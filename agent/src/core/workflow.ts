import { z } from 'zod'

/**
 * MVP 只保留能够回答“下一项任务是否可执行”的四种状态。
 * 状态直接保存在任务文档中，不再维护额外数据库或隐藏状态机。
 */
export const TaskStatusSchema = z.enum(['pending', 'running', 'completed', 'blocked'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/**
 * 任务元数据刻意不包含文件路径、技术分层和实现方案。
 * 任务正文只描述需求与验收标准，从而给执行会话保留实现判断空间。
 */
export const TaskMetadataSchema = z.object({
  id: z.string().regex(/^TASK-\d+$/, '任务 id 必须形如 TASK-001'),
  title: z.string().min(1),
  status: TaskStatusSchema,
})
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>

export interface TaskRecord {
  readonly metadata: TaskMetadata
  readonly document: string
}

/**
 * 规格访谈每轮只返回一个问题，或一次性返回最终规格。
 * 空字段用于保持 Claude 结构化输出契约简单且稳定。
 */
export const InterviewReplySchema = z.object({
  status: z.enum(['question', 'complete']),
  question: z.string(),
  specification: z.string(),
})
export type InterviewReply = z.infer<typeof InterviewReplySchema>

export const TaskDraftSchema = z.object({
  title: z.string().min(1),
  requirement: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
})
export type TaskDraft = z.infer<typeof TaskDraftSchema>

export const TaskPlanSchema = z.object({
  tasks: z.array(TaskDraftSchema).min(1),
})
export type TaskPlan = z.infer<typeof TaskPlanSchema>

/**
 * 执行报告只承载后续任务真正需要知道的事实。
 * 进度文档由应用层统一生成，Claude Code 不直接维护工作流状态。
 */
export const TaskExecutionReportSchema = z.object({
  status: z.enum(['completed', 'blocked']),
  summary: z.string().min(1),
  progress: z.string().min(1),
  changedFiles: z.array(z.string()),
  verification: z.array(z.string()),
  blocker: z.string(),
})
export type TaskExecutionReport = z.infer<typeof TaskExecutionReportSchema>

/**
 * 以下 JSON Schema 直接交给 Claude Agent SDK 的 outputFormat。
 * Zod 仍负责运行时校验，避免 SDK 输出与应用模型静默漂移。
 */
export const INTERVIEW_REPLY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'question', 'specification'],
  properties: {
    status: { type: 'string', enum: ['question', 'complete'] },
    question: { type: 'string' },
    specification: { type: 'string' },
  },
} as const

export const TASK_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'requirement', 'acceptanceCriteria'],
        properties: {
          title: { type: 'string' },
          requirement: { type: 'string' },
          acceptanceCriteria: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
  },
} as const

export const TASK_EXECUTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'progress', 'changedFiles', 'verification', 'blocker'],
  properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] },
    summary: { type: 'string' },
    progress: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
} as const
