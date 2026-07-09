import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { serializeDocument, TaskDocRepository } from '../../src/infrastructure/index.js'
import {
  LocalReviewer,
  reviewTask,
  type Reviewer,
} from '../../src/cli/commands/task-review.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'
import type { GitMergePort } from '../../src/application/ports.js'
import type {
  ResultFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../src/core/index.js'

/* ============================================================ *
 * 夹具：临时 git 仓库（复用 task-run / recovery 测试构造方式）
 * ============================================================ */

let root = ''
let worktreesDir = ''

/** 执行 git 命令并返回原始结果（不判定成败），供断言验证 git 状态。 */
function git(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { code: r.status ?? -1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

/** 执行 git 命令，退出码非 0 抛错（夹具准备用）。 */
function gitOk(args: string[], cwd: string): string {
  const r = git(args, cwd)
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} 失败（${r.code}）：${r.stderr}`)
  }
  return r.stdout
}

/** 初始化带初始提交的 main 分支临时仓库，排除 worktree 目录。 */
function initRepo(repoDir: string): void {
  gitOk(['init', '-b', 'main'], repoDir)
  gitOk(['config', 'user.email', 'reviewer@example.com'], repoDir)
  gitOk(['config', 'user.name', 'Reviewer'], repoDir)
  writeFileSync(join(repoDir, 'README.md'), '# init\n')
  writeFileSync(join(repoDir, '.gitignore'), '.worktrees/\nnode_modules/\n')
  gitOk(['add', '.'], repoDir)
  gitOk(['commit', '-m', 'init: 初始提交'], repoDir)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'taskreview-test-'))
  initRepo(root)
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/* ============================================================ *
 * 夹具：frontmatter + 任务定义 + reviewing 态 + worktree + .result.md
 * ============================================================ */

/** 任务文件名（去 docs/tasks/ 前缀与 .result.md 后缀），由 result_file 派生。 */
function fileStem(task: TaskFrontmatter): string {
  const rf = task.workflow_outputs.result_file
  return rf.slice('docs/tasks/'.length, rf.length - '.result.md'.length)
}

/** 构造一份合法 TaskFrontmatter（默认 reviewing / page;slug = `<id>-<name>`）。 */
function mkTask(opts: {
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

/** 构造一份合法 .result.md frontmatter（默认 completed + review;failed 控制验证是否失败）。 */
function mkResult(taskId: TaskId, failed = false): ResultFrontmatter {
  return {
    task_id: taskId,
    execution_status: 'completed',
    modified_files: [],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: [
      {
        command: 'npm run typecheck',
        result: failed ? 'failed' : 'passed',
        notes: failed ? 'fake 失败' : 'fake 通过',
      },
    ],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
}

/**
 * 搭建 reviewing 态夹具：提交任务定义（ready）→ 创建 worktree → 在 worktree 写 .result.md
 * → 主工作区任务 status 置 reviewing（模拟 task:run 后的遗留态）。
 */
function setupReviewing(task: TaskFrontmatter, result: ResultFrontmatter): string {
  // 提交任务定义（ready 态，供 worktree 基线含之）。
  mkdirSync(join(root, 'docs', 'tasks'), { recursive: true })
  writeFileSync(
    join(root, 'docs', 'tasks', `${fileStem(task)}.md`),
    serializeDocument({ ...task, status: 'ready' }, `# ${task.id}\n`),
  )
  gitOk(['add', 'docs'], root)
  gitOk(['commit', '-m', `chore: 任务定义 ${task.id}`], root)
  // 创建 worktree（task:run 等价产物）。
  const wtPath = join(worktreesDir, task.id)
  gitOk(['worktree', 'add', '-b', `task/${task.id}`, wtPath, 'main'], root)
  // worktree 内写 .result.md（Executor 产物，尚未提交 / 合并入 main）。
  writeFileSync(
    join(wtPath, task.workflow_outputs.result_file),
    serializeDocument(result, `# ${task.id} 执行结果\n`),
  )
  // 主工作区任务 status 置 reviewing（task:run 后遗留态，状态权威在 main 工作区）。
  new TaskDocRepository(join(root, 'docs', 'tasks')).writeTask({ ...task, status: 'reviewing' })
  return wtPath
}

/** 主仓库任务文档仓储（读 frontmatter 权威，断言状态）。 */
function mainRepo(): TaskDocRepository {
  return new TaskDocRepository(join(root, 'docs', 'tasks'))
}

/** fake Reviewer：产出指定审查结论（控制 approved / rejected / needs-human-confirmation）。 */
function fakeReviewer(
  reviewResult: 'approved' | 'rejected' | 'needs-human-confirmation',
): Reviewer {
  return {
    name: 'fake-reviewer',
    async review() {
      return {
        review_result: reviewResult,
        required_changes: reviewResult === 'approved' ? [] : ['必须修改 X'],
        findings: ['发现 Y'],
      }
    },
  }
}

/** fake GitMergePort：rebase 后 listConflicts 返回冲突文件，模拟合并冲突（不依赖真实 git 冲突）。 */
function conflictGitPort(): GitMergePort {
  return {
    rebaseOnto: () => undefined,
    fastForwardMain: () => undefined,
    collectPostRebaseCommits: () => [],
    commitAuditResult: () => undefined,
    branchMerged: () => false,
    abortOrCleanRebase: () => undefined,
    listConflicts: () => ['src/conflicting.ts'],
  }
}

/** 捕获 console.log 全部调用参数，返回累加数组。 */
function spyOnConsole(method: 'log' | 'warn'): string[] {
  const buffer: string[] = []
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    buffer.push(args.map((a) => String(a)).join(' '))
  })
  return buffer
}

/* ============================================================ *
 * 三种审查结论映射状态（§15 固定映射）
 * ============================================================ */

describe('task:review — 三种审查结论映射状态', () => {
  it('approved → done + 合并回收，main HEAD 前进', async () => {
    const task = mkTask({ id: 'TASK-401', name: 'approve' })
    setupReviewing(task, mkResult('TASK-401'))
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await reviewTask('TASK-401', {
      projectRoot: root,
      worktreesDir,
      reviewer: fakeReviewer('approved'),
    })

    expect(outcome.reviewResult).toBe('approved')
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.merged).toBe(true)
    expect(outcome.conflicts).toEqual([])
    expect(mainRepo().readTask('TASK-401').status).toBe('done')
    // approved → done → 合并 → main HEAD 前进。
    expect(gitOk(['rev-parse', 'main'], root)).not.toBe(headBefore)
    // .result.md 已进入 main 历史。
    expect(git(['show', `main:${task.workflow_outputs.result_file}`], root).code).toBe(0)
  })

  it('rejected → rejected，不合并，main 不前进，worktree 保留', async () => {
    const task = mkTask({ id: 'TASK-402', name: 'reject' })
    setupReviewing(task, mkResult('TASK-402'))
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await reviewTask('TASK-402', {
      projectRoot: root,
      worktreesDir,
      reviewer: fakeReviewer('rejected'),
    })

    expect(outcome.reviewResult).toBe('rejected')
    expect(outcome.finalStatus).toBe('rejected')
    expect(outcome.merged).toBe(false)
    // rejected 不合并 → main 不前进。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    // worktree 保留供人工处理。
    expect(existsSync(outcome.worktreePath)).toBe(true)
  })

  it('needs-human-confirmation → blocked，不合并，worktree 保留', async () => {
    const task = mkTask({ id: 'TASK-403', name: 'needshuman' })
    setupReviewing(task, mkResult('TASK-403'))
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await reviewTask('TASK-403', {
      projectRoot: root,
      worktreesDir,
      reviewer: fakeReviewer('needs-human-confirmation'),
    })

    expect(outcome.reviewResult).toBe('needs-human-confirmation')
    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.merged).toBe(false)
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    expect(existsSync(outcome.worktreePath)).toBe(true)
  })
})

/* ============================================================ *
 * no_review skipped 路径（§15：Orchestrator 生成 skipped + 产物校验）
 * ============================================================ */

describe('task:review — no_review skipped 路径', () => {
  it('no_review + 产物校验通过 → skipped → done + 合并', async () => {
    const task = mkTask({ id: 'TASK-411', name: 'noreview-ok', noReview: true })
    setupReviewing(task, mkResult('TASK-411', false))

    const outcome = await reviewTask('TASK-411', { projectRoot: root, worktreesDir })

    expect(outcome.reviewResult).toBe('skipped')
    expect(outcome.reviewer).toBe('orchestrator')
    // 产物校验通过（verification 无 failed）→ done（§7/§15 no_review 三分）。
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.merged).toBe(true)
  })

  it('no_review + 产物校验未通过（verification 含 failed）→ skipped → blocked，不合并', async () => {
    const task = mkTask({ id: 'TASK-412', name: 'noreview-fail', noReview: true })
    setupReviewing(task, mkResult('TASK-412', true))
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await reviewTask('TASK-412', { projectRoot: root, worktreesDir })

    expect(outcome.reviewResult).toBe('skipped')
    // 产物校验未通过 → blocked（§7），不合并。
    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.merged).toBe(false)
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
  })
})

/* ============================================================ *
 * 审查结论隔离（§5.3：结论写 .review.md，不污染 .result.md）
 * ============================================================ */

describe('task:review — 审查结论写 .review.md 不污染 .result.md', () => {
  it('.review.md 含审查结论;.result.md 不含审查字段', async () => {
    const task = mkTask({ id: 'TASK-421', name: 'isolate' })
    setupReviewing(task, mkResult('TASK-421'))

    await reviewTask('TASK-421', {
      projectRoot: root,
      worktreesDir,
      reviewer: fakeReviewer('rejected'),
    })

    // .review.md 在 main 仓库，含审查结论。
    const review = mainRepo().readReview('TASK-421')
    expect(review.review_result).toBe('rejected')
    expect(review.reviewer).toBe('fake-reviewer')
    expect(review.required_changes).toEqual(['必须修改 X'])

    // .result.md 不含审查字段（review_result / reviewer 不出现在 .result.md 正文）。
    const resultRaw = readFileSync(
      join(outcomeWorktree('TASK-421'), task.workflow_outputs.result_file),
      'utf8',
    )
    expect(resultRaw).not.toContain('review_result')
    expect(resultRaw).not.toContain('reviewer')
  })
})

/* ============================================================ *
 * 默认 LocalReviewer（§12 SDK 未就位兜底）
 * ============================================================ */

describe('task:review — 默认 LocalReviewer', () => {
  it('默认 LocalReviewer 产 approved → done + 合并', async () => {
    const task = mkTask({ id: 'TASK-431', name: 'localdefault' })
    setupReviewing(task, mkResult('TASK-431'))

    const outcome = await reviewTask('TASK-431', { projectRoot: root, worktreesDir })

    expect(outcome.reviewer).toBe('local-reviewer')
    expect(outcome.reviewResult).toBe('approved')
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.merged).toBe(true)
  })

  it('LocalReviewer 实例 name 为 local-reviewer', () => {
    expect(new LocalReviewer().name).toBe('local-reviewer')
  })
})

/* ============================================================ *
 * 状态前置
 * ============================================================ */

describe('task:review — 状态前置', () => {
  it('任务非 reviewing（如 ready）→ 拒绝审查', async () => {
    const task = mkTask({ id: 'TASK-441', name: 'notready', status: 'ready' })
    setupReviewing(task, mkResult('TASK-441'))
    // 主工作区改回 ready（模拟未进入 reviewing）。
    mainRepo().writeTask({ ...task, status: 'ready' })

    await expect(
      reviewTask('TASK-441', { projectRoot: root, worktreesDir }),
    ).rejects.toThrow(/应为 reviewing 才能审查/)
  })

  it('worktree 不存在 → 拒绝审查', async () => {
    const task = mkTask({ id: 'TASK-442', name: 'nowt' })
    setupReviewing(task, mkResult('TASK-442'))
    // 删除 worktree 模拟缺失。
    rmSync(join(worktreesDir, 'TASK-442'), { recursive: true, force: true })

    await expect(
      reviewTask('TASK-442', { projectRoot: root, worktreesDir }),
    ).rejects.toThrow(/worktree 不存在/)
  })
})

/* ============================================================ *
 * 合并冲突 → blocked + ISSUES
 * ============================================================ */

describe('task:review — 合并冲突置 blocked + 落 ISSUES', () => {
  it('rebase 冲突 → done→blocked，登记冲突到 docs/ISSUES.md', async () => {
    const task = mkTask({ id: 'TASK-451', name: 'conflict' })
    setupReviewing(task, mkResult('TASK-451'))
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await reviewTask('TASK-451', {
      projectRoot: root,
      worktreesDir,
      reviewer: fakeReviewer('approved'),
      gitMergePort: conflictGitPort(),
    })

    // approved→done→合并冲突→blocked（Orchestrator confirmed），不进 main。
    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.merged).toBe(false)
    expect(outcome.conflicts).toEqual(['src/conflicting.ts'])
    expect(mainRepo().readTask('TASK-451').status).toBe('blocked')
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    // 冲突已登记进 docs/ISSUES.md（§3.2 / §8 不静默）。
    expect(existsSync(join(root, 'docs', 'ISSUES.md'))).toBe(true)
    const issuesContent = readFileSync(join(root, 'docs', 'ISSUES.md'), 'utf8')
    expect(issuesContent).toContain('TASK-451')
    expect(issuesContent).toContain('合并冲突')
    expect(issuesContent).toContain('src/conflicting.ts')
  })
})

/* ============================================================ *
 * runCli（退出码 + 输出）
 * ============================================================ */

describe('task:review — runCli（退出码 + 输出）', () => {
  it('approved 路径返回成功退出码并提示已合并', async () => {
    const task = mkTask({ id: 'TASK-461', name: 'cliok' })
    setupReviewing(task, mkResult('TASK-461'))
    const logs = spyOnConsole('log')

    const exit = await runCli([
      'task:review',
      'TASK-461',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
    ])

    expect(exit).toBe(CliExitCode.Success)
    expect(logs.join('\n')).toContain('approved')
    expect(logs.join('\n')).toContain('done')
    expect(logs.join('\n')).toContain('合并')
  })

  it('任务非 reviewing 返回非零退出码', async () => {
    const task = mkTask({ id: 'TASK-462', name: 'clifail', status: 'ready' })
    setupReviewing(task, mkResult('TASK-462'))
    mainRepo().writeTask({ ...task, status: 'ready' })

    const exit = await runCli([
      'task:review',
      'TASK-462',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * 辅助
 * ============================================================ */

/** 取某任务的 worktree 路径。 */
function outcomeWorktree(taskId: TaskId): string {
  return join(worktreesDir, taskId)
}
