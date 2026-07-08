/**
 * Infrastructure SQLite schema 与迁移（Readme.md §3.1 / §3.2 / §6）。
 *
 * SQLite 是**派生的状态索引存储**（§3.2：非事实来源，写入失败不阻断流程，
 * 可由 rebuild-index 从文档全量重建）。本文件落地索引表的 DDL 与前向迁移入口，
 * 供 TASK-014（SQLite 索引仓储）在建表后读写；本文件不打开连接、不做读写、
 * 不参与状态机判定（§3.2：索引不参与状态机判定，状态机只读 frontmatter）。
 *
 * 设计约束（任务 §8）：
 *   - 用 better-sqlite3（同步、简单）；DDL 集中在本文件。
 *   - depends_on / allowed_paths / permissions 以 JSON 文本列存储（§8）。
 *   - 迁移幂等：版本表已记录的版本跳过，重复调用 runMigrations 无副作用。
 *
 * 索引内容清单（§3.2「至少包括」，任务 §2 DDL）：
 *   - tasks：id / title / status / layer / depends_on / allowed_paths / permissions
 *   - decisions：id / title / status / scope
 *   - issues：id / title / severity / status / owner
 *   - executions：task_id / execution_status / review_result / next_action /
 *     commit_hash / commit_message / author / time（最近一次执行摘要 + 执行 commit 元信息）
 *
 * 不做（任务 §7）：读写仓库（TASK-014）、索引重建（rebuild-index 命令）、
 *   状态机判定（§3.2：索引不参与）。
 *
 * 权威来源：根目录 Readme.md §3.1（技术栈）/ §3.2（索引内容与派生存储定位）。
 */
import type Database from 'better-sqlite3'

/** better-sqlite3 数据库实例类型（默认导出 namespace 内的 Database 接口）。 */
type DB = Database.Database

/** 索引表名常量（供 TASK-014 读写引用，避免魔法字符串）。 */
export const TASKS_TABLE = 'tasks'
export const DECISIONS_TABLE = 'decisions'
export const ISSUES_TABLE = 'issues'
export const EXECUTIONS_TABLE = 'executions'

/** 迁移版本表名。 */
export const MIGRATIONS_TABLE = 'schema_migrations'

/** 当前 schema 版本（最大已定义迁移版本）。 */
export const SCHEMA_VERSION = 1

/* ============================================================ *
 * 迁移定义（前向 only，按 version 升序应用）
 * ============================================================ */

/**
 * 单条前向迁移。`up` 在事务内执行（DDL / DML），失败则整条迁移回滚。
 * 新增迁移时按 version 递增追加到 MIGRATIONS，不复用已用版本号。
 */
interface Migration {
  version: number
  name: string
  /** 应用该迁移（DDL / DML），在事务内执行。 */
  up: (db: DB) => void
}

/** 全部迁移（按 version 升序；前向 only，不回滚）。 */
const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-schema', up: createInitialSchema },
]

/* ============================================================ *
 * runMigrations —— 对外入口（幂等）
 * ============================================================ */

/**
 * 对 db 执行全部未应用的前向迁移；已应用的跳过（幂等）。
 *
 * - 首次调用：创建迁移版本表（IF NOT EXISTS）→ 逐条应用未应用的迁移 → 记录版本。
 * - 重复调用：迁移版本表已存在，全部版本均已记录 → 逐条跳过，无副作用。
 *
 * 幂等性来源（任务 §8）：迁移版本表是「已应用版本」的唯一事实来源——
 * 索引表 DDL 不带 IF NOT EXISTS，由版本表守卫「建表只发生一次」；
 * 迁移版本表本身是 bootstrap，用 IF NOT EXISTS 保证可重复创建。
 *
 * 每条迁移在独立事务内执行：`up` + 写版本记录原子提交，`up` 抛错则整条回滚
 * （已成功执行的 CREATE TABLE 等一并撤销，版本不记录），错误向上冒泡不静默。
 */
export function runMigrations(db: DB): void {
  ensureMigrationsTable(db)
  const applied = readAppliedVersions(db)
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    applyMigration(db, migration)
  }
}

/* ============================================================ *
 * 模块级辅助
 * ============================================================ */

/**
 * 创建迁移版本表（bootstrap，首次调用幂等）。
 *
 * 用 IF NOT EXISTS：本表是「记录已应用版本」的前提，必须先存在才能查询；
 * 重复调用时表已存在，IF NOT EXISTS 使其成为 no-op（不报错）。
 */
function ensureMigrationsTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    )
  `)
}

/** 读取已应用的迁移版本号集合（迁移版本表必已存在，由 ensureMigrationsTable 保证）。 */
function readAppliedVersions(db: DB): Set<number> {
  const rows = db
    .prepare<unknown[], { version: number }>(`SELECT version FROM ${MIGRATIONS_TABLE}`)
    .all()
  return new Set(rows.map((row) => row.version))
}

/** 在事务内应用单条迁移并记录版本号；`up` 抛错则回滚（含已建表），错误向上冒泡。 */
function applyMigration(db: DB, migration: Migration): void {
  const tx = db.transaction(() => {
    migration.up(db)
    db.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`,
    ).run(migration.version, migration.name, new Date().toISOString())
  })
  tx()
}

/**
 * v1：创建初始索引表（tasks / decisions / issues / executions）。
 *
 * 列与 §3.2「索引内容至少包括」清单逐项对齐（DEC-010）：
 *   - depends_on / allowed_paths / permissions：JSON 文本列（§8），DEFAULT '[]' 便于写入省略。
 *   - 文本主键显式 NOT NULL（SQLite 对非 INTEGER 主键不隐式 NOT NULL，显式声明符合标准）。
 *   - executions 以 task_id 为主键：一行 = 一个任务的「最近一次执行摘要」（§3.2），
 *     commit 列存代表性 commit 元信息（execution_commits 数组在索引中取首条 / 最新条，
 *     多 commit 全量索引留待后续需要时由 TASK-014+ 扩展）。
 *   - executions 的 review_result / next_action / commit_* 可空：任务可能尚未审查或无 commit。
 */
function createInitialSchema(db: DB): void {
  db.exec(`
    CREATE TABLE ${TASKS_TABLE} (
      id            TEXT PRIMARY KEY NOT NULL,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL,
      layer         TEXT NOT NULL,
      depends_on    TEXT NOT NULL DEFAULT '[]',
      allowed_paths TEXT NOT NULL DEFAULT '[]',
      permissions   TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE ${DECISIONS_TABLE} (
      id     TEXT PRIMARY KEY NOT NULL,
      title  TEXT NOT NULL,
      status TEXT NOT NULL,
      scope  TEXT NOT NULL
    );

    CREATE TABLE ${ISSUES_TABLE} (
      id       TEXT PRIMARY KEY NOT NULL,
      title    TEXT NOT NULL,
      severity TEXT NOT NULL,
      status   TEXT NOT NULL,
      owner    TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE ${EXECUTIONS_TABLE} (
      task_id          TEXT PRIMARY KEY NOT NULL,
      execution_status TEXT NOT NULL,
      review_result    TEXT,
      next_action      TEXT,
      commit_hash      TEXT,
      commit_message   TEXT,
      author           TEXT,
      time             TEXT
    );
  `)
}
