/*
 * ReviewStage 只负责冻结候选的独立只读审核、审核遥测和修复反馈。
 * Worker 恢复与 Git 提交不进入本模块，Reviewer 每次都从新的隔离 session 启动。
 */
import { randomUUID } from "node:crypto";
import { CandidateChangedError } from "../domain/errors.js";
import {
  reviewResultSchema,
  type AgentRunOutcome,
  type ReviewResult,
} from "../domain/agent-result.js";
import {
  replaceCurrentReviewAttempt,
  replaceTaskFields,
  transitionTask,
  type ReviewAttemptState,
  type RunState,
  type TaskRunState,
} from "../domain/run-state.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { AgentModelResolver } from "../ports/agent-model-resolver.js";
import type { Clock } from "../ports/clock.js";
import type { ProjectContextProvider } from "../ports/project-context-provider.js";
import type { CandidateStore } from "../ports/workspace.js";
import { ORCHESTRATOR_POLICY } from "./orchestrator-policy.js";
import type { PromptBuilder } from "./prompt-builder.js";
import { ReviewSessionCheckpoint } from "./review-session-checkpoint.js";
import type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";
import type { TaskResourceBudget } from "./task-resource-budget.js";
import type { TaskStageSupport } from "./task-stage-support.js";

export class ReviewStage {
  public constructor(
    private readonly agent: AgentExecutor,
    private readonly workspace: CandidateStore,
    private readonly promptBuilder: PromptBuilder,
    private readonly projectContext: ProjectContextProvider,
    private readonly modelResolver: AgentModelResolver,
    private readonly clock: Clock,
    private readonly resourceBudget: TaskResourceBudget,
    private readonly support: TaskStageSupport,
  ) {}

  public async step(
    input: TaskStepInput,
    initialTaskState: TaskRunState,
  ): Promise<TaskStepResult> {
    if (initialTaskState.candidateFingerprint === undefined) {
      return this.support.block(input, "审核阶段缺少实现候选指纹");
    }
    const reconciledState = this.finishInterruptedReview(input.state, input.task.id);
    const taskState = reconciledState.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`任务 ${input.task.id} 缺少 Reviewer 状态`);
    }
    const exhaustionReason = this.resourceBudget.getExhaustionReason(
      taskState,
      "reviewer",
    );
    if (exhaustionReason !== undefined) {
      return this.support.block(
        input,
        `TASK 资源预算耗尽：${exhaustionReason}`,
        reconciledState,
      );
    }

    let reviewBundle: Awaited<ReturnType<CandidateStore["captureReviewCandidate"]>>;
    try {
      reviewBundle = await this.workspace.captureReviewCandidate();
    } catch (error) {
      if (error instanceof CandidateChangedError) {
        return this.support.block(input, error.message, reconciledState);
      }
      throw error;
    }
    if (reviewBundle.candidate.fingerprint !== taskState.candidateFingerprint) {
      return this.support.block(
        input,
        "候选内容在实现完成后发生变化，拒绝审核",
        reconciledState,
      );
    }
    /*
     * Reviewer 是独立的新 attempt，因此在冻结候选校验通过后读取一次当前 CC Switch 模型。
     * 解析结果先进入 reviewAttempt，再用于 SDK 请求和会话初始化 checkpoint。
     */
    const requestedModel = await this.modelResolver.resolveModel(
      input.loaded.projectRoot,
    );
    const sessionId = randomUUID();
    const reviewAttempt: ReviewAttemptState = {
      number: taskState.reviewAttempts.length + 1,
      sessionId,
      sessionInitialized: false,
      requestedModel,
      startedAt: this.support.now(),
    };
    let workingState = replaceTaskFields(
      reconciledState,
      input.task.id,
      { reviewAttempts: [...taskState.reviewAttempts, reviewAttempt] },
      this.support.now(),
    );
    await input.onCheckpoint?.(
      workingState,
      `开始第 ${reviewAttempt.number} 次 Reviewer 会话`,
      { sessionId },
    );
    const sessionCheckpoint = new ReviewSessionCheckpoint(
      workingState,
      input.task.id,
      reviewAttempt,
      this.clock,
      input.onCheckpoint,
    );
    const projectContext = await this.projectContext.compile(input.loaded.projectRoot);
    const outcome = await this.runAgent(
      input,
      reviewAttempt,
      reviewBundle.candidate.files.map((file) => file.path),
      reviewBundle.diff,
      taskState.attempts.at(-1)?.verifications ?? [],
      projectContext,
      sessionCheckpoint,
    );
    workingState = sessionCheckpoint.currentState;

    if (!outcome.ok && outcome.kind === "aborted") {
      return {
        state: this.finishAttempt(
          workingState,
          input.task.id,
          outcome,
          "interrupted",
        ),
        message: "审核被中止，恢复后将启动全新 Reviewer 会话",
        details: this.support.createOutcomeDetails(outcome),
      };
    }
    if (!outcome.ok) {
      const finishedState = this.finishAttempt(
        workingState,
        input.task.id,
        outcome,
        "failed",
      );
      if (outcome.retryable || isSessionResourceLimit(outcome.kind)) {
        return {
          state: transitionTask(
            finishedState,
            input.task.id,
            "reviewing",
            this.support.now(),
          ),
          message: `审核基础设施失败，将重试：${outcome.message}`,
          details: this.support.createOutcomeDetails(outcome),
        };
      }
      return {
        state: transitionTask(
          finishedState,
          input.task.id,
          "failed",
          this.support.now(),
          { failureReason: `审核失败：${outcome.message}` },
        ),
        message: `审核失败且无法继续：${outcome.message}`,
        details: this.support.createOutcomeDetails(outcome),
      };
    }

    const hasMaterialFindings = outcome.data.findings.some(
      (finding) => finding.severity !== "low",
    );
    const normalizedOutcome = outcome.data.status === "approved"
      && hasMaterialFindings
      ? "rejected" as const
      : outcome.data.status;
    const finishedState = this.finishAttempt(
      workingState,
      input.task.id,
      outcome,
      normalizedOutcome,
    );
    if (outcome.data.status === "blocked") {
      const reason = outcome.data.blockingQuestions.join("；")
        || outcome.data.summary;
      return {
        state: transitionTask(
          finishedState,
          input.task.id,
          "blocked",
          this.support.now(),
          { failureReason: reason },
        ),
        message: `审核需要人工决策：${reason}`,
        details: this.support.createOutcomeDetails(outcome),
      };
    }
    if (outcome.data.status === "rejected" || hasMaterialFindings) {
      const retry = this.support.scheduleRetry(input, finishedState, {
        kind: "repair",
        reason: "独立审核未通过",
        feedback: formatReviewFeedback(outcome.data),
      });
      return {
        ...retry,
        details: this.support.createOutcomeDetails(outcome),
      };
    }
    return {
      state: transitionTask(
        finishedState,
        input.task.id,
        "committing",
        this.support.now(),
      ),
      message: "独立审核通过，进入原子提交",
      details: this.support.createOutcomeDetails(outcome),
    };
  }

  private runAgent(
    input: TaskStepInput,
    reviewAttempt: ReviewAttemptState,
    changedFiles: readonly string[],
    diff: string,
    verifications: NonNullable<TaskRunState["attempts"][number]["verifications"]>,
    projectContext: Awaited<ReturnType<ProjectContextProvider["compile"]>>,
    sessionCheckpoint: ReviewSessionCheckpoint,
  ): Promise<AgentRunOutcome<ReviewResult>> {
    /*
     * Reviewer 请求只消费已持久化的 attempt 模型，不再次读取可变用户配置。
     * 连接字段仍由只读基础设施边界单独投影，模型选择不会削弱权限隔离。
     */
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
        verifications,
        projectContext,
      ),
      cwd: input.loaded.projectRoot,
      model: reviewAttempt.requestedModel,
      expectedResolvedModel: reviewAttempt.requestedModel,
      effort: ORCHESTRATOR_POLICY.reviewer.effort,
      maxTurns: ORCHESTRATOR_POLICY.reviewer.maxTurns,
      maxBudgetUsd: ORCHESTRATOR_POLICY.reviewer.maxBudgetUsd,
      timeoutMs: ORCHESTRATOR_POLICY.reviewer.timeoutMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      sessionId: reviewAttempt.sessionId,
      onSessionInitialized: (session) => sessionCheckpoint.initialize(session),
      resultSchema: reviewResultSchema,
    });
  }

  private finishInterruptedReview(state: RunState, taskId: string): RunState {
    const current = state.tasks[taskId]?.reviewAttempts.at(-1);
    if (current === undefined || current.finishedAt !== undefined) {
      return state;
    }
    return replaceCurrentReviewAttempt(
      state,
      taskId,
      {
        ...current,
        finishedAt: this.support.now(),
        outcome: "interrupted",
        summary: "进程在 Reviewer 终态落盘前中断",
      },
      this.support.now(),
    );
  }

  private finishAttempt(
    state: RunState,
    taskId: string,
    outcome: AgentRunOutcome<ReviewResult>,
    normalizedOutcome: ReviewAttemptState["outcome"],
  ): RunState {
    const current = state.tasks[taskId]?.reviewAttempts.at(-1);
    if (current === undefined) {
      throw new Error(`任务 ${taskId} 缺少当前 Reviewer attempt`);
    }
    const summary = outcome.ok ? outcome.data.summary : outcome.message;
    return replaceCurrentReviewAttempt(
      state,
      taskId,
      {
        ...current,
        finishedAt: this.support.now(),
        outcome: normalizedOutcome,
        summary,
        costUsd: outcome.costUsd,
        turns: outcome.turns,
        resolvedModel: outcome.telemetry.resolvedModel,
        durationMs: outcome.telemetry.durationMs,
        apiRetryCount: outcome.telemetry.apiRetryCount,
        apiRetryDelayMs: outcome.telemetry.apiRetryDelayMs,
        toolCalls: outcome.telemetry.toolCalls,
      },
      this.support.now(),
    );
  }
}

function isSessionResourceLimit(kind: string): boolean {
  return kind === "max_turns" || kind === "max_budget" || kind === "timeout";
}

function formatReviewFeedback(result: ReviewResult): string {
  const findings = result.findings.map((finding) =>
    `- [${finding.severity}] ${finding.file ?? "<unknown>"}${
      finding.line === undefined ? "" : `:${finding.line}`
    } ${finding.message}`);
  return `${result.summary}\n${findings.join("\n")}`;
}
