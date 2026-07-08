/**
 * Infrastructure SQLite 索引仓储（Readme.md §3.1 / §3.2 / §6）。
 *
 * 本仓储是 SQLite 状态索引的读写入口：把任务 / 决策 / 问题 / 执行摘要四类索引行
 * 的增删改查与「从文档全量重建」收敛为统一接口，供 application 层（状态流转 /
 * 合并 / 决策问题变更时）同步写入、供 CLI（status / rebuild-index）查询与重建。
 *
 * 设计约束（任务 §8 / §3.2）：
 *   - 依赖 sqlite/schema（runMigrations 建表 + 表名常量）与文档仓储（只读，rebuild 用）。
 *   - 写入容错：upsert* 写失败仅记告警日志、不向上抛阻断错误（§3.2「索引写入失败
 *     不阻断状态流转和合并」，正确性以文档为准、可 rebuild-index 修复）。
 *   - rebuildFromDocs 清空后从文档全量重建，必须能完全恢复索引（§3.2 / §11）。
 *   - 索引不参与状态机判定（§3.2：状态机只读 frontmatter）；本仓储只做读写不做判定。
 *
 * 不做（任务 §7）：状态机判定、CLI 命令包装（TASK-025 包装 rebuild-index）。
 *
 * 权威来源：根目录 Readme.md §3.1（技术栈）/ §3.2（索引内容与派生存储定位）。
 */
import type Database from 'better-sqlite3'
import {
  DECISIONS_TABLE,
  EXECUTIONS_TABLE,
  ISSUES_TABLE,
  TASKS_TABLE,
  runMigrations,
} from './schema.js'
import type { TaskDocRepository } from '../fs/task-doc-repo.js'
import type { GlobalDocRepository } from '../fs/global-doc-repo.js'
import type {
  Decision,
  DecisionStatus,
  ExecutionCommit,
  ExecutionStatus,
  Issue,
  IssueSeverity,
  IssueStatus,
  Layer,
  NextAction,
  Permission,
  ResultFrontmatter,
  ReviewFrontmatter,
  ReviewResult,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../core/index.js'

/** better-sqlite3 数据库实例类型。 */
type DB = Database.Database

/* ============================================================ *
 * 索引行类型（读写两侧的领域化结构；JSON 文本列在边界处 stringify / parse）
 * ============================================================ */

/** tasks 索引行（§3.2：id/title/status/layer + JSON 文本列 depends_on/allowed_paths/permissions）。 */
export interface TaskIndexRow {
  id: TaskId
  title: string
  status: TaskStatus
  layer: Layer
  depends_on: TaskId[]
  allowed_paths: string[]
  permissions: Permission[]
}

/** decisions 索引行（§3.2：id/title/status/scope）。 */
export interface DecisionIndexRow {
  id: string
  title: string
  status: DecisionStatus
  scope: string
}

/** issues 索引行（§3.2：id/title/severity/status/owner）。 */
export interface IssueIndexRow {
  id: string
  title: string
  severity: IssueSeverity
  status: IssueStatus
  owner: string
}

/** executions 索引行（§3.2：最近一次执行摘要 + 代表性 commit 元信息，可空列为 null）。 */
export interface ExecutionIndexRow {
  task_id: TaskId
  execution_status: ExecutionStatus
  review_result: ReviewResult | null
  next_action: NextAction | null
  commit_hash: string | null
  commit_message: string | null
  author: string | null
  time: string | null
}

/**
 * executions 写入输入：由 ResultFrontmatter（+ 可选 ReviewFrontmatter）综合而成。
 *
 * 索引 executions 表以 task_id 为主键（DEC-010），一行 = 一个任务的最近一次执行摘要。
 * review_result 在无审查时为 null；commit 为 execution_commits 的代表性条目（首条），
 * 无 commit 时为 null（多 commit 全量索引留待后续，DEC-010）。
 */
export interface ExecutionSummary {
  task_id: TaskId
  execution_status: ExecutionStatus
  review_result: ReviewResult | null
  next_action: NextAction
  commit: ExecutionCommit | null
}

/** queryTasks 过滤条件（任一字段缺省即不过滤该维度）。 */
export interface TaskQueryFilter {
  status?: TaskStatus
  layer?: Layer
}

/** rebuildFromDocs 的文档来源（文档为唯一事实来源，§3.2）。 */
export interface DocSources {
  /** 任务 / 结果 / 审查文档仓储（只读：listTasks / readTask / readResult / readReview）。 */
  taskRepo: TaskDocRepository
  /** 全局文档解析器（readDecisions / readIssues 解析 fenced yaml block，TASK-012 DEC-009）。 */
  globalRepo: GlobalDocRepository
  /** DECISIONS.md 完整内容（GlobalDocRepository 为纯变换无 I/O，由调用方读盘后传入）。 */
  decisionsDoc: string
  /** ISSUES.md 完整内容。 */
  issuesDoc: string
}

/* ============================================================ *
 * IndexRepository
 * ============================================================ */

/**
 * SQLite 索引仓储：四张索引表的读写 + 从文档全量重建。
 *
 * 构造时对传入 db 调一次 runMigrations 建表（幂等，DEC-010），之后 upsert* / query*
 * 假定表已存在。upsert* 写失败经 onWarning 记告警后吞掉、不抛阻断（§3.2 容错）；
 * 默认 onWarning 输出 console.warn，可注入自定义回调便于测试断言。
 *
 * 查询面只暴露 queryTasks / getExecution（任务状态与执行摘要是索引的主要查询场景，
 * §3.2）；decisions / issues 索引用于审计与 rebuild，其人读展示走文档本身。
 *
 * 借助 TypeScript 结构类型兼容，本类无需显式 implements application 层 Port
 * （ARCHITECTURE.md §4），由 cli 在 composition root 处 wiring 注入。
 */
export class IndexRepository {
  constructor(
    private readonly db: DB,
    private readonly onWarning: (err: unknown) => void = defaultWarn,
  ) {
    runMigrations(db)
  }

  /* ---------- 容错写入（§3.2：写失败不阻断，记告警后继续） ---------- */

  /** 写入 / 更新任务索引行；写失败记告警不抛（§3.2）。 */
  upsertTask(task: TaskFrontmatter): void {
    this.tolerantWrite(() => this.insertTask(task))
  }

  /** 写入 / 更新决策索引行；写失败记告警不抛（§3.2）。 */
  upsertDecision(decision: Decision): void {
    this.tolerantWrite(() => this.insertDecision(decision))
  }

  /** 写入 / 更新问题索引行；写失败记告警不抛（§3.2）。 */
  upsertIssue(issue: Issue): void {
    this.tolerantWrite(() => this.insertIssue(issue))
  }

  /** 写入 / 更新执行摘要行（task_id 主键，INSERT OR REPLACE 覆盖重跑）；写失败记告警不抛（§3.2）。 */
  upsertExecution(summary: ExecutionSummary): void {
    this.tolerantWrite(() => this.insertExecution(summary))
  }

  /* ---------- 查询（§3.2：任务状态与执行摘要是索引主要查询场景） ---------- */

  /**
   * 按过滤条件查询任务索引行（缺省字段不过滤该维度）；JSON 文本列读出后 parse，
   * 结果按 id 数值升序（与 TaskDocRepository.listTasks 一致，鲁棒于补零）。
   */
  queryTasks(filter: TaskQueryFilter = {}): TaskIndexRow[] {
    const where = buildWhere(filter)
    const rows = this.db
      .prepare<unknown[], TaskRawRow>(`SELECT * FROM ${TASKS_TABLE} ${where.sql}`)
      .all(...where.params)
    return rows.map(toTaskRow).sort(byTaskIdNumeric)
  }

  /** 读取某任务的最近一次执行摘要；无记录返回 null。 */
  getExecution(taskId: TaskId): ExecutionIndexRow | null {
    const row = this.db
      .prepare<unknown[], ExecutionRawRow>(
        `SELECT * FROM ${EXECUTIONS_TABLE} WHERE task_id = ?`,
      )
      .get(taskId)
    return row === undefined ? null : toExecutionRow(row)
  }

  /* ---------- 从文档全量重建（§3.2 / §11） ---------- */

  /**
   * 清空全部索引表后从文档全量重建（任务 §2 / §11：索引内容 = 文档全集）。
   *
   * 重建在单一事务内：DELETE 四张表 + 逐条 INSERT，任一步抛错则整体回滚、索引保持
   * 重建前状态（原子）。重建用「直接插入」（非容错 upsert*）——rebuild 是显式修复命令，
   * 文档自身损坏应让错误显式冒泡由调用方处理，不静默丢行（否则索引 ≠ 文档，违反 §11）。
   *
   * 数据来源（文档为唯一事实来源，§3.2）：
   *   - tasks / executions ← TaskDocRepository（listTasks → readTask / readResult / readReview）。
   *   - decisions / issues ← GlobalDocRepository.readDecisions / readIssues（解析传入的文档内容）。
   *
   * result / review 附属文档不存在属预期（任务尚未执行 / 未审查），跳过该任务的 execution；
   * 文档存在但损坏（Zod 校验失败等）让错误冒泡——rebuild 应忠实反映文档现状。
   */
  rebuildFromDocs(sources: DocSources): void {
    const tx = this.db.transaction(() => {
      this.clearAll()
      this.rebuildTasksAndExecutions(sources.taskRepo)
      this.rebuildDecisions(sources.globalRepo, sources.decisionsDoc)
      this.rebuildIssues(sources.globalRepo, sources.issuesDoc)
    })
    tx()
  }

  /* ---------- 内部：直接插入（严格，失败抛错，供容错包装与重建共用） ---------- */

  private insertTask(task: TaskFrontmatter): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${TASKS_TABLE} (id, title, status, layer, depends_on, allowed_paths, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.status,
        task.layer,
        JSON.stringify(task.depends_on),
        JSON.stringify(task.allowed_paths),
        JSON.stringify(task.permissions),
      )
  }

  private insertDecision(decision: Decision): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${DECISIONS_TABLE} (id, title, status, scope) VALUES (?, ?, ?, ?)`,
      )
      .run(decision.id, decision.title, decision.status, decision.scope)
  }

  private insertIssue(issue: Issue): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${ISSUES_TABLE} (id, title, severity, status, owner) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(issue.id, issue.title, issue.severity, issue.status, issue.owner)
  }

  private insertExecution(summary: ExecutionSummary): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${EXECUTIONS_TABLE} (task_id, execution_status, review_result, next_action, commit_hash, commit_message, author, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        summary.task_id,
        summary.execution_status,
        summary.review_result,
        summary.next_action,
        summary.commit?.hash ?? null,
        summary.commit?.message ?? null,
        summary.commit?.author ?? null,
        summary.commit?.time ?? null,
      )
  }

  /* ---------- 内部：重建子步骤 ---------- */

  /** 重建 tasks + executions：遍历任务文档，每个任务写一行 task；有 result 则写 execution。 */
  private rebuildTasksAndExecutions(taskRepo: TaskDocRepository): void {
    for (const id of taskRepo.listTasks()) {
      const task = taskRepo.readTask(id)
      this.insertTask(task)
      const result = readResultOptional(taskRepo, id)
      if (result === null) continue // 任务尚未产出 result，无 execution 行
      const review = readReviewOptional(taskRepo, id)
      this.insertExecution(buildExecutionSummary(result, review ?? undefined))
    }
  }

  /** 重建 decisions：解析 DECISIONS.md 后逐条写入。 */
  private rebuildDecisions(globalRepo: GlobalDocRepository, decisionsDoc: string): void {
    for (const decision of globalRepo.readDecisions(decisionsDoc)) {
      this.insertDecision(decision)
    }
  }

  /** 重建 issues：解析 ISSUES.md 后逐条写入。 */
  private rebuildIssues(globalRepo: GlobalDocRepository, issuesDoc: string): void {
    for (const issue of globalRepo.readIssues(issuesDoc)) {
      this.insertIssue(issue)
    }
  }

  /* ---------- 内部：清空 + 容错包装 ---------- */

  /** 清空四张索引表（重建第一步，与后续 INSERT 同事务保证原子）。 */
  private clearAll(): void {
    this.db.exec(
      `DELETE FROM ${TASKS_TABLE}; DELETE FROM ${DECISIONS_TABLE}; DELETE FROM ${ISSUES_TABLE}; DELETE FROM ${EXECUTIONS_TABLE};`,
    )
  }

  /** 容错执行写入：成功正常返回，失败经 onWarning 记告警后吞掉、不向上抛（§3.2）。 */
  private tolerantWrite(write: () => void): void {
    try {
      write()
    } catch (err) {
      this.onWarning(err)
    }
  }
}

/* ============================================================ *
 * 模块级辅助函数
 * ============================================================ */

/** 默认告警回调：输出 console.warn（§3.2 容错，不阻断流程）。 */
const defaultWarn = (err: unknown): void => {
  const msg = err instanceof Error ? err.message : String(err)
  console.warn(`[IndexRepository] 索引写入失败（不阻断流程，§3.2 容错）: ${msg}`)
}

/**
 * 综合 .result.md（+ 可选 .review.md）为执行摘要行。
 *
 * execution_status / next_action / commit 取自 result；review_result 取自 review（无审查为 null）；
 * commit 取 execution_commits 首条作代表性 commit（DEC-010 委托 TASK-014 决定取首条，
 * 多 commit 全量索引留待后续需要时扩展）。
 */
export function buildExecutionSummary(
  result: ResultFrontmatter,
  review?: ReviewFrontmatter,
): ExecutionSummary {
  const commit = result.execution_commits[0] ?? null
  return {
    task_id: result.task_id,
    execution_status: result.execution_status,
    review_result: review?.review_result ?? null,
    next_action: result.next_action,
    commit,
  }
}

/**
 * 读取 .result.md（不存在视为预期、返回 null；存在但损坏让错误冒泡）。
 *
 * TaskDocRepository.readResult 对「文件不存在 / 缺 frontmatter / Zod 校验失败」均抛错，
 * 此处以错误消息前缀「文档不存在」区分「附属文档尚未产出」（预期，跳过）与「文档损坏」
 * （冒泡）——前缀是 TaskDocRepository 的稳定契约（DEC-008）。
 */
function readResultOptional(taskRepo: TaskDocRepository, id: TaskId): ResultFrontmatter | null {
  try {
    return taskRepo.readResult(id)
  } catch (err) {
    if (isDocMissing(err)) return null
    throw err
  }
}

/** 读取 .review.md（语义同 readResultOptional）。 */
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

/* ============================================================ *
 * 查询辅助：原始行类型 / WHERE 拼接 / 行映射 / 排序
 * ============================================================ */

/** 原始 tasks 行（JSON 文本列未 parse）。 */
interface TaskRawRow {
  id: string
  title: string
  status: string
  layer: string
  depends_on: string
  allowed_paths: string
  permissions: string
}

/** 原始 executions 行（可空列为 string | null）。 */
interface ExecutionRawRow {
  task_id: string
  execution_status: string
  review_result: string | null
  next_action: string | null
  commit_hash: string | null
  commit_message: string | null
  author: string | null
  time: string | null
}

/**
 * 由过滤条件构建 WHERE 子句。列名为静态字面量（status / layer）、参数走绑定，
 * 无 SQL 注入风险；无过滤条件时返回空 sql（全表扫描）。
 */
function buildWhere(filter: TaskQueryFilter): { sql: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filter.status !== undefined) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.layer !== undefined) {
    conditions.push('layer = ?')
    params.push(filter.layer)
  }
  return conditions.length === 0
    ? { sql: '', params }
    : { sql: `WHERE ${conditions.join(' AND ')}`, params }
}

/**
 * tasks 原始行 → 领域行（JSON 文本列 parse；status/layer 字符串强转枚举——
 * 索引值均源自 Zod 校验后的 frontmatter，写入时已合法，读出强转安全）。
 */
function toTaskRow(raw: TaskRawRow): TaskIndexRow {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status as TaskStatus,
    layer: raw.layer as Layer,
    depends_on: JSON.parse(raw.depends_on) as TaskId[],
    allowed_paths: JSON.parse(raw.allowed_paths) as string[],
    permissions: JSON.parse(raw.permissions) as Permission[],
  }
}

/** executions 原始行 → 领域行（可空列保留 null；字符串强转枚举，值源自校验后的 frontmatter）。 */
function toExecutionRow(raw: ExecutionRawRow): ExecutionIndexRow {
  return {
    task_id: raw.task_id,
    execution_status: raw.execution_status as ExecutionStatus,
    review_result: raw.review_result as ReviewResult | null,
    next_action: raw.next_action as NextAction | null,
    commit_hash: raw.commit_hash,
    commit_message: raw.commit_message,
    author: raw.author,
    time: raw.time,
  }
}

/** 任务 id 前缀（剥离后取数字部分做数值排序）。 */
const TASK_PREFIX = 'TASK-'

/** 任务 id 数值升序比较器（TASK-2 < TASK-10，鲁棒于补零，与 listTasks 一致）。 */
function byTaskIdNumeric(a: { id: string }, b: { id: string }): number {
  return numericId(a.id) - numericId(b.id)
}

/** 提取任务 id 的数字部分（TASK-011 → 11）；非数字回退 0 保证排序稳定。 */
function numericId(id: string): number {
  const digits = Number(id.slice(TASK_PREFIX.length))
  return Number.isFinite(digits) ? digits : 0
}
