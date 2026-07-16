/*
 * AgentExecutor 将 Claude 视为自主 Worker：输入是完整提示词和显式资源熔断，输出是结构化结果。
 * SDK 消息、权限请求和 subprocess 生命周期必须封装在基础设施实现内部。
 */
import type { z } from "zod";
import type { AgentRunOutcome } from "../domain/agent-result.js";

export type AgentAccessMode = "write" | "read";
export type AgentAttemptKind = "implementation" | "repair" | "review" | "resume";

/*
 * 初始化事实来自 Claude Code 的 system/init 消息，而不是请求参数的回显。
 * 应用层据此持久化实际模型，执行器同时核验它与 attempt 请求模型快照一致。
 */
export interface AgentSessionInfo {
  readonly sessionId: string;
  readonly resolvedModel: string;
}

export interface AgentRunRequest<T> {
  readonly access: AgentAccessMode;
  readonly attemptKind: AgentAttemptKind;
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string;
  readonly expectedResolvedModel: string;
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
  /*
   * 可选字段只透传应用层已经决定的资源熔断；适配器不得自行补默认限制。
   * 默认组合根显式传入轮数、费用和时长上限，独立装配者也必须自行决定是否省略。
   */
  readonly maxTurns?: number;
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
  readonly resumeSessionId?: string;
  readonly onSessionInitialized?: (session: AgentSessionInfo) => Promise<void>;
  readonly resultSchema: z.ZodType<T>;
}

export interface AgentExecutor {
  run<T>(request: AgentRunRequest<T>): Promise<AgentRunOutcome<T>>;
}
