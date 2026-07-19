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
    /*
     * 通用系统阻塞（资源耗尽、候选变化、阶段证据缺失）不是对 Worker 外部阻塞声明的确认。
     * 清除待审计报告，确保终态原因只来自当前系统事实，不把尚未复核的模型判断混入状态。
     */
    return {
      state: transitionTask(
        state,
        input.task.id,
        "blocked",
        this.now(),
        { failureReason: reason, workerBlocker: undefined },
      ),
      message: `任务无法继续：${reason}`,
    };
  }

  public scheduleRetry(
    input: TaskStepInput,
    state: RunState,
    retry: RetryContext,
  ): TaskStepResult {
    /*
     * Reviewer 驳回 Worker 阻塞声明后，新的修复会话必须从普通实现语义重新开始。
     * 显式清除旧阻塞报告和冻结指纹，防止下一轮候选被误当成仍在审计同一个外部依赖。
     */
    return {
      state: transitionTask(
        state,
        input.task.id,
        "retry_pending",
        this.now(),
        {
          retry,
          candidateFingerprint: undefined,
          workerBlocker: undefined,
        },
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
