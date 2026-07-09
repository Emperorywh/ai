import { describe, expect, it } from 'vitest'
import { StateOrchestrator } from '../../src/application/index.js'
import type { TaskDocRepositoryPort } from '../../src/application/ports.js'
import type {
  ExecutionStatus,
  NextAction,
  ResultFrontmatter,
  ResultVerification,
  ReviewFrontmatter,
  ReviewResult,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../src/core/index.js'

/* ============================================================ *
 * 测试夹具
 * ============================================================ */

/**
 * 内存 fake 仓储：实现 TaskDocRepositoryPort，聚焦编排逻辑（不依赖 fs / frontmatter 序列化，
 * 后者已由 TASK-011 覆盖）。读取缺失即抛「文档不存在」错（对齐 DEC-008 稳定契约），
 * writeTask 仅更新已存在任务（对齐 DEC-008）。
 */
class InMemoryRepo implements TaskDocRepositoryPort {
  private readonly tasks = new Map<TaskId, TaskFrontmatter>()
  private readonly results = new Map<TaskId, ResultFrontmatter>()
  private readonly reviews = new Map<TaskId, ReviewFrontmatter>()

  seedTask(task: TaskFrontmatter): void {
    this.tasks.set(task.id, { ...task })
  }
  seedResult(result: ResultFrontmatter): void {
    this.results.set(result.task_id, { ...result })
  }

  readTask(id: TaskId): TaskFrontmatter {
    const t = this.tasks.get(id)
    if (t === undefined) throw new Error(`任务文档不存在：${id}`)
    return { ...t }
  }
  writeTask(task: TaskFrontmatter): void {
    if (!this.tasks.has(task.id)) {
      throw new Error(`任务文档不存在：${task.id}`)
    }
    this.tasks.set(task.id, { ...task })
  }
  readResult(id: TaskId): ResultFrontmatter {
    const r = this.results.get(id)
    if (r === undefined) throw new Error(`结果文档不存在：${id}`)
    return { ...r }
  }
  writeResult(result: ResultFrontmatter): void {
    this.results.set(result.task_id, { ...result })
  }
  readReview(id: TaskId): ReviewFrontmatter {
    const r = this.reviews.get(id)
    if (r === undefined) throw new Error(`审查文档不存在：${id}`)
    return { ...r }
  }
  writeReview(review: ReviewFrontmatter): void {
    this.reviews.set(review.task_id, { ...review })
  }
  listTasks(): TaskId[] {
    return [...this.tasks.keys()].sort((a, b) => taskIdNum(a) - taskIdNum(b))
  }
}

/** 提取 TASK-XXX 的数字部分（与 TaskDocRepository.listTasks 一致，鲁棒于补零）。 */
function taskIdNum(id: TaskId): number {
  return Number(id.replace('TASK-', ''))
}

/** 构造合法 TaskFrontmatter，按需覆盖状态编排关心的字段（status / no_review / depends_on）。 */
function makeTask(
  overrides: {
    id?: TaskId
    status?: TaskStatus
    no_review?: boolean
    depends_on?: TaskId[]
  } = {},
): TaskFrontmatter {
  return {
    id: overrides.id ?? 'TASK-001',
    title: '测试任务',
    status: overrides.status ?? 'running',
    layer: 'domain',
    depends_on: overrides.depends_on ?? [],
    allowed_paths: [],
    forbidden_paths: [],
    permissions: [],
    no_review: overrides.no_review ?? false,
    restart_on_retry: false,
    verification: [],
    context_pack: {
      required_docs: [],
      optional_doc_excerpts: [],
      source_files: [],
    },
    workflow_outputs: {
      result_file: 'docs/tasks/TASK-001-test.result.md',
    },
  }
}

/** 构造合法 ResultFrontmatter，默认 verification 全 passed（产物齐全）。 */
function makeResult(
  overrides: {
    task_id?: TaskId
    execution_status?: ExecutionStatus
    next_action?: NextAction
    verification?: ResultVerification[]
  } = {},
): ResultFrontmatter {
  return {
    task_id: overrides.task_id ?? 'TASK-001',
    execution_status: overrides.execution_status ?? 'completed',
    modified_files: [],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification:
      overrides.verification ??
      [{ command: 'npm run typecheck', result: 'passed', notes: '' }],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: overrides.next_action ?? 'review',
  }
}

/** 构造合法 ReviewFrontmatter，按需覆盖 review_result。 */
function makeReview(
  overrides: {
    task_id?: TaskId
    review_result?: ReviewResult
    required_changes?: string[]
  } = {},
): ReviewFrontmatter {
  return {
    task_id: overrides.task_id ?? 'TASK-001',
    review_result: overrides.review_result ?? 'approved',
    reviewer: 'reviewer-agent',
    reviewed_at: '2026-07-09T00:00:00Z',
    required_changes: overrides.required_changes ?? [],
    findings: [],
  }
}

/** 种入一个 running 任务 + 对应 orchestrator，返回 { orch, repo } 便于各用例定制。 */
function setup(task: TaskFrontmatter): {
  orch: StateOrchestrator
  repo: InMemoryRepo
} {
  const repo = new InMemoryRepo()
  repo.seedTask(task)
  return { orch: new StateOrchestrator(repo), repo }
}

/* ============================================================ *
 * transition：显式状态转移
 * ============================================================ */

describe('transition：显式状态转移', () => {
  it('合法转移写回 status（ready→running）', () => {
    const { orch, repo } = setup(makeTask({ id: 'TASK-001', status: 'ready' }))
    orch.transition('TASK-001', 'running', {
      no_review: false,
      confirmed: false,
    })
    expect(repo.readTask('TASK-001').status).toBe('running')
  })

  it('running→done 需 no_review:true（false 抛错、true 通过）', () => {
    const { orch, repo } = setup(
      makeTask({ id: 'TASK-001', status: 'running', no_review: false }),
    )
    expect(() =>
      orch.transition('TASK-001', 'done', { no_review: false, confirmed: false }),
    ).toThrowError(/no_review/)
    orch.transition('TASK-001', 'done', { no_review: true, confirmed: false })
    expect(repo.readTask('TASK-001').status).toBe('done')
  })

  it('表外非法转移抛错（done→running 不在 §7 流转表）', () => {
    const { orch, repo } = setup(makeTask({ id: 'TASK-001', status: 'done' }))
    expect(() =>
      orch.transition('TASK-001', 'running', {
        no_review: false,
        confirmed: false,
      }),
    ).toThrowError(/不在.*状态流转表/)
    // 抛错后 status 不变（writeTask 未被调用）
    expect(repo.readTask('TASK-001').status).toBe('done')
  })

  it('failed→ready 需 confirmed（未确认抛错）', () => {
    const { orch } = setup(makeTask({ id: 'TASK-001', status: 'failed' }))
    expect(() =>
      orch.transition('TASK-001', 'ready', {
        no_review: false,
        confirmed: false,
      }),
    ).toThrowError(/确认/)
  })

  it('写回时仅替换 status，其余 frontmatter 字段保留', () => {
    const { orch, repo } = setup(makeTask({ id: 'TASK-001', status: 'ready' }))
    orch.transition('TASK-001', 'running', {
      no_review: false,
      confirmed: false,
    })
    const after = repo.readTask('TASK-001')
    expect(after.id).toBe('TASK-001')
    expect(after.layer).toBe('domain')
    expect(after.no_review).toBe(false)
  })
})

/* ============================================================ *
 * applyResult：§10 execution_status × next_action 映射
 * ============================================================ */

describe('applyResult：completed 分支（含 no_review 三分）', () => {
  it('completed+review（no_review:false）→ reviewing', () => {
    const { orch, repo } = setup(makeTask({ status: 'running', no_review: false }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'completed', next_action: 'review' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('reviewing')
  })

  it('completed+review + no_review:true + 校验通过 → done（免审直 done）', () => {
    const { orch, repo } = setup(makeTask({ status: 'running', no_review: true }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'completed', next_action: 'review' }),
      { orchestratorVerified: true },
    )
    expect(repo.readTask('TASK-001').status).toBe('done')
  })

  it('completed+review + no_review:true + 校验未通过 → blocked（§7 改走）', () => {
    const { orch, repo } = setup(makeTask({ status: 'running', no_review: true }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'completed', next_action: 'review' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })

  it('completed+needs-human → blocked', () => {
    const { orch, repo } = setup(makeTask({ status: 'running' }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'completed', next_action: 'needs-human' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })
})

describe('applyResult：blocked / failed 分支', () => {
  it('blocked+needs-human → blocked', () => {
    const { orch, repo } = setup(makeTask({ status: 'running' }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'blocked', next_action: 'needs-human' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })

  it('blocked+retry → blocked（待确认后 → ready）', () => {
    const { orch, repo } = setup(makeTask({ status: 'running' }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'blocked', next_action: 'retry' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })

  it('failed+retry → failed', () => {
    const { orch, repo } = setup(makeTask({ status: 'running' }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'failed', next_action: 'retry' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('failed')
  })

  it('failed+needs-human → failed', () => {
    const { orch, repo } = setup(makeTask({ status: 'running' }))
    orch.applyResult(
      'TASK-001',
      makeResult({ execution_status: 'failed', next_action: 'needs-human' }),
      { orchestratorVerified: false },
    )
    expect(repo.readTask('TASK-001').status).toBe('failed')
  })
})

describe('applyResult：cancel 对任意 execution_status 一律 cancelled', () => {
  it.each(['completed', 'blocked', 'failed'] as ExecutionStatus[])(
    '%s + cancel → cancelled',
    (executionStatus) => {
      const { orch, repo } = setup(makeTask({ status: 'running' }))
      orch.applyResult(
        'TASK-001',
        makeResult({ execution_status: executionStatus, next_action: 'cancel' }),
        { orchestratorVerified: false },
      )
      expect(repo.readTask('TASK-001').status).toBe('cancelled')
    },
  )
})

describe('applyResult：§10 非法组合抛错（DEC-005 不静默）', () => {
  it('completed+retry 抛错', () => {
    const { orch } = setup(makeTask({ status: 'running' }))
    expect(() =>
      orch.applyResult(
        'TASK-001',
        makeResult({ execution_status: 'completed', next_action: 'retry' }),
        { orchestratorVerified: false },
      ),
    ).toThrowError(/非法组合/)
  })

  it('blocked+review 抛错', () => {
    const { orch } = setup(makeTask({ status: 'running' }))
    expect(() =>
      orch.applyResult(
        'TASK-001',
        makeResult({ execution_status: 'blocked', next_action: 'review' }),
        { orchestratorVerified: false },
      ),
    ).toThrowError(/非法组合/)
  })

  it('failed+review 抛错', () => {
    const { orch } = setup(makeTask({ status: 'running' }))
    expect(() =>
      orch.applyResult(
        'TASK-001',
        makeResult({ execution_status: 'failed', next_action: 'review' }),
        { orchestratorVerified: false },
      ),
    ).toThrowError(/非法组合/)
  })
})

/* ============================================================ *
 * applyReview：§15 review_result 映射
 * ============================================================ */

describe('applyReview：§15 固定映射（任务处于 reviewing）', () => {
  it('approved → done', () => {
    const { orch, repo } = setup(makeTask({ status: 'reviewing' }))
    orch.applyReview('TASK-001', makeReview({ review_result: 'approved' }))
    expect(repo.readTask('TASK-001').status).toBe('done')
  })

  it('rejected → rejected', () => {
    const { orch, repo } = setup(makeTask({ status: 'reviewing' }))
    orch.applyReview('TASK-001', makeReview({ review_result: 'rejected' }))
    expect(repo.readTask('TASK-001').status).toBe('rejected')
  })

  it('needs-human-confirmation → blocked', () => {
    const { orch, repo } = setup(makeTask({ status: 'reviewing' }))
    orch.applyReview(
      'TASK-001',
      makeReview({ review_result: 'needs-human-confirmation' }),
    )
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })
})

describe('applyReview：skipped 走 no_review 产物校验分支', () => {
  it('skipped + 产物齐全（verification 全 passed）→ done', () => {
    const { orch, repo } = setup(
      makeTask({ status: 'running', no_review: true }),
    )
    repo.seedResult(makeResult())
    orch.applyReview('TASK-001', makeReview({ review_result: 'skipped' }))
    expect(repo.readTask('TASK-001').status).toBe('done')
  })

  it('skipped + 产物不全（verification 含 failed）→ blocked', () => {
    const { orch, repo } = setup(
      makeTask({ status: 'running', no_review: true }),
    )
    repo.seedResult(
      makeResult({
        verification: [
          { command: 'npm run typecheck', result: 'passed', notes: '' },
          { command: 'npm test', result: 'failed', notes: '一处失败' },
        ],
      }),
    )
    orch.applyReview('TASK-001', makeReview({ review_result: 'skipped' }))
    expect(repo.readTask('TASK-001').status).toBe('blocked')
  })

  it('skipped 且无 .result.md → readResult 抛错（no_review 任务必须有产物）', () => {
    const { orch } = setup(makeTask({ status: 'running', no_review: true }))
    expect(() =>
      orch.applyReview('TASK-001', makeReview({ review_result: 'skipped' })),
    ).toThrowError(/结果文档不存在/)
  })
})

/* ============================================================ *
 * cascadeIfBlocked：§7 依赖级联
 * ============================================================ */

describe('cascadeIfBlocked：前置触发态 → 后继 blocked', () => {
  it('前置 failed，后继 running → blocked', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'failed' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'failed' }),
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
    ])
    expect(outcome.blocked).toEqual(['TASK-002'])
    expect(outcome.skipped).toEqual([])
    expect(repo.readTask('TASK-002').status).toBe('blocked')
  })

  it('前置 rejected，后继 reviewing → blocked', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'rejected' }))
    repo.seedTask(
      makeTask({
        id: 'TASK-002',
        status: 'reviewing',
        depends_on: ['TASK-001'],
      }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'rejected' }),
      makeTask({
        id: 'TASK-002',
        status: 'reviewing',
        depends_on: ['TASK-001'],
      }),
    ])
    expect(outcome.blocked).toEqual(['TASK-002'])
  })

  it('传递闭包：前置 failed，A←B←C 后继全级联', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'failed' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
    )
    repo.seedTask(
      makeTask({ id: 'TASK-003', status: 'running', depends_on: ['TASK-002'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'failed' }),
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-003', status: 'running', depends_on: ['TASK-002'] }),
    ])
    expect(outcome.blocked).toEqual(['TASK-002', 'TASK-003'])
  })

  it('前置非触发态（done）→ 空级联', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'done' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'ready', depends_on: ['TASK-001'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'done' }),
      makeTask({ id: 'TASK-002', status: 'ready', depends_on: ['TASK-001'] }),
    ])
    expect(outcome.blocked).toEqual([])
    expect(outcome.skipped).toEqual([])
  })

  it('前置 failed，后继 ready → skipped（状态机无 ready→blocked 边，ISS-006）', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'failed' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'ready', depends_on: ['TASK-001'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'failed' }),
      makeTask({ id: 'TASK-002', status: 'ready', depends_on: ['TASK-001'] }),
    ])
    expect(outcome.blocked).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0]?.id).toBe('TASK-002')
    // ready 后继未被写回（status 不变）
    expect(repo.readTask('TASK-002').status).toBe('ready')
  })

  it('前置 failed，后继已 done → skipped（done→blocked 需 confirmed）', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'failed' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'done', depends_on: ['TASK-001'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'failed' }),
      makeTask({ id: 'TASK-002', status: 'done', depends_on: ['TASK-001'] }),
    ])
    expect(outcome.blocked).toEqual([])
    expect(outcome.skipped[0]?.id).toBe('TASK-002')
  })

  it('多后继混合：running blocked + ready skipped', () => {
    const repo = new InMemoryRepo()
    repo.seedTask(makeTask({ id: 'TASK-001', status: 'failed' }))
    repo.seedTask(
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
    )
    repo.seedTask(
      makeTask({ id: 'TASK-003', status: 'ready', depends_on: ['TASK-001'] }),
    )
    const orch = new StateOrchestrator(repo)
    const outcome = orch.cascadeIfBlocked('TASK-001', [
      makeTask({ id: 'TASK-001', status: 'failed' }),
      makeTask({ id: 'TASK-002', status: 'running', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-003', status: 'ready', depends_on: ['TASK-001'] }),
    ])
    expect(outcome.blocked).toEqual(['TASK-002'])
    expect(outcome.skipped.map((s) => s.id)).toEqual(['TASK-003'])
  })

  it('taskId 不在集合 → 抛错', () => {
    const { orch } = setup(makeTask({ id: 'TASK-001', status: 'failed' }))
    expect(() => orch.cascadeIfBlocked('TASK-999', [])).toThrowError(
      /不在任务集合/,
    )
  })
})
