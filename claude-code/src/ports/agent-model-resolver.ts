/*
 * AgentModelResolver 只暴露编排层需要的模型选择事实，不泄露 Claude 设置结构或 Provider 凭据。
 * 每个新 attempt 都通过该端口读取一次当前配置，恢复已有 attempt 时则继续使用已持久化的模型快照。
 */
export interface AgentModelResolver {
  resolveModel(cwd: string): Promise<string>;
}
