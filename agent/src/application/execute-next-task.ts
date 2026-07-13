import type { TaskExecutionReport, TaskRecord } from '../core/workflow.js'
import type { CodingAgentPort, WorkflowRepositoryPort } from './ports.js'
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
    private readonly agent: CodingAgentPort,
    private readonly repository: WorkflowRepositoryPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ExecuteNextTaskOutcome> {
    const tasks = this.repository.listTasks()
    if (tasks.length === 0) throw new Error('没有任务，请先运行 caw plan')

    const task = tasks.find((candidate) => candidate.metadata.status !== 'completed')
    if (!task) return { task: null, report: null }

    this.repository.updateTaskStatus(task.metadata.id, 'running')
    const runningTask = this.repository
      .listTasks()
      .find((candidate) => candidate.metadata.id === task.metadata.id)
    if (!runningTask) throw new Error(`任务状态更新后无法重新读取：${task.metadata.id}`)
    try {
      const report = await this.agent.executeTask({
        specification: this.repository.readSpecification(),
        progress: this.repository.readProgress(),
        task: runningTask,
      })
      this.finishTask(runningTask, report)
      return { task: runningTask, report }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const report: TaskExecutionReport = {
        status: 'blocked',
        summary: 'Claude Code 会话未正常完成',
        progress: '本次执行没有产生可信的完成结论，后续应重试当前任务。',
        changedFiles: [],
        verification: [],
        blocker: message,
      }
      this.finishTask(runningTask, report)
      throw error
    }
  }

  private finishTask(task: TaskRecord, report: TaskExecutionReport): void {
    this.repository.updateTaskStatus(task.metadata.id, report.status)
    const tasks = this.repository.listTasks()
    const previousProgress = this.repository.readProgress()
    const entry = toProgressEntry(task, report, this.now().toISOString())
    this.repository.writeProgress(renderProgress(tasks, entry, previousProgress))
  }
}
