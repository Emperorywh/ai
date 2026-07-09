import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { IndexRepository, serializeDocument } from '../../src/infrastructure/index.js'
import {
  collectStatus,
  formatStatus,
  type ExecutionDigest,
} from '../../src/cli/commands/status.js'
import { rebuildIndex } from '../../src/cli/commands/rebuild-index.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'
import type {
  Decision,
  Issue,
  ResultFrontmatter,
  ReviewFrontmatter,
  TaskFrontmatter,
} from '../../src/core/index.js'

/* ============================================================ *
 * 夹具：镜像 Readme §9 / §10 / §15 模板的 frontmatter
 * ============================================================ */

const TASK_A: TaskFrontmatter = {
  id: 'TASK-101',
  title: '有执行摘要的任务',
  status: 'done',
  layer: 'data',
  depends_on: [],
  allowed_paths: ['src/x.ts'],
  forbidden_paths: ['src/core'],
  permissions: [],
  no_review: false,
  restart_on_retry: false,
  verification: ['npm run typecheck'],
  context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
  workflow_outputs: { result_file: 'docs/tasks/TASK-101-x.result.md' },
}

const TASK_B: TaskFrontmatter = {
  id: 'TASK-102',
  title: '未执行的任务',
  status: 'draft',
  layer: 'type',
  depends_on: [],
  allowed_paths: ['src/y.ts'],
  forbidden_paths: [],
  permissions: [],
  no_review: false,
  restart_on_retry: false,
  verification: ['npm run typecheck'],
  context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
  workflow_outputs: { result_file: 'docs/tasks/TASK-102-y.result.md' },
}

const RESULT_A: ResultFrontmatter = {
  task_id: 'TASK-101',
  execution_status: 'completed',
  modified_files: ['src/x.ts'],
  created_files: [],
  deleted_files: [],
  execution_commits: [
    { hash: 'abc123def', message: 'feat: x', author: 'executor', time: '2026-07-09T09:00:00Z' },
  ],
  verification: [{ command: 'npm run typecheck', result: 'passed', notes: '' }],
  global_update_requests: { progress: [], decisions: [], issues: [] },
  next_action: 'review',
}

const REVIEW_A: ReviewFrontmatter = {
  task_id: 'TASK-101',
  review_result: 'approved',
  reviewer: 'reviewer-agent',
  reviewed_at: '2026-07-09T10:00:00Z',
  required_changes: [],
  findings: [],
}

const DECISION: Decision = {
  id: 'DEC-099',
  title: '测试决策',
  status: 'accepted',
  scope: 'test',
  created_from_task: 'TASK-001',
  decision: '用测试夹具',
  rationale: '简化测试',
  consequences: '无',
}

const ISSUE: Issue = {
  id: 'ISS-099',
  title: '测试问题',
  status: 'open',
  severity: 'low',
  scope: 'test',
  created_from_task: 'TASK-001',
  owner: '',
  recommended_action: '忽略',
}

/** 构造一份含一条 fenced yaml 决策的 DECISIONS.md 内容。 */
function decisionsDoc(): string {
  return serializeDocument(
    { doc: 'DECISIONS', status: 'active' },
    `# DECISIONS

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
}

/** 构造一份含一条 fenced yaml 问题的 ISSUES.md 内容。 */
function issuesDoc(): string {
  return serializeDocument(
    { doc: 'ISSUES', status: 'active' },
    `# ISSUES

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
}

/* ============================================================ *
 * 辅助：临时项目根 + 种子文档
 * ============================================================ */

let root: string
let tasksDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caw-status-'))
  tasksDir = join(root, 'docs', 'tasks')
  // 建立文档协议目录结构，种子文件直接写入（空目录对 collectStatus 同样返回 []）
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(tasksDir, { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** 写入两份种子任务（A 含 result+review，B 无），并落 DECISIONS.md / ISSUES.md。 */
function seedFullProject(): void {
  writeFileSync(join(tasksDir, 'TASK-101-x.md'), serializeDocument(TASK_A, `# ${TASK_A.id}\n`))
  writeFileSync(
    join(tasksDir, 'TASK-101-x.result.md'),
    serializeDocument(RESULT_A, `# ${TASK_A.id} result\n`),
  )
  writeFileSync(
    join(tasksDir, 'TASK-101-x.review.md'),
    serializeDocument(REVIEW_A, `# ${TASK_A.id} review\n`),
  )
  writeFileSync(join(tasksDir, 'TASK-102-y.md'), serializeDocument(TASK_B, `# ${TASK_B.id}\n`))
  writeFileSync(join(root, 'docs', 'DECISIONS.md'), decisionsDoc())
  writeFileSync(join(root, 'docs', 'ISSUES.md'), issuesDoc())
}

/* ============================================================ *
 * status：collectStatus（文档为权威，无 SQLite）
 * ============================================================ */

describe('status 命令 — collectStatus（文档为权威，不依赖 SQLite）', () => {
  it('从文档读取任务，按 id 数值升序', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir)
    expect(rows.map((r) => r.id)).toEqual(['TASK-101', 'TASK-102'])
    expect(rows[0]?.title).toBe('有执行摘要的任务')
    expect(rows[0]?.status).toBe('done')
    expect(rows[0]?.layer).toBe('data')
  })

  it('执行摘要来自 .result.md + .review.md（综合 commit 首条 hash）', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir)
    const exec = rows[0]?.execution as ExecutionDigest
    expect(exec.execution_status).toBe('completed')
    expect(exec.next_action).toBe('review')
    expect(exec.commit).toBe('abc123def')
  })

  it('无 .result.md 的任务执行摘要为 null（未执行）', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir)
    expect(rows[1]?.execution).toBeNull()
  })

  it('不读取 / 不创建任何 SQLite 索引文件（§3.1：读状态不得只依赖 SQLite）', () => {
    seedFullProject()
    collectStatus(tasksDir)
    expect(existsSync(join(root, '.caw'))).toBe(false)
  })

  it('按 status 过滤', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir, { status: 'draft' })
    expect(rows.map((r) => r.id)).toEqual(['TASK-102'])
  })

  it('按 layer 过滤', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir, { layer: 'data' })
    expect(rows.map((r) => r.id)).toEqual(['TASK-101'])
  })

  it('空任务目录返回空数组', () => {
    // tasksDir 已由 beforeEach 建立但无文件（mkdtempSync 只建 root，tasksDir 尚不存在）
    expect(collectStatus(tasksDir)).toEqual([])
  })
})

/* ============================================================ *
 * status：formatStatus
 * ============================================================ */

describe('status 命令 — formatStatus', () => {
  it('空结果返回占位提示', () => {
    expect(formatStatus([])).toBe('（暂无任务）')
  })

  it('表头含五列，正文含任务 id 与执行标签', () => {
    seedFullProject()
    const rows = collectStatus(tasksDir)
    const out = formatStatus(rows)
    expect(out).toContain('TASK-ID')
    expect(out).toContain('STATUS')
    expect(out).toContain('LAYER')
    expect(out).toContain('EXECUTION')
    expect(out).toContain('TITLE')
    expect(out).toContain('TASK-101')
    expect(out).toContain('TASK-102')
    // 有摘要者展示 execution_status + 短 hash；未执行者展示「未执行」
    expect(out).toContain('completed')
    expect(out).toContain('abc123d')
    expect(out).toContain('未执行')
  })
})

/* ============================================================ *
 * status：runCli（退出码 + 输出）
 * ============================================================ */

describe('status 命令 — runCli（退出码 + 输出）', () => {
  it('status 列出任务并返回成功退出码', async () => {
    seedFullProject()
    const logs = spyOnConsole('log')
    const exit = await runCli(['status', '--tasks-dir', tasksDir])
    expect(exit).toBe(CliExitCode.Success)
    expect(logs.join('\n')).toContain('TASK-101')
    expect(logs.join('\n')).toContain('未执行')
    expect(logs.join('\n')).toContain('共 2 个任务')
  })

  it('无 SQLite 索引仍能正确展示（验收：无索引可展示）', async () => {
    seedFullProject()
    const logs = spyOnConsole('log')
    const exit = await runCli(['status', '--tasks-dir', tasksDir])
    expect(exit).toBe(CliExitCode.Success)
    expect(existsSync(join(root, '.caw'))).toBe(false)
    expect(logs.join('\n')).toContain('TASK-102')
  })

  it('--status 过滤生效', async () => {
    seedFullProject()
    const logs = spyOnConsole('log')
    const exit = await runCli(['status', '--tasks-dir', tasksDir, '--status', 'draft'])
    expect(exit).toBe(CliExitCode.Success)
    const out = logs.join('\n')
    expect(out).toContain('TASK-102')
    expect(out).not.toContain('TASK-101')
  })

  it('非法 --status 返回非零退出码', async () => {
    seedFullProject()
    spyOnConsole('log')
    const exit = await runCli(['status', '--tasks-dir', tasksDir, '--status', 'bogus'])
    expect(exit).not.toBe(CliExitCode.Success)
  })

  it('任务目录不存在返回非零退出码', async () => {
    const exit = await runCli(['status', '--tasks-dir', join(root, 'nope')])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * rebuild-index：rebuildIndex（重建 + 索引 = 文档全集）
 * ============================================================ */

describe('rebuild-index 命令 — rebuildIndex（索引 = 文档全集）', () => {
  it('从文档全量重建四表，行数与文档一致', () => {
    seedFullProject()
    const stats = rebuildIndex({ projectRoot: root })
    expect(stats.tasks).toBe(2)
    expect(stats.executions).toBe(1) // 仅 TASK-101 有 result
    expect(stats.decisions).toBe(1)
    expect(stats.issues).toBe(1)
    expect(stats.dbPath).toBe(join(root, '.caw', 'index.db'))
    expect(existsSync(stats.dbPath)).toBe(true)
  })

  it('重建后索引 = 文档全集（经 IndexRepository 校验）', () => {
    seedFullProject()
    const { dbPath } = rebuildIndex({ projectRoot: root })
    const db = new Database(dbPath)
    try {
      const repo = new IndexRepository(db)
      const tasks = repo.queryTasks()
      expect(tasks.map((t) => t.id)).toEqual(['TASK-101', 'TASK-102'])
      expect(tasks[0]?.status).toBe('done')
      const exec = repo.getExecution('TASK-101')
      expect(exec?.execution_status).toBe('completed')
      expect(exec?.review_result).toBe('approved')
      expect(exec?.commit_hash).toBe('abc123def')
      // 无 result 的任务无 execution 行
      expect(repo.getExecution('TASK-102')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('重复重建幂等（行数稳定）', () => {
    seedFullProject()
    const a = rebuildIndex({ projectRoot: root })
    const b = rebuildIndex({ projectRoot: root })
    expect(b).toEqual(a)
  })

  it('无全局文档时 decisions/issues 为 0（缺失视为空集）', () => {
    // 仅种任务，不落 DECISIONS.md / ISSUES.md
    writeFileSync(join(tasksDir, 'TASK-101-x.md'), serializeDocument(TASK_A, `# x\n`))
    const stats = rebuildIndex({ projectRoot: root })
    expect(stats.tasks).toBe(1)
    expect(stats.decisions).toBe(0)
    expect(stats.issues).toBe(0)
  })

  it('支持 --dbPath 自定义索引路径', () => {
    seedFullProject()
    const custom = join(root, 'custom.db')
    const stats = rebuildIndex({ projectRoot: root, dbPath: custom })
    expect(stats.dbPath).toBe(custom)
    expect(existsSync(custom)).toBe(true)
  })

  it('任务目录不存在抛错', () => {
    expect(() => rebuildIndex({ projectRoot: join(root, 'nope') })).toThrow()
  })
})

/* ============================================================ *
 * rebuild-index：runCli（退出码 + 输出）
 * ============================================================ */

describe('rebuild-index 命令 — runCli（退出码 + 输出）', () => {
  it('rebuild-index 重建并返回成功退出码，输出含统计与破坏性提示', async () => {
    seedFullProject()
    const logs = spyOnConsole('log')
    const warns = spyOnConsole('warn')
    const exit = await runCli(['rebuild-index', '--project-root', root])
    expect(exit).toBe(CliExitCode.Success)
    const out = logs.join('\n')
    expect(out).toContain('已重建索引')
    expect(out).toContain('tasks:       2 行')
    expect(out).toContain('executions:  1 行')
    expect(warns.join('\n')).toContain('破坏性')
  })

  it('任务目录不存在返回非零退出码', async () => {
    const exit = await runCli(['rebuild-index', '--project-root', join(root, 'nope')])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * 辅助：console spy
 * ============================================================ */

/** 捕获指定 console 方法的全部调用参数，返回累加数组。 */
function spyOnConsole(method: 'log' | 'warn'): string[] {
  const buffer: string[] = []
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    buffer.push(args.map((a) => String(a)).join(' '))
  })
  return buffer
}
