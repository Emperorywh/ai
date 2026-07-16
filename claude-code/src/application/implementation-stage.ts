/*
 * ImplementationStage 只负责 Worker 尝试、恢复、资源收敛和候选冻结前检查点。
 * Reviewer 与 Git 完成证据不进入本模块，使写入会话生命周期可以独立测试和演进。
 */
import { randomUUID } from "node:crypto";
import {
  implementationResultSchema,
  type AgentRunOutcome,
  type ImplementationResult,
} from "../domain/agent-result.js";
import {
  replaceCurrentAttempt,
  transitionTask,
  type RunState,
  type TaskAttemptState,
  type TaskRunState,
} from "../domain/run-state.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { AgentModelResolver } from "../ports/agent-model-resolver.js";
import type { Clock } from "../ports/clock.js";
import type { ProjectContextProvider } from "../ports/project-context-provider.js";
import type {
  CandidateStore,
  WorkspaceIdentityStore,
} from "../ports/workspace.js";
import { AgentSessionCheckpoint } from "./agent-session-checkpoint.js";
import { ORCHESTRATOR_POLICY } from "./orchestrator-policy.js";
import type { PromptBuilder } from "./prompt-builder.js";
import type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";
import type { TaskResourceBudget } from "./task-resource-budget.js";
import type { TaskStageSupport } from "./task-stage-support.js";

export class ImplementationStage {
  public constructor(
    private readonly agent: AgentExecutor,
    private readonly workspace: CandidateStore & Pick<WorkspaceIdentityStore, "assertClean">,
    private readonly promptBuilder: PromptBuilder,
    private readonly projectContext: ProjectContextProvider,
    private readonly modelResolver: AgentModelResolver,
    private readonly clock: Clock,
    private readonly resourceBudget: TaskResourceBudget,
    private readonly support: TaskStageSupport,
  ) {}

  public async step(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    if (taskState.status === "pending" || taskState.status === "retry_pending") {
      return this.prepareAttempt(input, taskState);
    }
    if (taskState.status === "executing") {
      return this.executeAgent(input, taskState);
    }
    if (taskState.status === "candidate_pending") {
      return this.freezeCandidate(input);
    }
    throw new Error(`ImplementationStage 不支持状态 ${taskState.status}`);
  }

  private async prepareAttempt(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    const exhaustionReason = this.resourceBudget.getExhaustionReason(
      taskState,
      "worker",
    );
    if (exhaustionReason !== undefined) {
      return this.support.block(input, `TASK 资源预算耗尽：${exhaustionReason}`);
    }
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

    /*
     * 只在创建新 attempt 时读取 CC Switch 当前模型，并立即保存为可恢复的执行事实。
     * 同一 attempt 后续执行或进程恢复都复用该快照，不依赖可变的全局用户配置。
     */
    const requestedModel = await this.modelResolver.resolveModel(
      input.loaded.projectRoot,
    );

    const now = this.support.now();
    const attempt: TaskAttemptState = {
      number: taskState.attempts.length + 1,
      kind,
      sessionId,
      sessionInitialized: kind === "resume",
      requestedModel,
      startedAt: now,
    };
    return {
      state: transitionTask(
        input.state,
        input.task.id,
        "executing",
        now,
        {
          attempts: [...taskState.attempts, attempt],
          candidateFingerprint: undefined,
        },
      ),
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
      attempt = { ...attempt, sessionId: randomUUID() };
      workingState = replaceCurrentAttempt(
        workingState,
        input.task.id,
        attempt,
        this.support.now(),
      );
      await input.onCheckpoint?.(
        workingState,
        "上次会话尚未初始化，已准备全新会话",
        { sessionId: attempt.sessionId },
      );
    }

    const shouldResume = attempt.sessionInitialized
      && (attempt.kind === "resume" || input.resumeExistingExecution);
    const feedback = taskState.retry?.feedback
      ?? "上次会话在落盘前中断，请检查当前工作区并继续。";
    const projectContext = await this.projectContext.compile(input.loaded.projectRoot);
    const prompt = shouldResume
      ? this.promptBuilder.buildResume(
          input.loaded,
          input.task,
          feedback,
          projectContext,
        )
      : attempt.kind === "implementation"
        ? this.promptBuilder.buildImplementation(
            input.loaded,
            input.task,
            projectContext,
          )
        : this.promptBuilder.buildRepair(
            input.loaded,
            input.task,
            feedback,
            projectContext,
          );
    const sessionCheckpoint = new AgentSessionCheckpoint(
      workingState,
      input.task.id,
      attempt,
      this.clock,
      input.onCheckpoint,
    );
    const outcome = await this.runAgent(
      input,
      attempt,
      shouldResume,
      prompt,
      sessionCheckpoint,
    );
    workingState = sessionCheckpoint.currentState;

    if (!outcome.ok && outcome.kind === "aborted") {
      const interruptedState = this.finishAttempt(
        workingState,
        input.task.id,
        outcome,
        "interrupted",
      );
      const current = interruptedState.tasks[input.task.id]?.attempts.at(-1);
      const retry = current?.sessionInitialized === true
        && outcome.sessionId !== undefined
        ? this.support.scheduleRetry(input, interruptedState, {
            kind: "resume",
            reason: "Agent 被外部中止",
            feedback: "上次会话被外部中止，请从当前文件和工具状态继续未完成工作。",
            resumeSessionId: outcome.sessionId,
          })
        : this.support.scheduleRetry(input, interruptedState, {
            kind: "repair",
            reason: "Agent 在会话初始化前被外部中止",
            feedback: "请检查当前工作区，只继续尚未完成的部分。",
          });
      return { ...retry, details: this.support.createOutcomeDetails(outcome) };
    }

    const completedWithFailedVerification = outcome.ok
      && outcome.data.status === "completed"
      && outcome.data.verifications.some(
        (verification) => verification.status === "failed",
      );
    const finishedState = this.finishAttempt(
      workingState,
      input.task.id,
      outcome,
      completedWithFailedVerification ? "failed" : undefined,
    );
    if (!outcome.ok) {
      return this.handleFailure(input, finishedState, outcome);
    }
    if (outcome.data.status === "blocked") {
      const reason = outcome.data.blockingQuestions.join("；") || outcome.data.summary;
      return {
        state: transitionTask(
          finishedState,
          input.task.id,
          "blocked",
          this.support.now(),
          { failureReason: reason },
        ),
        message: `任务需要人工决策：${reason}`,
        details: this.support.createOutcomeDetails(outcome),
      };
    }
    if (outcome.data.status === "failed") {
      const retry = this.support.scheduleRetry(input, finishedState, {
        kind: "repair",
        reason: "Agent 主动报告实现失败",
        feedback: outcome.data.summary,
      });
      return { ...retry, details: this.support.createOutcomeDetails(outcome) };
    }
    const failedVerifications = outcome.data.verifications.filter(
      (verification) => verification.status === "failed",
    );
    if (failedVerifications.length > 0) {
      const retry = this.support.scheduleRetry(input, finishedState, {
        kind: "repair",
        reason: "Agent 报告 completed 但验证仍失败",
        feedback: failedVerifications
          .map((verification) =>
            `${verification.command}：${verification.summary}`)
          .join("；"),
      });
      return { ...retry, details: this.support.createOutcomeDetails(outcome) };
    }
    return {
      state: transitionTask(
        finishedState,
        input.task.id,
        "candidate_pending",
        this.support.now(),
      ),
      message: "实现会话完成，已持久化终态并等待冻结候选",
      details: this.support.createOutcomeDetails(outcome),
    };
  }

  private async freezeCandidate(input: TaskStepInput): Promise<TaskStepResult> {
    const candidate = await this.workspace.captureCandidate();
    return {
      state: transitionTask(
        input.state,
        input.task.id,
        "reviewing",
        this.support.now(),
        { candidateFingerprint: candidate.fingerprint },
      ),
      message: "实现候选已冻结，进入独立审核",
      details: {
        candidateFingerprint: candidate.fingerprint,
        changedFiles: candidate.files.map((file) => file.path),
      },
    };
  }

  private runAgent(
    input: TaskStepInput,
    attempt: TaskAttemptState,
    shouldResume: boolean,
    prompt: string,
    sessionCheckpoint: AgentSessionCheckpoint,
  ): Promise<AgentRunOutcome<ImplementationResult>> {
    /*
     * 请求值与握手期望都来自持久化 attempt，日志因此展示本次实际选择的 CC Switch 模型。
     * 精确握手仍能在首次工具调用前阻止 SDK 或 Provider 静默切换到其他模型。
     */
    return this.agent.run({
      access: "write",
      attemptKind: shouldResume ? "resume" : attempt.kind,
      taskId: input.task.id,
      title: input.task.title,
      prompt,
      cwd: input.loaded.projectRoot,
      model: attempt.requestedModel,
      expectedResolvedModel: attempt.requestedModel,
      effort: ORCHESTRATOR_POLICY.worker.effort,
      maxTurns: ORCHESTRATOR_POLICY.worker.maxTurns,
      maxBudgetUsd: ORCHESTRATOR_POLICY.worker.maxBudgetUsd,
      timeoutMs: ORCHESTRATOR_POLICY.worker.timeoutMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(shouldResume
        ? { resumeSessionId: attempt.sessionId }
        : { sessionId: attempt.sessionId }),
      onSessionInitialized: (session) => sessionCheckpoint.initialize(session),
      resultSchema: implementationResultSchema,
    });
  }

  private handleFailure(
    input: TaskStepInput,
    state: RunState,
    outcome: Extract<AgentRunOutcome<ImplementationResult>, { ok: false }>,
  ): TaskStepResult {
    if (this.isSessionResourceLimit(outcome.kind)) {
      const taskState = state.tasks[input.task.id];
      if (taskState === undefined) {
        throw new Error(`任务 ${input.task.id} 缺少资源预算状态`);
      }
      const exhaustionReason = this.resourceBudget.getExhaustionReason(
        taskState,
        "worker",
      );
      if (exhaustionReason !== undefined) {
        return {
          ...this.support.block(
            input,
            `TASK 资源预算耗尽：${exhaustionReason}`,
            state,
          ),
          details: this.support.createOutcomeDetails(outcome),
        };
      }
    }
    if (!outcome.retryable && !this.isSessionResourceLimit(outcome.kind)) {
      return {
        state: transitionTask(
          state,
          input.task.id,
          "failed",
          this.support.now(),
          { failureReason: outcome.message },
        ),
        message: `Agent 不可重试失败：${outcome.message}`,
        details: this.support.createOutcomeDetails(outcome),
      };
    }
    const retry = this.support.scheduleRetry(input, state, {
      kind: outcome.sessionId === undefined ? "repair" : "resume",
      reason: `Agent ${outcome.kind} 错误`,
      feedback: outcome.message,
      ...(outcome.sessionId === undefined
        ? {}
        : { resumeSessionId: outcome.sessionId }),
    });
    return { ...retry, details: this.support.createOutcomeDetails(outcome) };
  }

  private finishAttempt(
    state: RunState,
    taskId: string,
    outcome: AgentRunOutcome<ImplementationResult>,
    outcomeOverride?: "failed" | "interrupted",
  ): RunState {
    const current = state.tasks[taskId]?.attempts.at(-1);
    if (current === undefined) {
      throw new Error(`任务 ${taskId} 缺少当前 attempt`);
    }
    const summary = outcome.ok ? outcome.data.summary : outcome.message;
    return replaceCurrentAttempt(
      state,
      taskId,
      {
        ...current,
        finishedAt: this.support.now(),
        outcome: outcomeOverride ?? (outcome.ok ? outcome.data.status : "failed"),
        summary,
        costUsd: outcome.costUsd,
        turns: outcome.turns,
        resolvedModel: outcome.telemetry.resolvedModel,
        durationMs: outcome.telemetry.durationMs,
        apiRetryCount: outcome.telemetry.apiRetryCount,
        apiRetryDelayMs: outcome.telemetry.apiRetryDelayMs,
        toolCalls: outcome.telemetry.toolCalls,
        ...(outcome.ok ? { verifications: outcome.data.verifications } : {}),
      },
      this.support.now(),
    );
  }

  private isSessionResourceLimit(kind: string): boolean {
    return kind === "max_turns" || kind === "max_budget" || kind === "timeout";
  }
}
