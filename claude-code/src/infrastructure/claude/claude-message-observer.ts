/*
 * ClaudeMessageObserver 是 Claude SDK 消息流在基础设施层内部的观察边界。
 * 它保留完整 SDK 动态供终端适配器消费，同时避免 SDK 私有消息类型进入应用状态机。
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentAttemptKind } from "../../ports/agent-executor.js";

export interface ClaudeMessageContext {
  readonly taskId: string;
  readonly attemptKind: AgentAttemptKind;
}

export interface ClaudeMessageObserver {
  onMessage(context: ClaudeMessageContext, message: SDKMessage): void;
  onStderr(context: ClaudeMessageContext, data: string): void;
}
