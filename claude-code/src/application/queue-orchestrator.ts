/*
 * QueueOrchestrator 是严格线性驱动器：每轮只推进当前 TASK 的一个阶段并持久化 checkpoint。
 * 当前任务只有完成后才会开放后继；阻塞或失败会在隔离候选后立即结束整个 Run。
 */
import { randomUUID } from "node:crypto";
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedProject, TaskDefinition } from "../domain/project.js";
import {
  createInitialRunState,
  finishRun,
  replaceTaskFields,
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
    loaded: LoadedProject,
    options: StartRunOptions = {},
  ): Promise<OrchestratorResult> {
    const runId = this.createRunId();
    const lock = await this.runLock.acquire(runId);
    try {
      await this.workspace.assertClean();
      const workspaceIdentity = await this.workspace.getIdentity();
      const now = this.now();
      const orderedTasks = loaded.tasks;
      const progressPlan = await this.taskProgress.createPlan({
        loaded,
        head: workspaceIdentity.head,
        fresh: options.fresh === true,
      });
      const state = createInitialRunState({
        runId,
        projectHash: loaded.projectHash,
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
    loaded: LoadedProject,
    runId: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorResult> {
    const existing = await this.stateStore.load(runId);
    if (existing === undefined) {
      throw new ConfigurationError(`找不到运行 ${runId}`);
    }
    this.assertResumeProjectCompatible(loaded, existing);
    if (existing.status !== "running") {
      return { state: existing, artifacts: [] };
    }

    const lock = await this.runLock.acquire(runId);
    try {
      await this.assertResumeWorkspaceCompatible(existing);
      const orderedTasks = loaded.tasks;
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
    loaded: LoadedProject,
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

      const stateAfterQuarantine = await this.quarantineTerminalCandidate(
        state,
        orderedTasks,
      );
      if (stateAfterQuarantine !== undefined) {
        state = stateAfterQuarantine;
        continue;
      }

      const currentTask = this.selectCurrentTask(state, orderedTasks);
      if (currentTask === undefined) {
        return this.finishLinearRun(loaded, state, orderedTasks);
      }

      const taskState = state.tasks[currentTask.id];
      if (taskState === undefined) {
        throw new ConfigurationError(`运行状态缺少任务 ${currentTask.id}`);
      }
      this.assertPreviousTasksCompleted(state, orderedTasks, currentTask);

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
   * 当前终态候选归档是结束线性 Run 的前置条件；每轮只处理一个任务并立即 checkpoint。
   * 崩溃恢复会通过确定性 Git ref 找回已归档候选，不会重复覆盖或丢失文件树。
   */
  private async quarantineTerminalCandidate(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<RunState | undefined> {
    const task = orderedTasks.find(
      (candidate) => state.tasks[candidate.id]?.status !== "completed",
    );
    const taskState = task === undefined ? undefined : state.tasks[task.id];
    if (
      taskState?.status !== "blocked"
      && taskState?.status !== "failed"
    ) {
      return undefined;
    }
    if (taskState.candidateArchive !== undefined) {
      return undefined;
    }
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
   * 第一个未完成任务就是线性队列的唯一当前位置，不允许跳过它扫描后继任务。
   * 当前位置进入 blocked/failed 后返回空，由收敛逻辑立即结束 Run 并保留后续 pending 状态。
   */
  private selectCurrentTask(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): TaskDefinition | undefined {
    const task = orderedTasks.find(
      (candidate) => state.tasks[candidate.id]?.status !== "completed",
    );
    if (task === undefined) {
      return undefined;
    }
    const status = state.tasks[task.id]?.status;
    if (status === undefined) {
      throw new ConfigurationError(`运行状态缺少任务 ${task.id}`);
    }
    return status === "blocked" || status === "failed" ? undefined : task;
  }

  /*
   * 没有当前位置只可能表示全部完成，或队首未完成任务已经 blocked/failed。
   * pending 后继不参与终态计算，避免把尚未开放的任务误报为额外失败。
   */
  private async finishLinearRun(
    loaded: LoadedProject,
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<OrchestratorResult> {
    const allCompleted = orderedTasks.every(
      (task) => state.tasks[task.id]?.status === "completed",
    );
    const terminalTask = orderedTasks
      .map((task) => state.tasks[task.id])
      .find((taskState) =>
        taskState?.status === "blocked" || taskState?.status === "failed");
    if (!allCompleted && terminalTask === undefined) {
      throw new ConfigurationError("线性队列没有可执行任务，也没有可解释的终态任务");
    }
    const terminalStatus = allCompleted
      ? "completed" as const
      : terminalTask?.status === "failed"
        ? "failed" as const
        : "blocked" as const;
    const failureReason = allCompleted
      ? undefined
      : `${terminalTask?.taskId ?? "unknown"}: ${terminalTask?.failureReason ?? terminalStatus}`;
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

  private assertResumeProjectCompatible(
    loaded: LoadedProject,
    state: RunState,
  ): void {
    if (state.projectHash !== loaded.projectHash) {
      throw new ConfigurationError(
        "orchestration/SPEC.md 或 TASK 已变化，不能混用旧运行状态。请创建新运行。",
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

  /*
   * 线性队列要求当前位置之前的所有 TASK 都已完成，直接前驱完成只是该不变量的最小表现。
   * 完整检查可以在损坏或人工构造的恢复状态进入 Agent 前立即暴露顺序缺口。
   */
  private assertPreviousTasksCompleted(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
    task: TaskDefinition,
  ): void {
    const taskIndex = orderedTasks.findIndex((candidate) => candidate.id === task.id);
    if (taskIndex < 0) {
      throw new ConfigurationError(`线性任务序列中不存在任务：${task.id}`);
    }
    const incomplete = orderedTasks.slice(0, taskIndex).filter(
      (previousTask) => state.tasks[previousTask.id]?.status !== "completed",
    );
    if (incomplete.length > 0) {
      throw new ConfigurationError(
        `任务 ${task.id} 之前仍有任务未完成：${incomplete
          .map((previousTask) => previousTask.id)
          .join(", ")}`,
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
    loaded: LoadedProject,
    state: RunState,
  ): Promise<readonly string[]> {
    const acceptanceChecklist = [
      `# 人工验收清单`,
      "",
      `Run ID：${state.runId}`,
      "",
      ...loaded.tasks
        .filter((task) => state.tasks[task.id]?.status === "completed")
        .flatMap((task) => [
        `## ${task.id} ${task.title}`,
        "",
        "- [ ] 按该 TASK 的任务描述完成人工验收",
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
        acceptanceChecklist,
      ),
      this.stateStore.writeArtifact(state.runId, "summary.md", summary),
    ]);
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
   * 队列计划在运行开始和恢复时显式输出，展示 TASK 目录经过严格校验后的真实线性顺序。
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
