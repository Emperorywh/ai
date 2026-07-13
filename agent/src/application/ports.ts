import type {
  TaskExecutionReport,
  TaskRecord,
  TaskStatus,
} from '../core/workflow.js'

/**
 * 应用层只依赖“执行一个任务”的产品能力，不感知 Claude SDK 会话细节。
 * 规格与任务由外部 AI 工具按提示词生成，不再进入运行时 Agent 端口。
 */
export interface TaskExecutionAgentPort {
  executeTask(input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport>
}

/**
 * 任务执行用例只依赖运行阶段真正需要的文件能力。
 * 初始化提示词属于 CLI 基础设施职责，不进入应用层仓储端口。
 */
export interface TaskWorkflowRepositoryPort {
  readSpecification(): string
  listTasks(): readonly TaskRecord[]
  updateTaskStatus(taskId: string, status: TaskStatus): void
  readProgress(): string
  writeProgress(progress: string): void
}
