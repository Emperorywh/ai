import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { WorkflowRepositoryPort } from '../application/ports.js'
import {
  TaskMetadataSchema,
  type TaskDraft,
  type TaskRecord,
  type TaskStatus,
} from '../core/workflow.js'
import { parseMarkdownDocument, serializeMarkdownDocument } from './markdown-document.js'

const SPEC_PLACEHOLDER = `# SPEC — 产品规格说明

> 尚未生成。运行 \`caw interview "你的初始需求"\` 开始深度访谈。
`

const PROGRESS_PLACEHOLDER = `# PROGRESS — 项目进度

> 尚未执行任务。规格和任务生成后，运行 \`caw run\`。
`

const AGENTS_TEMPLATE = `# 项目执行约束

- 使用简体中文沟通。
- 编码前先理解架构、数据流、状态流和模块边界。
- 新增或修改的复杂代码必须写多行简体中文注释。
- 遵循高内聚、低耦合、单一职责和分层设计。
- 不添加临时 patch、fallback、deprecated 或 legacy 兼容逻辑。
- 不主动格式化无关代码，不自动启动浏览器测试。
`

/**
 * 文件仓储把所有持久化集中在 docs/SPEC.md、docs/tasks 和 docs/PROGRESS.md。
 * 不存在数据库、缓存索引或旁路结果文件，因此任何状态都能直接从文档推导。
 */
export class FileWorkflowRepository implements WorkflowRepositoryPort {
  readonly projectRoot: string
  private readonly docsDir: string
  private readonly tasksDir: string
  private readonly specPath: string
  private readonly progressPath: string

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot)
    this.docsDir = join(this.projectRoot, 'docs')
    this.tasksDir = join(this.docsDir, 'tasks')
    this.specPath = join(this.docsDir, 'SPEC.md')
    this.progressPath = join(this.docsDir, 'PROGRESS.md')
  }

  initialize(): { readonly created: readonly string[]; readonly skipped: readonly string[] } {
    if (existsSync(this.projectRoot) && !statSync(this.projectRoot).isDirectory()) {
      throw new Error(`目标路径不是目录：${this.projectRoot}`)
    }
    mkdirSync(this.tasksDir, { recursive: true })

    const files = [
      { relativePath: 'AGENTS.md', content: AGENTS_TEMPLATE },
      { relativePath: 'docs/SPEC.md', content: SPEC_PLACEHOLDER },
      { relativePath: 'docs/PROGRESS.md', content: PROGRESS_PLACEHOLDER },
    ]
    const created: string[] = []
    const skipped: string[] = []
    for (const file of files) {
      const filePath = join(this.projectRoot, file.relativePath)
      if (existsSync(filePath)) {
        skipped.push(file.relativePath)
      } else {
        writeFileSync(filePath, file.content, 'utf8')
        created.push(file.relativePath)
      }
    }
    return { created, skipped }
  }

  readSpecification(): string {
    this.requireFile(this.specPath, '规格文档不存在，请先运行 caw init')
    const specification = readFileSync(this.specPath, 'utf8').trim()
    if (specification === SPEC_PLACEHOLDER.trim()) {
      throw new Error('规格文档尚未生成，请先运行 caw interview')
    }
    return specification
  }

  writeSpecification(specification: string): void {
    mkdirSync(this.docsDir, { recursive: true })
    writeFileSync(this.specPath, `${specification.trim()}\n`, 'utf8')
  }

  replaceTasks(tasks: readonly TaskDraft[]): readonly TaskRecord[] {
    mkdirSync(this.tasksDir, { recursive: true })
    for (const name of readdirSync(this.tasksDir)) {
      if (/^TASK-\d+\.md$/.test(name)) unlinkSync(join(this.tasksDir, name))
    }

    tasks.forEach((task, index) => {
      const id = `TASK-${String(index + 1).padStart(3, '0')}`
      const body = renderTaskBody(id, task)
      const document = serializeMarkdownDocument(
        { id, title: task.title, status: 'pending' },
        body,
      )
      writeFileSync(join(this.tasksDir, `${id}.md`), document, 'utf8')
    })
    // 重新规划会整体替换任务集合，旧进度不再具有语义一致性。
    // 同步重置进度文档，保证后续独立会话不会读到上一版计划的完成事实。
    writeFileSync(this.progressPath, PROGRESS_PLACEHOLDER, 'utf8')
    return this.listTasks()
  }

  listTasks(): readonly TaskRecord[] {
    if (!existsSync(this.tasksDir)) return []
    return readdirSync(this.tasksDir)
      .filter((name) => /^TASK-\d+\.md$/.test(name))
      .sort(compareTaskFiles)
      .map((name) => this.readTask(join(this.tasksDir, name)))
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const filePath = join(this.tasksDir, `${taskId}.md`)
    this.requireFile(filePath, `任务不存在：${taskId}`)
    const current = readFileSync(filePath, 'utf8')
    const parsed = parseMarkdownDocument(current)
    const metadata = TaskMetadataSchema.parse(parsed.frontmatter)
    writeFileSync(
      filePath,
      serializeMarkdownDocument({ ...metadata, status }, parsed.body),
      'utf8',
    )
  }

  readProgress(): string {
    return existsSync(this.progressPath) ? readFileSync(this.progressPath, 'utf8') : PROGRESS_PLACEHOLDER
  }

  writeProgress(progress: string): void {
    mkdirSync(this.docsDir, { recursive: true })
    writeFileSync(this.progressPath, `${progress.trim()}\n`, 'utf8')
  }

  private readTask(filePath: string): TaskRecord {
    const document = readFileSync(filePath, 'utf8')
    const parsed = parseMarkdownDocument(document)
    return {
      metadata: TaskMetadataSchema.parse(parsed.frontmatter),
      document,
    }
  }

  private requireFile(filePath: string, message: string): void {
    if (!existsSync(filePath)) throw new Error(message)
  }
}

/**
 * 每个任务正文只回答“要实现什么、怎样算完成”。
 * 不生成建议目录、技术方案或允许路径，防止规划阶段冻结实现方式。
 */
function renderTaskBody(id: string, task: TaskDraft): string {
  return [
    `# ${id} — ${task.title}`,
    '',
    '## 需求',
    '',
    task.requirement.trim(),
    '',
    '## 验收标准',
    '',
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion.trim()}`),
  ].join('\n')
}

function compareTaskFiles(left: string, right: string): number {
  const leftNumber = Number(left.match(/\d+/)?.[0] ?? 0)
  const rightNumber = Number(right.match(/\d+/)?.[0] ?? 0)
  return leftNumber - rightNumber
}
