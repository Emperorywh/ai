/*
 * 测试夹具以端口 Fake 代替 Claude、Git、进程和文件系统，只保留应用状态机的真实组合。
 * 所有可观察副作用都记录为显式字段，使测试能够推导执行顺序、并发度、提交与恢复参数。
 */
import type { AgentRunOutcome } from "../../src/domain/agent-result.js";
import {
  taskDefinitionSchema,
  taskManifestSchema,
  type LoadedTaskManifest,
  type TaskDefinition,
} from "../../src/domain/manifest.js";
import type { RunState } from "../../src/domain/run-state.js";
import { createTaskContractHash } from "../../src/domain/task-completion.js";
import type {
  AgentExecutor,
  AgentRunRequest,
} from "../../src/ports/agent-executor.js";
import type { Clock } from "../../src/ports/clock.js";
import type { EventLogger, RunEvent } from "../../src/ports/event-logger.js";
import type { RunLock, RunLockHandle } from "../../src/ports/run-lock.js";
import type { StateStore } from "../../src/ports/state-store.js";
import type {
  CandidateSnapshot,
  TaskCompletionEvidence,
  Workspace,
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

export class RecordingWorkspace implements Workspace {
  public readonly commits: string[] = [];
  public cleanChecks = 0;
  public quarantines = 0;
  private currentHead = "base-sha";
  private readonly completionHistory: TaskCompletionEvidence[] = [];

  public async getStateDirectory(): Promise<string> {
    return "/state";
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

  public async captureCandidate(): Promise<CandidateSnapshot> {
    return createCandidate("stable-candidate");
  }

  public async quarantineCandidate() {
    this.quarantines += 1;
    return {
      reference: `refs/quarantine/${this.quarantines}`,
      changedFiles: ["src/candidate.ts"],
    };
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    dependencyFingerprint: string;
  }): Promise<string> {
    this.commits.push(input.task.id);
    const commitSha = `${input.task.id.toLowerCase()}-${this.commits.length}-sha`;
    this.currentHead = commitSha;
    this.completionHistory.unshift({
      taskId: input.task.id,
      commitSha,
      runId: input.runId,
      taskContractHash: input.taskContractHash,
      dependencyFingerprint: input.dependencyFingerprint,
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

export type AgentBehavior = (
  request: AgentRunRequest<unknown>,
) => AgentRunOutcome<unknown>;

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
      await request.onSessionInitialized?.(sessionId);
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2));
    const outcome = this.behavior(request);
    this.active -= 1;
    return outcome as AgentRunOutcome<T>;
  }
}

export function completedBehavior(
  request: AgentRunRequest<unknown>,
): AgentRunOutcome<unknown> {
  return {
    ok: true,
      sessionId: request.sessionId ?? request.resumeSessionId ?? "missing-session",
    data: {
      status: "completed",
      summary: `${request.taskId} complete`,
      blockingQuestions: [],
      notes: [],
    },
    costUsd: 0.01,
    turns: 2,
  };
}

export function createLoadedManifest(
  taskInputs: readonly {
    id: string;
    dependsOn?: readonly string[];
    contractRevision?: string;
  }[],
): LoadedTaskManifest {
  const manifest = taskManifestSchema.parse({
    version: 3,
    project: {
      root: ".",
      contextFiles: [],
    },
    defaults: {
      model: "sonnet",
      effort: "high",
    },
    review: {
      enabled: false,
    },
    taskCatalog: {
      directory: "tasks",
    },
  });
  const tasks = taskInputs.map((input) => taskDefinitionSchema.parse({
      id: input.id,
      title: input.id,
      file: `tasks/${input.id}.md`,
      dependsOn: input.dependsOn ?? [],
      manualAcceptance: [],
    }));
  const taskDocuments = new Map(
    tasks.map((task) => [
      task.id,
      {
        path: task.file,
        content: `# ${task.id}\n${taskInputs.find((input) => input.id === task.id)?.contractRevision ?? ""}`,
      },
    ]),
  );
  /*
   * 测试夹具使用与生产仓储相同的契约哈希函数，跨 Run 复用测试不会依赖手写假哈希。
   * contractRevision 只改变指定 TASK 正文，便于验证局部失效和 DAG 下游传播。
   */
  const taskContractHashes = new Map(tasks.map((task) => {
    const taskDocument = taskDocuments.get(task.id);
    if (taskDocument === undefined) {
      throw new Error(`测试任务缺少文档：${task.id}`);
    }
    return [
      task.id,
      createTaskContractHash({
        manifest,
        task,
        taskDocument,
        contextDocuments: [],
      }),
    ] as const;
  }));

  return {
    manifest,
    tasks,
    manifestPath: "/project/orchestrator.yaml",
    projectRoot: "/project",
    manifestHash: "manifest-hash",
    taskDocuments,
    taskContractHashes,
    contextDocuments: [],
  };
}

/*
 * 候选快照包含结构化文件记录，使审核与提交测试不依赖 diff 文本或暂存区表现。
 * fingerprint 参数由用例控制，文件哈希同步变化以维持快照内部语义一致。
 */
export function createCandidate(fingerprint: string): CandidateSnapshot {
  return {
    fingerprint,
    diff: "diff --git a/file b/file",
    files: [{
      path: "src/candidate.ts",
      kind: "file",
      mode: 0o100644,
      contentHash: fingerprint,
    }],
  };
}
