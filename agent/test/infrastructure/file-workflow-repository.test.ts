import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileWorkflowRepository } from '../../src/infrastructure/file-workflow-repository.js'

const roots: string[] = []

/**
 * 测试只通过仓储公开接口创建工作流文件。
 * 每个用例使用独立临时目录，避免任务状态在用例间形成隐式共享。
 */
function createRepository(): FileWorkflowRepository {
  const root = mkdtempSync(join(tmpdir(), 'caw-mvp-'))
  roots.push(root)
  return new FileWorkflowRepository(root)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('FileWorkflowRepository', () => {
  it('只初始化三个核心文档', () => {
    const repository = createRepository()
    const result = repository.initialize()

    expect(result.created).toEqual(['AGENTS.md', 'docs/SPEC.md', 'docs/PROGRESS.md'])
    expect(repository.listTasks()).toEqual([])
  })

  it('生成的任务只包含需求、验收标准和最小状态', () => {
    const repository = createRepository()
    repository.initialize()
    const tasks = repository.replaceTasks([
      {
        title: '允许用户创建项目',
        requirement: '用户可以创建一个带名称的项目。',
        acceptanceCriteria: ['创建成功后能够看到项目', '项目名称不能为空'],
      },
    ])

    expect(tasks[0]?.metadata).toEqual({
      id: 'TASK-001',
      title: '允许用户创建项目',
      status: 'pending',
    })
    expect(tasks[0]?.document).not.toContain('allowed_paths')
    expect(tasks[0]?.document).not.toContain('layer:')
  })

  it('更新状态时保留任务需求正文', () => {
    const repository = createRepository()
    repository.initialize()
    repository.replaceTasks([
      { title: '任务', requirement: '原始需求', acceptanceCriteria: ['可以验收'] },
    ])

    repository.updateTaskStatus('TASK-001', 'completed')

    const task = repository.listTasks()[0]
    expect(task?.metadata.status).toBe('completed')
    expect(task?.document).toContain('原始需求')
    expect(readFileSync(join(repository.projectRoot, 'docs/tasks/TASK-001.md'), 'utf8')).toContain(
      'status: completed',
    )
  })
})
