/*
 * Agent 输出必须经过结构化协议和运行时校验，不能从自然语言中猜测完成状态。
 * 这些类型属于稳定领域边界，Claude Agent SDK 的消息结构不会向应用层泄漏。
 */
import { z } from "zod";

export const implementationResultSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  summary: z.string(),
  blockingQuestions: z.array(z.string()),
  notes: z.array(z.string()),
}).strict();

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
}).strict();

export const reviewResultSchema = z.object({
  status: z.enum(["approved", "rejected", "blocked"]),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
  blockingQuestions: z.array(z.string()),
}).strict();

export type ImplementationResult = z.infer<typeof implementationResultSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export type AgentFailureKind =
  | "execution"
  | "max_turns"
  | "max_budget"
  | "structured_output"
  | "timeout"
  | "protocol"
  | "aborted";

export type AgentRunOutcome<T> =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly data: T;
      readonly costUsd: number;
      readonly turns: number;
    }
  | {
      readonly ok: false;
      readonly sessionId?: string;
      readonly kind: AgentFailureKind;
      readonly message: string;
      readonly costUsd: number;
      readonly turns: number;
      readonly retryable: boolean;
    };
