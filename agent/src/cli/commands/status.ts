import { Command } from 'commander'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { TaskDocRepository, buildExecutionSummary } from '../../infrastructure/index.js'
import {
  LayerSchema,
  TaskStatusSchema,
  type ExecutionStatus,
  type Layer,
  type NextAction,
  type ResultFrontmatter,
  type ReviewFrontmatter,
  type TaskId,
  type TaskStatus,
} from '../../core/index.js'

/**
 * `status` 命令：列出任务状态与最近执行摘要。
 *
 * 职责（见 docs/tasks/TASK-025 §2 / Readme §3.1 / §3.2）：
 *  - 任务 id / title / status / layer 来自 docs/tasks frontmatter（**文档为权威**）。
 *  - 执行摘要来自 .result.md（+ 可选 .review.md）经 buildExecutionSummary 综合；任务尚未
 *    执行时无摘要。
 *  - 支持按 --status / --layer 过滤。
 *
 * 设计依据（Readme §3.1 明文）：
 *  - 「索引不参与状态机判定，状态机只读 frontmatter；任何『读状态』的判断都不得只依赖
 *    SQLite。」故 status 的任务状态一律取自文档，**不读取 SQLite 索引**——索引是派生加速
 *    存储，其维护见 rebuild-index 命令。这同时满足验收「无索引时仍能从文档正确展示」。
 *
 * 不做（任务 §7）：任务执行 / 状态流转 / 合并（归 task:run / Orchestrator）。
 */

/** status 展示的单任务行：任务基本信息 + 最近执行摘要。 */
export interface StatusRow {
  readonly id: TaskId
  readonly title: string
  readonly status: TaskStatus
  readonly layer: Layer
  /** 最近一次执行摘要；任务尚未产出 .result.md 时为 null。 */
  readonly execution: ExecutionDigest | null
}

/** 执行摘要（来自 .result.md + 可选 .review.md，文档为权威，§3.2）。 */
export interface ExecutionDigest {
  readonly execution_status: ExecutionStatus
  readonly next_action: NextAction
  /** 代表性 commit hash（execution_commits 首条，DEC-011）；无 commit 时为 null。 */
  readonly commit: string | null
}

/** collectStatus 的过滤选项（均可缺省）。 */
export interface StatusCollectOptions {
  /** 按任务状态过滤（TaskStatus 枚举值）。 */
  readonly status?: TaskStatus
  /** 按任务层级过滤（Layer 枚举值）。 */
  readonly layer?: Layer
}

/**
 * 从文档（docs/tasks）收集任务状态行（§3.2：状态判定以 frontmatter 为准，不依赖 SQLite）。
 *
 * 任务 id / title / status / layer 来自 readTask（frontmatter 权威）；执行摘要来自
 * .result.md（+ 可选 .review.md）经 buildExecutionSummary 综合——任务尚未执行时为 null。
 * 纯编排 + 纯读取，不做状态机判定、不写任何文件。
 */
export function collectStatus(tasksDir: string, options: StatusCollectOptions = {}): StatusRow[] {
  const taskRepo = new TaskDocRepository(tasksDir)
  const rows: StatusRow[] = []
  for (const id of taskRepo.listTasks()) {
    const task = taskRepo.readTask(id)
    if (options.status !== undefined && task.status !== options.status) continue
    if (options.layer !== undefined && task.layer !== options.layer) continue
    rows.push({
      id: task.id,
      title: task.title,
      status: task.status,
      layer: task.layer,
      execution: readExecutionDigest(taskRepo, id),
    })
  }
  return rows
}

/** 读取某任务的执行摘要：.result.md 不存在（任务未执行）返回 null；存在但损坏让错误冒泡。 */
function readExecutionDigest(taskRepo: TaskDocRepository, id: TaskId): ExecutionDigest | null {
  const result = readResultOptional(taskRepo, id)
  if (result === null) return null
  const review = readReviewOptional(taskRepo, id)
  const summary = buildExecutionSummary(result, review ?? undefined)
  return {
    execution_status: summary.execution_status,
    next_action: summary.next_action,
    commit: summary.commit?.hash ?? null,
  }
}

/** 读取 .result.md；文件不存在（任务未执行）返回 null，存在但损坏让错误冒泡（DEC-008 前缀契约）。 */
function readResultOptional(taskRepo: TaskDocRepository, id: TaskId): ResultFrontmatter | null {
  try {
    return taskRepo.readResult(id)
  } catch (err) {
    if (isDocMissing(err)) return null
    throw err
  }
}

/** 读取 .review.md；语义同 readResultOptional。 */
function readReviewOptional(taskRepo: TaskDocRepository, id: TaskId): ReviewFrontmatter | null {
  try {
    return taskRepo.readReview(id)
  } catch (err) {
    if (isDocMissing(err)) return null
    throw err
  }
}

/** 判定错误是否为「文档不存在」（TaskDocRepository 抛错的稳定前缀，DEC-008）。 */
function isDocMissing(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('文档不存在')
}

/**
 * 把任务行格式化为可读表格：前四列等宽对齐，TITLE 原样跟在其后。
 * 空结果返回占位提示（命令层据此输出「无任务」语义）。
 */
export function formatStatus(rows: readonly StatusRow[]): string {
  if (rows.length === 0) return '（暂无任务）'
  const idW = Math.max('TASK-ID'.length, ...rows.map((r) => r.id.length))
  const statusW = Math.max('STATUS'.length, ...rows.map((r) => r.status.length))
  const layerW = Math.max('LAYER'.length, ...rows.map((r) => r.layer.length))
  const execW = Math.max('EXECUTION'.length, ...rows.map((r) => executionLabel(r.execution).length))
  const header = `${pad('TASK-ID', idW)}  ${pad('STATUS', statusW)}  ${pad('LAYER', layerW)}  ${pad('EXECUTION', execW)}  TITLE`
  const body = rows.map((r) => {
    const exec = executionLabel(r.execution)
    return `${pad(r.id, idW)}  ${pad(r.status, statusW)}  ${pad(r.layer, layerW)}  ${pad(exec, execW)}  ${r.title}`
  })
  return [header, ...body].join('\n')
}

/** 执行摘要的展示文本：未执行 → 「未执行」；否则 execution_status + 可选 7 位短 commit。 */
function executionLabel(exec: ExecutionDigest | null): string {
  if (exec === null) return '未执行'
  const hash = exec.commit !== null ? ' ' + exec.commit.slice(0, 7) : ''
  return `${exec.execution_status}${hash}`
}

/** 右侧补空格到指定宽度（不截断超长内容）。 */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/** commander 解析后的 status 选项（--tasks-dir → tasksDir，带默认值故为必填字符串）。 */
interface StatusOptions {
  status?: string
  layer?: string
  tasksDir: string
}

/**
 * 向 commander program 注册 status 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('列出任务状态与最近执行摘要（状态以 docs/tasks frontmatter 为准，§3.2）')
    .option('--status <status>', '按任务状态过滤（TaskStatus 枚举值）')
    .option('--layer <layer>', '按任务层级过滤（Layer 枚举值）')
    .option('--tasks-dir <dir>', '任务文档目录', 'docs/tasks')
    .action((options: StatusOptions) => {
      const tasksDir = resolve(options.tasksDir)
      if (!existsSync(tasksDir)) {
        throw new Error(`任务目录不存在: ${tasksDir}`)
      }
      const filter: StatusCollectOptions = {
        status:
          options.status !== undefined
            ? pickEnum(options.status, TaskStatusSchema.options, '--status')
            : undefined,
        layer:
          options.layer !== undefined
            ? pickEnum(options.layer, LayerSchema.options, '--layer')
            : undefined,
      }
      const rows = collectStatus(tasksDir, filter)
      console.log(formatStatus(rows))
      console.log(`\n共 ${rows.length} 个任务（状态以 docs/tasks frontmatter 为准，索引仅加速，§3.2）`)
    })
}

/** 校验过滤值是否为合法枚举并原样返回（类型化为枚举类型）；非法抛错（不静默放行无效过滤值）。 */
function pickEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} 非法值: ${value}（合法值: ${allowed.join(', ')}）`)
  }
  return value as T
}
