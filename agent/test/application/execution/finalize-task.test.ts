import { describe, expect, it } from 'vitest'
import type {
  GitMergePort,
  GlobalDocRepositoryPort,
  TaskDocRepositoryPort,
} from '../../../src/application/ports.js'
import type { IdAllocator } from '../../../src/application/merge/section-writeback.js'
import {
  FinalizeTaskUseCase,
  type FinalizeTaskPorts,
} from '../../../src/application/execution/finalize-task.js'
import type {
  Decision,
  ExecutionCommit,
  GlobalUpdateRequests,
  Issue,
  IssueSeverity,
  ProgressUpdateRequest,
  ResultFrontmatter,
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
 * 主仓储（taskRepo）与 worktree 仓储（openWorktreeRepo 返回）各持一份，模拟「main 状态权威 +
 * worktree 产物」双仓储事实位置（§12 显式区分）。
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
 * 内存 fake：GitMergePort（merged / conflict 两态）
 * ============================================================ */

/**
 * 内存 fake GitMergePort：listConflicts 控制合并成功 / 冲突（不依赖真实 git）。
 * 冲突态返回固定冲突清单；成功态 collectPostRebaseCommits 返回空（回填 execution_commits=[]）。
 */
function fakeGitMerge(conflicts: readonly string[]): GitMergePort {
  return {
    rebaseOnto: () => undefined,
    fastForwardMain: () => undefined,
    collectPostRebaseCommits: (): ExecutionCommit[] => [],
    commitAuditResult: () => undefined,
    branchMerged: () => false,
    abortOrCleanRebase: () => undefined,
    listConflicts: () => [...conflicts],
  }
}

/* ============================================================ *
 * 内存 fake：GlobalDocRepositoryPort（捕获 progress / decisions / issues 回写）
 * ============================================================ */

/**
 * 内存 fake 全局文档仓储：捕获 applyProgressUpdate / appendDecision / appendIssue 调用，
 * 供断言「合并成功 → 全局回写」「冲突 → 落 ISSUES」单一业务入口（任务 §11）。
 */
class InMemoryGlobalRepo implements GlobalDocRepositoryPort {
  progressUpdates: ProgressUpdateRequest[] = []
  appendedDecisions: Decision[] = []
  appendedIssues: Issue[] = []
  private docs: Record<'progress' | 'decisions' | 'issues', string> = {
    progress: '',
    decisions: '',
    issues: '',
  }

  readGlobalDoc(name: 'progress' | 'decisions' | 'issues'): string {
    return this.docs[name]
  }
  writeGlobalDoc(name: 'progress' | 'decisions' | 'issues', content: string): void {
    this.docs[name] = content
  }
  applyProgressUpdate(_doc: string, update: ProgressUpdateRequest): string {
    this.progressUpdates.push(update)
    return ''
  }
  appendDecision(_doc: string, decision: Decision): string {
    this.appendedDecisions.push(decision)
    return ''
  }
  appendIssue(_doc: string, issue: Issue): string {
    this.appendedIssues.push(issue)
    return ''
  }
  readDecisions(): Decision[] {
    return []
  }
  readIssues(): Issue[] {
    return []
  }
}

/** 顺序 id 分配器（DEC / ISS，与 cli sequentialIdAllocator 同构）。 */
function fakeIdAllocator(): IdAllocator {
  let dec = 0
  let iss = 0
  return {
    nextDecisionId: () => `DEC-${String(++dec).padStart(3, '0')}`,
    nextIssueId: () => `ISS-${String(++iss).padStart(3, '0')}`,
  }
}

/* ============================================================ *
 * 夹具：TaskFrontmatter / ResultFrontmatter 构造
 * ============================================================ */

/** 构造合法 TaskFrontmatter（默认 done / page;slug = `<id>-<name>`）。 */
function makeTask(opts: {
  id: TaskId
  name: string
  status?: TaskStatus
  noReview?: boolean
  updates?: GlobalUpdateRequests
}): TaskFrontmatter {
  const slug = `${opts.id}-${opts.name}`
  return {
    id: opts.id,
    title: slug,
    status: opts.status ?? 'done',
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

/** 构造合法 ResultFrontmatter（默认 completed + 含一条 progress 回写请求）。 */
function makeResult(opts: {
  taskId: TaskId
  updates?: GlobalUpdateRequests
}): ResultFrontmatter {
  return {
    task_id: opts.taskId,
    execution_status: 'completed',
    modified_files: [],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: [],
    global_update_requests:
      opts.updates ?? { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
}

/* ============================================================ *
 * 装配：构造用例 + fake Ports（mainRepo 状态权威 / worktreeRepo 合并读 result）
 * ============================================================ */

/**
 * 装配一个可定制的 FinalizeTaskUseCase + 观测句柄。
 *
 * mainRepo 预 seed 任务（status=done，finalizer 冲突时 done→blocked 写回这里）；
 * worktreeRepo 预 seed result（合并 rebaseAndFastForward 经 docs.readResult 读这里）。
 * 返回 globalRepo / syncCalls 供断言回写 + 主工作区同步。
 */
function setup(opts: {
  task: TaskFrontmatter
  result?: ResultFrontmatter
  conflicts?: readonly string[]
}): {
  useCase: FinalizeTaskUseCase
  mainRepo: InMemoryRepo
  worktreeRepo: InMemoryRepo
  globalRepo: InMemoryGlobalRepo
  syncCalls: string[]
} {
  const mainRepo = new InMemoryRepo()
  mainRepo.seedTask(opts.task)

  const worktreeRepo = new InMemoryRepo()
  worktreeRepo.seedResult(opts.result ?? makeResult({ taskId: opts.task.id }))

  const globalRepo = new InMemoryGlobalRepo()
  const syncCalls: string[] = []
  const idAllocator = fakeIdAllocator()

  const ports: FinalizeTaskPorts = {
    taskRepo: mainRepo,
    gitMerge: fakeGitMerge(opts.conflicts ?? []),
    globalDocRepo: globalRepo,
    idAllocator,
    openWorktreeRepo: () => worktreeRepo,
    syncMainFile: (resultFileRel) => {
      syncCalls.push(resultFileRel)
    },
  }

  return { useCase: new FinalizeTaskUseCase(ports), mainRepo, worktreeRepo, globalRepo, syncCalls }
}

/* ============================================================ *
 * 合并成功路径
 * ============================================================ */

describe('FinalizeTaskUseCase — 合并成功路径', () => {
  it('rebase+ff 成功 → merged=true，全局回写 + 主工作区同步', () => {
    const task = makeTask({ id: 'TASK-501', name: 'ok' })
    const result = makeResult({
      taskId: 'TASK-501',
      updates: {
        progress: [{ section: '当前阶段', mode: 'replace', content: '新阶段内容' }],
        decisions: [],
        issues: [],
      },
    })
    const { useCase, mainRepo, globalRepo, syncCalls } = setup({ task, result })

    const outcome = useCase.finalize({
      taskId: 'TASK-501',
      mainRef: 'main',
      worktreePath: '/fake/worktrees/TASK-501',
      task,
      result,
    })

    expect(outcome.merged).toBe(true)
    expect(outcome.conflicts).toEqual([])
    expect(outcome.taskId).toBe('TASK-501')
    // 合并成功不改变状态（done 保持 done）。
    expect(mainRepo.readTask('TASK-501').status).toBe('done')
    // 全局文档 section 回写：progress 请求已 apply（§3.2 串行回写）。
    expect(globalRepo.progressUpdates).toHaveLength(1)
    expect(globalRepo.progressUpdates[0]?.section).toBe('当前阶段')
    // 主工作区结果文件已同步（syncMainFile 注入回调被调用）。
    expect(syncCalls).toEqual(['docs/tasks/TASK-501-ok.result.md'])
  })

  it('合并的 docs port 路由到 worktree 仓储（readResult 从 worktree 读，§12 显式区分）', () => {
    const task = makeTask({ id: 'TASK-502', name: 'route' })
    const result = makeResult({ taskId: 'TASK-502' })
    const { useCase, mainRepo, worktreeRepo } = setup({ task, result })

    useCase.finalize({
      taskId: 'TASK-502',
      mainRef: 'main',
      worktreePath: '/fake/worktrees/TASK-502',
      task,
      result,
    })

    // main 仓储无 result（未 seed）；worktree 仓储有 result（合并 readResult 来源）。
    expect(() => mainRepo.readResult('TASK-502')).toThrow(/结果文档不存在/)
    expect(worktreeRepo.readResult('TASK-502').task_id).toBe('TASK-502')
  })
})

/* ============================================================ *
 * 合并冲突路径
 * ============================================================ */

describe('FinalizeTaskUseCase — 合并冲突路径', () => {
  it('rebase 冲突 → merged=false + done→blocked + 落 ISSUES（单一业务入口）', () => {
    const task = makeTask({ id: 'TASK-510', name: 'conflict' })
    const result = makeResult({ taskId: 'TASK-510' })
    const { useCase, mainRepo, globalRepo, syncCalls } = setup({
      task,
      result,
      conflicts: ['src/conflicting.ts', 'docs/PROGRESS.md'],
    })

    const outcome = useCase.finalize({
      taskId: 'TASK-510',
      mainRef: 'main',
      worktreePath: '/fake/worktrees/TASK-510',
      task,
      result,
    })

    expect(outcome.merged).toBe(false)
    expect(outcome.conflicts).toEqual(['src/conflicting.ts', 'docs/PROGRESS.md'])
    // done → blocked（StateOrchestrator confirmed）。
    expect(mainRepo.readTask('TASK-510').status).toBe('blocked')
    // 冲突登记进 ISSUES（§3.2 / §8 不静默）。
    expect(globalRepo.appendedIssues).toHaveLength(1)
    const issue = globalRepo.appendedIssues[0]!
    expect(issue.title).toContain('TASK-510')
    expect(issue.title).toContain('合并冲突')
    expect(issue.recommended_action).toContain('src/conflicting.ts')
    expect(issue.recommended_action).toContain('docs/PROGRESS.md')
    // 冲突不合并 → 不触发全局 progress 回写 + 主工作区同步。
    expect(globalRepo.progressUpdates).toHaveLength(0)
    expect(syncCalls).toHaveLength(0)
  })

  it('no_review 任务冲突 → done→blocked 转移上下文带 no_review=true', () => {
    const task = makeTask({ id: 'TASK-511', name: 'noreview-conflict', noReview: true })
    const result = makeResult({ taskId: 'TASK-511' })
    const { useCase, mainRepo } = setup({
      task,
      result,
      conflicts: ['src/x.ts'],
    })

    const outcome = useCase.finalize({
      taskId: 'TASK-511',
      mainRef: 'main',
      worktreePath: '/fake/worktrees/TASK-511',
      task,
      result,
    })

    // done→blocked 合法（no_review 不影响该转移），冲突登记后状态=blocked。
    expect(outcome.merged).toBe(false)
    expect(mainRepo.readTask('TASK-511').status).toBe('blocked')
  })
})

/* ============================================================ *
 * 可被 Orchestrator 直接调用（任务 §11 / SPEC §20.4）
 * ============================================================ */

describe('FinalizeTaskUseCase — 可被 SerialTaskOrchestrator 直接调用', () => {
  it('构造注入 Ports 后单次 finalize 调用即可完成合并回收（无 CLI 依赖）', () => {
    const task = makeTask({ id: 'TASK-520', name: 'orch' })
    const result = makeResult({ taskId: 'TASK-520' })
    const { useCase } = setup({ task, result })

    // Orchestrator 等价调用：直接构造用例 + 喂入结构化输入（task / result / worktreePath）。
    const outcome = useCase.finalize({
      taskId: 'TASK-520',
      mainRef: 'main',
      worktreePath: '/wt/TASK-520',
      task,
      result,
    })

    expect(outcome.merged).toBe(true)
    expect(outcome.taskId).toBe('TASK-520')
  })

  it('合并回写全局文档含 decisions / issues 提议项（idAllocator 分配 DEC/ISS）', () => {
    const task = makeTask({ id: 'TASK-521', name: 'writeback' })
    const result = makeResult({
      taskId: 'TASK-521',
      updates: {
        progress: [],
        decisions: [
          {
            id: '',
            title: '决策 A',
            status: 'accepted',
            scope: 'architecture',
            created_from_task: 'TASK-521',
            decision: '决定 X',
            rationale: '理由 Y',
            consequences: '后果 Z',
          },
        ],
        issues: [
          {
            id: '',
            title: '问题 B',
            status: 'open',
            severity: 'medium' as IssueSeverity,
            scope: 'TASK-521',
            created_from_task: 'TASK-521',
            owner: '',
            recommended_action: '建议 C',
          },
        ],
      },
    })
    const { useCase, globalRepo } = setup({ task, result })

    const outcome = useCase.finalize({
      taskId: 'TASK-521',
      mainRef: 'main',
      worktreePath: '/wt/TASK-521',
      task,
      result,
    })

    expect(outcome.merged).toBe(true)
    // decisions / issues 经 idAllocator 分配后 append（DEC-001 / ISS-001）。
    expect(globalRepo.appendedDecisions).toHaveLength(1)
    expect(globalRepo.appendedDecisions[0]!.id).toBe('DEC-001')
    expect(globalRepo.appendedIssues).toHaveLength(1)
    expect(globalRepo.appendedIssues[0]!.id).toBe('ISS-001')
  })
})
