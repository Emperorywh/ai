import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskDocRepository, serializeDocument } from '../../../src/infrastructure/index.js'
import type {
  ResultFrontmatter,
  ReviewFrontmatter,
  TaskFrontmatter,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具：镜像 Readme §9 / §10 / §15 模板的完整 frontmatter（z.infer 输出类型，
 * 默认字段均已显式提供，便于 round-trip 深度相等）。
 * ============================================================ */

const TASK_FM: TaskFrontmatter = {
  id: 'TASK-011',
  title: 'Infra 任务/结果/审查文档仓储',
  status: 'draft',
  layer: 'data',
  depends_on: ['TASK-003', 'TASK-005', 'TASK-006', 'TASK-010'],
  allowed_paths: ['src/infrastructure/fs/task-doc-repo.ts'],
  forbidden_paths: ['src/core', 'src/application', 'src/cli'],
  permissions: [],
  no_review: false,
  restart_on_retry: false,
  verification: ['npm run typecheck', 'npm test -- infrastructure/fs/task-doc-repo'],
  context_pack: {
    required_docs: ['AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/PROGRESS.md'],
    optional_doc_excerpts: [],
    source_files: [],
  },
  workflow_outputs: {
    result_file: 'docs/tasks/TASK-011-infra-task-doc-repo.result.md',
  },
}

const TASK_BODY = `# TASK-011 Infra 任务/结果/审查文档仓储

## 1. 背景

来自 PLAN P2。

## 2. 当前目标

实现 TaskDocRepository。
`

const RESULT_FM: ResultFrontmatter = {
  task_id: 'TASK-011',
  execution_status: 'completed',
  modified_files: ['src/infrastructure/fs/task-doc-repo.ts'],
  created_files: ['test/infrastructure/fs/task-doc-repo.test.ts'],
  deleted_files: [],
  execution_commits: [],
  verification: [
    { command: 'npm run typecheck', result: 'passed', notes: '' },
    { command: 'npm test -- infrastructure/fs/task-doc-repo', result: 'passed', notes: '' },
  ],
  global_update_requests: {
    progress: [],
    decisions: [],
    issues: [],
  },
  next_action: 'review',
}

const RESULT_BODY = `# TASK-011 执行结果

## 1. 执行结论

任务完成。
`

const REVIEW_FM: ReviewFrontmatter = {
  task_id: 'TASK-011',
  review_result: 'approved',
  reviewer: 'reviewer-agent',
  reviewed_at: '2026-07-08T00:00:00Z',
  required_changes: [],
  findings: [],
}

const REVIEW_BODY = `# TASK-011 审查结论

## 1. 审查意见

通过。
`

/* ============================================================ *
 * 临时 tasks 目录（TESTING.md data 层集成测试策略）
 * ============================================================ */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'task-doc-repo-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 在临时目录下写入一份种子任务文件，返回其完整路径。 */
function seedTask(slug: string, fm: TaskFrontmatter, body: string): string {
  const path = join(dir, `TASK-011-${slug}.md`)
  writeFileSync(path, serializeDocument(fm, body))
  return path
}

/* ============================================================ *
 * 任务文档 readTask / writeTask
 * ============================================================ */

describe('TaskDocRepository — 任务文档', () => {
  it('readTask 读取并按 TaskFrontmatterSchema 校验 frontmatter', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    expect(repo.readTask('TASK-011')).toEqual(TASK_FM)
  })

  it('writeTask 更新 frontmatter 后 readTask round-trip 通过', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    const updated: TaskFrontmatter = { ...TASK_FM, status: 'ready' }
    repo.writeTask(updated)
    expect(repo.readTask('TASK-011')).toEqual(updated)
  })

  it('writeTask 未传 body 时保留人工维护的正文（§12 风险点）', () => {
    const path = seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeTask({ ...TASK_FM, status: 'ready' })
    // 正文应原样保留，未被 frontmatter 序列化抹掉
    const raw = readFileSync(path, 'utf8')
    expect(raw.endsWith(TASK_BODY)).toBe(true)
  })

  it('writeTask 传入 body 时整体替换正文', () => {
    const path = seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    const newBody = '# 完全新的正文\n'
    repo.writeTask(TASK_FM, newBody)
    const raw = readFileSync(path, 'utf8')
    expect(raw.endsWith(newBody)).toBe(true)
    expect(raw.includes(TASK_BODY)).toBe(false)
  })

  it('readTask 文件不存在时抛错', () => {
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readTask('TASK-011')).toThrow(/未找到任务文件/)
  })

  it('writeTask 任务文件不存在时抛错（不越界新建含 slug 的任务文件）', () => {
    const repo = new TaskDocRepository(dir)
    expect(() => repo.writeTask(TASK_FM)).toThrow(/未找到任务文件/)
  })

  it('readTask 文档缺少 frontmatter（纯 Markdown）时抛错', () => {
    writeFileSync(join(dir, 'TASK-011-infra-task-doc-repo.md'), '# Title\n\n正文\n')
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readTask('TASK-011')).toThrow(/缺少 frontmatter/)
  })

  it('readTask frontmatter 缺必填字段时抛错', () => {
    const brokenFm = {
      id: 'TASK-011',
      title: '缺 layer',
      status: 'draft',
      // 缺 layer / allowed_paths / verification / context_pack / workflow_outputs
    }
    writeFileSync(
      join(dir, 'TASK-011-infra-task-doc-repo.md'),
      serializeDocument(brokenFm, TASK_BODY),
    )
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readTask('TASK-011')).toThrow(/校验失败/)
  })

  it('readTask frontmatter 枚举非法值时抛错', () => {
    const brokenFm = { ...TASK_FM, layer: 'not-a-layer' as never }
    writeFileSync(
      join(dir, 'TASK-011-infra-task-doc-repo.md'),
      serializeDocument(brokenFm, TASK_BODY),
    )
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readTask('TASK-011')).toThrow(/校验失败/)
  })
})

/* ============================================================ *
 * 执行结果 readResult / writeResult
 * ============================================================ */

describe('TaskDocRepository — 执行结果', () => {
  it('writeResult 新建后 readResult round-trip 通过（frontmatter + 正文）', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeResult(RESULT_FM, RESULT_BODY)
    expect(repo.readResult('TASK-011')).toEqual(RESULT_FM)
  })

  it('writeResult 文件名按任务文件 slug 派生（先有任务才有结果）', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeResult(RESULT_FM, RESULT_BODY)
    expect(existsSync(join(dir, 'TASK-011-infra-task-doc-repo.result.md'))).toBe(true)
  })

  it('writeResult 未传 body 时保留现有 result 正文', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeResult(RESULT_FM, RESULT_BODY)
    // 仅回填 execution_commits（改 frontmatter），正文应保留
    const amended: ResultFrontmatter = {
      ...RESULT_FM,
      execution_commits: [
        { hash: 'abc1234', message: 'feat: 实现(TASK-011)', author: 'bot', time: '2026-07-08T00:00:00Z' },
      ],
    }
    repo.writeResult(amended)
    expect(repo.readResult('TASK-011')).toEqual(amended)
    const raw = readFileSync(join(dir, 'TASK-011-infra-task-doc-repo.result.md'), 'utf8')
    expect(raw.includes(RESULT_BODY)).toBe(true)
  })

  it('readResult frontmatter 非法时抛错', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const brokenFm = { ...RESULT_FM, execution_status: 'unknown' as never }
    writeFileSync(
      join(dir, 'TASK-011-infra-task-doc-repo.result.md'),
      serializeDocument(brokenFm, RESULT_BODY),
    )
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readResult('TASK-011')).toThrow(/校验失败/)
  })

  it('readResult result 文件不存在时抛错', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readResult('TASK-011')).toThrow(/文档不存在/)
  })
})

/* ============================================================ *
 * 审查结论 readReview / writeReview
 * ============================================================ */

describe('TaskDocRepository — 审查结论', () => {
  it('writeReview 新建后 readReview round-trip 通过', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeReview(REVIEW_FM, REVIEW_BODY)
    expect(repo.readReview('TASK-011')).toEqual(REVIEW_FM)
    expect(existsSync(join(dir, 'TASK-011-infra-task-doc-repo.review.md'))).toBe(true)
  })

  it('writeReview 未传 body 时保留现有正文', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    repo.writeReview(REVIEW_FM, REVIEW_BODY)
    const amended: ReviewFrontmatter = { ...REVIEW_FM, review_result: 'rejected', required_changes: ['修复 X'] }
    repo.writeReview(amended)
    expect(repo.readReview('TASK-011')).toEqual(amended)
    const raw = readFileSync(join(dir, 'TASK-011-infra-task-doc-repo.review.md'), 'utf8')
    expect(raw.includes(REVIEW_BODY)).toBe(true)
  })
})

/* ============================================================ *
 * listTasks
 * ============================================================ */

describe('TaskDocRepository — listTasks', () => {
  it('只返回 TASK-*.md 的 id，排除 .result.md / .review.md', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    writeFileSync(join(dir, 'TASK-011-infra-task-doc-repo.result.md'), serializeDocument(RESULT_FM, ''))
    writeFileSync(join(dir, 'TASK-011-infra-task-doc-repo.review.md'), serializeDocument(REVIEW_FM, ''))
    // 另一个任务
    writeFileSync(join(dir, 'TASK-002-core-enums.md'), serializeDocument({ ...TASK_FM, id: 'TASK-002' }, ''))
    const repo = new TaskDocRepository(dir)
    expect(repo.listTasks().sort()).toEqual(['TASK-002', 'TASK-011'])
  })

  it('按 id 数值升序排列（鲁棒于补零）', () => {
    for (const id of ['TASK-2', 'TASK-10', 'TASK-1']) {
      writeFileSync(join(dir, `${id}-slug.md`), serializeDocument({ ...TASK_FM, id }, ''))
    }
    const repo = new TaskDocRepository(dir)
    expect(repo.listTasks()).toEqual(['TASK-1', 'TASK-2', 'TASK-10'])
  })

  it('空目录返回空数组', () => {
    const repo = new TaskDocRepository(dir)
    expect(repo.listTasks()).toEqual([])
  })

  it('tasksDir 不存在时返回空数组', () => {
    const repo = new TaskDocRepository(join(dir, 'does-not-exist'))
    expect(repo.listTasks()).toEqual([])
  })
})

/* ============================================================ *
 * 路径歧义
 * ============================================================ */

describe('TaskDocRepository — 路径歧义', () => {
  it('同一 id 匹配多个任务文件时 readTask 抛歧义错', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    seedTask('another-slug', TASK_FM, TASK_BODY)
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readTask('TASK-011')).toThrow(/歧义/)
  })

  it('同一 id 匹配多个 .result.md 时 readResult 抛歧义错', () => {
    seedTask('infra-task-doc-repo', TASK_FM, TASK_BODY)
    writeFileSync(join(dir, 'TASK-011-infra-task-doc-repo.result.md'), serializeDocument(RESULT_FM, ''))
    writeFileSync(join(dir, 'TASK-011-another.result.md'), serializeDocument(RESULT_FM, ''))
    const repo = new TaskDocRepository(dir)
    expect(() => repo.readResult('TASK-011')).toThrow(/歧义/)
  })
})
