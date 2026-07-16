/*
 * 运行指标只从持久化 RunState 投影，不读取控制台 transcript 或 SDK 临时对象。
 * 所有摘要、status 扩展和后续监控可以共享这一确定性聚合，避免重复计算口径漂移。
 */
import type { RunState, TaskRunState } from "../domain/run-state.js";

export interface TaskExecutionMetrics {
  readonly workerSessions: number;
  readonly reviewerSessions: number;
  readonly turns: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly apiRetryCount: number;
  readonly apiRetryDelayMs: number;
  readonly toolCalls: number;
}

export interface AgentModelUsage {
  readonly requestedModel: string;
  readonly resolvedModel: string;
}

export function aggregateTaskMetrics(
  task: TaskRunState,
): TaskExecutionMetrics {
  const attempts = [...task.attempts, ...task.reviewAttempts];
  return {
    workerSessions: task.attempts.length,
    reviewerSessions: task.reviewAttempts.length,
    turns: sum(attempts, (attempt) => attempt.turns),
    costUsd: sum(attempts, (attempt) => attempt.costUsd),
    durationMs: sum(attempts, (attempt) => attempt.durationMs),
    apiRetryCount: sum(attempts, (attempt) => attempt.apiRetryCount),
    apiRetryDelayMs: sum(attempts, (attempt) => attempt.apiRetryDelayMs),
    toolCalls: sum(attempts, (attempt) => attempt.toolCalls),
  };
}

export function aggregateRunMetrics(state: RunState): TaskExecutionMetrics {
  const metrics = Object.values(state.tasks).map(aggregateTaskMetrics);
  return {
    workerSessions: sum(metrics, (metric) => metric.workerSessions),
    reviewerSessions: sum(metrics, (metric) => metric.reviewerSessions),
    turns: sum(metrics, (metric) => metric.turns),
    costUsd: sum(metrics, (metric) => metric.costUsd),
    durationMs: sum(metrics, (metric) => metric.durationMs),
    apiRetryCount: sum(metrics, (metric) => metric.apiRetryCount),
    apiRetryDelayMs: sum(metrics, (metric) => metric.apiRetryDelayMs),
    toolCalls: sum(metrics, (metric) => metric.toolCalls),
  };
}

/*
 * 模型使用按“请求值 → init 实际值”去重，未完成握手的尝试不会伪造 resolvedModel。
 * 摘要可以直接展示该投影，模型漂移仍由执行器在首次 init 时硬失败。
 */
export function collectTaskModelUsage(
  task: TaskRunState,
): readonly AgentModelUsage[] {
  const usage = new Map<string, AgentModelUsage>();
  for (const attempt of [...task.attempts, ...task.reviewAttempts]) {
    if (attempt.resolvedModel === undefined) {
      continue;
    }
    const key = `${attempt.requestedModel}\0${attempt.resolvedModel}`;
    usage.set(key, {
      requestedModel: attempt.requestedModel,
      resolvedModel: attempt.resolvedModel,
    });
  }
  return [...usage.values()];
}

export function collectRunModelUsage(
  state: RunState,
): readonly AgentModelUsage[] {
  const usage = new Map<string, AgentModelUsage>();
  for (const task of Object.values(state.tasks)) {
    for (const model of collectTaskModelUsage(task)) {
      usage.set(`${model.requestedModel}\0${model.resolvedModel}`, model);
    }
  }
  return [...usage.values()];
}

function sum<T>(
  values: readonly T[],
  selector: (value: T) => number | undefined,
): number {
  return values.reduce((total, value) => total + (selector(value) ?? 0), 0);
}
