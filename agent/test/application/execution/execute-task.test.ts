import { describe, expect, it } from 'vitest'
import type { TaskDocRepositoryPort, WorktreePort } from '../../../src/application/ports.js'
import type {
  ExecuteInput,
  TaskExecutorPort,
} from '../../../src/application/execution/ports.js'
import {
  ExecuteTaskUseCase,
  type ExecuteTaskPorts,
} from '../../../src/application/execution/execute-task.js'
import type {
  ExecutionStatus,
  NextAction,
  Permission,
  ResultFrontmatter,
  ResultVerification,
  ReviewFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
  TestingCommand,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 内存 fake：TaskDocRepositoryPort（复用 state-orchestrator 测试模式，无 fs / frontmatter 序列化）
 * ============================================================ */

/**
 * 内存 fake 仓储：实现 TaskDocRepositoryPort，聚焦用例编排逻辑（不依赖 fs / git / SDK）。
 * 读取缺失即抛「文档不存在」错（对齐 DEC-008 稳定契约，供 readDependencyResults 容错分支覆盖）。
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

/** 提取 TASK-XXX 的数字部分（与 TaskDocRepository.listTasks 一致）。 */
function taskIdNum(id: TaskId): number {
  return Number(id.replace('TASK-', ''))
}

/**
 * 内存 fake WorktreePort：create 返回标记路径（不真的建目录 / 不依赖 git）。
 * 记录 create 调用以断言「路径冲突 / 依赖未完成在 worktree 创建前失败」。
 */
class FakeWorktree implements WorktreePort {
  readonly createCalls: Array<{ mainRef: string; taskId: TaskId }> = []
  create(mainRef: string, taskId: TaskId): string {
    this.createCalls.push({ mainRef, taskId })
    return `/fake/worktrees/${taskId}`
  }
  reset(): void {
    /* 用例不触发 reset */
  }
  retain(): void {
    /* 用例不触发 retain */
  }
  remove(): void {
    /* 用例不触发 remove */
  }
}

/* ============================================================ *
 * 夹具：TaskFrontmatter / ResultFrontmatter 构造
 * ============================================================ */

/** 构造合法 TaskFrontmatter（默认 ready / page / 非免审，slug = `<id>-<name>`）。 */
function makeTask(opts: {
  id: TaskId
  name: string
  status?: TaskStatus
  noReview?: boolean
  dependsOn?: TaskId[]
  allowedPaths?: string[]
  forbiddenPaths?: string[]
  permissions?: Permission[]
  sourceFiles?: string[]
  verification?: string[]
}): TaskFrontmatter {
  const slug = `${opts.id}-${opts.name}`
  return {
    id: opts.id,
    title: slug,
    status: opts.status ?? 'ready',
    layer: 'page',
    depends_on: opts.dependsOn ?? [],
    allowed_paths: opts.allowedPaths ?? ['src/x.ts'],
    forbidden_paths: opts.forbiddenPaths ?? [],
    permissions: opts.permissions ?? [],
    no_review: opts.noReview ?? false,
    restart_on_retry: false,
    verification: opts.verification ?? ['npm run typecheck'],
    context_pack: {
      required_docs: [],
      optional_doc_excerpts: [],
      source_files: opts.sourceFiles ?? [],
    },
    workflow_outputs: { result_file: `docs/tasks/${slug}.result.md` },
  }
}

/** 构造合法 ResultFrontmatter（默认 completed + review + verification 全过）。 */
function makeResult(opts: {
  taskId: TaskId
  executionStatus?: ExecutionStatus
  nextAction?: NextAction
  verification?: ResultVerification[]
  modifiedFiles?: string[]
  createdFiles?: string[]
}): ResultFrontmatter {
  return {
    task_id: opts.taskId,
    execution_status: opts.executionStatus ?? 'completed',
    modified_files: opts.modifiedFiles ?? [],
    created_files: opts.createdFiles ?? [],
    deleted_files: [],
    execution_commits: [],
    verification: opts.verification ?? [],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: opts.nextAction ?? 'review',
  }
}

/** 项目级验证命令声明（layer=page 适用 typecheck / test / lint）。 */
const PAGE_TESTING_COMMANDS: readonly TestingCommand[] = [
  { command: 'npm run typecheck', layers: ['type', 'domain', 'page'] },
  { command: 'npm test', layers: ['type', 'domain', 'page'] },
  { command: 'npm run lint', layers: ['page'] },
]

/* ============================================================ *
 * 装配：构造用例 + fake Ports（worktreeRepo 与 executor 闭包共享，模拟「Executor 写 → worktree 仓储读」）
 * ============================================================ */

/**
 * 装配一个可定制的 ExecuteTaskUseCase + 观测句柄。
 *
 * worktreeRepo 预先 seed 任务副本（模拟 worktree 基线 = main 拷贝）；fake executor 执行时把
 * result seed 进同一 worktreeRepo，用例经 openWorktreeRepo 读取——覆盖 §11「result 由 worktree
 * 仓储读取」。返回 capturedInput / prepareCalls / worktree 供断言。
 */
function setup(opts: {
  task: TaskFrontmatter
  extraTasks?: TaskFrontmatter[]
  extraResults?: ResultFrontmatter[]
  resultForTask?: ResultFrontmatter
  prepareFails?: boolean
}): {
  useCase: ExecuteTaskUseCase
  mainRepo: InMemoryRepo
  worktree: FakeWorktree
  capturedInput: { value?: ExecuteInput }
  prepareCalls: Array<{ wtPath: string; permissions: readonly Permission[] }>
} {
  const mainRepo = new InMemoryRepo()
  mainRepo.seedTask(opts.task)
  for (const t of opts.extraTasks ?? []) mainRepo.seedTask(t)
  for (const r of opts.extraResults ?? []) mainRepo.seedResult(r)

  // worktree 仓储:基线任务副本 + executor 将 seed 的 result(同一实例,模拟 worktree 内读写)。
  const worktreeRepo = new InMemoryRepo()
  worktreeRepo.seedTask(opts.task)

  const capturedInput: { value?: ExecuteInput } = {}
  const prepareCalls: Array<{ wtPath: string; permissions: readonly Permission[] }> = []

  const executor: TaskExecutorPort = {
    name: 'fake-executor',
    async execute(input) {
      capturedInput.value = input
      // Executor 产出 .result.md(经 worktree 仓储模拟):把 result seed 进 worktreeRepo。
      worktreeRepo.seedResult(opts.resultForTask ?? makeResult({ taskId: input.task_id }))
      return { result_file: input.result_file, execution_status: 'completed' }
    },
  }

  const ports: ExecuteTaskPorts = {
    taskRepo: mainRepo,
    worktree: new FakeWorktree(),
    executor,
    openWorktreeRepo: () => worktreeRepo,
    prepareWorktree: (wtPath, permissions) => {
      prepareCalls.push({ wtPath, permissions })
      if (opts.prepareFails) throw new Error('R7 工作区准备失败(fake)')
    },
  }

  return {
    useCase: new ExecuteTaskUseCase(ports),
    mainRepo,
    worktree: ports.worktree as FakeWorktree,
    capturedInput,
    prepareCalls,
  }
}

/* ============================================================ *
 * reviewing 路径(普通任务,不合并)
 * ============================================================ */

describe('ExecuteTaskUseCase — reviewing 路径(普通任务 completed+review)', () => {
  it('ready→running→reviewing,worktree 创建 + Executor 执行 + result 读自 worktree 仓储', async () => {
    const task = makeTask({ id: 'TASK-401', name: 'review', noReview: false })
    const { useCase, mainRepo, worktree } = setup({ task })

    const outcome = await useCase.execute({
      taskId: 'TASK-401',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    // 普通任务 completed+review → reviewing(用例不合并,无合并代码)。
    expect(outcome.finalStatus).toBe('reviewing')
    expect(outcome.taskId).toBe('TASK-401')
    expect(outcome.executor).toBe('fake-executor')
    // worktree 已创建。
    expect(worktree.createCalls).toHaveLength(1)
    expect(worktree.createCalls[0]).toEqual({ mainRef: 'main', taskId: 'TASK-401' })
    // 状态由 main 仓储维护(§11):applyResult 写回 main。
    expect(mainRepo.readTask('TASK-401').status).toBe('reviewing')
    expect(outcome.worktreePath).toBe('/fake/worktrees/TASK-401')
  })

  it('Executor 接收正确的 ExecuteInput(worktree_path / result_file / context_pack / permission_boundary / startup_prompt)', async () => {
    const task = makeTask({ id: 'TASK-402', name: 'input', noReview: false })
    const { useCase, capturedInput } = setup({ task })

    await useCase.execute({
      taskId: 'TASK-402',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    const input = capturedInput.value
    expect(input).toBeDefined()
    expect(input?.task_id).toBe('TASK-402')
    expect(input?.worktree_path).toBe('/fake/worktrees/TASK-402')
    // result_file = join(worktree_path, result_file_rel)(Windows 下分隔符被规范化为 \)。
    expect(input?.result_file).toContain('TASK-402-input.result.md')
    // permission_boundary 来自任务声明(无重叠 → 直接透传)。
    expect(input?.permission_boundary.allowed_paths).toEqual(['src/x.ts'])
    expect(input?.permission_boundary.forbidden_paths).toEqual([])
    // verification_commands 由 layer(page)裁剪项目级命令 + 任务级并集。
    expect(input?.permission_boundary.verification_commands.map((c) => c.command)).toEqual(
      expect.arrayContaining(['npm run typecheck', 'npm test', 'npm run lint']),
    )
    // startup_prompt(§18)含任务文件路径。
    expect(input?.startup_prompt).toContain('docs/tasks/TASK-402-input.md')
    expect(input?.startup_prompt).toContain('docs/tasks/TASK-402-input.result.md')
  })
})

/* ============================================================ *
 * done / blocked 路径(no_review,由产物校验决定)
 * ============================================================ */

describe('ExecuteTaskUseCase — no_review 路径(产物校验三分)', () => {
  it('no_review + verification 全过 → done(orchestratorVerified=true)', async () => {
    const task = makeTask({ id: 'TASK-410', name: 'done', noReview: true })
    const result = makeResult({ taskId: 'TASK-410' }) // verification=[]
    const { useCase, mainRepo } = setup({ task, resultForTask: result })

    const outcome = await useCase.execute({
      taskId: 'TASK-410',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    expect(outcome.finalStatus).toBe('done')
    expect(mainRepo.readTask('TASK-410').status).toBe('done')
    // outcome.result 来自 worktree 仓储(readResult)。
    expect(outcome.result.task_id).toBe('TASK-410')
  })

  it('no_review + verification 含 failed → blocked(orchestratorVerified=false)', async () => {
    const task = makeTask({ id: 'TASK-411', name: 'blocked', noReview: true })
    const result = makeResult({
      taskId: 'TASK-411',
      verification: [{ command: 'npm run typecheck', result: 'failed', notes: 'fake 失败' }],
    })
    const { useCase, mainRepo } = setup({ task, resultForTask: result })

    const outcome = await useCase.execute({
      taskId: 'TASK-411',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    expect(outcome.finalStatus).toBe('blocked')
    expect(mainRepo.readTask('TASK-411').status).toBe('blocked')
  })
})

/* ============================================================ *
 * 前置失败:均在创建 worktree 之前
 * ============================================================ */

describe('ExecuteTaskUseCase — 前置失败均在 worktree 创建前', () => {
  it('任务非 ready(如 running)→ 拒绝,worktree 未创建', async () => {
    const task = makeTask({ id: 'TASK-420', name: 'x', status: 'running' })
    const { useCase, worktree } = setup({ task })

    await expect(
      useCase.execute({ taskId: 'TASK-420', mainRef: 'main', testingCommands: PAGE_TESTING_COMMANDS }),
    ).rejects.toThrow(/应为 ready 才能运行/)
    expect(worktree.createCalls).toHaveLength(0)
  })

  it('依赖未完成(ready)→ 拒绝,worktree 未创建', async () => {
    const dep = makeTask({ id: 'TASK-430', name: 'dep', status: 'ready' })
    const task = makeTask({ id: 'TASK-431', name: 'main', dependsOn: ['TASK-430'] })
    const { useCase, worktree } = setup({ task, extraTasks: [dep] })

    await expect(
      useCase.execute({ taskId: 'TASK-431', mainRef: 'main', testingCommands: PAGE_TESTING_COMMANDS }),
    ).rejects.toThrow(/前置依赖未全部完成/)
    expect(worktree.createCalls).toHaveLength(0)
  })

  it('allowed/forbidden 路径重叠 → deny 优先拒绝,worktree 未创建', async () => {
    const task = makeTask({
      id: 'TASK-432',
      name: 'overlap',
      allowedPaths: ['src/shared.ts'],
      forbiddenPaths: ['src/shared.ts'],
    })
    const { useCase, worktree } = setup({ task })

    await expect(
      useCase.execute({ taskId: 'TASK-432', mainRef: 'main', testingCommands: PAGE_TESTING_COMMANDS }),
    ).rejects.toThrow(/权限检测失败/)
    expect(worktree.createCalls).toHaveLength(0)
  })
})

/* ============================================================ *
 * Context Pack 刷新 + R7 工作区准备
 * ============================================================ */

describe('ExecuteTaskUseCase — Context Pack 刷新与 worktree 准备', () => {
  it('依赖全部 done → 用依赖产物刷新 context_pack.source_files 并回写 main 仓储', async () => {
    const dep = makeTask({ id: 'TASK-440', name: 'dep', status: 'done' })
    const depResult = makeResult({ taskId: 'TASK-440', modifiedFiles: ['src/dep-impl.ts'] })
    const task = makeTask({
      id: 'TASK-441',
      name: 'main',
      dependsOn: ['TASK-440'],
      sourceFiles: ['src/prefilled.ts'], // 预填值,应被依赖产物替换
    })
    const { useCase, mainRepo, capturedInput } = setup({
      task,
      extraTasks: [dep],
      extraResults: [depResult],
    })

    const outcome = await useCase.execute({
      taskId: 'TASK-441',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    // refreshSourceFiles(all-or-nothing,依赖全 done)→ 用依赖 modified_files 替换预填。
    expect(mainRepo.readTask('TASK-441').context_pack.source_files).toEqual(['src/dep-impl.ts'])
    // 刷新后的 context pack 注入 Executor。
    expect(capturedInput.value?.context_pack.source_files).toEqual(['src/dep-impl.ts'])
    // 必读核心含当前任务文件 + AGENTS/ARCHITECTURE/PROGRESS。
    expect(capturedInput.value?.context_pack.required_docs).toContain('docs/tasks/TASK-441-main.md')
    expect(capturedInput.value?.context_pack.required_docs).toContain('AGENTS.md')
    // outcome.task 是刷新后的任务投影。
    expect(outcome.task.context_pack.source_files).toEqual(['src/dep-impl.ts'])
  })

  it('prepareWorktree 用任务的 permissions 被调用(worktree 创建后、Executor 执行前)', async () => {
    const task = makeTask({
      id: 'TASK-442',
      name: 'r7',
      permissions: ['install_dependencies'],
    })
    const { useCase, prepareCalls, worktree } = setup({ task })

    await useCase.execute({
      taskId: 'TASK-442',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    expect(worktree.createCalls).toHaveLength(1)
    expect(prepareCalls).toHaveLength(1)
    expect(prepareCalls[0]?.wtPath).toBe('/fake/worktrees/TASK-442')
    expect(prepareCalls[0]?.permissions).toEqual(['install_dependencies'])
  })
})

/* ============================================================ *
 * main / worktree 仓储显式区分(§12 风险点)
 * ============================================================ */

describe('ExecuteTaskUseCase — main / worktree 仓储显式区分(§12)', () => {
  it('Executor 产物只进 worktree 仓储;main 仓储无 result(未合并)', async () => {
    const task = makeTask({ id: 'TASK-450', name: 'isolation', noReview: false })
    const { useCase, mainRepo } = setup({ task })

    await useCase.execute({
      taskId: 'TASK-450',
      mainRef: 'main',
      testingCommands: PAGE_TESTING_COMMANDS,
    })

    // 状态由 main 仓储维护;但 result 未合并入 main → main 仓储读 result 抛错(不存在)。
    expect(mainRepo.readTask('TASK-450').status).toBe('reviewing')
    expect(() => mainRepo.readResult('TASK-450')).toThrow(/结果文档不存在/)
  })
})
