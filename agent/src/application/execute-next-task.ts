import type { TaskExecutionReport, TaskRecord } from '../core/workflow.js'
import type { TaskExecutionAgentPort, TaskWorkflowRepositoryPort } from './ports.js'
import { renderProgress, toProgressEntry } from './progress.js'

export interface ExecuteNextTaskOutcome {
  readonly task: TaskRecord | null
  readonly report: TaskExecutionReport | null
}

/**
 * MVP 严格顺序执行第一个未完成任务，避免引入依赖图和并行调度。
 * 每次 agent.executeTask 都是全新 SDK 查询，上下文只来自规格、进度和当前任务。
 */
export class ExecuteNextTaskUseCase {
  constructor(
    private readonly agent: TaskExecutionAgentPort,
    private readonly repository: TaskWorkflowRepositoryPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ExecuteNextTaskOutcome> {
    const tasks = this.repository.listTasks()
    if (tasks.length === 0) {
      throw new Error('没有任务，请先使用 prompts/generate-tasks.md 生成任务文档')
    }

    const task = tasks.find((candidate) => candidate.metadata.status !== 'completed')
    if (!task) return { task: null, report: null }

    /**
     * 外部 AI 生成的工作流事实必须在进入运行状态前全部可读。
     * 输入协议错误不属于任务执行失败，因此不应把尚未启动的任务标记为 blocked。
     */
    const specification = this.repository.readSpecification()
    const progress = this.repository.readProgress()
    this.repository.updateTaskStatus(task.metadata.id, 'running')
    const runningTask = this.repository
      .listTasks()
      .find((candidate) => candidate.metadata.id === task.metadata.id)
    if (!runningTask) throw new Error(`任务状态更新后无法重新读取：${task.metadata.id}`)

    let report: TaskExecutionReport
    try {
      report = await this.agent.executeTask({
        specification,
        progress,
        task: runningTask,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const blockedReport: TaskExecutionReport = {
        status: 'blocked',
        summary: 'Claude Code 会话未正常完成',
        progress: '本次执行没有产生可信的完成结论，后续应重试当前任务。',
        changedFiles: [],
        verification: [],
        blocker: message,
      }
      this.finishTask(runningTask, blockedReport)
      throw error
    }

    /**
     * 会话成功返回后再单独持久化报告，避免仓储写入异常被误判为 Claude 失败。
     * 工作流存储错误直接上抛，由调用方处理文件一致性问题。
     */
    this.finishTask(runningTask, report)
    return { task: runningTask, report }
  }

  private finishTask(task: TaskRecord, report: TaskExecutionReport): void {
    this.repository.updateTaskStatus(task.metadata.id, report.status)
    const tasks = this.repository.listTasks()
    const previousProgress = this.repository.readProgress()
    const entry = toProgressEntry(task, report, this.now().toISOString())
    this.repository.writeProgress(renderProgress(tasks, entry, previousProgress))
  }
}
