/*
 * 编排器只提供这一套不可由项目覆盖的资源与 Git 策略，所有应用服务从同一事实源读取。
 * 模型属于 Claude 用户运行时配置，由独立端口在 attempt 边界解析，不能固化进静态编排策略。
 */
export const ORCHESTRATOR_POLICY = Object.freeze({
  worker: Object.freeze({
    effort: "high" as const,
    maxTurns: 80,
    maxBudgetUsd: 6,
    timeoutMs: 45 * 60 * 1_000,
  }),
  reviewer: Object.freeze({
    effort: "high" as const,
    maxTurns: 30,
    maxBudgetUsd: 2,
    timeoutMs: 15 * 60 * 1_000,
  }),
  taskBudget: Object.freeze({
    maxWorkerSessions: 8,
    maxReviewerSessions: 3,
    maxTotalTurns: 200,
    maxTotalBudgetUsd: 15,
  }),
  git: Object.freeze({
    commitMessagePrefix: "task",
  }),
});
