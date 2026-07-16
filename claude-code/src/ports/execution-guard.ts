/*
 * ExecutionGuard 是 Agent 工具调用进入宿主环境前的同步策略边界。
 * 端口只表达允许或拒绝，不依赖 Claude Hook 的输入与输出协议。
 */
export interface ExecutionGuardDecision {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
}

export interface ExecutionGuard {
  inspect(toolName: string, input: unknown): ExecutionGuardDecision;
}
