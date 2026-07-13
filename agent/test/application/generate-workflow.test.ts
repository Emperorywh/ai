import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GenerateSpecificationUseCase,
  GenerateTasksUseCase,
  type CodingAgentPort,
  type InterviewMessage,
} from '../../src/application/index.js'
import type {
  InterviewReply,
  TaskDraft,
  TaskExecutionReport,
  TaskRecord,
} from '../../src/core/workflow.js'
import { FileWorkflowRepository } from '../../src/infrastructure/file-workflow-repository.js'

const roots: string[] = []

/**
 * Fake Agent 只记录应用层传入的显式上下文。
 * 它不会模拟 SDK 内部细节，从而验证模块边界确实面向产品动作。
 */
class FakeAgent implements CodingAgentPort {
  readonly transcripts: (readonly InterviewMessage[])[] = []
  interviewReplies: InterviewReply[] = []
  taskDrafts: TaskDraft[] = []

  interview(_requirement: string, transcript: readonly InterviewMessage[]): Promise<InterviewReply> {
    this.transcripts.push([...transcript])
    const reply = this.interviewReplies.shift()
    if (!reply) throw new Error('未配置访谈回复')
    return Promise.resolve(reply)
  }

  createTaskPlan(_specification: string): Promise<readonly TaskDraft[]> {
    return Promise.resolve(this.taskDrafts)
  }

  executeTask(_input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport> {
    throw new Error('本测试不执行任务')
  }
}

function createRepository(): FileWorkflowRepository {
  const root = mkdtempSync(join(tmpdir(), 'caw-app-'))
  roots.push(root)
  const repository = new FileWorkflowRepository(root)
  repository.initialize()
  return repository
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('规格与任务生成', () => {
  it('逐轮访谈并只在完成时写入规格', async () => {
    const repository = createRepository()
    const agent = new FakeAgent()
    agent.interviewReplies = [
      { status: 'question', question: '谁会使用它？', specification: '' },
      { status: 'complete', question: '', specification: '# SPEC\n\n完整规格' },
    ]
    const useCase = new GenerateSpecificationUseCase(agent, repository, {
      ask: async () => '个人开发者',
    })

    await useCase.execute('做一个任务工具')

    expect(repository.readSpecification()).toContain('完整规格')
    expect(agent.transcripts[1]).toEqual([
      { role: 'assistant', content: '谁会使用它？' },
      { role: 'user', content: '个人开发者' },
    ])
  })

  it('从规格生成顺序任务文档', async () => {
    const repository = createRepository()
    repository.writeSpecification('# SPEC\n\n目标')
    const agent = new FakeAgent()
    agent.taskDrafts = [
      { title: '第一项', requirement: '需求一', acceptanceCriteria: ['标准一'] },
      { title: '第二项', requirement: '需求二', acceptanceCriteria: ['标准二'] },
    ]

    const tasks = await new GenerateTasksUseCase(agent, repository).execute()

    expect(tasks.map((task) => task.metadata.id)).toEqual(['TASK-001', 'TASK-002'])
  })
})
