/*
 * 编排器只提供这一套不可配置的执行策略，所有应用服务从同一事实源读取。
 * 策略与项目内容分离，防止模型选择、审核流程和提交命名渗入 TASK 或文件加载层。
 */
export const ORCHESTRATOR_POLICY = Object.freeze({
  worker: Object.freeze({
    model: "claude-sonnet-5",
    expectedResolvedModel: "claude-sonnet-5",
    effort: "high" as const,
    maxTurns: 80,
    maxBudgetUsd: 6,
    timeoutMs: 45 * 60 * 1_000,
  }),
  reviewer: Object.freeze({
    model: "claude-sonnet-5",
    expectedResolvedModel: "claude-sonnet-5",
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
