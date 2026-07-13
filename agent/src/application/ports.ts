import type {
  InterviewReply,
  TaskDraft,
  TaskExecutionReport,
  TaskRecord,
  TaskStatus,
} from '../core/workflow.js'

export interface InterviewMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/**
 * AI 能力按产品动作表达，而不是暴露底层 SDK 会话细节。
 * 应用层因此可以独立测试，基础设施层也可以替换具体模型实现。
 */
export interface CodingAgentPort {
  interview(initialRequirement: string, transcript: readonly InterviewMessage[]): Promise<InterviewReply>
  createTaskPlan(specification: string): Promise<readonly TaskDraft[]>
  executeTask(input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport>
}

/**
 * Markdown 文档是工作流的唯一事实来源。
 * 仓储接口只暴露三个核心文档概念：规格、任务和进度。
 */
export interface WorkflowRepositoryPort {
  initialize(): { readonly created: readonly string[]; readonly skipped: readonly string[] }
  readSpecification(): string
  writeSpecification(specification: string): void
  replaceTasks(tasks: readonly TaskDraft[]): readonly TaskRecord[]
  listTasks(): readonly TaskRecord[]
  updateTaskStatus(taskId: string, status: TaskStatus): void
  readProgress(): string
  writeProgress(progress: string): void
}

/**
 * 访谈输入输出属于边界交互，由 CLI 实现。
 * 用例只决定何时追问以及何时持久化最终规格。
 */
export interface InterviewIOPort {
  ask(question: string): Promise<string>
}
