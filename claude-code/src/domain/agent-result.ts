/*
 * Agent 输出必须经过结构化协议和运行时校验，不能从自然语言中猜测完成状态。
 * 这些类型属于稳定领域边界，Claude Agent SDK 的消息结构不会向应用层泄漏。
 */
import { z } from "zod";

const summaryText = z.string().trim().min(1).max(10_000);
const detailText = z.string().trim().min(1).max(2_000);

/*
 * 验证证据只记录实际执行过的命令，不允许用自然语言“应该通过”替代可审计事实。
 * scope 区分局部反馈与最终全量门禁，使 Reviewer 能判断当前证据是否覆盖任务风险。
 */
export const verificationEvidenceSchema = z.object({
  scope: z.enum(["targeted", "full"]),
  command: z.string().trim().min(1).max(2_000),
  status: z.enum(["passed", "failed"]),
  summary: detailText,
}).strict();

export const implementationResultSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  summary: summaryText,
  blockingQuestions: z.array(detailText).max(50),
  notes: z.array(detailText).max(100),
  verifications: z.array(verificationEvidenceSchema).max(100),
}).strict();

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  message: detailText,
  file: z.string().trim().min(1).max(1_000).optional(),
  line: z.number().int().positive().optional(),
}).strict();

export const reviewResultSchema = z.object({
  status: z.enum(["approved", "rejected", "blocked"]),
  summary: summaryText,
  findings: z.array(reviewFindingSchema).max(200),
  blockingQuestions: z.array(detailText).max(50),
}).strict();

export type ImplementationResult = z.infer<typeof implementationResultSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;

export type AgentFailureKind =
  | "execution"
  | "max_turns"
  | "max_budget"
  | "model_mismatch"
  | "structured_output"
  | "timeout"
  | "protocol"
  | "aborted";

/*
 * AgentRunTelemetry 记录一次 SDK 调用可稳定观测的资源事实。
 * 业务状态只消费聚合结果，不依赖 Claude SDK 的私有消息结构或控制台文本。
 */
export interface AgentRunTelemetry {
  readonly requestedModel: string;
  readonly resolvedModel?: string | undefined;
  readonly durationMs: number;
  readonly apiRetryCount: number;
  readonly apiRetryDelayMs: number;
  readonly toolCalls: number;
}

export type AgentRunOutcome<T> =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly data: T;
      readonly costUsd: number;
      readonly turns: number;
      readonly telemetry: AgentRunTelemetry;
    }
  | {
      readonly ok: false;
      readonly sessionId?: string;
      readonly kind: AgentFailureKind;
      readonly message: string;
      readonly costUsd: number;
      readonly turns: number;
      readonly retryable: boolean;
      readonly telemetry: AgentRunTelemetry;
    };
