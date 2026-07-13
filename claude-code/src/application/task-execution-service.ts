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
  transitionTask,
  type RetryContext,
  type RunState,
  type TaskAttemptState,
  type TaskRunState,
  type TaskStatus,
} from "../domain/run-state.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { Clock } from "../ports/clock.js";
import type { GateRunner } from "../ports/gate-runner.js";
import type { Workspace } from "../ports/workspace.js";
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
        gateResults: [],
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
      maxTurns: input.loaded.manifest.defaults.maxTurns,
      ...(input.loaded.manifest.defaults.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: input.loaded.manifest.defaults.maxBudgetUsd }),
      timeoutMs: getTaskTimeoutMinutes(input.loaded.manifest, input.task) * 60_000,
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

    const results = await this.gates.run(
      input.loaded.projectRoot,
      input.task.gates,
      input.signal,
    );
    if (input.signal?.aborted === true) {
      return { state: input.state, message: "门禁被中止，将在恢复后重新执行" };
    }

    const afterAudit = await this.workspace.auditChanges(
      input.task,
      input.loaded.protectedPaths,
    );
    const afterAuditFailure = this.describeAuditFailure(afterAudit);
    if (afterAuditFailure !== undefined) {
      return this.blockTask(input, afterAuditFailure);
    }
    const candidateAfterGates = await this.workspace.captureCandidate();
    if (candidateAfterGates.fingerprint !== candidateBeforeGates.fingerprint) {
      return this.blockTask(
        input,
        "外部门禁修改了候选文件；门禁必须是只读验证命令",
      );
    }

    const allPassed = results.length === input.task.gates.length
      && results.every((result) => result.exitCode === 0 && !result.timedOut);
    if (!allPassed) {
      const stateWithResults = this.replaceTaskFields(input.state, input.task.id, {
        gateResults: results,
      });
      return this.retryOrFail(input, stateWithResults, {
        kind: "repair",
        reason: "外部门禁失败",
        feedback: this.formatGateFeedback(results),
      });
    }

    const nextStatus: TaskStatus = input.loaded.manifest.review.enabled
      ? "reviewing"
      : "committing";
    return {
      state: transitionTask(
        input.state,
        input.task.id,
        nextStatus,
        this.now(),
        {
          gateResults: results,
          candidateFingerprint: candidateAfterGates.fingerprint,
        },
      ),
      message: input.loaded.manifest.review.enabled
        ? "全部门禁通过，进入独立审核"
        : "全部门禁通过，进入提交阶段",
    };
  }

  private async executeReview(
    input: TaskStepInput,
    taskState: TaskRunState,
  ): Promise<TaskStepResult> {
    if (taskState.reviewAttempts >= input.loaded.manifest.review.maxAttempts) {
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
      if (reviewAttempts < input.loaded.manifest.review.maxAttempts && outcome.retryable) {
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
      const stateWithReview = this.replaceTaskFields(input.state, input.task.id, {
        reviewAttempts,
        reviewSessionId: outcome.sessionId,
        reviewSummary: outcome.data.summary,
      });
      if (reviewAttempts >= input.loaded.manifest.review.maxAttempts) {
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
        taskState.gateResults,
        changedFiles,
        diff,
      ),
      cwd: input.loaded.projectRoot,
      model: input.loaded.manifest.review.model,
      effort: input.loaded.manifest.review.effort,
      maxTurns: input.loaded.manifest.review.maxTurns,
      ...(input.loaded.manifest.review.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: input.loaded.manifest.review.maxBudgetUsd }),
      timeoutMs: getTaskTimeoutMinutes(input.loaded.manifest, input.task) * 60_000,
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
    if (taskState.attempts.length >= attemptLimit) {
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

  private replaceTaskFields(
    state: RunState,
    taskId: string,
    patch: Partial<Omit<TaskRunState, "taskId" | "status" | "updatedAt">>,
  ): RunState {
    const current = state.tasks[taskId];
    if (current === undefined) {
      throw new Error(`运行状态中不存在任务 ${taskId}`);
    }
    const now = this.now();
    return {
      ...state,
      updatedAt: now,
      tasks: {
        ...state.tasks,
        [taskId]: { ...current, ...patch, updatedAt: now },
      },
    };
  }

  private blockTask(
    input: TaskStepInput,
    reason: string,
  ): TaskStepResult {
    return {
      state: transitionTask(
        input.state,
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
