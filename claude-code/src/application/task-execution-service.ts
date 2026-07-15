/*
 * TaskExecutionService 每次只推进一个 TASK 的一个显式阶段，不持有队列，也不直接保存状态。
 * 自主实现、独立审核和原子提交分别通过端口完成，使每个阶段都能独立测试并从快照恢复。
 */
import { randomUUID } from "node:crypto";
import {
  implementationResultSchema,
  reviewResultSchema,
  type AgentRunOutcome,
  type ImplementationResult,
  type ReviewResult,
} from "../domain/agent-result.js";
import type { LoadedProject, TaskDefinition } from "../domain/project.js";
import {
  replaceCurrentAttempt,
  replaceExpectedHead,
  replaceTaskFields,
  transitionTask,
  type RetryContext,
  type RunState,
  type TaskAttemptState,
  type TaskCompletionState,
  type TaskRunState,
} from "../domain/run-state.js";
import { createPredecessorCompletionFingerprint } from "../domain/task-completion.js";
import { findTaskPredecessor } from "../domain/task-sequence.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { Clock } from "../ports/clock.js";
import type { Workspace } from "../ports/workspace.js";
import {
  AgentSessionCheckpoint,
  type TaskCheckpointWriter,
} from "./agent-session-checkpoint.js";
import { ORCHESTRATOR_POLICY } from "./orchestrator-policy.js";
import type { PromptBuilder } from "./prompt-builder.js";

export interface TaskStepResult {
  readonly state: RunState;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TaskStepInput {
  readonly loaded: LoadedProject;
  readonly state: RunState;
  readonly task: TaskDefinition;
  readonly resumeExistingExecution: boolean;
  readonly signal?: AbortSignal;
  readonly onCheckpoint?: TaskCheckpointWriter;
}

export class TaskExecutionService {
  public constructor(
    private readonly agent: AgentExecutor,
    private readonly workspace: Workspace,
    private readonly promptBuilder: PromptBuilder,
    private readonly clock: Clock,
  ) {}

  public async step(input: TaskStepInput): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`运行状态中不存在任务 ${input.task.id}`);
    }

    switch (taskState.status) {
      case "pending":
      case "retry_pending":
        return this.prepareAttempt(input, taskState);
      case "executing":
        return this.executeAgent(input, taskState);
      case "reviewing":
        return this.executeReview(input, taskState);
      case "committing":
        return this.commitTask(input);
      case "completed":
      case "blocked":
      case "failed":
        return { state: input.state, message: `任务已处于终态 ${taskState.status}` };
    }
  }

  private async prepareAttempt(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    if (taskState.status === "pending") {
      await this.workspace.assertClean();
    }

    const retry = taskState.status === "retry_pending" ? taskState.retry : undefined;
    const kind = taskState.status === "pending"
      ? "implementation" as const
      : retry?.kind === "resume"
        ? "resume" as const
        : "repair" as const;
    const sessionId = kind === "resume"
      ? retry?.resumeSessionId
      : randomUUID();
    if (sessionId === undefined) {
      throw new Error(`任务 ${input.task.id} 的恢复上下文缺少 sessionId`);
    }

    const now = this.now();
    const attempt: TaskAttemptState = {
      number: taskState.attempts.length + 1,
      kind,
      sessionId,
      sessionInitialized: kind === "resume",
      startedAt: now,
    };
    const state = transitionTask(
      input.state,
      input.task.id,
      "executing",
      now,
      {
        attempts: [...taskState.attempts, attempt],
        candidateFingerprint: undefined,
      },
    );

    return {
      state,
      message: `开始第 ${attempt.number} 次 ${kind} 会话`,
      details: { sessionId },
    };
  }

  private async executeAgent(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    let attempt = taskState.attempts.at(-1);
    if (attempt === undefined) {
      throw new Error(`任务 ${input.task.id} 执行阶段缺少 attempt`);
    }

    let workingState = input.state;
    if (input.resumeExistingExecution && !attempt.sessionInitialized) {
      attempt = {
        ...attempt,
        sessionId: randomUUID(),
      };
      workingState = replaceCurrentAttempt(
        workingState,
        input.task.id,
        attempt,
        this.now(),
      );
      await input.onCheckpoint?.(
        workingState,
        "上次会话尚未初始化，已准备全新会话",
        { sessionId: attempt.sessionId },
      );
    }

    const shouldResume = attempt.sessionInitialized
      && (attempt.kind === "resume" || input.resumeExistingExecution);
    const feedback = taskState.retry?.feedback ?? "上次会话在落盘前中断，请检查当前工作区并继续。";
    const prompt = shouldResume
      ? this.promptBuilder.buildResume(input.loaded, input.task)
      : attempt.kind === "implementation"
        ? this.promptBuilder.buildImplementation(input.loaded, input.task)
        : this.promptBuilder.buildRepair(input.loaded, input.task, feedback);
    const sessionCheckpoint = new AgentSessionCheckpoint(
      workingState,
      input.task.id,
      attempt,
      this.clock,
      input.onCheckpoint,
    );
    const outcome = await this.runImplementationAgent(
      input,
      attempt,
      shouldResume,
      prompt,
      sessionCheckpoint,
    );
    workingState = sessionCheckpoint.currentState;

    if (!outcome.ok && outcome.kind === "aborted") {
      return {
        state: workingState,
        message: "Agent 被中止，保留 executing 快照供下次精确恢复",
      };
    }

    const finishedState = this.finishAttempt(workingState, input.task.id, outcome);
    if (!outcome.ok) {
      return this.handleAgentFailure(input, finishedState, outcome);
    }

    if (outcome.data.status === "blocked") {
      const reason = this.joinBlockingReason(outcome.data);
      return {
        state: transitionTask(
          finishedState,
          input.task.id,
          "blocked",
          this.now(),
          { failureReason: reason },
        ),
        message: `任务需要人工决策：${reason}`,
      };
    }

    if (outcome.data.status === "failed") {
      return this.scheduleRetry(
        input,
        finishedState,
        {
          kind: "repair",
          reason: "Agent 主动报告实现失败",
          feedback: outcome.data.summary,
        },
      );
    }

    /*
     * Worker 成功后立即冻结完整项目候选，后续 Reviewer 与提交阶段都绑定同一份指纹。
     * 不存在外部命令门禁或路径审计，候选的正确性只由任务契约和独立审核判断。
     */
    const candidate = await this.workspace.captureCandidate();
    return {
      state: transitionTask(
        finishedState,
        input.task.id,
        "reviewing",
        this.now(),
        { candidateFingerprint: candidate.fingerprint },
      ),
      message: "实现会话完成，进入独立审核",
    };
  }

  private runImplementationAgent(
    input: TaskStepInput,
    attempt: TaskAttemptState,
    shouldResume: boolean,
    prompt: string,
    sessionCheckpoint: AgentSessionCheckpoint,
  ): Promise<AgentRunOutcome<ImplementationResult>> {
    return this.agent.run({
      access: "write",
      attemptKind: shouldResume ? "resume" : attempt.kind,
      taskId: input.task.id,
      title: input.task.title,
      prompt,
      cwd: input.loaded.projectRoot,
      model: ORCHESTRATOR_POLICY.worker.model,
      effort: ORCHESTRATOR_POLICY.worker.effort,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(shouldResume
        ? { resumeSessionId: attempt.sessionId }
        : { sessionId: attempt.sessionId }),
      onSessionInitialized: (sessionId) => sessionCheckpoint.initialize(sessionId),
      resultSchema: implementationResultSchema,
    });
  }

  private async executeReview(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    if (taskState.candidateFingerprint === undefined) {
      return this.blockTask(input, "审核阶段缺少实现候选指纹");
    }

    const candidate = await this.workspace.captureCandidate();
    if (candidate.fingerprint !== taskState.candidateFingerprint) {
      return this.blockTask(
        input,
        "候选内容在实现完成后发生变化，拒绝审核",
      );
    }
    const outcome = await this.runReviewAgent(
      input,
      candidate.files.map((file) => file.path),
      candidate.diff,
    );

    if (!outcome.ok && outcome.kind === "aborted") {
      return { state: input.state, message: "审核被中止，恢复后将启动全新审核会话" };
    }

    const reviewAttempts = taskState.reviewAttempts + 1;
    if (!outcome.ok) {
      if (outcome.retryable) {
        return {
          state: transitionTask(
            input.state,
            input.task.id,
            "reviewing",
            this.now(),
            {
              reviewAttempts,
              ...(outcome.sessionId === undefined
                ? {}
                : { reviewSessionId: outcome.sessionId }),
              reviewSummary: outcome.message,
            },
          ),
          message: `审核基础设施失败，将重试：${outcome.message}`,
        };
      }

      return {
        state: transitionTask(
          input.state,
          input.task.id,
          "failed",
          this.now(),
          {
            reviewAttempts,
            failureReason: `审核失败：${outcome.message}`,
          },
        ),
        message: `审核失败且无法继续：${outcome.message}`,
      };
    }

    const hasMaterialFindings = outcome.data.findings.some(
      (finding) => finding.severity !== "low",
    );
    if (outcome.data.status === "blocked") {
      const reason = outcome.data.blockingQuestions.join("；") || outcome.data.summary;
      return {
        state: transitionTask(
          input.state,
          input.task.id,
          "blocked",
          this.now(),
          {
            reviewAttempts,
            reviewSessionId: outcome.sessionId,
            reviewSummary: outcome.data.summary,
            failureReason: reason,
          },
        ),
        message: `审核需要人工决策：${reason}`,
      };
    }

    if (outcome.data.status === "rejected" || hasMaterialFindings) {
      const stateWithReview = replaceTaskFields(
        input.state,
        input.task.id,
        {
          reviewAttempts,
          reviewSessionId: outcome.sessionId,
          reviewSummary: outcome.data.summary,
        },
        this.now(),
      );
      return this.scheduleRetry(input, stateWithReview, {
        kind: "repair",
        reason: "独立审核未通过",
        feedback: this.formatReviewFeedback(outcome.data),
      });
    }

    return {
      state: transitionTask(
        input.state,
        input.task.id,
        "committing",
        this.now(),
        {
          reviewAttempts,
          reviewSessionId: outcome.sessionId,
          reviewSummary: outcome.data.summary,
        },
      ),
      message: "独立审核通过，进入原子提交",
    };
  }

  private runReviewAgent(
    input: TaskStepInput,
    changedFiles: readonly string[],
    diff: string,
  ): Promise<AgentRunOutcome<ReviewResult>> {
    return this.agent.run({
      access: "read",
      attemptKind: "review",
      taskId: input.task.id,
      title: input.task.title,
      prompt: this.promptBuilder.buildReview(
        input.loaded,
        input.task,
        changedFiles,
        diff,
      ),
      cwd: input.loaded.projectRoot,
      model: ORCHESTRATOR_POLICY.reviewer.model,
      effort: ORCHESTRATOR_POLICY.reviewer.effort,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      sessionId: randomUUID(),
      resultSchema: reviewResultSchema,
    });
  }

  private async commitTask(input: TaskStepInput): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState?.candidateFingerprint === undefined) {
      return this.blockTask(input, "提交阶段缺少实现候选指纹");
    }
    const completion = this.createCompletionState(input);
    const existingCommit = await this.workspace.findTaskCommit(
      {
        runId: input.state.runId,
        taskId: input.task.id,
        expectedParent: input.state.workspace.expectedHead,
        candidateFingerprint: taskState.candidateFingerprint,
      },
    );
    if (existingCommit !== undefined) {
      await this.workspace.assertClean();
      const completed = transitionTask(
        input.state,
        input.task.id,
        "completed",
        this.now(),
        { commitSha: existingCommit, completion },
      );
      return {
        state: replaceExpectedHead(completed, existingCommit, this.now()),
        message: `检测到已完成提交 ${existingCommit}，恢复为 completed`,
      };
    }

    /*
     * 提交阶段不要求非空 diff；自主 Worker 或人工预先实现都可能已经满足 TASK。
     * 空候选与非空候选使用同一指纹约束，并由 Workspace 生成可复用完成证据。
     */

    const candidate = await this.workspace.captureCandidate();
    if (candidate.fingerprint !== taskState.candidateFingerprint) {
      return this.blockTask(
        input,
        "候选内容在实现或审核完成后发生变化，拒绝提交",
      );
    }

    const commitSha = await this.workspace.commitTask({
      runId: input.state.runId,
      task: input.task,
      messagePrefix: ORCHESTRATOR_POLICY.git.commitMessagePrefix,
      expectedHead: input.state.workspace.expectedHead,
      expectedFingerprint: taskState.candidateFingerprint,
      taskContractHash: completion.contractHash,
      predecessorFingerprint: completion.predecessorFingerprint,
    });
    const completed = transitionTask(
      input.state,
      input.task.id,
      "completed",
      this.now(),
      { commitSha, completion },
    );
    return {
      state: replaceExpectedHead(completed, commitSha, this.now()),
      message: `任务已提交：${commitSha}`,
    };
  }

  /*
   * 完成提交绑定当前 TASK 契约与直接前驱的具体提交，形成可沿线性序列推导的验证链。
   * 缺少前驱提交属于状态不变量破坏，必须立即失败，不能写入可被后续 Run 误复用的证据。
   */
  private createCompletionState(input: TaskStepInput): TaskCompletionState {
    const contractHash = input.loaded.taskContractHashes.get(input.task.id);
    if (contractHash === undefined) {
      throw new Error(`任务缺少完成契约指纹：${input.task.id}`);
    }
    const predecessor = findTaskPredecessor(input.loaded.tasks, input.task.id);
    const predecessorCompletion = predecessor === undefined
      ? undefined
      : {
          taskId: predecessor.id,
          commitSha: this.requireCompletedTaskCommit(input.state, predecessor.id),
        };
    return {
      origin: "executed",
      evidenceRunId: input.state.runId,
      contractHash,
      predecessorFingerprint: createPredecessorCompletionFingerprint(
        predecessorCompletion,
      ),
    };
  }

  private requireCompletedTaskCommit(state: RunState, taskId: string): string {
    /*
     * 前驱状态与提交必须同时存在，completed 但缺少 commitSha 仍是不可写入证据的损坏状态。
     * 守卫集中在完成证据边界，避免 Workspace 接收到无法验证的空前驱事实。
     */
    const taskState = state.tasks[taskId];
    if (taskState?.status !== "completed" || taskState.commitSha === undefined) {
      throw new Error(`前驱任务缺少完成提交：${taskId}`);
    }
    return taskState.commitSha;
  }

  private handleAgentFailure(
    input: TaskStepInput,
    state: RunState,
    outcome: Extract<AgentRunOutcome<ImplementationResult>, { ok: false }>,
  ): TaskStepResult {
    if (!outcome.retryable) {
      return {
        state: transitionTask(
          state,
          input.task.id,
          "failed",
          this.now(),
          { failureReason: outcome.message },
        ),
        message: `Agent 不可重试失败：${outcome.message}`,
      };
    }

    return this.scheduleRetry(input, state, {
      kind: outcome.sessionId === undefined ? "repair" : "resume",
      reason: `Agent ${outcome.kind} 错误`,
      feedback: outcome.message,
      ...(outcome.sessionId === undefined
        ? {}
        : { resumeSessionId: outcome.sessionId }),
    });
  }

  /*
   * 任务级尝试次数和超时已经从静态 TASK 契约删除，repair 循环只受明确阻塞或外部中止控制。
   * 该方法只负责构造下一次显式尝试，不再混入按任务变化的资源策略分支。
   */
  private scheduleRetry(
    input: TaskStepInput,
    state: RunState,
    retry: RetryContext,
  ): TaskStepResult {
    return {
      state: transitionTask(
        state,
        input.task.id,
        "retry_pending",
        this.now(),
        { retry, candidateFingerprint: undefined },
      ),
      message: `${retry.reason}，准备新的 ${retry.kind} 尝试`,
    };
  }

  private finishAttempt(
    state: RunState,
    taskId: string,
    outcome: AgentRunOutcome<ImplementationResult>,
  ): RunState {
    const taskState = state.tasks[taskId];
    const current = taskState?.attempts.at(-1);
    if (current === undefined) {
      throw new Error(`任务 ${taskId} 缺少当前 attempt`);
    }
    const summary = outcome.ok ? outcome.data.summary : outcome.message;
    const attempt: TaskAttemptState = {
      ...current,
      finishedAt: this.now(),
      outcome: outcome.ok ? outcome.data.status : "failed",
      summary,
      costUsd: outcome.costUsd,
      turns: outcome.turns,
    };
    return replaceCurrentAttempt(state, taskId, attempt, this.now());
  }

  private blockTask(
    input: TaskStepInput,
    reason: string,
    state: RunState = input.state,
  ): TaskStepResult {
    return {
      state: transitionTask(
        state,
        input.task.id,
        "blocked",
        this.now(),
        { failureReason: reason },
      ),
      message: `任务无法继续：${reason}`,
    };
  }

  private joinBlockingReason(result: ImplementationResult): string {
    return result.blockingQuestions.join("；") || result.summary;
  }


  private formatReviewFeedback(result: ReviewResult): string {
    const findings = result.findings.map((finding) =>
      `- [${finding.severity}] ${finding.file ?? "<unknown>"}${
        finding.line === undefined ? "" : `:${finding.line}`
      } ${finding.message}`);
    return `${result.summary}\n${findings.join("\n")}`;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
