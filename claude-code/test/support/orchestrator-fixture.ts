/*
 * 测试夹具以端口 Fake 代替 Claude、Git、进程和文件系统，只保留应用状态机的真实组合。
 * 所有可观察副作用都记录为显式字段，使测试能够推导执行顺序、并发度、提交与恢复参数。
 */
import type { AgentRunOutcome } from "../../src/domain/agent-result.js";
import { encodeCanonicalUtf8 } from "../../src/domain/canonical-json.js";
import {
  PROJECT_STRUCTURE,
  taskDefinitionSchema,
  type LoadedProject,
  type TaskDefinition,
  type TextDocument,
} from "../../src/domain/project.js";
import {
  createSpecContractHash,
  createTaskContractHash,
  splitTaskDocument,
} from "../../src/domain/project-contract.js";
import type { RunState } from "../../src/domain/run-state.js";
import type { ProjectContextProvider } from "../../src/ports/project-context-provider.js";
import { createLinearTaskSequence } from "../../src/domain/task-sequence.js";
import { NodeCanonicalHashService } from "../../src/infrastructure/canonical/node-canonical-hash-service.js";
import type {
  AgentExecutor,
  AgentRunRequest,
} from "../../src/ports/agent-executor.js";
import type { AgentModelResolver } from "../../src/ports/agent-model-resolver.js";
import type { Clock } from "../../src/ports/clock.js";
import type { EventLogger, RunEvent } from "../../src/ports/event-logger.js";
import type { RunLock, RunLockHandle } from "../../src/ports/run-lock.js";
import type { StateStore } from "../../src/ports/state-store.js";
import type {
  CandidateSnapshot,
  TaskCompletionEvidence,
  Workspace,
  WorkspaceHeadAdvance,
} from "../../src/ports/workspace.js";

export class FakeClock implements Clock {
  private milliseconds = Date.parse("2026-07-13T00:00:00.000Z");

  public now(): Date {
    const current = new Date(this.milliseconds);
    this.milliseconds += 1_000;
    return current;
  }
}

export class MemoryStateStore implements StateStore {
  public readonly snapshots: RunState[] = [];
  public readonly artifacts = new Map<string, string>();
  private readonly states = new Map<string, RunState>();
  private latestRunId: string | undefined;

  public async save(state: RunState): Promise<void> {
    const copy = structuredClone(state);
    this.snapshots.push(copy);
    this.states.set(state.runId, copy);
    this.latestRunId = state.runId;
  }

  public async load(runId: string): Promise<RunState | undefined> {
    return this.states.get(runId);
  }

  public async getLatestRunId(): Promise<string | undefined> {
    return this.latestRunId;
  }

  public async writeArtifact(
    runId: string,
    name: string,
    content: string,
  ): Promise<string> {
    const path = `/state/runs/${runId}/${name}`;
    this.artifacts.set(path, content);
    return path;
  }
}

export class RecordingRunLock implements RunLock {
  public active = 0;
  public maxActive = 0;

  public async acquire(): Promise<RunLockHandle> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return {
      release: async () => {
        this.active -= 1;
      },
    };
  }
}

export class RecordingLogger implements EventLogger {
  public readonly events: RunEvent[] = [];

  public async log(event: RunEvent): Promise<void> {
    this.events.push(event);
  }
}

/*
 * 应用测试使用固定项目清单，确保阶段测试不依赖真实文件系统，也能验证上下文已进入提示词。
 * 生产编译器的排序、截断和脚本发现由独立基础设施测试覆盖。
 */
export class FixedProjectContextProvider implements ProjectContextProvider {
  public async compile() {
    return {
      fingerprint: "test-project-context",
      packageManager: "pnpm" as const,
      scripts: [{ name: "test", command: "vitest run" }],
      scriptsTruncated: false,
      entries: ["src/", "src/index.ts"],
      truncated: false,
      diagnostics: [],
    };
  }
}

export class FixedAgentModelResolver implements AgentModelResolver {
  public readonly resolvedDirectories: string[] = [];

  public constructor(private readonly model = "claude-sonnet-5") {}

  /*
   * 应用测试通过显式模型 Fake 模拟 CC Switch 的当前选择，并记录解析边界的调用目录。
   * Fake 不读取开发机用户设置，因此测试结果不会随本地 Provider 切换而变化。
   */
  public async resolveModel(cwd: string): Promise<string> {
    this.resolvedDirectories.push(cwd);
    return this.model;
  }
}

export class RecordingWorkspace implements Workspace {
  public readonly commits: string[] = [];
  public readonly commitExpectedHeads: string[] = [];
  public cleanChecks = 0;
  public quarantines = 0;
  public readonly restoredCandidates: {
    reference?: string | undefined;
    expectedFingerprint: string;
  }[] = [];
  public readonly consumedCandidateArchives: string[] = [];
  private currentHead = "base-sha";
  private readonly completionHistory: TaskCompletionEvidence[] = [];
  private readonly headAdvances = new Map<string, WorkspaceHeadAdvance>();

  public async getStateDirectory(): Promise<string> {
    return "/state";
  }

  public async getLockDirectory(): Promise<string> {
    return "/worktree-lock";
  }

  public async getIdentity() {
    return {
      repositoryRoot: "/project",
      branch: "main",
      head: this.currentHead,
    };
  }

  public async assertClean(): Promise<void> {
    this.cleanChecks += 1;
  }

  public async inspectHeadAdvance(input: {
    expectedHead: string;
    currentHead: string;
  }): Promise<WorkspaceHeadAdvance> {
    return this.headAdvances.get(
      `${input.expectedHead}\0${input.currentHead}`,
    ) ?? { kind: "diverged" };
  }

  public advanceHead(
    head: string,
    changedProjectFiles: readonly string[] = [],
  ): void {
    /*
     * Fake 显式记录 HEAD 图关系，避免测试根据 SHA 文本猜测祖先关系。
     * changedProjectFiles 为空表示与故障现场一致的兄弟项目提交。
     */
    this.headAdvances.set(`${this.currentHead}\0${head}`, {
      kind: "descendant",
      changedProjectFiles,
    });
    this.currentHead = head;
  }

  public async captureCandidate(): Promise<CandidateSnapshot> {
    return createCandidate("stable-candidate");
  }

  public async captureReviewCandidate() {
    return {
      candidate: createCandidate("stable-candidate"),
      diff: "diff --git a/file b/file",
    };
  }

  public async quarantineCandidate() {
    this.quarantines += 1;
    return {
      reference: `refs/quarantine/${this.quarantines}`,
      changedFiles: ["src/candidate.ts"],
    };
  }

  /*
   * 应用层 Fake 只记录 blocked 候选恢复协议；真实 Git 文件恢复与引用消费由基础设施测试覆盖。
   * 记录完整输入可以断言编排器没有绕过冻结指纹，也没有恢复错误的隔离引用。
   */
  public async restoreCandidate(input: {
    reference?: string | undefined;
    expectedFingerprint: string;
  }): Promise<string> {
    this.restoredCandidates.push(input);
    return input.expectedFingerprint;
  }

  /*
   * Fake 将引用消费与候选恢复分开记录，锁定“先 checkpoint、后消费”的两阶段恢复协议。
   * 真实引用删除仍由 GitWorkspace 集成测试验证，不在应用层测试里模拟 Git 对象数据库。
   */
  public async consumeCandidateArchive(reference: string): Promise<void> {
    this.consumedCandidateArchives.push(reference);
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    predecessorFingerprint: string;
  }): Promise<string> {
    /*
     * Fake 与生产提交器共享严格 expectedHead 前置条件，防止应用测试在错误基线上假成功。
     * 这样只有显式协调并 checkpoint 的 HEAD 才能进入提交记录。
     */
    if (input.expectedHead !== this.currentHead) {
      throw new Error(
        `Fake 提交基线不一致：期望 ${input.expectedHead}，实际 ${this.currentHead}`,
      );
    }
    this.commitExpectedHeads.push(input.expectedHead);
    this.commits.push(input.task.id);
    const parentHead = this.currentHead;
    /*
     * Fake 提交 OID 使用合法完整十六进制格式，与生产 Git 对象身份共享同一契约约束。
     * 计数器保证每个提交唯一，测试不会依赖可读字符串绕过 OID 校验。
     */
    const commitSha = this.commits.length.toString(16).padStart(40, "0");
    this.currentHead = commitSha;
    /*
     * 任务提交会改变当前项目树；恢复校验必须先走精确 trailer 证据，不能误当作安全项目外快进。
     * 该事实让应用测试同时覆盖提交成功但 checkpoint 尚未落盘的既有恢复窗口。
     */
    this.headAdvances.set(`${parentHead}\0${commitSha}`, {
      kind: "descendant",
      changedProjectFiles: ["src/candidate.ts"],
    });
    this.completionHistory.unshift({
      taskId: input.task.id,
      commitSha,
      runId: input.runId,
      taskContractHash: input.taskContractHash,
      predecessorFingerprint: input.predecessorFingerprint,
    });
    return commitSha;
  }

  public async findTaskCommit(): Promise<string | undefined> {
    return undefined;
  }

  public async readTaskCompletionHistory(): Promise<readonly TaskCompletionEvidence[]> {
    return this.completionHistory;
  }
}

type TestAgentOutcome =
  | Omit<Extract<AgentRunOutcome<unknown>, { ok: true }>, "telemetry">
  | Omit<Extract<AgentRunOutcome<unknown>, { ok: false }>, "telemetry">;

export type AgentBehavior = (
  request: AgentRunRequest<unknown>,
) => TestAgentOutcome;

export class RecordingAgent implements AgentExecutor {
  public active = 0;
  public maxActive = 0;
  public readonly requests: AgentRunRequest<unknown>[] = [];

  public constructor(private readonly behavior: AgentBehavior = completedBehavior) {}

  public async run<T>(request: AgentRunRequest<T>): Promise<AgentRunOutcome<T>> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.requests.push(request);
    const sessionId = request.sessionId ?? request.resumeSessionId;
    if (sessionId !== undefined) {
      await request.onSessionInitialized?.({
        sessionId,
        resolvedModel: request.expectedResolvedModel,
      });
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2));
    const outcome = this.behavior(request);
    this.active -= 1;
    return {
      ...outcome,
      telemetry: {
        requestedModel: request.model,
        resolvedModel: request.expectedResolvedModel,
        durationMs: 2,
        apiRetryCount: 0,
        apiRetryDelayMs: 0,
        toolCalls: 1,
      },
    } as AgentRunOutcome<T>;
  }
}

export function completedBehavior(
  request: AgentRunRequest<unknown>,
): TestAgentOutcome {
  /*
   * 系统固定执行独立审核，因此默认 Fake 同时覆盖 Worker 完成和 Reviewer 通过两类协议。
   * 测试若关心拒绝、阻塞或重试，会在用例中显式替换对应行为。
   */
  if (request.attemptKind === "review") {
    return {
      ok: true,
      sessionId: request.sessionId ?? "missing-review-session",
      data: {
        status: "approved",
        summary: `${request.taskId} review approved`,
        findings: [],
        blockingQuestions: [],
      },
      costUsd: 0.01,
      turns: 1,
    };
  }
  return {
    ok: true,
      sessionId: request.sessionId ?? request.resumeSessionId ?? "missing-session",
    data: {
      status: "completed",
      summary: `${request.taskId} complete`,
      blockingQuestions: [],
      notes: [],
      verifications: [{
        scope: "full",
        command: "pnpm test",
        status: "passed",
        summary: "测试通过",
      }],
    },
    costUsd: 0.01,
    turns: 2,
  };
}

export function createLoadedProject(
  taskInputs: readonly {
    id: string;
    contractRevision?: string;
  }[],
): LoadedProject {
  /*
   * 应用层夹具同样提供唯一规格文档，避免测试通过空上下文绕过生产不变量。
   * 所有任务契约共享该规格，contractRevision 仍只用于控制单个 TASK 的局部变化。
   */
  const canonicalHash = new NodeCanonicalHashService();
  const hashText = (text: string): string =>
    canonicalHash.digestBytes(encodeCanonicalUtf8(text));
  const specificationDocument: TextDocument = {
    path: PROJECT_STRUCTURE.specification,
    content: "# 规格说明\n\n测试项目规格。\n",
    sourceHash: hashText("# 规格说明\n\n测试项目规格。\n"),
  };
  const specificationContractHash = createSpecContractHash(
    specificationDocument.content,
    canonicalHash,
  );
  const tasks = createLinearTaskSequence(taskInputs.map((input) => taskDefinitionSchema.parse({
      id: input.id,
      title: input.id,
      file: `${PROJECT_STRUCTURE.taskDirectory}/${input.id}.md`,
    })));
  const taskDocuments = new Map(
    tasks.map((task) => {
      const content = `---\nid: ${task.id}\ntitle: ${task.title}\n---\n\n## 任务描述\n\n${taskInputs.find((input) => input.id === task.id)?.contractRevision ?? "测试任务正文"}\n`;
      return [
        task.id,
        { path: task.file, content, sourceHash: hashText(content) },
      ] as const;
    }),
  );
  /*
   * 测试夹具使用与生产仓储相同的契约哈希函数，跨 Run 复用测试不会依赖手写假哈希。
   * contractRevision 只改变指定 TASK 正文，便于验证局部失效和线性后继传播。
   */
  const taskContractHashes = new Map(tasks.map((task) => {
    const taskDocument = taskDocuments.get(task.id);
    if (taskDocument === undefined) {
      throw new Error(`测试任务缺少文档：${task.id}`);
    }
    return [
      task.id,
      createTaskContractHash(
        {
          task,
          body: splitTaskDocument(taskDocument.content)?.body ?? "",
          specContractHash: specificationContractHash,
        },
        canonicalHash,
      ),
    ] as const;
  }));

  return {
    tasks,
    projectRoot: "/project",
    projectHash: "project-hash",
    taskDocuments,
    taskContractHashes,
    specificationDocument,
    specificationContractHash,
  };
}

/*
 * 候选快照包含结构化文件记录，使审核与提交测试不依赖 diff 文本或暂存区表现。
 * fingerprint 参数由用例控制，文件哈希同步变化以维持快照内部语义一致。
 */
export function createCandidate(fingerprint: string): CandidateSnapshot {
  return {
    fingerprint,
    files: [{
      path: "src/candidate.ts",
      kind: "file",
      mode: 0o100644,
      contentHash: fingerprint,
    }],
  };
}
