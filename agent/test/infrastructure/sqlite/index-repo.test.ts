import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  DECISIONS_TABLE,
  EXECUTIONS_TABLE,
  ISSUES_TABLE,
  GlobalDocRepository,
  IndexRepository,
  serializeDocument,
  TaskDocRepository,
  buildExecutionSummary,
} from '../../../src/infrastructure/index.js'
import type {
  Decision,
  Issue,
  ResultFrontmatter,
  ReviewFrontmatter,
  TaskFrontmatter,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具：镜像 Readme §9 / §10 / §15 模板的完整 frontmatter
 * ============================================================ */

const TASK_FM: TaskFrontmatter = {
  id: 'TASK-014',
  title: 'Infra SQLite 索引仓储与 rebuild-index',
  status: 'draft',
  layer: 'data',
  depends_on: ['TASK-011', 'TASK-012', 'TASK-013'],
  allowed_paths: ['src/infrastructure/sqlite/index-repo.ts'],
  forbidden_paths: ['src/core', 'src/application', 'src/cli'],
  permissions: [],
  no_review: false,
  restart_on_retry: false,
  verification: ['npm run typecheck', 'npm test -- infrastructure/sqlite/index-repo'],
  context_pack: {
    required_docs: ['AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/PROGRESS.md'],
    optional_doc_excerpts: [],
    source_files: [],
  },
  workflow_outputs: {
    result_file: 'docs/tasks/TASK-014-infra-sqlite-index-repo.result.md',
  },
}

const RESULT_FM: ResultFrontmatter = {
  task_id: 'TASK-014',
  execution_status: 'completed',
  modified_files: ['src/infrastructure/sqlite/index-repo.ts'],
  created_files: ['test/infrastructure/sqlite/index-repo.test.ts'],
  deleted_files: [],
  execution_commits: [
    {
      hash: 'abc123',
      message: 'feat: SQLite 索引仓储',
      author: 'executor',
      time: '2026-07-08T09:00:00Z',
    },
  ],
  verification: [
    { command: 'npm run typecheck', result: 'passed', notes: '' },
    { command: 'npm test -- infrastructure/sqlite/index-repo', result: 'passed', notes: '' },
  ],
  global_update_requests: {
    progress: [],
    decisions: [],
    issues: [],
  },
  next_action: 'review',
}

const REVIEW_FM: ReviewFrontmatter = {
  task_id: 'TASK-014',
  review_result: 'approved',
  reviewer: 'reviewer-agent',
  reviewed_at: '2026-07-08T10:00:00Z',
  required_changes: [],
  findings: [],
}

const DECISION: Decision = {
  id: 'DEC-010',
  title: 'SQLite schema 迁移设计',
  status: 'proposed',
  scope: 'infrastructure/sqlite',
  created_from_task: 'TASK-013',
  decision: '版本表为唯一事实来源',
  rationale: '前向迁移业界标准',
  consequences: 'TASK-014 调 runMigrations',
}

const ISSUE: Issue = {
  id: 'ISS-005',
  title: 'better-sqlite3 原生模块 Node 版本',
  status: 'open',
  severity: 'low',
  scope: 'infrastructure/sqlite',
  created_from_task: 'TASK-013',
  owner: '',
  recommended_action: '固定 Node 22 或装编译工具链',
}

/* ============================================================ *
 * 夹具：全局文档内容（fenced yaml block，readDecisions/readIssues 可解析）
 * ============================================================ */

const DECISIONS_DOC = serializeDocument(
  { doc: 'DECISIONS', status: 'active' },
  `# DECISIONS — 架构决策记录

\`\`\`yaml
id: ${DECISION.id}
title: "${DECISION.title}"
status: ${DECISION.status}
scope: ${DECISION.scope}
created_from_task: ${DECISION.created_from_task}
decision: "${DECISION.decision}"
rationale: "${DECISION.rationale}"
consequences: "${DECISION.consequences}"
\`\`\`
`,
)

const ISSUES_DOC = serializeDocument(
  { doc: 'ISSUES', status: 'active' },
  `# ISSUES — 问题记录

\`\`\`yaml
id: ${ISSUE.id}
title: "${ISSUE.title}"
status: ${ISSUE.status}
severity: ${ISSUE.severity}
scope: ${ISSUE.scope}
created_from_task: ${ISSUE.created_from_task}
owner: "${ISSUE.owner}"
recommended_action: "${ISSUE.recommended_action}"
\`\`\`
`,
)

/* ============================================================ *
 * 辅助：内存 SQLite / 临时 tasks 目录
 * ============================================================ */

/** 每个 case 独立创建内存 SQLite，避免跨用例污染（TESTING.md data 层：内存 SQLite）。 */
function openDb(): Database.Database {
  return new Database(':memory:')
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'index-repo-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 在临时 tasks 目录下写入一份种子任务文件（含正文）。 */
function seedTaskFile(slug: string, fm: TaskFrontmatter, body = `# ${fm.id}\n`): void {
  writeFileSync(join(dir, `${fm.id}-${slug}.md`), serializeDocument(fm, body))
}

/** 在临时 tasks 目录下写入一份种子 .result.md（slug 从任务文件派生）。 */
function seedResultFile(slug: string, fm: ResultFrontmatter, body = `# ${fm.task_id} result\n`): void {
  writeFileSync(join(dir, `${fm.task_id}-${slug}.result.md`), serializeDocument(fm, body))
}

/** 在临时 tasks 目录下写入一份种子 .review.md。 */
function seedReviewFile(slug: string, fm: ReviewFrontmatter, body = `# ${fm.task_id} review\n`): void {
  writeFileSync(join(dir, `${fm.task_id}-${slug}.review.md`), serializeDocument(fm, body))
}

/** 直接读取 decisions 表全部行（decisions 无公共读接口，测试以原始 SQL 校验 rebuild）。 */
function readDecisionsRows(db: Database.Database): Array<{ id: string; title: string; status: string; scope: string }> {
  return db.prepare<unknown[], { id: string; title: string; status: string; scope: string }>(
    `SELECT id, title, status, scope FROM ${DECISIONS_TABLE}`,
  ).all()
}

/** 直接读取 issues 表全部行。 */
function readIssuesRows(db: Database.Database): Array<{ id: string; title: string; severity: string; status: string; owner: string }> {
  return db
    .prepare<unknown[], { id: string; title: string; severity: string; status: string; owner: string }>(
      `SELECT id, title, severity, status, owner FROM ${ISSUES_TABLE}`,
    )
    .all()
}

/** 直接读取 executions 表全部行数。 */
function countExecutions(db: Database.Database): number {
  const row = db.prepare<unknown[], { c: number }>(`SELECT COUNT(*) AS c FROM ${EXECUTIONS_TABLE}`).get()
  return row?.c ?? 0
}

/* ============================================================ *
 * upsert + query round-trip（§11：upsert 写入后可 query）
 * ============================================================ */

describe('IndexRepository — upsert + query round-trip', () => {
  it('upsertTask 后 queryTasks 返回该行，JSON 文本列已 parse', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertTask(TASK_FM)
    const rows = repo.queryTasks()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id: 'TASK-014',
      title: TASK_FM.title,
      status: 'draft',
      layer: 'data',
      depends_on: ['TASK-011', 'TASK-012', 'TASK-013'],
      allowed_paths: ['src/infrastructure/sqlite/index-repo.ts'],
      permissions: [],
    })
    db.close()
  })

  it('upsertTask 同 id 重写取最新值（INSERT OR REPLACE，非累积）', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertTask(TASK_FM)
    repo.upsertTask({ ...TASK_FM, status: 'done', depends_on: ['TASK-013'] })
    const rows = repo.queryTasks()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('done')
    expect(rows[0]?.depends_on).toEqual(['TASK-013'])
    db.close()
  })

  it('queryTasks 按 id 数值升序（TASK-2 排在 TASK-10 之前）', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertTask({ ...TASK_FM, id: 'TASK-10' })
    repo.upsertTask({ ...TASK_FM, id: 'TASK-2' })
    repo.upsertTask({ ...TASK_FM, id: 'TASK-1' })
    const ids = repo.queryTasks().map((r) => r.id)
    expect(ids).toEqual(['TASK-1', 'TASK-2', 'TASK-10'])
    db.close()
  })
})

/* ============================================================ *
 * queryTasks 过滤
 * ============================================================ */

describe('IndexRepository — queryTasks 过滤', () => {
  function seedThree(db: Database.Database): void {
    const repo = new IndexRepository(db)
    repo.upsertTask({ ...TASK_FM, id: 'TASK-1', status: 'done', layer: 'data' })
    repo.upsertTask({ ...TASK_FM, id: 'TASK-2', status: 'draft', layer: 'type' })
    repo.upsertTask({ ...TASK_FM, id: 'TASK-3', status: 'done', layer: 'type' })
  }

  it('按 status 过滤', () => {
    const db = openDb()
    seedThree(db)
    const repo = new IndexRepository(db)
    expect(repo.queryTasks({ status: 'done' }).map((r) => r.id)).toEqual(['TASK-1', 'TASK-3'])
    db.close()
  })

  it('按 layer 过滤', () => {
    const db = openDb()
    seedThree(db)
    const repo = new IndexRepository(db)
    expect(repo.queryTasks({ layer: 'type' }).map((r) => r.id)).toEqual(['TASK-2', 'TASK-3'])
    db.close()
  })

  it('status + layer 组合过滤', () => {
    const db = openDb()
    seedThree(db)
    const repo = new IndexRepository(db)
    expect(repo.queryTasks({ status: 'done', layer: 'type' }).map((r) => r.id)).toEqual(['TASK-3'])
    db.close()
  })

  it('空过滤返回全部', () => {
    const db = openDb()
    seedThree(db)
    const repo = new IndexRepository(db)
    expect(repo.queryTasks().map((r) => r.id)).toEqual(['TASK-1', 'TASK-2', 'TASK-3'])
    expect(repo.queryTasks({}).map((r) => r.id)).toEqual(['TASK-1', 'TASK-2', 'TASK-3'])
    db.close()
  })
})

/* ============================================================ *
 * upsertExecution + getExecution
 * ============================================================ */

describe('IndexRepository — execution 摘要', () => {
  it('upsertExecution 后 getExecution 返回该行', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    const summary = buildExecutionSummary(RESULT_FM, REVIEW_FM)
    repo.upsertExecution(summary)
    const row = repo.getExecution('TASK-014')
    expect(row).toEqual({
      task_id: 'TASK-014',
      execution_status: 'completed',
      review_result: 'approved',
      next_action: 'review',
      commit_hash: 'abc123',
      commit_message: 'feat: SQLite 索引仓储',
      author: 'executor',
      time: '2026-07-08T09:00:00Z',
    })
    db.close()
  })

  it('getExecution 无记录返回 null', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    expect(repo.getExecution('TASK-999')).toBeNull()
    db.close()
  })

  it('upsertExecution 无 commit / 无 review 时可空列为 null', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    const noCommits: ResultFrontmatter = { ...RESULT_FM, execution_commits: [] }
    repo.upsertExecution(buildExecutionSummary(noCommits))
    const row = repo.getExecution('TASK-014')
    expect(row?.review_result).toBeNull()
    expect(row?.commit_hash).toBeNull()
    expect(row?.commit_message).toBeNull()
    expect(row?.author).toBeNull()
    expect(row?.time).toBeNull()
    expect(row?.next_action).toBe('review')
    db.close()
  })

  it('upsertExecution 同 task_id 重写覆盖（INSERT OR REPLACE）', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertExecution(buildExecutionSummary(RESULT_FM, REVIEW_FM))
    repo.upsertExecution(
      buildExecutionSummary({ ...RESULT_FM, execution_status: 'failed', next_action: 'retry' }),
    )
    expect(countExecutions(db)).toBe(1)
    const row = repo.getExecution('TASK-014')
    expect(row?.execution_status).toBe('failed')
    expect(row?.next_action).toBe('retry')
    db.close()
  })
})

/* ============================================================ *
 * upsertDecision / upsertIssue（无公共读接口，直接 SQL 校验）
 * ============================================================ */

describe('IndexRepository — decision / issue 写入', () => {
  it('upsertDecision 写入一行', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertDecision(DECISION)
    expect(readDecisionsRows(db)).toEqual([
      { id: 'DEC-010', title: DECISION.title, status: 'proposed', scope: 'infrastructure/sqlite' },
    ])
    db.close()
  })

  it('upsertIssue 写入一行', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertIssue(ISSUE)
    expect(readIssuesRows(db)).toEqual([
      { id: 'ISS-005', title: ISSUE.title, severity: 'low', status: 'open', owner: '' },
    ])
    db.close()
  })
})

/* ============================================================ *
 * 写入容错（§11：模拟写失败时函数不抛、记日志）
 * ============================================================ */

describe('IndexRepository — 写入容错（§3.2 / §11）', () => {
  it('坏 db（连接已关闭）时 upsertTask 不抛、经 onWarning 记告警', () => {
    const db = openDb()
    const warnings: unknown[] = []
    const repo = new IndexRepository(db, (err) => {
      warnings.push(err)
    })
    db.close() // 模拟坏 db：连接不可用
    expect(() => repo.upsertTask(TASK_FM)).not.toThrow()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toBeInstanceOf(Error)
  })

  it('坏 db 时 upsertDecision / upsertIssue / upsertExecution 均不抛', () => {
    const db = openDb()
    const repo = new IndexRepository(db, () => {})
    db.close()
    expect(() => repo.upsertDecision(DECISION)).not.toThrow()
    expect(() => repo.upsertIssue(ISSUE)).not.toThrow()
    expect(() => repo.upsertExecution(buildExecutionSummary(RESULT_FM))).not.toThrow()
  })

  it('默认 onWarning 不抛（输出 console.warn）', () => {
    const db = openDb()
    const repo = new IndexRepository(db) // 默认 onWarning = console.warn
    db.close()
    expect(() => repo.upsertTask(TASK_FM)).not.toThrow()
  })
})

/* ============================================================ *
 * buildExecutionSummary（代表性 commit 取首条 / review_result 缺省 null）
 * ============================================================ */

describe('buildExecutionSummary', () => {
  it('取 execution_commits 首条作代表性 commit', () => {
    const multi: ResultFrontmatter = {
      ...RESULT_FM,
      execution_commits: [
        { hash: 'first', message: 'm1', author: 'a1', time: 't1' },
        { hash: 'second', message: 'm2', author: 'a2', time: 't2' },
      ],
    }
    const summary = buildExecutionSummary(multi, REVIEW_FM)
    expect(summary.commit).toEqual({ hash: 'first', message: 'm1', author: 'a1', time: 't1' })
    expect(summary.review_result).toBe('approved')
  })

  it('无 execution_commits 时 commit 为 null', () => {
    const summary = buildExecutionSummary({ ...RESULT_FM, execution_commits: [] })
    expect(summary.commit).toBeNull()
  })

  it('无 review 时 review_result 为 null', () => {
    const summary = buildExecutionSummary(RESULT_FM)
    expect(summary.review_result).toBeNull()
    expect(summary.next_action).toBe('review')
    expect(summary.execution_status).toBe('completed')
  })
})

/* ============================================================ *
 * rebuildFromDocs（§11：索引内容 = 文档全集）
 * ============================================================ */

describe('IndexRepository — rebuildFromDocs 全量重建', () => {
  it('从文档完全恢复索引：tasks + executions + decisions + issues', () => {
    // 两个任务：TASK-101（data，有 result+review+commit）、TASK-102（type，无 result）
    const taskA: TaskFrontmatter = { ...TASK_FM, id: 'TASK-101', status: 'done', layer: 'data' }
    const taskB: TaskFrontmatter = {
      ...TASK_FM,
      id: 'TASK-102',
      status: 'draft',
      layer: 'type',
      depends_on: [],
      allowed_paths: ['src/core/x.ts'],
      title: '另一个任务',
    }
    seedTaskFile('task-a', taskA)
    seedTaskFile('task-b', taskB)
    seedResultFile('task-a', { ...RESULT_FM, task_id: 'TASK-101' })
    seedReviewFile('task-a', { ...REVIEW_FM, task_id: 'TASK-101' })

    const db = openDb()
    const repo = new IndexRepository(db)
    const taskRepo = new TaskDocRepository(dir)
    const globalRepo = new GlobalDocRepository()
    repo.rebuildFromDocs({ taskRepo, globalRepo, decisionsDoc: DECISIONS_DOC, issuesDoc: ISSUES_DOC })

    // tasks：两个任务均入索引，JSON 列已 parse
    const tasks = repo.queryTasks()
    expect(tasks.map((t) => t.id)).toEqual(['TASK-101', 'TASK-102'])
    const a = tasks.find((t) => t.id === 'TASK-101')
    expect(a?.layer).toBe('data')
    expect(a?.status).toBe('done')
    expect(a?.depends_on).toEqual(['TASK-011', 'TASK-012', 'TASK-013'])

    // executions：TASK-101 有 result+review，TASK-102 无 result → 无 execution 行
    expect(countExecutions(db)).toBe(1)
    const exec = repo.getExecution('TASK-101')
    expect(exec?.execution_status).toBe('completed')
    expect(exec?.review_result).toBe('approved')
    expect(exec?.commit_hash).toBe('abc123')
    expect(repo.getExecution('TASK-102')).toBeNull()

    // decisions / issues：从全局文档解析后逐条写入
    expect(readDecisionsRows(db)).toHaveLength(1)
    expect(readDecisionsRows(db)[0]?.id).toBe('DEC-010')
    expect(readIssuesRows(db)).toHaveLength(1)
    expect(readIssuesRows(db)[0]?.id).toBe('ISS-005')
    db.close()
  })

  it('rebuild 先清空：旧索引行被清除', () => {
    const taskA: TaskFrontmatter = { ...TASK_FM, id: 'TASK-101', status: 'done', layer: 'data' }
    seedTaskFile('task-a', taskA)

    const db = openDb()
    const repo = new IndexRepository(db)
    // 预置陈旧行（即将被 rebuild 清除）
    repo.upsertTask({ ...TASK_FM, id: 'TASK-999', title: '陈旧行' })
    repo.upsertDecision(DECISION)
    repo.upsertIssue(ISSUE)
    repo.upsertExecution(buildExecutionSummary(RESULT_FM))

    repo.rebuildFromDocs({
      taskRepo: new TaskDocRepository(dir),
      globalRepo: new GlobalDocRepository(),
      decisionsDoc: DECISIONS_DOC,
      issuesDoc: ISSUES_DOC,
    })

    expect(repo.queryTasks().map((t) => t.id)).toEqual(['TASK-101']) // TASK-999 已清除
    // decisions/issues 源文档各 1 条，rebuild 后仍是 1 条（清除后重写）
    expect(readDecisionsRows(db)).toHaveLength(1)
    expect(readIssuesRows(db)).toHaveLength(1)
    db.close()
  })

  it('result 无 review 时 execution 行 review_result 为 null', () => {
    const taskA: TaskFrontmatter = { ...TASK_FM, id: 'TASK-101', status: 'reviewing', layer: 'data' }
    seedTaskFile('task-a', taskA)
    seedResultFile('task-a', { ...RESULT_FM, task_id: 'TASK-101' })
    // 不写 review 文件

    const db = openDb()
    const repo = new IndexRepository(db)
    repo.rebuildFromDocs({
      taskRepo: new TaskDocRepository(dir),
      globalRepo: new GlobalDocRepository(),
      decisionsDoc: DECISIONS_DOC,
      issuesDoc: ISSUES_DOC,
    })
    const exec = repo.getExecution('TASK-101')
    expect(exec?.review_result).toBeNull()
    expect(exec?.execution_status).toBe('completed')
    db.close()
  })

  it('空文档集重建得到空索引（不抛）', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    repo.upsertTask({ ...TASK_FM, id: 'TASK-001' })
    repo.rebuildFromDocs({
      taskRepo: new TaskDocRepository(dir), // 空临时目录
      globalRepo: new GlobalDocRepository(),
      decisionsDoc: serializeDocument({ doc: 'DECISIONS' }, '# DECISIONS\n'),
      issuesDoc: serializeDocument({ doc: 'ISSUES' }, '# ISSUES\n'),
    })
    expect(repo.queryTasks()).toEqual([])
    expect(readDecisionsRows(db)).toEqual([])
    expect(readIssuesRows(db)).toEqual([])
    db.close()
  })

  it('rebuild 原子性：文档损坏时整体回滚，既有索引保持不变', () => {
    const db = openDb()
    const repo = new IndexRepository(db)
    // 预置一行既有索引（验证回滚后是否保留）
    repo.upsertTask({ ...TASK_FM, id: 'TASK-001', title: '既有行' })

    // 种子：合法任务文件 + 损坏 result 文件（execution_status 非法枚举）
    const taskBad: TaskFrontmatter = { ...TASK_FM, id: 'TASK-099', status: 'reviewing', layer: 'data' }
    seedTaskFile('task-bad', taskBad)
    writeFileSync(
      join(dir, 'TASK-099-task-bad.result.md'),
      serializeDocument(
        { ...RESULT_FM, task_id: 'TASK-099', execution_status: 'bogus-status' } as unknown as ResultFrontmatter,
        '# corrupt\n',
      ),
    )

    expect(() =>
      repo.rebuildFromDocs({
        taskRepo: new TaskDocRepository(dir),
        globalRepo: new GlobalDocRepository(),
        decisionsDoc: DECISIONS_DOC,
        issuesDoc: ISSUES_DOC,
      }),
    ).toThrow()
    // 回滚：DELETE 未生效，既有 TASK-001 仍在
    expect(repo.queryTasks().map((t) => t.id)).toEqual(['TASK-001'])
    db.close()
  })
})
