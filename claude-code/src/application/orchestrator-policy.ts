/*
 * 编排器只提供这一套不可配置的执行策略，所有应用服务从同一事实源读取。
 * 策略与项目内容分离，防止模型选择、审核流程和提交命名渗入 TASK 或文件加载层。
 */
export const ORCHESTRATOR_POLICY = Object.freeze({
  worker: Object.freeze({
    model: "sonnet",
    effort: "high" as const,
  }),
  reviewer: Object.freeze({
    model: "sonnet",
    effort: "high" as const,
  }),
  git: Object.freeze({
    commitMessagePrefix: "task",
  }),
});
