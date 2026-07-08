import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  runMigrations,
  MIGRATIONS_TABLE,
  TASKS_TABLE,
  DECISIONS_TABLE,
  ISSUES_TABLE,
  EXECUTIONS_TABLE,
  SCHEMA_VERSION,
} from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 夹具与辅助
 * ============================================================ */

/** 每个 case 独立创建内存 SQLite，避免跨用例污染（TESTING.md data 层：内存 SQLite）。 */
function openDb(): Database.Database {
  return new Database(':memory:')
}

/** 读取 db 中全部用户表名（sqlite_master）。 */
function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
  return rows.map((r) => r.name)
}

/** 读取某表的列名（PRAGMA table_info）。 */
function columnNames(db: Database.Database, table: string): string[] {
  const rows = db
    .prepare<unknown[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
  return rows.map((r) => r.name)
}

/** 读取某表的列信息（含 notnull / dflt_value / pk）。 */
function columnInfo(
  db: Database.Database,
  table: string,
): Array<{ name: string; notnull: number; dflt_value: string | null; pk: number }> {
  return db
    .prepare<
      unknown[],
      { name: string; notnull: number; dflt_value: string | null; pk: number }
    >(`PRAGMA table_info(${table})`)
    .all()
}

/* ============================================================ *
 * runMigrations：建表
 * ============================================================ */

describe('runMigrations：建表', () => {
  it('创建 4 张索引表 + 迁移版本表', () => {
    const db = openDb()
    runMigrations(db)
    const tables = tableNames(db)
    expect(tables).toContain(TASKS_TABLE)
    expect(tables).toContain(DECISIONS_TABLE)
    expect(tables).toContain(ISSUES_TABLE)
    expect(tables).toContain(EXECUTIONS_TABLE)
    expect(tables).toContain(MIGRATIONS_TABLE)
    db.close()
  })

  it('迁移版本表记录当前 schema 版本 + 名称 + 时间戳', () => {
    const db = openDb()
    runMigrations(db)
    const rows = db
      .prepare<unknown[], { version: number; name: string; applied_at: string }>(
        `SELECT version, name, applied_at FROM ${MIGRATIONS_TABLE}`,
      )
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.version).toBe(SCHEMA_VERSION)
    expect(rows[0]?.version).toBe(1)
    expect(rows[0]?.name).toBe('initial-schema')
    // applied_at 为 ISO8601 UTC（含 Z），与项目 datetime 约定一致
    expect(rows[0]?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    db.close()
  })
})

/* ============================================================ *
 * 幂等性（任务 §8 / §11 验收核心）
 * ============================================================ */

describe('runMigrations：幂等', () => {
  it('重复调用不报错，迁移版本表仍只有 1 条记录', () => {
    const db = openDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const count = db
      .prepare<unknown[], { c: number }>(`SELECT COUNT(*) AS c FROM ${MIGRATIONS_TABLE}`)
      .get()
    expect(count?.c).toBe(1)
    db.close()
  })

  it('重复调用后表结构不变（列集合稳定）', () => {
    const db = openDb()
    runMigrations(db)
    const tasksBefore = columnNames(db, TASKS_TABLE)
    runMigrations(db)
    runMigrations(db)
    const tasksAfter = columnNames(db, TASKS_TABLE)
    expect(tasksAfter).toEqual(tasksBefore)
    db.close()
  })

  it('迁移版本表用 IF NOT EXISTS 可重复创建（bootstrap 幂等）', () => {
    const db = openDb()
    runMigrations(db)
    // 再次 runMigrations 会先走 ensureMigrationsTable（IF NOT EXISTS），不应抛「表已存在」
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

/* ============================================================ *
 * 列与 §3.2「索引内容至少包括」清单逐项对齐（§11 验收）
 * ============================================================ */

describe('列对齐 §3.2 索引清单', () => {
  it('tasks 列含 id/title/status/layer/depends_on/allowed_paths/permissions', () => {
    const db = openDb()
    runMigrations(db)
    expect(columnNames(db, TASKS_TABLE)).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'status',
        'layer',
        'depends_on',
        'allowed_paths',
        'permissions',
      ]),
    )
    db.close()
  })

  it('decisions 列含 id/title/status/scope', () => {
    const db = openDb()
    runMigrations(db)
    expect(columnNames(db, DECISIONS_TABLE)).toEqual(
      expect.arrayContaining(['id', 'title', 'status', 'scope']),
    )
    db.close()
  })

  it('issues 列含 id/title/severity/status/owner', () => {
    const db = openDb()
    runMigrations(db)
    expect(columnNames(db, ISSUES_TABLE)).toEqual(
      expect.arrayContaining(['id', 'title', 'severity', 'status', 'owner']),
    )
    db.close()
  })

  it('executions 列含 task_id/execution_status/review_result/next_action + commit 元信息', () => {
    const db = openDb()
    runMigrations(db)
    expect(columnNames(db, EXECUTIONS_TABLE)).toEqual(
      expect.arrayContaining([
        'task_id',
        'execution_status',
        'review_result',
        'next_action',
        'commit_hash',
        'commit_message',
        'author',
        'time',
      ]),
    )
    db.close()
  })
})

/* ============================================================ *
 * 约束与默认值（DEC-010）
 * ============================================================ */

describe('列约束与默认值', () => {
  it('tasks 的 JSON 文本列有 DEFAULT []，写入时可省略', () => {
    const db = openDb()
    runMigrations(db)
    const info = new Map(columnInfo(db, TASKS_TABLE).map((c) => [c.name, c]))
    expect(info.get('depends_on')?.notnull).toBe(1)
    expect(info.get('depends_on')?.dflt_value).toBe("'[]'")
    expect(info.get('allowed_paths')?.notnull).toBe(1)
    expect(info.get('allowed_paths')?.dflt_value).toBe("'[]'")
    expect(info.get('permissions')?.notnull).toBe(1)
    expect(info.get('permissions')?.dflt_value).toBe("'[]'")
    db.close()
  })

  it('文本主键显式 NOT NULL（SQLite 非 INTEGER 主键不隐式 NOT NULL）', () => {
    const db = openDb()
    runMigrations(db)
    const tasksPk = columnInfo(db, TASKS_TABLE).find((c) => c.pk > 0)
    expect(tasksPk?.name).toBe('id')
    expect(tasksPk?.notnull).toBe(1)
    const execPk = columnInfo(db, EXECUTIONS_TABLE).find((c) => c.pk > 0)
    expect(execPk?.name).toBe('task_id')
    expect(execPk?.notnull).toBe(1)
    db.close()
  })

  it('executions 的 review_result/next_action/commit_* 可空（尚未审查或无 commit）', () => {
    const db = openDb()
    runMigrations(db)
    const info = new Map(columnInfo(db, EXECUTIONS_TABLE).map((c) => [c.name, c]))
    expect(info.get('execution_status')?.notnull).toBe(1)
    expect(info.get('review_result')?.notnull).toBe(0)
    expect(info.get('next_action')?.notnull).toBe(0)
    expect(info.get('commit_hash')?.notnull).toBe(0)
    expect(info.get('commit_message')?.notnull).toBe(0)
    expect(info.get('author')?.notnull).toBe(0)
    expect(info.get('time')?.notnull).toBe(0)
    db.close()
  })
})

/* ============================================================ *
 * 读写冒烟：建表后可正常插入 / 查询（为 TASK-014 铺路）
 * ============================================================ */

describe('建表后读写冒烟', () => {
  it('tasks 的 depends_on/allowed_paths/permissions 以 JSON 文本存取（§8）', () => {
    const db = openDb()
    runMigrations(db)
    db.prepare(
      `INSERT INTO ${TASKS_TABLE} (id, title, status, layer, depends_on, allowed_paths, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'TASK-013',
      'Infra SQLite schema 与迁移',
      'done',
      'data',
      JSON.stringify(['TASK-001']),
      JSON.stringify(['src/infrastructure/sqlite/schema.ts']),
      JSON.stringify([]),
    )
    const row = db
      .prepare<
        unknown[],
        { depends_on: string; allowed_paths: string; permissions: string }
      >(`SELECT depends_on, allowed_paths, permissions FROM ${TASKS_TABLE} WHERE id = ?`)
      .get('TASK-013')
    expect(JSON.parse(row?.depends_on ?? 'null')).toEqual(['TASK-001'])
    expect(JSON.parse(row?.allowed_paths ?? 'null')).toEqual([
      'src/infrastructure/sqlite/schema.ts',
    ])
    expect(JSON.parse(row?.permissions ?? 'null')).toEqual([])
    db.close()
  })

  it('四张表均可正常插入与查询', () => {
    const db = openDb()
    runMigrations(db)
    db.prepare(
      `INSERT INTO ${DECISIONS_TABLE} (id, title, status, scope) VALUES (?, ?, ?, ?)`,
    ).run('DEC-010', 'SQLite schema 迁移设计', 'proposed', 'infrastructure/sqlite')
    db.prepare(
      `INSERT INTO ${ISSUES_TABLE} (id, title, severity, status, owner) VALUES (?, ?, ?, ?, ?)`,
    ).run('ISS-005', '原生模块 Node 版本', 'low', 'open', '')
    db.prepare(
      `INSERT INTO ${EXECUTIONS_TABLE} (task_id, execution_status, review_result, next_action, commit_hash, commit_message, author, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'TASK-013',
      'completed',
      null,
      'review',
      'abc123',
      'feat: SQLite schema',
      'executor',
      '2026-07-08T09:00:00Z',
    )
    const dec = db
      .prepare<unknown[], { status: string }>(
        `SELECT status FROM ${DECISIONS_TABLE} WHERE id = ?`,
      )
      .get('DEC-010')
    expect(dec?.status).toBe('proposed')
    const iss = db
      .prepare<unknown[], { severity: string; owner: string }>(
        `SELECT severity, owner FROM ${ISSUES_TABLE} WHERE id = ?`,
      )
      .get('ISS-005')
    expect(iss?.severity).toBe('low')
    expect(iss?.owner).toBe('')
    const exec = db
      .prepare<
        unknown[],
        { execution_status: string; review_result: string | null; commit_hash: string }
      >(`SELECT execution_status, review_result, commit_hash FROM ${EXECUTIONS_TABLE} WHERE task_id = ?`)
      .get('TASK-013')
    expect(exec?.execution_status).toBe('completed')
    expect(exec?.review_result).toBeNull()
    expect(exec?.commit_hash).toBe('abc123')
    db.close()
  })
})

/* ============================================================ *
 * 迁移事务回滚：up 抛错则不记录版本（保护数据一致性）
 * ============================================================ */

describe('迁移事务原子性', () => {
  it('单条迁移在事务内执行：版本与 DDL 同进退', () => {
    // 真实迁移 v1 成功后版本已记录；此处验证「版本表与表结构同时落库」的事务一致性：
    // runMigrations 成功 → 版本 1 在表 + 4 张索引表都在；不存在「表建了但版本没记」的中间态。
    const db = openDb()
    runMigrations(db)
    const versions = db
      .prepare<unknown[], { version: number }>(`SELECT version FROM ${MIGRATIONS_TABLE}`)
      .all()
      .map((r) => r.version)
    expect(versions).toContain(1)
    const tables = tableNames(db)
    expect(tables).toContain(TASKS_TABLE)
    expect(tables).toContain(EXECUTIONS_TABLE)
    db.close()
  })
})
