import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatTaskId } from '../../src/core/workflow.js'
import { serializeMarkdownDocument } from '../../src/infrastructure/markdown-document.js'

export interface ExternalTaskFixture {
  readonly title: string
  readonly requirement: string
  readonly acceptanceCriteria: readonly string[]
}

/**
 * 测试夹具模拟外部 AI 工具按照提示词直接生成规格和任务文档。
 * 应用测试不再通过已删除的内置规划能力构造运行时状态。
 */
export function writeExternalWorkflow(
  projectRoot: string,
  tasks: readonly ExternalTaskFixture[],
  specification = '# SPEC\n\n总目标',
): void {
  const docsDir = join(projectRoot, 'docs')
  const tasksDir = join(docsDir, 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  writeFileSync(join(docsDir, 'SPEC.md'), `${specification.trim()}\n`, 'utf8')

  tasks.forEach((task, index) => {
    const id = formatTaskId(index + 1)
    const body = [
      `# ${id} — ${task.title}`,
      '',
      '## 需求',
      '',
      task.requirement,
      '',
      '## 验收标准',
      '',
      ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    ].join('\n')
    writeFileSync(
      join(tasksDir, `${id}.md`),
      serializeMarkdownDocument({ id, title: task.title, status: 'pending' }, body),
      'utf8',
    )
  })
}
