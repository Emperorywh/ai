/*
 * TaskExecutionService 每次只推进一个 TASK 的一个显式阶段，不持有队列，也不直接保存状态。
 * 实现、门禁、审核和提交分别通过端口完成，使任何阶段都能独立测试并从快照恢复。
 */
import { randomUUID } from "node:crypto";
import {
  implementationResultSchema,
  reviewResultSchema,
  type AgentRunOutcome,
  type ImplementationResult,
  type ReviewResult,
} from "../domain/agent-result.js";
import {
  getTaskAttemptLimit,
  getTaskTimeoutMinutes,
  type LoadedTaskManifest,
  type TaskDefinition,
} from "../domain/manifest.js";
import {
  replaceCurrentAttempt,
  replaceExpectedHead,
  replaceTaskFields,
  transitionTask,
  type GateRunState,
  type RetryContext,
  type RunState,
  type TaskAttemptState,
  type TaskRunState,
  type TaskStatus,
} from "../domain/run-state.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { Clock } from "../ports/clock.js";
import type { GateRunner } from "../ports/gate-runner.js";
import type {
  CandidateSnapshot,
  VerificationWorkspace,
  VerificationWorkspaceRelease,
  Workspace,
} from "../ports/workspace.js";
import {
  AgentSessionCheckpoint,
  type TaskCheckpointWriter,
} from "./agent-session-checkpoint.js";
import type { PromptBuilder } from "./prompt-builder.js";

export interface TaskStepResult {
  readonly state: RunState;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TaskStepInput {
  readonly loaded: LoadedTaskManifest;
  readonly state: RunState;
  readonly task: TaskDefinition;
  readonly resumeExistingExecution: boolean;
  readonly signal?: AbortSignal;
  readonly onCheckpoint?: TaskCheckpointWriter;
}

interface GateObservation {
  readonly gateRun: GateRunState;
  readonly candidateAfter: CandidateSnapshot;
  readonly auditFailure?: string | undefined;
  readonly allPassed: boolean;
}

interface AgentResourceLimits {
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
}

export class TaskExecutionService {
  public constructor(
    private readonly agent: AgentExecutor,
    private readonly gates: GateRunner,
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
      case "gating":
        return this.executeGates(input);
      case "reviewing":
        return this.executeReview(input, taskState);
      case "committing":
        return this.commitTask(input);
      case "completed":
      case "blocked":
      case "failed":
      case "dependency_blocked":
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
      return this.retryOrFail(
        input,
        finishedState,
        {
          kind: "repair",
          reason: "Agent 主动报告实现失败",
          feedback: outcome.data.summary,
        },
      );
    }

    return {
      state: transitionTask(
        finishedState,
        input.task.id,
        "gating",
        this.now(),
      ),
      message: "实现会话完成，进入外部门禁",
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
      model: input.loaded.manifest.defaults.model,
      effort: input.loaded.manifest.defaults.effort,
      ...this.buildAgentResourceLimits(
        input,
        input.loaded.manifest.defaults.maxTurns,
        input.loaded.manifest.defaults.maxBudgetUsd,
      ),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(shouldResume
        ? { resumeSessionId: attempt.sessionId }
        : { sessionId: attempt.sessionId }),
      onSessionInitialized: (sessionId) => sessionCheckpoint.initialize(sessionId),
      pathBoundary: {
        projectRoot: input.loaded.projectRoot,
        write: {
          allow: input.task.scope.allow,
          deny: input.task.scope.deny,
          protectedPaths: input.loaded.protectedPaths,
        },
      },
      resultSchema: implementationResultSchema,
    });
  }

  private async executeGates(
    input: TaskStepInput,
  ): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`运行状态中不存在任务 ${input.task.id}`);
    }
    const beforeAudit = await this.workspace.auditChanges(
      input.task,
      input.loaded.protectedPaths,
    );
    const auditFailure = this.describeAuditFailure(beforeAudit);
    if (auditFailure !== undefined) {
      return this.blockTask(input, auditFailure);
    }
    if (beforeAudit.changedFiles.length === 0) {
      return this.retryOrFail(input, input.state, {
        kind: "repair",
        reason: "没有文件变更",
        feedback: "实现会话没有产生任何文件变更，请重新检查 TASK 并完成实现。",
      });
    }

    const candidateBeforeGates = await this.workspace.captureCandidate();
    const startedAt = this.now();
    const verification = await this.workspace.openVerificationWorkspace({
      runId: input.state.runId,
      taskId: input.task.id,
      sharedPaths: input.loaded.manifest.verification.sharedPaths,
      expectedCandidate: candidateBeforeGates,
    });

    /*
     * 门禁、审计和候选捕获全部发生在隔离 worktree；finally 保证任何返回路径都会释放它。
     * 合法副作用只有在形成诊断后才显式提升，且提升后的版本必须从第一道门禁重新验证。
     */
    let stepResult: TaskStepResult;
    let release: VerificationWorkspaceRelease;
    try {
      const observation = await this.observeGateRun(
        input,
        taskState,
        candidateBeforeGates,
        verification,
        startedAt,
      );
      if (observation === undefined) {
        stepResult = {
          state: input.state,
          message: "门禁被中止，将在恢复后重新执行",
        };
      } else {
        stepResult = await this.resolveGateObservation(
          input,
          verification,
          observation,
        );
      }
    } finally {
      release = await this.releaseVerificationWorkspace(verification);
    }

    if (release.status === "released") {
      return stepResult;
    }

    /*
     * 临时资源释放与门禁结论属于两个独立事实。Windows 文件占用只追加可观测诊断，
     * 状态机仍按已经得到的门禁结果继续循环，后续 worktree 使用唯一目录不会相互污染。
     */
    return {
      ...stepResult,
      message: `${stepResult.message}；隔离验证目录清理已延后，不影响任务继续`,
      details: {
        ...stepResult.details,
        verificationWorkspaceRelease: release,
      },
    };
  }

  private async releaseVerificationWorkspace(
    verification: VerificationWorkspace,
  ): Promise<VerificationWorkspaceRelease> {
    try {
      return await verification.dispose();
    } catch (error) {
      return {
        status: "deferred",
        diagnostics: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /*
   * 观察阶段只收集隔离门禁事实并计算分类，不修改主候选或任务状态。
   * 纯诊断结果交给决策阶段处理，避免进程执行与状态转换形成隐式耦合。
   */
  private async observeGateRun(
    input: TaskStepInput,
    taskState: TaskRunState,
    candidateBefore: CandidateSnapshot,
    verification: VerificationWorkspace,
    startedAt: string,
  ): Promise<GateObservation | undefined> {
    const results = await this.gates.run(
      verification.projectRoot,
      input.task.gates,
      input.signal,
    );
    if (input.signal?.aborted === true) {
      return undefined;
    }

    const afterAudit = await verification.auditChanges(
      input.task,
      input.loaded.protectedPaths,
    );
    const candidateAfter = await verification.captureCandidate();
    const mutatedFiles = compareCandidateFiles(candidateBefore, candidateAfter);
    const auditFailure = this.describeAuditFailure(afterAudit);
    const allPassed = results.length === input.task.gates.length
      && results.every((result) => result.exitCode === 0 && !result.timedOut);
    const outcome: GateRunState["outcome"] = auditFailure !== undefined
      ? "boundary_violation"
      : mutatedFiles.length > 0
        ? "mutated"
        : allPassed
          ? "passed"
          : "failed";
    return {
      gateRun: {
        number: taskState.gateRuns.length + 1,
        candidateBefore: candidateBefore.fingerprint,
        candidateAfter: candidateAfter.fingerprint,
        results,
        mutatedFiles,
        outcome,
        startedAt,
        finishedAt: this.now(),
      },
      candidateAfter,
      ...(auditFailure === undefined ? {} : { auditFailure }),
      allPassed,
    };
  }

  /*
   * 决策阶段先持久化所需的 GateRun 数据，再执行阻塞、提升、重试或放行策略。
   * 每个分支共享同一份诊断摘要，日志、状态和后续 repair 不会出现结论漂移。
   */
  private async resolveGateObservation(
    input: TaskStepInput,
    verification: VerificationWorkspace,
    observation: GateObservation,
  ): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`运行状态中不存在任务 ${input.task.id}`);
    }
    const { gateRun } = observation;
    const stateWithGateRun = replaceTaskFields(
      input.state,
      input.task.id,
      { gateRuns: [...taskState.gateRuns, gateRun] },
      this.now(),
    );
    const details = this.describeGateRun(gateRun);

    if (observation.auditFailure !== undefined) {
      return {
        ...this.blockTask(input, observation.auditFailure, stateWithGateRun),
        details,
      };
    }
    if (gateRun.mutatedFiles.length > 0) {
      await verification.promoteCandidate(gateRun.mutatedFiles);
      const promoted = await this.workspace.captureCandidate();
      if (promoted.fingerprint !== observation.candidateAfter.fingerprint) {
        throw new Error("隔离门禁变化提升后候选指纹不一致");
      }
      return {
        ...this.retryOrFail(input, stateWithGateRun, {
          kind: "repair",
          reason: "外部门禁产生了候选变化",
          feedback: this.formatGateMutationFeedback(
            gateRun.mutatedFiles,
            gateRun.results,
          ),
        }),
        details,
      };
    }
    if (!observation.allPassed) {
      return {
        ...this.retryOrFail(input, stateWithGateRun, {
          kind: "repair",
          reason: "外部门禁失败",
          feedback: this.formatGateFeedback(gateRun.results),
        }),
        details,
      };
    }

    const nextStatus: TaskStatus = input.loaded.manifest.review.enabled
      ? "reviewing"
      : "committing";
    return {
      state: transitionTask(
        stateWithGateRun,
        input.task.id,
        nextStatus,
        this.now(),
        { candidateFingerprint: observation.candidateAfter.fingerprint },
      ),
      message: input.loaded.manifest.review.enabled
        ? "全部门禁通过，进入独立审核"
        : "全部门禁通过，进入提交阶段",
      details,
    };
  }

  private async executeReview(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    const reviewAttemptLimit = input.loaded.manifest.review.maxAttempts;
    if (
      reviewAttemptLimit !== undefined
      && taskState.reviewAttempts >= reviewAttemptLimit
    ) {
      return {
        state: transitionTask(
          input.state,
          input.task.id,
          "failed",
          this.now(),
          { failureReason: "独立审核已达到最大会话次数" },
        ),
        message: "独立审核已达到最大会话次数",
      };
    }

    const audit = await this.workspace.auditChanges(
      input.task,
      input.loaded.protectedPaths,
    );
    const auditFailure = this.describeAuditFailure(audit);
    if (auditFailure !== undefined) {
      return this.blockTask(input, auditFailure);
    }

    if (taskState.candidateFingerprint === undefined) {
      return this.blockTask(input, "审核阶段缺少门禁候选指纹");
    }

    const candidate = await this.workspace.captureCandidate();
    if (candidate.fingerprint !== taskState.candidateFingerprint) {
      return this.blockTask(
        input,
        "候选内容在门禁通过后发生变化，拒绝审核",
      );
    }
    const outcome = await this.runReviewAgent(
      input,
      taskState,
      audit.changedFiles,
      candidate.diff,
    );

    if (!outcome.ok && outcome.kind === "aborted") {
      return { state: input.state, message: "审核被中止，恢复后将启动全新审核会话" };
    }

    const reviewAttempts = taskState.reviewAttempts + 1;
    if (!outcome.ok) {
      if (
        outcome.retryable
        && (
          reviewAttemptLimit === undefined
          || reviewAttempts < reviewAttemptLimit
        )
      ) {
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
      if (
        reviewAttemptLimit !== undefined
        && reviewAttempts >= reviewAttemptLimit
      ) {
        return {
          state: transitionTask(
            stateWithReview,
            input.task.id,
            "failed",
            this.now(),
            { failureReason: "独立审核未通过且已达到最大会话次数" },
          ),
          message: "独立审核未通过且已达到最大会话次数",
        };
      }
      return this.retryOrFail(input, stateWithReview, {
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
    taskState: TaskRunState,
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
        [...taskState.gateRuns].reverse().find(
          (run) => run.outcome === "passed",
        )?.results ?? [],
        changedFiles,
        diff,
      ),
      cwd: input.loaded.projectRoot,
      model: input.loaded.manifest.review.model,
      effort: input.loaded.manifest.review.effort,
      ...this.buildAgentResourceLimits(
        input,
        input.loaded.manifest.review.maxTurns,
        input.loaded.manifest.review.maxBudgetUsd,
      ),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      sessionId: randomUUID(),
      pathBoundary: {
        projectRoot: input.loaded.projectRoot,
      },
      resultSchema: reviewResultSchema,
    });
  }

  private async commitTask(input: TaskStepInput): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState?.candidateFingerprint === undefined) {
      return this.blockTask(input, "提交阶段缺少门禁候选指纹");
    }
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
      const recoveryAudit = await this.workspace.auditChanges(
        input.task,
        input.loaded.protectedPaths,
      );
      if (recoveryAudit.changedFiles.length > 0 || recoveryAudit.violations.length > 0) {
        return this.blockTask(
          input,
          "检测到已提交的 TASK，但工作区仍有残留修改",
        );
      }
      const completed = transitionTask(
        input.state,
        input.task.id,
        "completed",
        this.now(),
        { commitSha: existingCommit },
      );
      return {
        state: replaceExpectedHead(completed, existingCommit, this.now()),
        message: `检测到已完成提交 ${existingCommit}，恢复为 completed`,
      };
    }

    const audit = await this.workspace.auditChanges(
      input.task,
      input.loaded.protectedPaths,
    );
    const auditFailure = this.describeAuditFailure(audit);
    if (auditFailure !== undefined || audit.changedFiles.length === 0) {
      return this.blockTask(
        input,
        auditFailure ?? "提交前没有文件变更",
      );
    }

    const candidate = await this.workspace.captureCandidate();
    if (candidate.fingerprint !== taskState.candidateFingerprint) {
      return this.blockTask(
        input,
        "候选内容在门禁或审核通过后发生变化，拒绝提交",
      );
    }

    const commitSha = await this.workspace.commitTask({
      runId: input.state.runId,
      task: input.task,
      messagePrefix: input.loaded.manifest.git.commitMessagePrefix,
      expectedHead: input.state.workspace.expectedHead,
      expectedFingerprint: taskState.candidateFingerprint,
    });
    const completed = transitionTask(
      input.state,
      input.task.id,
      "completed",
      this.now(),
      { commitSha },
    );
    return {
      state: replaceExpectedHead(completed, commitSha, this.now()),
      message: `任务已提交：${commitSha}`,
    };
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

    return this.retryOrFail(input, state, {
      kind: outcome.sessionId === undefined ? "repair" : "resume",
      reason: `Agent ${outcome.kind} 错误`,
      feedback: outcome.message,
      ...(outcome.sessionId === undefined
        ? {}
        : { resumeSessionId: outcome.sessionId }),
    });
  }

  /*
   * 实现与审核共享同一套“显式限制才生效”规则，避免两个调用点分别换算时间并逐渐漂移。
   * 空对象表示完全交给 Agent 自主收敛，仅外部中断仍能终止当前阶段并保存 checkpoint。
   */
  private buildAgentResourceLimits(
    input: TaskStepInput,
    maxTurns: number | undefined,
    maxBudgetUsd: number | undefined,
  ): AgentResourceLimits {
    const timeoutMinutes = getTaskTimeoutMinutes(
      input.loaded.manifest,
      input.task,
    );
    return {
      ...(maxTurns === undefined ? {} : { maxTurns }),
      ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
      ...(timeoutMinutes === undefined
        ? {}
        : { timeoutMs: timeoutMinutes * 60_000 }),
    };
  }

  private retryOrFail(
    input: TaskStepInput,
    state: RunState,
    retry: RetryContext,
  ): TaskStepResult {
    const taskState = state.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`运行状态中不存在任务 ${input.task.id}`);
    }
    const attemptLimit = getTaskAttemptLimit(input.loaded.manifest, input.task);
    if (
      attemptLimit !== undefined
      && taskState.attempts.length >= attemptLimit
    ) {
      return {
        state: transitionTask(
          state,
          input.task.id,
          "failed",
          this.now(),
          { failureReason: `${retry.reason}；已达到 ${attemptLimit} 次尝试上限` },
        ),
        message: `${retry.reason}，已达到重试上限`,
      };
    }

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
      message: `任务安全边界阻止继续：${reason}`,
    };
  }

  private describeAuditFailure(audit: {
    changedFiles: readonly string[];
    violations: readonly string[];
  }): string | undefined {
    return audit.violations.length === 0
      ? undefined
      : `存在越界或受保护文件：${audit.violations.join(", ")}`;
  }

  private joinBlockingReason(result: ImplementationResult): string {
    return result.blockingQuestions.join("；") || result.summary;
  }

  private formatGateFeedback(results: readonly {
    name: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  }[]): string {
    return results.map((result) => [
      `${result.name}: exit=${result.exitCode ?? "null"}, timeout=${String(result.timedOut)}`,
      `stdout:\n${result.stdout || "<empty>"}`,
      `stderr:\n${result.stderr || "<empty>"}`,
    ].join("\n")).join("\n\n");
  }

  private formatGateMutationFeedback(
    mutatedFiles: readonly string[],
    results: readonly {
      name: string;
      exitCode: number | null;
      timedOut: boolean;
      stdout: string;
      stderr: string;
    }[],
  ): string {
    return [
      "门禁在隔离验证工作区产生了以下文件变化，变化已提升到主候选，但尚未被接受：",
      ...mutatedFiles.map((path) => `- ${path}`),
      "请检查这些生成结果是否符合任务契约；修复完成后，编排器会从第一道门禁重新验证完整候选。",
      this.formatGateFeedback(results),
    ].join("\n");
  }

  /*
   * 事件日志只保存快速诊断摘要，完整 stdout/stderr 仍保留在 RunState 的 GateRun 中。
   * 这样终端能直接看到变化文件和退出状态，同时避免 events.jsonl 重复写入大段输出。
   */
  private describeGateRun(gateRun: GateRunState): Readonly<Record<string, unknown>> {
    return {
      gateRunNumber: gateRun.number,
      outcome: gateRun.outcome,
      candidateBefore: gateRun.candidateBefore,
      candidateAfter: gateRun.candidateAfter,
      mutatedFiles: gateRun.mutatedFiles,
      results: gateRun.results.map((result) => ({
        name: result.name,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      })),
    };
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

/*
 * 候选差异只比较规范化文件记录，不读取或猜测 Git 暂存状态。
 * 返回稳定排序的路径集合，供诊断持久化和受控候选提升共同使用。
 */
function compareCandidateFiles(
  before: CandidateSnapshot,
  after: CandidateSnapshot,
): readonly string[] {
  const beforeByPath = new Map(before.files.map((file) => [file.path, file]));
  const afterByPath = new Map(after.files.map((file) => [file.path, file]));
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  return [...paths].filter((path) => {
    const left = beforeByPath.get(path);
    const right = afterByPath.get(path);
    return left?.kind !== right?.kind
      || left?.mode !== right?.mode
      || left?.contentHash !== right?.contentHash;
  }).sort();
}
