import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExecuteNextTaskUseCase, type CodingAgentPort } from '../../src/application/index.js'
import type {
  InterviewReply,
  TaskDraft,
  TaskExecutionReport,
  TaskRecord,
} from '../../src/core/workflow.js'
import { FileWorkflowRepository } from '../../src/infrastructure/file-workflow-repository.js'

const roots: string[] = []

/**
 * 执行 Fake 会捕获规格、历史进度与当前任务三个上下文输入。
 * 测试据此确认独立任务会话不依赖前一个模型会话的隐藏记忆。
 */
class ExecutionAgent implements CodingAgentPort {
  input: { specification: string; progress: string; task: TaskRecord } | null = null
  report: TaskExecutionReport | Error = {
    status: 'completed',
    summary: '能力已完成',
    progress: '新增了后续任务可直接使用的能力',
    changedFiles: ['src/example.ts'],
    verification: ['npm test 通过'],
    blocker: '',
  }

  interview(): Promise<InterviewReply> {
    throw new Error('本测试不访谈')
  }

  createTaskPlan(): Promise<readonly TaskDraft[]> {
    throw new Error('本测试不规划')
  }

  executeTask(input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport> {
    this.input = input
    return this.report instanceof Error ? Promise.reject(this.report) : Promise.resolve(this.report)
  }
}

function createRepository(): FileWorkflowRepository {
  const root = mkdtempSync(join(tmpdir(), 'caw-run-'))
  roots.push(root)
  const repository = new FileWorkflowRepository(root)
  repository.initialize()
  repository.writeSpecification('# SPEC\n\n总目标')
  repository.replaceTasks([
    { title: '第一项', requirement: '当前需求', acceptanceCriteria: ['当前标准'] },
    { title: '第二项', requirement: '后续需求', acceptanceCriteria: ['后续标准'] },
  ])
  return repository
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ExecuteNextTaskUseCase', () => {
  it('只执行首个未完成任务并回写进度', async () => {
    const repository = createRepository()
    const agent = new ExecutionAgent()
    const useCase = new ExecuteNextTaskUseCase(
      agent,
      repository,
      () => new Date('2026-07-13T00:00:00.000Z'),
    )

    const outcome = await useCase.execute()

    expect(outcome.task?.metadata.id).toBe('TASK-001')
    expect(agent.input?.specification).toContain('总目标')
    expect(agent.input?.progress).toContain('尚未执行任务')
    expect(agent.input?.task.document).toContain('当前需求')
    expect(agent.input?.task.metadata.status).toBe('running')
    expect(repository.listTasks().map((task) => task.metadata.status)).toEqual([
      'completed',
      'pending',
    ])
    expect(repository.readProgress()).toContain('新增了后续任务可直接使用的能力')
  })

  it('SDK 异常时把当前任务显式标记为 blocked', async () => {
    const repository = createRepository()
    const agent = new ExecutionAgent()
    agent.report = new Error('鉴权失败')
    const useCase = new ExecuteNextTaskUseCase(agent, repository)

    await expect(useCase.execute()).rejects.toThrow('鉴权失败')

    expect(repository.listTasks()[0]?.metadata.status).toBe('blocked')
    expect(repository.readProgress()).toContain('鉴权失败')
  })
})
