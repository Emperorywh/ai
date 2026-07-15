/*
 * QueueOrchestrator 是单并发 DAG 驱动器：每轮只推进一个 TASK 阶段并持久化 checkpoint。
 * 终态候选先隔离，依赖子图显式阻塞，互不依赖的可运行节点继续执行到全局收敛。
 */
import { randomUUID } from "node:crypto";
import { createStableTaskOrder } from "../domain/dag.js";
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedTaskManifest, TaskDefinition } from "../domain/manifest.js";
import {
  createInitialRunState,
  finishRun,
  replaceTaskFields,
  transitionTask,
  type RunState,
} from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type { EventLogger } from "../ports/event-logger.js";
import type { RunLock } from "../ports/run-lock.js";
import type { StateStore } from "../ports/state-store.js";
import type { TimeFormatter } from "../ports/time-formatter.js";
import type { Workspace } from "../ports/workspace.js";
import type { TaskExecutionService } from "./task-execution-service.js";
import type { TaskProgressReconciler } from "./task-progress-reconciler.js";

export interface OrchestratorResult {
  readonly state: RunState;
  readonly artifacts: readonly string[];
}

/*
 * 新 Run 默认核验并复用项目级完成证据；fresh 只由显式 CLI 参数开启。
 * signal 与运行策略放在同一选项对象中，避免后续扩展继续增加易混淆的位置参数。
 */
export interface StartRunOptions {
  readonly fresh?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class QueueOrchestrator {
  public constructor(
    private readonly taskExecution: TaskExecutionService,
    private readonly taskProgress: TaskProgressReconciler,
    private readonly stateStore: StateStore,
    private readonly runLock: RunLock,
    private readonly workspace: Workspace,
    private readonly logger: EventLogger,
    private readonly clock: Clock,
    private readonly timeFormatter: TimeFormatter,
  ) {}

  public async start(
    loaded: LoadedTaskManifest,
    options: StartRunOptions = {},
  ): Promise<OrchestratorResult> {
    const runId = this.createRunId();
    const lock = await this.runLock.acquire(runId);
    try {
      await this.workspace.assertClean();
      const workspaceIdentity = await this.workspace.getIdentity();
      const now = this.now();
      const orderedTasks = createStableTaskOrder(loaded.tasks);
      const progressPlan = await this.taskProgress.createPlan({
        loaded,
        orderedTasks,
        head: workspaceIdentity.head,
        fresh: options.fresh === true,
      });
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
        tasks: progressPlan.tasks,
        now,
      });
      const reusedTaskIds = progressPlan.decisions
        .filter((decision) => decision.reason === "reused")
        .map((decision) => decision.taskId);
      const pendingTaskIds = progressPlan.decisions
        .filter((decision) => decision.reason !== "reused")
        .map((decision) => decision.taskId);
      await this.checkpoint(
        state,
        undefined,
        "run_started",
        `${this.describeTaskQueue("新运行已创建", orderedTasks)}；复用 ${reusedTaskIds.length} 个，待执行 ${pendingTaskIds.length} 个`,
        {
          taskOrder: orderedTasks.map((task) => task.id),
          fresh: options.fresh === true,
          reusedTaskIds,
          pendingTaskIds,
          reuseDecisions: progressPlan.decisions,
        },
      );
      return await this.drive(
        loaded,
        orderedTasks,
        state,
        false,
        options.signal,
      );
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
      const orderedTasks = createStableTaskOrder(loaded.tasks);
      await this.checkpoint(
        existing,
        undefined,
        "run_resumed",
        this.describeTaskQueue("恢复已有运行", orderedTasks),
        { taskOrder: orderedTasks.map((task) => task.id) },
      );
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

      const stateAfterQuarantine = await this.quarantineNextTerminalCandidate(
        state,
        orderedTasks,
      );
      if (stateAfterQuarantine !== undefined) {
        state = stateAfterQuarantine;
        continue;
      }

      const stateAfterDependencyPropagation = await this.propagateNextDependencyBlock(
        state,
        orderedTasks,
      );
      if (stateAfterDependencyPropagation !== undefined) {
        state = stateAfterDependencyPropagation;
        continue;
      }

      const currentTask = this.selectRunnableTask(state, orderedTasks);
      if (currentTask === undefined) {
        return this.finishConvergedRun(loaded, state, orderedTasks);
      }

      const taskState = state.tasks[currentTask.id];
      if (taskState === undefined) {
        throw new ConfigurationError(`运行状态缺少任务 ${currentTask.id}`);
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

  /*
   * 终态候选归档是释放主工作区的前置条件；每轮只处理一个任务并立即 checkpoint。
   * 崩溃恢复会通过确定性 Git ref 找回已归档候选，不会重复覆盖或丢失文件树。
   */
  private async quarantineNextTerminalCandidate(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<RunState | undefined> {
    const task = orderedTasks.find((candidate) => {
      const taskState = state.tasks[candidate.id];
      return (taskState?.status === "blocked" || taskState?.status === "failed")
        && taskState.candidateArchive === undefined;
    });
    if (task === undefined) {
      return undefined;
    }

    const archive = await this.workspace.quarantineCandidate({
      runId: state.runId,
      taskId: task.id,
    });
    const nextState = replaceTaskFields(
      state,
      task.id,
      {
        candidateArchive: {
          ...(archive.reference === undefined ? {} : { reference: archive.reference }),
          changedFiles: archive.changedFiles,
          archivedAt: this.now(),
        },
      },
      this.now(),
    );
    await this.checkpoint(
      nextState,
      task.id,
      "task_candidate_quarantined",
      archive.reference === undefined
        ? "终态任务没有未提交候选，工作区保持干净"
        : `终态任务候选已隔离到 ${archive.reference}`,
      { changedFiles: archive.changedFiles },
    );
    return nextState;
  }

  /*
   * 依赖阻塞按拓扑顺序逐个传播，状态中会保留直接未完成依赖而不是笼统跳过。
   * 传播只处理 pending 节点，已完成或正在执行的任务不会被回溯修改。
   */
  private async propagateNextDependencyBlock(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<RunState | undefined> {
    const task = orderedTasks.find((candidate) => {
      const taskState = state.tasks[candidate.id];
      return taskState?.status === "pending"
        && candidate.dependsOn.some((dependencyId) => {
          const dependencyStatus = state.tasks[dependencyId]?.status;
          return dependencyStatus === "blocked"
            || dependencyStatus === "failed"
            || dependencyStatus === "dependency_blocked";
        });
    });
    if (task === undefined) {
      return undefined;
    }

    const blockedDependencies = task.dependsOn.filter(
      (dependencyId) => state.tasks[dependencyId]?.status !== "completed",
    );
    const reason = `依赖任务未完成：${blockedDependencies.join(", ")}`;
    const nextState = transitionTask(
      state,
      task.id,
      "dependency_blocked",
      this.now(),
      { failureReason: reason },
    );
    await this.checkpoint(
      nextState,
      task.id,
      "task_dependency_blocked",
      reason,
    );
    return nextState;
  }

  /*
   * 已进入执行阶段的任务拥有当前主工作区，必须优先恢复；否则选择第一个依赖均完成的节点。
   * blocked/failed 节点不会终止扫描，互不依赖的后续节点仍可继续推进。
   */
  private selectRunnableTask(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): TaskDefinition | undefined {
    return orderedTasks.find((task) => {
      const status = state.tasks[task.id]?.status;
      return status === "executing"
        || status === "gating"
        || status === "reviewing"
        || status === "committing";
    }) ?? orderedTasks.find((task) => {
      const status = state.tasks[task.id]?.status;
      return (status === "pending" || status === "retry_pending")
        && task.dependsOn.every(
          (dependencyId) => state.tasks[dependencyId]?.status === "completed",
        );
    });
  }

  /*
   * 没有可运行节点表示 DAG 已全局收敛，此时统一计算 Run 终态并生成完整产物。
   * failed 优先于 blocked，避免部分成功掩盖任何已经耗尽重试的任务。
   */
  private async finishConvergedRun(
    loaded: LoadedTaskManifest,
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<OrchestratorResult> {
    const allCompleted = orderedTasks.every(
      (task) => state.tasks[task.id]?.status === "completed",
    );
    const terminalStatus = allCompleted
      ? "completed" as const
      : orderedTasks.some((task) => state.tasks[task.id]?.status === "failed")
        ? "failed" as const
        : "blocked" as const;
    const failureReason = allCompleted
      ? undefined
      : this.describeTerminalFailures(state, orderedTasks);
    const completedState = finishRun(
      state,
      terminalStatus,
      this.now(),
      failureReason,
    );
    const artifacts = await this.writeRunArtifacts(loaded, completedState);
    await this.checkpoint(
      completedState,
      undefined,
      `run_${terminalStatus}`,
      terminalStatus === "completed" ? "全部任务完成" : failureReason ?? terminalStatus,
    );
    return { state: completedState, artifacts };
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

  private async writeRunArtifacts(
    loaded: LoadedTaskManifest,
    state: RunState,
  ): Promise<readonly string[]> {
    const manualAcceptance = [
      `# 人工验收清单`,
      "",
      `Run ID：${state.runId}`,
      "",
      ...loaded.tasks
        .filter((task) => state.tasks[task.id]?.status === "completed")
        .flatMap((task) => [
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
      `- 创建时间：${this.timeFormatter.formatTimestamp(state.createdAt)}`,
      `- 完成时间：${this.timeFormatter.formatTimestamp(state.updatedAt)}`,
      "",
      ...loaded.tasks.map((task) => {
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

  private describeTerminalFailures(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): string {
    return orderedTasks
      .map((task) => state.tasks[task.id])
      .filter((taskState) => taskState?.status !== "completed")
      .map((taskState) =>
        `${taskState?.taskId ?? "unknown"}: ${taskState?.failureReason ?? taskState?.status ?? "missing"}`)
      .join("；");
  }

  private createRunId(): string {
    /*
     * runId 同时出现在终端、状态目录和验收文档，因此时间部分也必须遵循北京时间展示契约。
     * 随机后缀继续只负责同一毫秒内的唯一性，不承载任何时间或排序语义。
     */
    const timestamp = this.timeFormatter.formatRunIdTimestamp(this.clock.now());
    return `${timestamp}-${randomUUID().slice(0, 8)}`;
  }

  /*
   * 队列计划在运行开始和恢复时显式输出，展示 TASK 目录经过严格校验后的真实 DAG 顺序。
   * 日志中的数量必须与目录加载结果一致，便于在 Agent 启动前确认完整任务范围。
   */
  private describeTaskQueue(
    prefix: string,
    orderedTasks: readonly TaskDefinition[],
  ): string {
    return `${prefix}，队列共 ${orderedTasks.length} 个任务：${orderedTasks
      .map((task) => task.id)
      .join(" → ")}`;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
