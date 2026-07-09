import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { serializeDocument, TaskDocRepository } from '../../src/infrastructure/index.js'
import type { TaskExecutor } from '../../src/infrastructure/index.js'
import { parseTestingCommands, runTask } from '../../src/cli/commands/task-run.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'
import type { GitMergePort } from '../../src/application/ports.js'
import type {
  ResultFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../src/core/index.js'

/* ============================================================ *
 * 夹具：临时 git 仓库（TESTING.md page 层策略，复用 recovery / rebase-ff 测试构造方式）
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

/** 初始化带初始提交的 main 分支临时仓库，排除 worktree 目录与 node_modules。 */
function initRepo(repoDir: string): void {
  gitOk(['init', '-b', 'main'], repoDir)
  gitOk(['config', 'user.email', 'executor@example.com'], repoDir)
  gitOk(['config', 'user.name', 'Executor'], repoDir)
  writeFileSync(join(repoDir, 'README.md'), '# init\n')
  writeFileSync(join(repoDir, '.gitignore'), '.worktrees/\nnode_modules/\n')
  gitOk(['add', '.'], repoDir)
  gitOk(['commit', '-m', 'init: 初始提交'], repoDir)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'taskrun-test-'))
  initRepo(root)
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/* ============================================================ *
 * 夹具：frontmatter + 任务定义提交（slug 单一来源：workflow_outputs.result_file）
 * ============================================================ */

/** 任务文件名（去 docs/tasks/ 前缀与 .result.md 后缀），由 result_file 派生，保证与仓储解析一致。 */
function fileStem(task: TaskFrontmatter): string {
  const rf = task.workflow_outputs.result_file
  return rf.slice('docs/tasks/'.length, rf.length - '.result.md'.length)
}

/** 构造一份合法 TaskFrontmatter（默认 ready / page / 非免审；slug = `<id>-<name>`）。 */
function mkTask(opts: {
  id: TaskId
  name: string
  status?: TaskStatus
  noReview?: boolean
  dependsOn?: TaskId[]
  allowedPaths?: string[]
  forbiddenPaths?: string[]
  sourceFiles?: string[]
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
    permissions: [],
    no_review: opts.noReview ?? false,
    restart_on_retry: false,
    verification: ['npm run typecheck'],
    context_pack: {
      required_docs: [],
      optional_doc_excerpts: [],
      source_files: opts.sourceFiles ?? [],
    },
    workflow_outputs: { result_file: `docs/tasks/${slug}.result.md` },
  }
}

/** 把任务文件写入主仓库并提交（模拟 plan/task:create 产出 + commit，使 worktree 基线含之）。 */
function commitTaskDef(repoDir: string, task: TaskFrontmatter): void {
  mkdirSync(join(repoDir, 'docs', 'tasks'), { recursive: true })
  writeFileSync(
    join(repoDir, 'docs', 'tasks', `${fileStem(task)}.md`),
    serializeDocument(task, `# ${task.id}\n`),
  )
  gitOk(['add', 'docs'], repoDir)
  gitOk(['commit', '-m', `chore: 任务定义 ${task.id}`], repoDir)
}

/** 把一份已完成依赖的 .result.md 写入主仓库并提交（含产物清单，供 refreshSourceFiles 读取）。 */
function commitDepResult(repoDir: string, task: TaskFrontmatter, modified: string[]): void {
  const result: ResultFrontmatter = {
    task_id: task.id,
    execution_status: 'completed',
    modified_files: modified,
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: [],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
  writeFileSync(
    join(repoDir, 'docs', 'tasks', `${fileStem(task)}.result.md`),
    serializeDocument(result, `# ${task.id} 执行结果\n`),
  )
  gitOk(['add', 'docs'], repoDir)
  gitOk(['commit', '-m', `chore: 依赖结果 ${task.id}`], repoDir)
}

/** 主仓库任务文档仓储（读 frontmatter 权威，断言状态 / context_pack）。 */
function mainRepo(): TaskDocRepository {
  return new TaskDocRepository(join(root, 'docs', 'tasks'))
}

/** worktree 内 node_modules 恢复 no-op（测试仓库无 node_modules，避免真实链接 / 安装）。 */
function noopNodeModules(): void {
  /* 测试不依赖 node_modules；注入 no-op 跳过 R7 真实逻辑 */
}

/* ============================================================ *
 * DryRun e2e：ready→running→reviewing（不合并）
 * ============================================================ */

describe('task:run — DryRun e2e reviewing 路径（不合并）', () => {
  it('ready→running→reviewing，不触发合并，main HEAD 不前进', async () => {
    const task = mkTask({ id: 'TASK-301', name: 'review', noReview: false })
    commitTaskDef(root, task)
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await runTask('TASK-301', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
    })

    expect(outcome.finalStatus).toBe('reviewing')
    expect(outcome.merged).toBe(false)
    expect(existsSync(outcome.worktreePath)).toBe(true)
    // 普通任务停在 reviewing，不合并 → main HEAD 不前进。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    expect(mainRepo().readTask('TASK-301').status).toBe('reviewing')
  })

  it('产物（.result.md）落在 worktree 内（尚未合并入 main）', async () => {
    const task = mkTask({ id: 'TASK-302', name: 'review', noReview: false })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-302', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
    })

    expect(existsSync(join(outcome.worktreePath, task.workflow_outputs.result_file))).toBe(true)
  })
})

/* ============================================================ *
 * DryRun e2e：ready→running→done（no_review，合并）
 * ============================================================ */

describe('task:run — DryRun e2e done 路径（no_review 合并回收）', () => {
  it('ready→running→done（no_review 校验通过），合并回收 + 全局回写', async () => {
    const task = mkTask({ id: 'TASK-303', name: 'done', noReview: true })
    commitTaskDef(root, task)
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await runTask('TASK-303', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
    })

    expect(outcome.finalStatus).toBe('done')
    expect(outcome.merged).toBe(true)
    expect(outcome.conflicts).toEqual([])
    expect(mainRepo().readTask('TASK-303').status).toBe('done')
    // 合并回收 → main HEAD 前进（audit commit 含 .result.md）。
    expect(gitOk(['rev-parse', 'main'], root)).not.toBe(headBefore)
    // 结果文件已进入 main 历史（git show 可读）。
    expect(git(['show', `main:${task.workflow_outputs.result_file}`], root).code).toBe(0)
    // 主工作区经同步后结果文件可见（fastForwardMain 用 update-ref，需手动检出）。
    expect(existsSync(join(root, task.workflow_outputs.result_file))).toBe(true)
  })

  it('no_review 任务但产物校验未通过（verification 含 failed）→ blocked，不合并', async () => {
    const task = mkTask({ id: 'TASK-304', name: 'blocked', noReview: true })
    commitTaskDef(root, task)
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await runTask('TASK-304', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      executor: fakeFailedExecutor('TASK-304'),
    })

    // completed+review+no_review+校验未通过 → blocked（§7 三分），不合并。
    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.merged).toBe(false)
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
  })
})

/* ============================================================ *
 * 前置依赖检查
 * ============================================================ */

describe('task:run — 前置依赖检查', () => {
  it('依赖未完成（ready）→ 拒绝运行', async () => {
    const dep = mkTask({ id: 'TASK-310', name: 'dep', status: 'ready' })
    const task = mkTask({ id: 'TASK-311', name: 'main', dependsOn: ['TASK-310'] })
    commitTaskDef(root, dep)
    commitTaskDef(root, task)

    await expect(
      runTask('TASK-311', {
        projectRoot: root,
        worktreesDir,
        nodeModulesRestorer: noopNodeModules,
      }),
    ).rejects.toThrow(/前置依赖未全部完成/)
  })

  it('依赖全部 done → 放行，并按依赖产物刷新 context_pack.source_files', async () => {
    const dep = mkTask({ id: 'TASK-312', name: 'dep', status: 'done' })
    commitTaskDef(root, dep)
    commitDepResult(root, dep, ['src/dep-impl.ts'])

    const task = mkTask({
      id: 'TASK-313',
      name: 'main',
      dependsOn: ['TASK-312'],
      sourceFiles: ['src/prefilled.ts'], // 预填值，应被依赖产物替换
      noReview: true,
    })
    commitTaskDef(root, task)

    await runTask('TASK-313', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
    })

    // refreshSourceFiles（all-or-nothing，依赖全 done）→ 用依赖 modified_files 替换预填。
    expect(mainRepo().readTask('TASK-313').context_pack.source_files).toEqual(['src/dep-impl.ts'])
  })
})

/* ============================================================ *
 * 状态前置 / 权限检测
 * ============================================================ */

describe('task:run — 状态前置与权限检测', () => {
  it('任务非 ready（如 running）→ 拒绝运行', async () => {
    const task = mkTask({ id: 'TASK-320', name: 'x', status: 'running' })
    commitTaskDef(root, task)

    await expect(
      runTask('TASK-320', {
        projectRoot: root,
        worktreesDir,
        nodeModulesRestorer: noopNodeModules,
      }),
    ).rejects.toThrow(/应为 ready 才能运行/)
  })

  it('allowed_paths 与 forbidden_paths 重叠 → deny 优先拒绝启动（建 worktree 之前）', async () => {
    const task = mkTask({
      id: 'TASK-321',
      name: 'x',
      allowedPaths: ['src/shared.ts'],
      forbiddenPaths: ['src/shared.ts'],
    })
    commitTaskDef(root, task)
    const headBefore = gitOk(['rev-parse', 'main'], root)

    await expect(
      runTask('TASK-321', {
        projectRoot: root,
        worktreesDir,
        nodeModulesRestorer: noopNodeModules,
      }),
    ).rejects.toThrow(/权限检测失败/)
    // 拒绝发生在 create worktree 之前 → 未产生 worktree、main 不变。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    expect(existsSync(join(worktreesDir, 'TASK-321'))).toBe(false)
  })
})

/* ============================================================ *
 * 合并冲突 → blocked + ISSUES
 * ============================================================ */

describe('task:run — 合并冲突置 blocked + 落 ISSUES', () => {
  it('rebase 冲突 → done→blocked，登记冲突到 docs/ISSUES.md', async () => {
    const task = mkTask({ id: 'TASK-330', name: 'conflict', noReview: true })
    commitTaskDef(root, task)
    const headBefore = gitOk(['rev-parse', 'main'], root)

    const outcome = await runTask('TASK-330', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      gitMergePort: conflictGitPort(),
    })

    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.merged).toBe(false)
    expect(outcome.conflicts).toEqual(['src/conflicting.ts'])
    expect(mainRepo().readTask('TASK-330').status).toBe('blocked')
    // 冲突不合并 → main 不前进。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(headBefore)
    // 冲突已登记进 docs/ISSUES.md（§3.2 / §8 不静默）。
    expect(existsSync(join(root, 'docs', 'ISSUES.md'))).toBe(true)
    const issuesContent = readFileSync(join(root, 'docs', 'ISSUES.md'), 'utf8')
    expect(issuesContent).toContain('TASK-330')
    expect(issuesContent).toContain('合并冲突')
    expect(issuesContent).toContain('src/conflicting.ts')
  })
})

/* ============================================================ *
 * parseTestingCommands（项目级验证命令解析）
 * ============================================================ */

describe('task:run — parseTestingCommands', () => {
  it('解析 docs/TESTING.md 的 fenced yaml 块为 TestingCommand', () => {
    const raw = [
      '# TESTING',
      '',
      '### typecheck',
      '',
      '```yaml',
      'command: npm run typecheck',
      'layers: [type, domain, page]',
      'requires_permissions: []',
      'notes: 全量类型检查',
      '```',
      '',
      '### install',
      '',
      '```yaml',
      'command: npm install',
      'layers: [data]',
      'requires_permissions: [install_dependencies]',
      '```',
      '',
      '```yaml',
      'command: echo hi',
      '```',
    ].join('\n')
    const cmds = parseTestingCommands(raw)
    expect(cmds.map((c) => c.command)).toEqual(['npm run typecheck', 'npm install', 'echo hi'])
    expect(cmds[0]?.layers).toEqual(['type', 'domain', 'page'])
    expect(cmds[1]?.requires_permissions).toEqual(['install_dependencies'])
    expect(cmds[2]?.layers).toBeUndefined()
  })

  it('空内容 / 残缺围栏 → 返回空数组（不抛错）', () => {
    expect(parseTestingCommands('')).toEqual([])
    expect(parseTestingCommands('```yaml\ncommand: x\n')).toEqual([]) // 无闭围栏
  })
})

/* ============================================================ *
 * runCli（退出码 + 输出）
 * ============================================================ */

describe('task:run — runCli（退出码 + 输出）', () => {
  it('reviewing 路径返回成功退出码并提示 task:review', async () => {
    const task = mkTask({ id: 'TASK-340', name: 'r', noReview: false })
    commitTaskDef(root, task)
    const logs = spyOnConsole('log')

    const exit = await runCli([
      'task:run',
      'TASK-340',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
    ])

    expect(exit).toBe(CliExitCode.Success)
    expect(logs.join('\n')).toContain('reviewing')
    expect(logs.join('\n')).toContain('caw task:review TASK-340')
  })

  it('依赖未完成返回非零退出码', async () => {
    const dep = mkTask({ id: 'TASK-341', name: 'dep', status: 'ready' })
    const task = mkTask({ id: 'TASK-342', name: 'm', dependsOn: ['TASK-341'] })
    commitTaskDef(root, dep)
    commitTaskDef(root, task)

    const exit = await runCli([
      'task:run',
      'TASK-342',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * 辅助：fake executor / fake git port / console spy
 * ============================================================ */

/**
 * fake 执行器：产出 verification 含 failed 的 .result.md（模拟「免审任务产物校验未通过」）。
 * next_action=review 走 completed+review+no_review 三分：orchestratorVerified=false（验证失败）→ blocked。
 */
function fakeFailedExecutor(taskId: TaskId): TaskExecutor {
  return {
    name: 'fake-failed',
    async execute(input) {
      const result: ResultFrontmatter = {
        task_id: taskId,
        execution_status: 'completed',
        modified_files: [],
        created_files: [],
        deleted_files: [],
        execution_commits: [],
        verification: input.permission_boundary.verification_commands.map((c) => ({
          command: c.command,
          result: 'failed' as const,
          notes: 'fake 失败',
        })),
        global_update_requests: { progress: [], decisions: [], issues: [] },
        next_action: 'review',
      }
      writeFileSync(input.result_file, serializeDocument(result, `# ${taskId} fake\n`), 'utf8')
      return { result_file: input.result_file, execution_status: 'completed' }
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
