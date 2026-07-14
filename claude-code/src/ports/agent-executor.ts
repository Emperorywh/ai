/*
 * AgentExecutor 将 Claude 视为受限 Worker：输入是完整提示词和显式资源边界，输出是结构化结果。
 * SDK 消息、权限请求和 subprocess 生命周期必须封装在基础设施实现内部。
 */
import type { z } from "zod";
import type { AgentRunOutcome } from "../domain/agent-result.js";

export type AgentAccessMode = "write" | "read";
export type AgentAttemptKind = "implementation" | "repair" | "review" | "resume";

export interface AgentWriteBoundary {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly protectedPaths: readonly string[];
}

export interface AgentPathBoundary {
  readonly projectRoot: string;
  readonly write?: AgentWriteBoundary;
}

export interface AgentRunRequest<T> {
  readonly access: AgentAccessMode;
  readonly attemptKind: AgentAttemptKind;
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string;
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
  /*
   * 三个可选字段只传递用户显式配置的熔断策略；省略时适配器不得自行补默认限制。
   * 外部 signal 独立存在，保证无限制会话仍然可以安全中断并从 checkpoint 恢复。
   */
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
  readonly resumeSessionId?: string;
  readonly onSessionInitialized?: (sessionId: string) => Promise<void>;
  readonly pathBoundary: AgentPathBoundary;
  readonly resultSchema: z.ZodType<T>;
}

export interface AgentExecutor {
  run<T>(request: AgentRunRequest<T>): Promise<AgentRunOutcome<T>>;
}
