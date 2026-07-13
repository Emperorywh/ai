/*
 * QueueOrchestrator 是单并发组合根：稳定拓扑排序后，只 await 当前 TASK 的一个阶段再继续。
 * 它独占运行锁、持久化每个 checkpoint，并在任何终态阻止下游任务被错误释放。
 */
import { randomUUID } from "node:crypto";
import { createStableTaskOrder } from "../domain/dag.js";
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedTaskManifest, TaskDefinition } from "../domain/manifest.js";
import {
  createInitialRunState,
  finishRun,
  type RunState,
} from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type { EventLogger } from "../ports/event-logger.js";
import type { RunLock } from "../ports/run-lock.js";
import type { StateStore } from "../ports/state-store.js";
import type { Workspace } from "../ports/workspace.js";
import type { TaskExecutionService } from "./task-execution-service.js";

export interface OrchestratorResult {
  readonly state: RunState;
  readonly artifacts: readonly string[];
}

export class QueueOrchestrator {
  public constructor(
    private readonly taskExecution: TaskExecutionService,
    private readonly stateStore: StateStore,
    private readonly runLock: RunLock,
    private readonly workspace: Workspace,
    private readonly logger: EventLogger,
    private readonly clock: Clock,
  ) {}

  public async start(
    loaded: LoadedTaskManifest,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    const runId = this.createRunId();
    const lock = await this.runLock.acquire(runId);
    try {
      await this.workspace.assertClean();
      const workspaceIdentity = await this.workspace.getIdentity();
      const now = this.now();
      const orderedTasks = createStableTaskOrder(loaded.manifest.tasks);
      const state = createInitialRunState({
        runId,
        manifestPath: loaded.manifestPath,
        manifestHash: loaded.manifestHash,
        projectRoot: loaded.projectRoot,
        workspace: {
          repositoryRoot: workspaceIdentity.repositoryRoot,
          branch: workspaceIdentity.branch,
          expectedHead: workspaceIdentity.head,
        },
        taskIds: orderedTasks.map((task) => task.id),
        now,
      });
      await this.checkpoint(state, undefined, "run_started", "新运行已创建");
      return await this.drive(loaded, orderedTasks, state, false, signal);
    } finally {
      await lock.release();
    }
  }

  public async resume(
    loaded: LoadedTaskManifest,
    runId: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    const existing = await this.stateStore.load(runId);
    if (existing === undefined) {
      throw new ConfigurationError(`找不到运行 ${runId}`);
    }
    this.assertResumeManifestCompatible(loaded, existing);
    if (existing.status !== "running") {
      return { state: existing, artifacts: [] };
    }

    const lock = await this.runLock.acquire(runId);
    try {
      await this.assertResumeWorkspaceCompatible(existing);
      const orderedTasks = createStableTaskOrder(loaded.manifest.tasks);
      await this.checkpoint(existing, undefined, "run_resumed", "恢复已有运行");
      return await this.drive(loaded, orderedTasks, existing, true, signal);
    } finally {
      await lock.release();
    }
  }

  public async getState(runId?: string): Promise<RunState | undefined> {
    const resolvedRunId = runId ?? await this.stateStore.getLatestRunId();
    return resolvedRunId === undefined
      ? undefined
      : this.stateStore.load(resolvedRunId);
  }

  private async drive(
    loaded: LoadedTaskManifest,
    orderedTasks: readonly TaskDefinition[],
    initialState: RunState,
    resumeExecutingOnEntry: boolean,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    let state = initialState;
    let shouldResumeExecution = resumeExecutingOnEntry;

    while (state.status === "running") {
      if (signal?.aborted === true) {
        await this.checkpoint(
          state,
          undefined,
          "run_interrupted",
          "收到中止信号，已停在最近 checkpoint",
        );
        return { state, artifacts: [] };
      }

      const currentTask = orderedTasks.find(
        (task) => state.tasks[task.id]?.status !== "completed",
      );
      if (currentTask === undefined) {
        const completedState = finishRun(state, "completed", this.now());
        const artifacts = await this.writeCompletionArtifacts(loaded, completedState);
        await this.checkpoint(
          completedState,
          undefined,
          "run_completed",
          "全部任务完成",
        );
        return { state: completedState, artifacts };
      }

      const taskState = state.tasks[currentTask.id];
      if (taskState === undefined) {
        throw new ConfigurationError(`运行状态缺少任务 ${currentTask.id}`);
      }
      if (taskState.status === "blocked" || taskState.status === "failed") {
        const status = taskState.status === "blocked" ? "blocked" : "failed";
        state = finishRun(
          state,
          status,
          this.now(),
          taskState.failureReason ?? `任务 ${currentTask.id} ${taskState.status}`,
        );
        await this.checkpoint(
          state,
          currentTask.id,
          `run_${status}`,
          state.failureReason ?? status,
        );
        return { state, artifacts: [] };
      }

      this.assertDependenciesCompleted(state, currentTask);

      const result = await this.taskExecution.step({
        loaded,
        state,
        task: currentTask,
        resumeExistingExecution: shouldResumeExecution,
        ...(signal === undefined ? {} : { signal }),
        onCheckpoint: async (checkpointState, message, details) => {
          state = checkpointState;
          await this.checkpoint(
            checkpointState,
            currentTask.id,
            "task_progress",
            message,
            details,
          );
        },
      });
      state = result.state;
      await this.checkpoint(
        state,
        currentTask.id,
        "task_progress",
        result.message,
        result.details,
      );

      shouldResumeExecution = false;
    }

    return { state, artifacts: [] };
  }

  private assertResumeManifestCompatible(
    loaded: LoadedTaskManifest,
    state: RunState,
  ): void {
    if (state.manifestPath !== loaded.manifestPath) {
      throw new ConfigurationError("Manifest 路径与运行快照不一致");
    }
    if (state.manifestHash !== loaded.manifestHash) {
      throw new ConfigurationError(
        "Manifest、SPEC、PLAN、TASK 或策略文件已变化，不能混用旧运行状态。请创建新运行。",
      );
    }
    if (state.projectRoot !== loaded.projectRoot) {
      throw new ConfigurationError("运行状态所属项目与当前项目不一致");
    }
  }

  private async assertResumeWorkspaceCompatible(state: RunState): Promise<void> {
    const current = await this.workspace.getIdentity();
    if (current.repositoryRoot !== state.workspace.repositoryRoot) {
      throw new ConfigurationError("Git 仓库身份与运行快照不一致");
    }
    if (current.branch !== state.workspace.branch) {
      throw new ConfigurationError(
        `Git 分支已变化：期望 ${state.workspace.branch}，实际 ${current.branch}`,
      );
    }
    if (current.head === state.workspace.expectedHead) {
      return;
    }

    const committingTask = Object.values(state.tasks).find(
      (task) => task.status === "committing",
    );
    if (committingTask?.candidateFingerprint !== undefined) {
      const recoveredCommit = await this.workspace.findTaskCommit({
        runId: state.runId,
        taskId: committingTask.taskId,
        expectedParent: state.workspace.expectedHead,
        candidateFingerprint: committingTask.candidateFingerprint,
      });
      if (recoveredCommit === current.head) {
        return;
      }
    }

    throw new ConfigurationError(
      `Git HEAD 已变化：期望 ${state.workspace.expectedHead}，实际 ${current.head}`,
    );
  }

  private assertDependenciesCompleted(
    state: RunState,
    task: TaskDefinition,
  ): void {
    const incomplete = task.dependsOn.filter(
      (dependencyId) => state.tasks[dependencyId]?.status !== "completed",
    );
    if (incomplete.length > 0) {
      throw new ConfigurationError(
        `任务 ${task.id} 的依赖尚未完成：${incomplete.join(", ")}`,
      );
    }
  }

  private async checkpoint(
    state: RunState,
    taskId: string | undefined,
    type: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.stateStore.save(state);
    await this.logger.log({
      timestamp: this.now(),
      runId: state.runId,
      ...(taskId === undefined ? {} : { taskId }),
      type,
      message,
      ...(details === undefined ? {} : { details }),
    });
  }

  private async writeCompletionArtifacts(
    loaded: LoadedTaskManifest,
    state: RunState,
  ): Promise<readonly string[]> {
    const manualAcceptance = [
      `# 人工验收清单`,
      "",
      `Run ID：${state.runId}`,
      "",
      ...loaded.manifest.tasks.flatMap((task) => [
        `## ${task.id} ${task.title}`,
        "",
        ...(task.manualAcceptance.length === 0
          ? ["- 未声明额外人工验收项"]
          : task.manualAcceptance.map((item) => `- [ ] ${item}`)),
        "",
      ]),
      "> 编排器没有启动浏览器或执行 UI 自动化；以上项目必须由人工验收。",
      "",
    ].join("\n");
    const summary = [
      "# 运行摘要",
      "",
      `- Run ID：${state.runId}`,
      `- 状态：${state.status}`,
      `- 创建时间：${state.createdAt}`,
      `- 完成时间：${state.updatedAt}`,
      "",
      ...loaded.manifest.tasks.map((task) => {
        const taskState = state.tasks[task.id];
        return `- ${task.id}: ${taskState?.status ?? "missing"} (${taskState?.commitSha ?? "no commit"})`;
      }),
      "",
    ].join("\n");

    return Promise.all([
      this.stateStore.writeArtifact(
        state.runId,
        "manual-acceptance.md",
        manualAcceptance,
      ),
      this.stateStore.writeArtifact(state.runId, "summary.md", summary),
    ]);
  }

  private createRunId(): string {
    const timestamp = this.now().replaceAll(/[:.]/gu, "-");
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
