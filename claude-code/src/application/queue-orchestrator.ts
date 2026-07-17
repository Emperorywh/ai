/*
 * QueueOrchestrator 是严格线性驱动器：每轮只推进当前 TASK 的一个阶段并持久化 checkpoint。
 * 当前任务只有完成后才会开放后继；阻塞或失败会在隔离候选后立即结束整个 Run。
 */
import { randomUUID } from "node:crypto";
import {
  ConfigurationError,
  InfrastructureError,
} from "../domain/errors.js";
import type { LoadedProject, TaskDefinition } from "../domain/project.js";
import {
  createInitialRunState,
  replaceExpectedHead,
  type RunState,
} from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type { RunLock } from "../ports/run-lock.js";
import type { StateStore } from "../ports/state-store.js";
import type { TimeFormatter } from "../ports/time-formatter.js";
import type {
  WorkspaceIdentityStore,
} from "../ports/workspace.js";
import type {
  TaskExecutionService,
  TaskStepResult,
} from "./task-execution-service.js";
import type { TaskProgressReconciler } from "./task-progress-reconciler.js";
import { aggregateRunMetrics, collectRunModelUsage } from "./run-metrics.js";
import type { RunArtifactWriter } from "./run-artifact-writer.js";
import type { RunCheckpointWriter } from "./run-checkpoint-writer.js";
import type { RunFinalizer } from "./run-finalizer.js";
import type { RunResumeValidator } from "./run-resume-validator.js";
import type { TerminalCandidateService } from "./terminal-candidate-service.js";

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

/*
 * 依赖对象显式展示队列驱动器的协作者，避免长位置参数在新增职责时发生错装配。
 * 恢复、收敛、产物和 checkpoint 均由专用服务持有，QueueOrchestrator 只控制线性推进顺序。
 */
export interface QueueOrchestratorDependencies {
  readonly taskExecution: TaskExecutionService;
  readonly taskProgress: TaskProgressReconciler;
  readonly stateStore: StateStore;
  readonly runLock: RunLock;
  readonly workspace: WorkspaceIdentityStore;
  readonly checkpoints: RunCheckpointWriter;
  readonly resumeValidator: RunResumeValidator;
  readonly finalizer: RunFinalizer;
  readonly artifacts: RunArtifactWriter;
  readonly terminalCandidates: TerminalCandidateService;
  readonly clock: Clock;
  readonly timeFormatter: TimeFormatter;
}

export class QueueOrchestrator {
  private readonly taskExecution: TaskExecutionService;
  private readonly taskProgress: TaskProgressReconciler;
  private readonly stateStore: StateStore;
  private readonly runLock: RunLock;
  private readonly workspace: WorkspaceIdentityStore;
  private readonly checkpoints: RunCheckpointWriter;
  private readonly resumeValidator: RunResumeValidator;
  private readonly finalizer: RunFinalizer;
  private readonly artifacts: RunArtifactWriter;
  private readonly terminalCandidates: TerminalCandidateService;
  private readonly clock: Clock;
  private readonly timeFormatter: TimeFormatter;

  public constructor(dependencies: QueueOrchestratorDependencies) {
    this.taskExecution = dependencies.taskExecution;
    this.taskProgress = dependencies.taskProgress;
    this.stateStore = dependencies.stateStore;
    this.runLock = dependencies.runLock;
    this.workspace = dependencies.workspace;
    this.checkpoints = dependencies.checkpoints;
    this.resumeValidator = dependencies.resumeValidator;
    this.finalizer = dependencies.finalizer;
    this.artifacts = dependencies.artifacts;
    this.terminalCandidates = dependencies.terminalCandidates;
    this.clock = dependencies.clock;
    this.timeFormatter = dependencies.timeFormatter;
  }

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
        orderedTasks,
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
    this.resumeValidator.validateProjectAndState(loaded, existing);
    if (existing.status !== "running") {
      return { state: existing, artifacts: [] };
    }

    const lock = await this.runLock.acquire(runId);
    try {
      const orderedTasks = loaded.tasks;
      const workspaceResolution = await this.resumeValidator.validateWorkspace(
        existing,
      );
      /*
       * 恢复校验只返回可接受的新 HEAD，驱动器负责先把它写入 run_resumed checkpoint。
       * 后续 CommitStage 因而始终从持久化基线继续，不依赖本进程内的临时协调结果。
       */
      const resumedState = workspaceResolution.reconciledHead === undefined
        ? existing
        : replaceExpectedHead(
            existing,
            workspaceResolution.reconciledHead,
            this.now(),
          );
      await this.checkpoint(
        resumedState,
        orderedTasks,
        undefined,
        "run_resumed",
        this.describeTaskQueue(
          workspaceResolution.reconciledHead === undefined
            ? "恢复已有运行"
            : `恢复已有运行，项目外 HEAD 快进已协调至 ${workspaceResolution.reconciledHead}`,
          orderedTasks,
        ),
        {
          taskOrder: orderedTasks.map((task) => task.id),
          ...(workspaceResolution.reconciledHead === undefined
            ? {}
            : {
                previousExpectedHead: existing.workspace.expectedHead,
                reconciledExpectedHead: workspaceResolution.reconciledHead,
              }),
        },
      );
      return await this.drive(loaded, orderedTasks, resumedState, true, signal);
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
          orderedTasks,
          undefined,
          "run_interrupted",
          "收到中止信号，已停在最近 checkpoint",
        );
        return { state, artifacts: [] };
      }

      const stateAfterQuarantine = await this.terminalCandidates.archiveIfNecessary(
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

      let result: TaskStepResult;
      try {
        result = await this.taskExecution.step({
          loaded,
          state,
          task: currentTask,
          resumeExistingExecution: shouldResumeExecution,
          ...(signal === undefined ? {} : { signal }),
          onCheckpoint: async (checkpointState, message, details) => {
            state = checkpointState;
            await this.checkpoint(
              checkpointState,
              orderedTasks,
              currentTask.id,
              "task_progress",
              message,
              details,
            );
          },
        });
      } catch (error) {
        /*
         * 基础设施中断不是 TASK 实现失败：保留最近 executing checkpoint，既不创建 repair，
         * 也不把瞬时安装/进程故障计入 Worker 预算；环境恢复后由 resume 重建未初始化会话。
         */
        if (!(error instanceof InfrastructureError)) {
          throw error;
        }
        await this.checkpoint(
          state,
          orderedTasks,
          currentTask.id,
          "run_infrastructure_interrupted",
          `基础设施故障，Run 已保留为可恢复状态：${error.message}`,
        );
        return { state, artifacts: [] };
      }
      state = result.state;
      await this.checkpoint(
        state,
        orderedTasks,
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
    const finalization = this.finalizer.finalize(
      state,
      orderedTasks,
      this.now(),
    );
    const artifacts = await this.artifacts.write(loaded, finalization.state);
    const runMetrics = aggregateRunMetrics(finalization.state);
    await this.checkpoint(
      finalization.state,
      orderedTasks,
      undefined,
      `run_${finalization.terminalStatus}`,
      finalization.message,
      {
        metrics: runMetrics,
        models: collectRunModelUsage(finalization.state),
      },
    );
    return { state: finalization.state, artifacts };
  }

  private async checkpoint(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
    taskId: string | undefined,
    type: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.checkpoints.write({
      state,
      orderedTasks,
      ...(taskId === undefined ? {} : { taskId }),
      type,
      message,
      ...(details === undefined ? {} : { details }),
    });
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
