/*
 * TaskStageSupport 集中提供跨阶段一致的状态收敛和遥测投影。
 * 它不判断当前阶段，也不调用外部端口，避免 Implementation、Review、Commit 复制状态模板。
 */
import type { AgentRunOutcome } from "../domain/agent-result.js";
import {
  transitionTask,
  type RetryContext,
  type RunState,
} from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";

export class TaskStageSupport {
  public constructor(private readonly clock: Clock) {}

  public block(
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

  public scheduleRetry(
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

  public createOutcomeDetails<T>(
    outcome: AgentRunOutcome<T>,
  ): Readonly<Record<string, unknown>> {
    return {
      costUsd: outcome.costUsd,
      turns: outcome.turns,
      requestedModel: outcome.telemetry.requestedModel,
      resolvedModel: outcome.telemetry.resolvedModel ?? "unresolved",
      durationMs: outcome.telemetry.durationMs,
      apiRetryCount: outcome.telemetry.apiRetryCount,
      apiRetryDelayMs: outcome.telemetry.apiRetryDelayMs,
      toolCalls: outcome.telemetry.toolCalls,
    };
  }

  public now(): string {
    return this.clock.now().toISOString();
  }
}
