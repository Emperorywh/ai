import type { TaskExecutionReport, TaskRecord } from '../core/workflow.js'
import type { ExecuteNextTaskOutcome } from './execute-next-task.js'

export interface NextTaskExecutorPort {
  execute(): Promise<ExecuteNextTaskOutcome>
}

export interface ExecutedTask {
  readonly task: TaskRecord
  readonly report: TaskExecutionReport
}

export interface ExecuteWorkflowOutcome {
  readonly status: 'completed' | 'blocked'
  readonly executions: readonly ExecutedTask[]
}

export type TaskFinishedReporter = (execution: ExecutedTask) => void

/**
 * 工作流用例顺序等待当前任务结束，再触发下一次独立任务执行。
 * 单任务状态机继续由 ExecuteNextTaskUseCase 负责，本层只管理循环与停止条件。
 */
export class ExecuteWorkflowUseCase {
  constructor(
    private readonly nextTaskExecutor: NextTaskExecutorPort,
    private readonly reportTaskFinished: TaskFinishedReporter = () => undefined,
  ) {}

  async execute(): Promise<ExecuteWorkflowOutcome> {
    const executions: ExecutedTask[] = []
    for (;;) {
      const outcome = await this.nextTaskExecutor.execute()
      if (!outcome.task || !outcome.report) {
        return { status: 'completed', executions }
      }

      const execution: ExecutedTask = { task: outcome.task, report: outcome.report }
      executions.push(execution)
      this.reportTaskFinished(execution)

      /**
       * 严格顺序工作流不能绕过阻塞任务，也不能在同一次运行中无限重试。
       * 用户处理阻塞原因后，可以再次运行 caw run 重新执行该任务。
       */
      if (outcome.report.status === 'blocked') {
        return { status: 'blocked', executions }
      }
    }
  }
}
