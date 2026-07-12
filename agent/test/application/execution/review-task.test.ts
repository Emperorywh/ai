import { describe, expect, it } from 'vitest'
import type { TaskDocRepositoryPort } from '../../../src/application/ports.js'
import type {
  ReviewInput,
  ReviewOutcome,
  TaskReviewerPort,
} from '../../../src/application/execution/ports.js'
import {
  ReviewTaskUseCase,
  type ReviewTaskPorts,
} from '../../../src/application/execution/review-task.js'
import type {
  ExecutionStatus,
  NextAction,
  ResultFrontmatter,
  ResultVerification,
  ReviewFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 内存 fake：TaskDocRepositoryPort（复用 execute-task 测试模式，无 fs / git / SDK）
 * ============================================================ */

/**
 * 内存 fake 仓储：实现 TaskDocRepositoryPort，聚焦用例编排逻辑（不依赖 fs / git / SDK）。
 * 主仓储（taskRepo）承载任务状态权威 + .review.md 落点；worktree 仓储（openWorktreeRepo 返回）
 * 承载 .result.md 产物——双仓储事实位置经 Ports 显式区分（§12 风险点）。
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
    if (!this.tasks.has(task.id)) throw new Error(`任务文档不存在：${task.id}`)
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

/** 提取 TASK-XXX 的数字部分。 */
function taskIdNum(id: TaskId): number {
  return Number(id.replace('TASK-', ''))
}

/* ============================================================ *
 * 夹具：TaskFrontmatter / ResultFrontmatter / fake reviewer
 * ============================================================ */

/** 构造合法 TaskFrontmatter（默认 reviewing / page;slug = `<id>-<name>`）。 */
function makeTask(opts: {
  id: TaskId
  name: string
  status?: TaskStatus
  noReview?: boolean
}): TaskFrontmatter {
  const slug = `${opts.id}-${opts.name}`
  return {
    id: opts.id,
    title: slug,
    status: opts.status ?? 'reviewing',
    layer: 'page',
    depends_on: [],
    allowed_paths: ['src/x.ts'],
    forbidden_paths: [],
    permissions: [],
    no_review: opts.noReview ?? false,
    restart_on_retry: false,
    verification: ['npm run typecheck'],
    context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
    workflow_outputs: { result_file: `docs/tasks/${slug}.result.md` },
  }
}

/** 构造合法 ResultFrontmatter（默认 completed + review;failed 控制验证是否失败）。 */
function makeResult(opts: {
  taskId: TaskId
  executionStatus?: ExecutionStatus
  nextAction?: NextAction
  verification?: ResultVerification[]
}): ResultFrontmatter {
  return {
    task_id: opts.taskId,
    execution_status: opts.executionStatus ?? 'completed',
    modified_files: [],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: opts.verification ?? [
      { command: 'npm run typecheck', result: 'passed', notes: 'fake 通过' },
    ],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: opts.nextAction ?? 'review',
  }
}

/** fake Reviewer：产出指定审查结论，并捕获收到的 ReviewInput（断言审查入参）。 */
function fakeReviewer(
  reviewResult: 'approved' | 'rejected' | 'needs-human-confirmation',
  captured: { input?: ReviewInput } = {},
): TaskReviewerPort {
  return {
    name: 'fake-reviewer',
    async review(input: ReviewInput): Promise<ReviewOutcome> {
      captured.input = input
      return {
        review_result: reviewResult,
        required_changes: reviewResult === 'approved' ? [] : ['必须修改 X'],
        findings: ['发现 Y'],
      }
    },
  }
}

/* ============================================================ *
 * 装配：构造用例 + fake Ports（mainRepo 状态权威 + .review.md 落点 / worktreeRepo 读 result）
 * ============================================================ */

/**
 * 装配一个可定制的 ReviewTaskUseCase + 观测句柄。
 *
 * mainRepo 预 seed 任务（status=reviewing，状态权威 + .review.md 落点）；
 * worktreeRepo 预 seed result（.result.md 产物所在）。返回 mainRepo / worktreeRepo / captured
 * 供断言状态映射、.review.md 落点、result 读取位置、reviewer 入参。
 */
function setup(opts: {
  task: TaskFrontmatter
  result?: ResultFrontmatter
  reviewer: TaskReviewerPort
}): {
  useCase: ReviewTaskUseCase
  mainRepo: InMemoryRepo
  worktreeRepo: InMemoryRepo
} {
  const mainRepo = new InMemoryRepo()
  mainRepo.seedTask(opts.task)

  const worktreeRepo = new InMemoryRepo()
  worktreeRepo.seedResult(opts.result ?? makeResult({ taskId: opts.task.id }))

  const ports: ReviewTaskPorts = {
    taskRepo: mainRepo,
    reviewer: opts.reviewer,
    openWorktreeRepo: () => worktreeRepo,
  }

  return { useCase: new ReviewTaskUseCase(ports), mainRepo, worktreeRepo }
}

/* ============================================================ *
 * 三种审查结论映射状态（§15 固定映射）
 * ============================================================ */

describe('ReviewTaskUseCase — 三种审查结论映射状态', () => {
  it('approved → done（reviewer 审查 + 写 .review.md + applyReview）', async () => {
    const task = makeTask({ id: 'TASK-601', name: 'approve' })
    const { useCase, mainRepo } = setup({ task, reviewer: fakeReviewer('approved') })

    const outcome = await useCase.review({ taskId: 'TASK-601', worktreePath: '/wt/TASK-601' })

    expect(outcome.reviewResult).toBe('approved')
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.reviewer).toBe('fake-reviewer')
    expect(mainRepo.readTask('TASK-601').status).toBe('done')
    // .review.md 落在 main 仓储（审查结论与执行事实分离，§5.3）。
    expect(mainRepo.readReview('TASK-601').review_result).toBe('approved')
  })

  it('rejected → rejected（不进 done，.review.md 记录结论）', async () => {
    const task = makeTask({ id: 'TASK-602', name: 'reject' })
    const { useCase, mainRepo } = setup({ task, reviewer: fakeReviewer('rejected') })

    const outcome = await useCase.review({ taskId: 'TASK-602', worktreePath: '/wt/TASK-602' })

    expect(outcome.reviewResult).toBe('rejected')
    expect(outcome.finalStatus).toBe('rejected')
    expect(mainRepo.readTask('TASK-602').status).toBe('rejected')
    expect(mainRepo.readReview('TASK-602').required_changes).toEqual(['必须修改 X'])
  })

  it('needs-human-confirmation → blocked', async () => {
    const task = makeTask({ id: 'TASK-603', name: 'needshuman' })
    const { useCase, mainRepo } = setup({
      task,
      reviewer: fakeReviewer('needs-human-confirmation'),
    })

    const outcome = await useCase.review({ taskId: 'TASK-603', worktreePath: '/wt/TASK-603' })

    expect(outcome.reviewResult).toBe('needs-human-confirmation')
    expect(outcome.finalStatus).toBe('blocked')
    expect(mainRepo.readTask('TASK-603').status).toBe('blocked')
  })
})

/* ============================================================ *
 * no_review skipped 路径（§15：Orchestrator 生成 skipped + 产物校验）
 * ============================================================ */

describe('ReviewTaskUseCase — no_review skipped 路径', () => {
  it('no_review + 产物校验通过 → skipped（orchestrator）→ done，不调 Reviewer', async () => {
    const task = makeTask({ id: 'TASK-611', name: 'noreview-ok', noReview: true })
    // 用一个必被调用的 fake reviewer 断言「no_review 不调 Reviewer」。
    const reviewer: TaskReviewerPort = {
      name: 'should-not-be-called',
      async review() {
        throw new Error('no_review 任务不应调用 Reviewer')
      },
    }
    const { useCase, mainRepo } = setup({ task, reviewer })

    const outcome = await useCase.review({ taskId: 'TASK-611', worktreePath: '/wt/TASK-611' })

    expect(outcome.reviewResult).toBe('skipped')
    expect(outcome.reviewer).toBe('orchestrator')
    expect(outcome.finalStatus).toBe('done')
    expect(mainRepo.readTask('TASK-611').status).toBe('done')
  })

  it('no_review + 产物校验未通过（verification 含 failed）→ skipped → blocked', async () => {
    const task = makeTask({ id: 'TASK-612', name: 'noreview-fail', noReview: true })
    const result = makeResult({
      taskId: 'TASK-612',
      verification: [{ command: 'npm run typecheck', result: 'failed', notes: 'fake 失败' }],
    })
    const { useCase, mainRepo } = setup({
      task,
      result,
      reviewer: {
        name: 'should-not-be-called',
        async review() {
          throw new Error('no_review 任务不应调用 Reviewer')
        },
      },
    })

    const outcome = await useCase.review({ taskId: 'TASK-612', worktreePath: '/wt/TASK-612' })

    expect(outcome.reviewResult).toBe('skipped')
    expect(outcome.finalStatus).toBe('blocked')
    expect(mainRepo.readTask('TASK-612').status).toBe('blocked')
  })
})

/* ============================================================ *
 * main / worktree 仓储显式区分（§12 风险点）
 * ============================================================ */

describe('ReviewTaskUseCase — main / worktree 仓储显式区分（§12）', () => {
  it('.result.md 从 worktree 仓储读;main 仓储无 result', async () => {
    const task = makeTask({ id: 'TASK-621', name: 'isolate' })
    const { useCase, mainRepo, worktreeRepo } = setup({
      task,
      reviewer: fakeReviewer('approved'),
    })

    const outcome = await useCase.review({ taskId: 'TASK-621', worktreePath: '/wt/TASK-621' })

    // outcome.result 来自 worktree 仓储（readResult）。
    expect(outcome.result.task_id).toBe('TASK-621')
    expect(worktreeRepo.readResult('TASK-621').task_id).toBe('TASK-621')
    // main 仓储无 result（尚未合并入 main）。
    expect(() => mainRepo.readResult('TASK-621')).toThrow(/结果文档不存在/)
  })

  it('reviewer.review 收到正确的 ReviewInput（result / worktree_path / result_file）', async () => {
    const task = makeTask({ id: 'TASK-622', name: 'input' })
    const captured: { input?: ReviewInput } = {}
    const { useCase } = setup({ task, reviewer: fakeReviewer('approved', captured) })

    await useCase.review({ taskId: 'TASK-622', worktreePath: '/wt/TASK-622' })

    expect(captured.input).toBeDefined()
    expect(captured.input?.task_id).toBe('TASK-622')
    expect(captured.input?.worktree_path).toBe('/wt/TASK-622')
    expect(captured.input?.result_file).toBe('docs/tasks/TASK-622-input.result.md')
    expect(captured.input?.result.task_id).toBe('TASK-622')
  })
})

/* ============================================================ *
 * 状态前置 + outcome 携带 finalize 所需契约
 * ============================================================ */

describe('ReviewTaskUseCase — 状态前置 + outcome 契约', () => {
  it('任务非 reviewing（如 ready）→ 拒绝审查', async () => {
    const task = makeTask({ id: 'TASK-631', name: 'notready', status: 'ready' })
    const { useCase } = setup({ task, reviewer: fakeReviewer('approved') })

    await expect(
      useCase.review({ taskId: 'TASK-631', worktreePath: '/wt/TASK-631' }),
    ).rejects.toThrow(/应为 reviewing 才能审查/)
  })

  it('outcome 携带 task / result / worktreePath，可直接喂给 FinalizeTaskUseCase', async () => {
    const task = makeTask({ id: 'TASK-641', name: 'chain' })
    const { useCase } = setup({ task, reviewer: fakeReviewer('approved') })

    const outcome = await useCase.review({ taskId: 'TASK-641', worktreePath: '/wt/TASK-641' })

    // done 路径：CLI / Orchestrator 用 outcome.task / result / worktreePath 喂 FinalizeTaskUseCase。
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.task.id).toBe('TASK-641')
    expect(outcome.task.workflow_outputs.result_file).toBe('docs/tasks/TASK-641-chain.result.md')
    expect(outcome.result.task_id).toBe('TASK-641')
    expect(outcome.worktreePath).toBe('/wt/TASK-641')
  })
})
