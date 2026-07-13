import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileWorkflowRepository } from '../../src/infrastructure/file-workflow-repository.js'
import { writeExternalWorkflow } from '../support/workflow-fixture.js'

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
  it('初始化事实文档和两份跨 AI 工具提示词', () => {
    const repository = createRepository()
    const result = repository.initialize()

    expect(result.created).toEqual([
      'AGENTS.md',
      'docs/SPEC.md',
      'docs/PROGRESS.md',
      'prompts/generate-specification.md',
      'prompts/generate-tasks.md',
    ])
    expect(
      readFileSync(join(repository.projectRoot, 'prompts/generate-specification.md'), 'utf8'),
    ).toContain('docs/SPEC.md')
    expect(readFileSync(join(repository.projectRoot, 'prompts/generate-tasks.md'), 'utf8')).toContain(
      'docs/tasks/TASK-XXX.md',
    )
    expect(repository.listTasks()).toEqual([])
  })

  it('读取外部 AI 按提示词生成的标准任务文档', () => {
    const repository = createRepository()
    repository.initialize()
    writeExternalWorkflow(repository.projectRoot, [
      {
        title: '允许用户创建项目',
        requirement: '用户可以创建一个带名称的项目。',
        acceptanceCriteria: ['创建成功后能够看到项目', '项目名称不能为空'],
      },
    ])
    const tasks = repository.listTasks()

    expect(tasks[0]?.metadata).toEqual({
      id: 'TASK-001',
      title: '允许用户创建项目',
      status: 'pending',
    })
    expect(tasks[0]?.document).not.toContain('allowed_paths')
    expect(tasks[0]?.document).not.toContain('layer:')
  })

  it('拒绝不连续的外部任务编号', () => {
    const repository = createRepository()
    repository.initialize()
    writeExternalWorkflow(repository.projectRoot, [
      { title: '第一项', requirement: '需求一', acceptanceCriteria: ['标准一'] },
      { title: '第二项', requirement: '需求二', acceptanceCriteria: ['标准二'] },
    ])
    rmSync(join(repository.projectRoot, 'docs/tasks/TASK-001.md'))

    expect(() => repository.listTasks()).toThrow('任务编号必须从 TASK-001 开始连续排列')
  })

  it('更新状态时保留任务需求正文', () => {
    const repository = createRepository()
    repository.initialize()
    writeExternalWorkflow(repository.projectRoot, [
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
