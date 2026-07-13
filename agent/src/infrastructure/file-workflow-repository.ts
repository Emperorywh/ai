import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { TaskWorkflowRepositoryPort } from '../application/ports.js'
import {
  formatTaskId,
  TaskMetadataSchema,
  type TaskRecord,
  type TaskStatus,
} from '../core/workflow.js'
import { parseMarkdownDocument, serializeMarkdownDocument } from './markdown-document.js'
import { parseTaskDocument, parseTaskFileName } from './task-document.js'
import {
  INITIAL_WORKFLOW_FILES,
  PROGRESS_PLACEHOLDER,
  SPEC_PLACEHOLDER,
} from './workflow-initialization.js'

/**
 * 文件仓储把所有持久化集中在 docs/SPEC.md、docs/tasks 和 docs/PROGRESS.md。
 * 不存在数据库、缓存索引或旁路结果文件，因此任何状态都能直接从文档推导。
 */
export class FileWorkflowRepository implements TaskWorkflowRepositoryPort {
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

    const created: string[] = []
    const skipped: string[] = []
    for (const file of INITIAL_WORKFLOW_FILES) {
      const filePath = join(this.projectRoot, file.relativePath)
      if (existsSync(filePath)) {
        skipped.push(file.relativePath)
      } else {
        mkdirSync(dirname(filePath), { recursive: true })
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
      throw new Error('规格文档尚未生成，请先使用 prompts/generate-specification.md')
    }
    return specification
  }

  listTasks(): readonly TaskRecord[] {
    if (!existsSync(this.tasksDir)) return []
    const directoryEntries = readdirSync(this.tasksDir)
    const invalidTaskFile = directoryEntries.find(
      (name) => name.startsWith('TASK-') && name.endsWith('.md') && !parseTaskFileName(name),
    )
    if (invalidTaskFile) throw new Error(`任务文件名不合法：${invalidTaskFile}`)

    const taskFiles = directoryEntries
      .map((fileName) => ({ fileName, taskId: parseTaskFileName(fileName) }))
      .filter((file): file is { fileName: string; taskId: string } => file.taskId !== null)
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
    taskFiles.forEach((file, index) => {
      const expectedTaskId = formatTaskId(index + 1)
      if (file.taskId !== expectedTaskId) {
        throw new Error(`任务编号必须从 TASK-001 开始连续排列，缺少：${expectedTaskId}.md`)
      }
    })
    return taskFiles.map((file) => this.readTask(file.fileName, file.taskId))
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

  private readTask(fileName: string, expectedTaskId: string): TaskRecord {
    const filePath = join(this.tasksDir, fileName)
    const document = readFileSync(filePath, 'utf8')
    return parseTaskDocument(expectedTaskId, document)
  }

  private requireFile(filePath: string, message: string): void {
    if (!existsSync(filePath)) throw new Error(message)
  }
}
