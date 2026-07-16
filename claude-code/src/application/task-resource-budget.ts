/*
 * TaskResourceBudget 只根据持久化尝试事实判断下一次会话能否启动。
 * 资源策略属于系统级不变量，不进入 TASK 文档，也不依赖 Claude SDK 私有消息。
 */
import type { TaskRunState } from "../domain/run-state.js";
import { ORCHESTRATOR_POLICY } from "./orchestrator-policy.js";

export type AgentStage = "worker" | "reviewer";

export class TaskResourceBudget {
  public getExhaustionReason(
    task: TaskRunState,
    stage: AgentStage,
  ): string | undefined {
    const workerSessions = task.attempts.length;
    const reviewerSessions = task.reviewAttempts.length;
    const allAttempts = [...task.attempts, ...task.reviewAttempts];
    const totalTurns = allAttempts.reduce(
      (sum, attempt) => sum + (attempt.turns ?? 0),
      0,
    );
    const totalBudgetUsd = allAttempts.reduce(
      (sum, attempt) => sum + (attempt.costUsd ?? 0),
      0,
    );
    const policy = ORCHESTRATOR_POLICY.taskBudget;

    if (stage === "worker" && workerSessions >= policy.maxWorkerSessions) {
      return `Worker 会话数已达到系统上限 ${policy.maxWorkerSessions}`;
    }
    if (stage === "reviewer" && reviewerSessions >= policy.maxReviewerSessions) {
      return `Reviewer 会话数已达到系统上限 ${policy.maxReviewerSessions}`;
    }
    if (totalTurns >= policy.maxTotalTurns) {
      return `TASK 累计轮数 ${totalTurns} 已达到系统上限 ${policy.maxTotalTurns}`;
    }
    if (totalBudgetUsd >= policy.maxTotalBudgetUsd) {
      return `TASK 累计费用 $${totalBudgetUsd.toFixed(4)} 已达到系统上限 $${policy.maxTotalBudgetUsd.toFixed(2)}`;
    }
    return undefined;
  }
}
