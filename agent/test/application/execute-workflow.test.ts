import { describe, expect, it } from 'vitest'
import {
  ExecuteWorkflowUseCase,
  type ExecuteNextTaskOutcome,
  type NextTaskExecutorPort,
} from '../../src/application/index.js'
import { formatTaskId, type TaskExecutionReport, type TaskRecord } from '../../src/core/workflow.js'

/**
 * 队列执行器显式记录调用次数，模拟单任务用例依次完成、阻塞或耗尽。
 * 工作流循环测试不接触文件系统和 SDK，只验证顺序编排与停止条件。
 */
class QueuedTaskExecutor implements NextTaskExecutorPort {
  calls = 0

  constructor(private readonly outcomes: readonly ExecuteNextTaskOutcome[]) {}

  execute(): Promise<ExecuteNextTaskOutcome> {
    const outcome = this.outcomes[this.calls]
    this.calls += 1
    return Promise.resolve(outcome ?? { task: null, report: null })
  }
}

function createExecution(sequence: number, status: 'completed' | 'blocked'): ExecuteNextTaskOutcome {
  const id = formatTaskId(sequence)
  const task: TaskRecord = {
    metadata: { id, title: `任务 ${sequence}`, status: 'running' },
    document: `# ${id}`,
  }
  const report: TaskExecutionReport = {
    status,
    summary: `${id} 执行结果`,
    progress: `${id} 产生的事实`,
    changedFiles: [],
    verification: [],
    blocker: status === 'blocked' ? '需要用户处理' : '',
  }
  return { task, report }
}

describe('ExecuteWorkflowUseCase', () => {
  it('等待每个任务完成并自动执行到任务集合耗尽', async () => {
    const executor = new QueuedTaskExecutor([
      createExecution(1, 'completed'),
      createExecution(2, 'completed'),
    ])
    const reportedTaskIds: string[] = []
    const useCase = new ExecuteWorkflowUseCase(executor, ({ task }) => {
      reportedTaskIds.push(task.metadata.id)
    })

    const outcome = await useCase.execute()

    expect(outcome.status).toBe('completed')
    expect(outcome.executions.map((execution) => execution.task.metadata.id)).toEqual([
      'TASK-001',
      'TASK-002',
    ])
    expect(reportedTaskIds).toEqual(['TASK-001', 'TASK-002'])
    expect(executor.calls).toBe(3)
  })

  it('当前任务阻塞后停止，不在同一次运行中重试或越过任务', async () => {
    const executor = new QueuedTaskExecutor([
      createExecution(1, 'blocked'),
      createExecution(2, 'completed'),
    ])

    const outcome = await new ExecuteWorkflowUseCase(executor).execute()

    expect(outcome.status).toBe('blocked')
    expect(outcome.executions).toHaveLength(1)
    expect(executor.calls).toBe(1)
  })
})
