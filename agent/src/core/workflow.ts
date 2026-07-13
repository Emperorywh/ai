import { z } from 'zod'

/**
 * MVP 只保留能够回答“下一项任务是否可执行”的四种状态。
 * 状态直接保存在任务文档中，不再维护额外数据库或隐藏状态机。
 */
export const TaskStatusSchema = z.enum(['pending', 'running', 'completed', 'blocked'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TASK_ID_PATTERN = /^TASK-\d{3}$/

/**
 * 顺序号到任务 ID 的转换属于领域协议，文件仓储和测试夹具共享同一实现。
 * 三位编号明确限制单个工作流最多 999 个任务，避免不同边界各自拼接 ID。
 */
export function formatTaskId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new Error(`任务序号必须是 1 到 999 的整数：${sequence}`)
  }
  return `TASK-${String(sequence).padStart(3, '0')}`
}

/**
 * 任务元数据刻意不包含文件路径、技术分层和实现方案。
 * 任务正文只描述需求与验收标准，从而给执行会话保留实现判断空间。
 */
export const TaskMetadataSchema = z.object({
  id: z.string().regex(TASK_ID_PATTERN, '任务 id 必须形如 TASK-001'),
  title: z.string().min(1),
  status: TaskStatusSchema,
})
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>

export interface TaskRecord {
  readonly metadata: TaskMetadata
  readonly document: string
}

/**
 * 执行报告只承载后续任务真正需要知道的事实。
 * 进度文档由应用层统一生成，Claude Code 不直接维护工作流状态。
 */
export const TaskExecutionReportSchema = z
  .object({
    status: z.enum(['completed', 'blocked']),
    summary: z.string().trim().min(1),
    progress: z.string().trim().min(1),
    changedFiles: z.array(z.string()),
    verification: z.array(z.string()),
    blocker: z.string(),
  })
  .superRefine((report, context) => {
    /**
     * completed 与 blocked 的阻塞语义必须互斥，不能只依赖模型遵守提示词。
     * 领域校验在状态落盘前阻止自相矛盾的执行报告进入进度历史。
     */
    if (report.status === 'completed' && report.blocker.trim()) {
      context.addIssue({ code: 'custom', path: ['blocker'], message: '完成报告不能包含阻塞原因' })
    }
    if (report.status === 'blocked' && !report.blocker.trim()) {
      context.addIssue({ code: 'custom', path: ['blocker'], message: '阻塞报告必须包含阻塞原因' })
    }
  })
export type TaskExecutionReport = z.infer<typeof TaskExecutionReportSchema>

/**
 * 执行报告的 JSON Schema 直接交给 Claude Agent SDK 的 outputFormat。
 * Zod 继续负责 SDK 返回后的运行时校验，避免外部输出静默污染工作流状态。
 */
export const TASK_EXECUTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'progress', 'changedFiles', 'verification', 'blocker'],
  properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] },
    summary: { type: 'string', minLength: 1 },
    progress: { type: 'string', minLength: 1 },
    changedFiles: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
} as const
