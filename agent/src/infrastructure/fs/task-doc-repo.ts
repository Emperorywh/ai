/**
 * Infrastructure 任务 / 结果 / 审查文档仓储（Readme.md §6 / §9 / §10 / §15 文档协议）。
 *
 * 本仓储是文档协议的文件系统适配层：把「任务文件 / .result.md / .review.md」三类
 * 文档的读写收敛为统一入口——读取即用 core Schema 做 Zod 校验（不静默放行非法
 * frontmatter），写入即用 frontmatter-parser 分离 frontmatter 与正文。
 *
 * 设计约束（任务 §8）：
 *   - 依赖 core Schema + frontmatter-parser，不反向定义业务规则（不实现状态流转，
 *     不做 slug 生成——新建任务文件含命名决策属 CLI task-create 职责）。
 *   - 写入保留正文：仅更新 frontmatter 时做「frontmatter 替换 + 正文保留」，
 *     避免抹掉人工维护的 13 节任务正文 / result / review 正文（§12 风险点）。
 *   - 文件命名遵循 §6：docs/tasks/TASK-XXX-<slug>.md / .result.md / .review.md，
 *     result / review 与任务文件共用同一 slug。
 *
 * 方法语义（任务 §2 / §9）：
 *   - readTask / readResult / readReview：读取并 Zod 校验 frontmatter；
 *     frontmatter 缺失 / 非法 / 文件不存在均抛错（不静默）。
 *   - writeTask：更新「已存在」任务文件的 frontmatter（+ 可选正文）；任务文件不存在
 *     则抛错。
 *   - writeResult / writeReview：Executor / Reviewer 产物落盘，可新建（文件名按 §6
 *     复用任务文件 slug 派生）；body 未传则保留现有正文（如 Orchestrator 回填
 *     execution_commits 仅改 frontmatter）。
 *   - listTasks：扫描 docs/tasks/ 只返回 TASK-XXX-*.md 的 id（排除 .result.md /
 *     .review.md），按数值升序排列。
 *
 * 权威来源：根目录 Readme.md §6（文档体系）/ §9（任务文件模板）/ §10（结果模板）/
 * §15（审查模板）。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  ResultFrontmatterSchema,
  ReviewFrontmatterSchema,
  TaskFrontmatterSchema,
  type ResultFrontmatter,
  type ReviewFrontmatter,
  type TaskFrontmatter,
  type TaskId,
} from '../../core/index.js'
import { parseDocument, serializeDocument } from './frontmatter-parser.js'

/** 任务 id 前缀（Readme.md §6 文件命名约定），用于数值排序时剥离数字部分。 */
const TASK_ID_PREFIX = 'TASK-'

/**
 * 任务文档仓储：基于文件系统路径读写任务 / 结果 / 审查三类文档。
 *
 * 构造时传入 tasks 目录（docs/tasks/），所有文档路径在其下解析，便于在临时目录中
 * 做集成测试（TESTING.md data 层策略）。借助 TypeScript 结构类型兼容，本类无需
 * 显式 implements application 层 Port（ARCHITECTURE.md §4），由 cli 在 composition
 * root 处 wiring 注入。
 */
export class TaskDocRepository {
  constructor(private readonly tasksDir: string) {}

  /* ============================================================ *
   * 任务文档（docs/tasks/TASK-XXX-<slug>.md）
   * ============================================================ */

  /** 读取任务文件 frontmatter 并用 TaskFrontmatterSchema 校验。 */
  readTask(id: TaskId): TaskFrontmatter {
    return this.readAndValidate(this.resolveTaskPath(id), TaskFrontmatterSchema)
  }

  /**
   * 更新已存在任务文件的 frontmatter（任务 §8「frontmatter 替换 + 正文保留」）。
   *
   * - body 传入 → 整体写入（frontmatter + body）。
   * - body 未传 → 保留现有正文，仅替换 frontmatter（§12：避免抹掉人工维护的正文）。
   * - 任务文件不存在 → 抛错（新建任务文件含 slug 命名，属 CLI task-create 职责，不越界）。
   */
  writeTask(task: TaskFrontmatter, body?: string): void {
    const filePath = this.resolveTaskPath(task.id)
    const finalBody = body ?? this.readBodyIfExists(filePath)
    writeFileSync(filePath, serializeDocument(task, finalBody), 'utf8')
  }

  /* ============================================================ *
   * 执行结果（docs/tasks/TASK-XXX-<slug>.result.md）
   * ============================================================ */

  /** 读取 .result.md frontmatter 并用 ResultFrontmatterSchema 校验。 */
  readResult(id: TaskId): ResultFrontmatter {
    return this.readAndValidate(this.resolveResultPath(id), ResultFrontmatterSchema)
  }

  /**
   * 写入 .result.md（Executor 产物落盘，任务 §9 数据流）。
   *
   * 文件名按 §6 复用任务文件 slug 派生（先有任务才有结果）；body 传入则整体写入，
   * 未传则保留现有 result 正文（仅更新 frontmatter，如 Orchestrator 回填 execution_commits）。
   */
  writeResult(result: ResultFrontmatter, body?: string): void {
    const filePath = this.resolveResultPath(result.task_id)
    const finalBody = body ?? this.readBodyIfExists(filePath)
    writeFileSync(filePath, serializeDocument(result, finalBody), 'utf8')
  }

  /* ============================================================ *
   * 审查结论（docs/tasks/TASK-XXX-<slug>.review.md）
   * ============================================================ */

  /** 读取 .review.md frontmatter 并用 ReviewFrontmatterSchema 校验。 */
  readReview(id: TaskId): ReviewFrontmatter {
    return this.readAndValidate(this.resolveReviewPath(id), ReviewFrontmatterSchema)
  }

  /**
   * 写入 .review.md（Reviewer 产物落盘，任务 §9 数据流）。
   *
   * 语义同 writeResult：文件名按 §6 复用任务文件 slug 派生，body 未传则保留现有正文。
   */
  writeReview(review: ReviewFrontmatter, body?: string): void {
    const filePath = this.resolveReviewPath(review.task_id)
    const finalBody = body ?? this.readBodyIfExists(filePath)
    writeFileSync(filePath, serializeDocument(review, finalBody), 'utf8')
  }

  /* ============================================================ *
   * 任务列举
   * ============================================================ */

  /**
   * 列举 docs/tasks/ 下全部任务 id（任务 §11 验收：只返回 TASK-XXX-*.md，
   * 排除 .result.md / .review.md）。结果按 id 数值升序排列（鲁棒于补零与否）。
   * tasksDir 不存在或为空目录时返回空数组。
   */
  listTasks(): TaskId[] {
    const ids = new Set<TaskId>()
    for (const name of readdirSafe(this.tasksDir)) {
      if (name.endsWith('.result.md') || name.endsWith('.review.md')) continue
      const matched = name.match(/^(TASK-\d+)-.+\.md$/)
      const id = matched?.[1]
      if (id) ids.add(id)
    }
    return [...ids].sort(byTaskNumber)
  }

  /* ============================================================ *
   * 内部辅助：读取校验 / 正文保留
   * ============================================================ */

  /**
   * 读取文件并校验 frontmatter（读取即 Zod 校验，不静默放行非法文档）。
   * 文件不存在 / frontmatter 缺失 / Zod 校验失败 均抛带文件路径的 Error。
   *
   * 用约束泛型 <S extends z.ZodTypeAny> + z.infer<S> 让返回类型由具体 schema 派生，
   * 绕开「z.ZodType<T> 会把 T 绑到 schema 的 input（含 .default 可选字段）」的推断歧义。
   */
  private readAndValidate<S extends z.ZodTypeAny>(filePath: string, schema: S): z.infer<S> {
    if (!existsSync(filePath)) {
      throw new Error(`文档不存在: ${filePath}`)
    }
    const raw = readFileSync(filePath, 'utf8')
    const { frontmatter } = parseDocument(raw)
    if (frontmatter === null) {
      throw new Error(`文档缺少 frontmatter: ${filePath}`)
    }
    const parsed = schema.safeParse(frontmatter)
    if (!parsed.success) {
      throw new Error(`文档 frontmatter 校验失败: ${filePath}\n${parsed.error.message}`)
    }
    return parsed.data
  }

  /** 读取文件现有正文；文件不存在返回空串（用于 writeXxx 保留正文场景）。 */
  private readBodyIfExists(filePath: string): string {
    if (!existsSync(filePath)) return ''
    const raw = readFileSync(filePath, 'utf8')
    return parseDocument(raw).body
  }

  /* ============================================================ *
   * 内部辅助：路径解析
   * ============================================================ */

  /** 解析任务文件路径：docs/tasks/<id>-<slug>.md（排除 .result.md / .review.md）。 */
  private resolveTaskPath(id: TaskId): string {
    const prefix = id + '-'
    const matches = readdirSafe(this.tasksDir).filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith('.md') &&
        !name.endsWith('.result.md') &&
        !name.endsWith('.review.md'),
    )
    return this.requireUnique(matches, id, '任务文件')
  }

  /** 解析 .result.md 路径：优先复用现有文件，否则按任务文件 slug 派生新建路径。 */
  private resolveResultPath(id: TaskId): string {
    return this.resolveSidecarPath(id, '.result.md')
  }

  /** 解析 .review.md 路径：优先复用现有文件，否则按任务文件 slug 派生新建路径。 */
  private resolveReviewPath(id: TaskId): string {
    return this.resolveSidecarPath(id, '.review.md')
  }

  /**
   * 解析 result / review 附属文档路径（任务 §8 文件命名）。
   *
   * - 已存在唯一 `<id>-<slug><suffix>` → 复用。
   * - 已存在多个 → 抛歧义错。
   * - 不存在 → 从任务文件提取 slug，派生 `<id>-<slug><suffix>` 新建路径
   *   （§6：result / review 与任务文件共用同一 slug）。
   */
  private resolveSidecarPath(id: TaskId, suffix: string): string {
    const prefix = id + '-'
    const matches = readdirSafe(this.tasksDir).filter(
      (name) => name.startsWith(prefix) && name.endsWith(suffix),
    )
    const found = matches[0]
    if (matches.length === 1 && found) {
      return join(this.tasksDir, found)
    }
    if (matches.length > 1) {
      throw new Error(`${id} 附属文档（${suffix}）歧义，匹配多个: ${matches.join(', ')}`)
    }
    return this.deriveSidecarPath(id, suffix)
  }

  /** 从任务文件名提取 slug，派生附属文档路径。 */
  private deriveSidecarPath(id: TaskId, suffix: string): string {
    const slug = this.taskSlug(id)
    return join(this.tasksDir, `${id}-${slug}${suffix}`)
  }

  /** 从任务文件名提取 slug：TASK-011-infra-task-doc-repo.md → infra-task-doc-repo。 */
  private taskSlug(id: TaskId): string {
    const taskFile = basename(this.resolveTaskPath(id))
    const prefixLen = id.length + 1 // 去掉 "<id>-"
    const suffixLen = '.md'.length
    return taskFile.slice(prefixLen, taskFile.length - suffixLen)
  }

  /** 多匹配抛歧义错，唯一匹配返回完整路径，零匹配抛未找到错。 */
  private requireUnique(matches: string[], id: TaskId, label: string): string {
    if (matches.length === 0) {
      throw new Error(`未找到${label}: ${id}（在 ${this.tasksDir}）`)
    }
    if (matches.length > 1) {
      throw new Error(`${label}歧义: ${id} 匹配多个: ${matches.join(', ')}`)
    }
    const found = matches[0]
    if (!found) {
      throw new Error(`未找到${label}: ${id}（在 ${this.tasksDir}）`)
    }
    return join(this.tasksDir, found)
  }
}

/**
 * 安全读取目录：目录不存在时返回空数组（listTasks 对空 / 不存在的 tasksDir 返回 []）；
 * 目录存在则交由 readdirSync 读取，若路径误指文件等配置错误让错误显式冒泡。
 */
function readdirSafe(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

/** 任务 id 数值升序比较器（TASK-2 < TASK-10，鲁棒于是否补零）。 */
function byTaskNumber(a: TaskId, b: TaskId): number {
  return numericPart(a) - numericPart(b)
}

/** 提取任务 id 的数字部分（TASK-011 → 11）；非数字回退 0 保证排序稳定。 */
function numericPart(id: TaskId): number {
  const digits = Number(id.slice(TASK_ID_PREFIX.length))
  return Number.isFinite(digits) ? digits : 0
}
