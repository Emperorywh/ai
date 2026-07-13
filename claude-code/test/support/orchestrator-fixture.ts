/*
 * 测试夹具以端口 Fake 代替 Claude、Git、进程和文件系统，只保留应用状态机的真实组合。
 * 所有可观察副作用都记录为显式字段，使测试能够推导执行顺序、并发度、提交与恢复参数。
 */
import type { AgentRunOutcome } from "../../src/domain/agent-result.js";
import {
  taskManifestSchema,
  type LoadedTaskManifest,
  type TaskDefinition,
} from "../../src/domain/manifest.js";
import type { RunState } from "../../src/domain/run-state.js";
import type {
  AgentExecutor,
  AgentRunRequest,
} from "../../src/ports/agent-executor.js";
import type { Clock } from "../../src/ports/clock.js";
import type { EventLogger, RunEvent } from "../../src/ports/event-logger.js";
import type { GateRunner } from "../../src/ports/gate-runner.js";
import type { RunLock, RunLockHandle } from "../../src/ports/run-lock.js";
import type { StateStore } from "../../src/ports/state-store.js";
import type { ChangeAuditResult, Workspace } from "../../src/ports/workspace.js";

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

export class PassingGateRunner implements GateRunner {
  public active = 0;
  public maxActive = 0;
  public readonly taskOrder: string[] = [];

  public async run(_cwd: string, gates: Parameters<GateRunner["run"]>[1]) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await Promise.resolve();
    this.active -= 1;
    return gates.map((gate) => ({
      name: gate.name,
      command: gate.command,
      args: gate.args,
      exitCode: 0,
      timedOut: false,
      stdout: "ok",
      stderr: "",
      durationMs: 1,
    }));
  }
}

export class RecordingWorkspace implements Workspace {
  public readonly commits: string[] = [];
  public cleanChecks = 0;

  public async getStateDirectory(): Promise<string> {
    return "/state";
  }

  public async getIdentity() {
    return {
      repositoryRoot: "/project",
      branch: "main",
      head: this.commits.at(-1)?.toLowerCase().concat("-sha") ?? "base-sha",
    };
  }

  public async assertClean(): Promise<void> {
    this.cleanChecks += 1;
  }

  public async auditChanges(task: TaskDefinition): Promise<ChangeAuditResult> {
    return {
      changedFiles: [`src/${task.id}.ts`],
      violations: [],
    };
  }

  public async captureCandidate() {
    return {
      fingerprint: "stable-candidate",
      diff: "diff --git a/file b/file",
    };
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
  }): Promise<string> {
    this.commits.push(input.task.id);
    return `${input.task.id.toLowerCase()}-sha`;
  }

  public async findTaskCommit(): Promise<string | undefined> {
    return undefined;
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
  }[],
): LoadedTaskManifest {
  const manifest = taskManifestSchema.parse({
    version: 1,
    project: {
      root: ".",
      contextFiles: [],
    },
    defaults: {
      maxAttempts: 3,
      taskTimeoutMinutes: 1,
      maxTurns: 10,
      model: "sonnet",
      effort: "high",
    },
    review: {
      enabled: false,
    },
    tasks: taskInputs.map((input) => ({
      id: input.id,
      title: input.id,
      file: `tasks/${input.id}.md`,
      dependsOn: input.dependsOn ?? [],
      scope: {
        allow: ["src/**"],
        deny: [],
      },
      gates: [{
        name: "test",
        command: "pnpm",
        args: ["test"],
      }],
      manualAcceptance: [],
    })),
  });
  const taskDocuments = new Map(
    manifest.tasks.map((task) => [
      task.id,
      { path: task.file, content: `# ${task.id}` },
    ]),
  );

  return {
    manifest,
    manifestPath: "/project/orchestrator.yaml",
    projectRoot: "/project",
    manifestHash: "manifest-hash",
    taskDocuments,
    contextDocuments: [],
    protectedPaths: [
      "orchestrator.yaml",
      ...manifest.tasks.map((task) => task.file),
    ],
  };
}
