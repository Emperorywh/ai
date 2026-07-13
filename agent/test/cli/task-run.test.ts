import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { serializeDocument, TaskDocRepository, WorktreeAdapter } from '../../src/infrastructure/index.js'
import type {
  TaskExecutorPort,
  VerificationRunnerInput,
  VerificationRunnerPort,
  VerificationRunnerResult,
} from '../../src/application/execution/ports.js'
import type { SdkRunReport } from '../../src/infrastructure/sdk/claude-sdk-adapter.js'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  assembleExecutor,
  parseTestingCommands,
  runTask,
  runTaskWithAssembly,
  type InvocationFactory,
} from '../../src/cli/commands/task-run.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'
import type { GitMergePort } from '../../src/application/ports.js'
import type {
  ResultFrontmatter,
  ResultVerification,
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

    // --executor dry-run：TASK-034 后默认走 auto（读 profile 配置），临时仓库无配置文件，
    // 显式 dry-run 绕过装配直测 runTask 编排（reviewing 路径 + 输出）。
    const exit = await runCli([
      'task:run',
      'TASK-340',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
      '--executor',
      'dry-run',
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
      '--executor',
      'dry-run',
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * assembleExecutor composition root（TASK-034：profile → env → invocation → executor）
 * ============================================================ */

/** 写入最小合法 provider profile 配置（anthropic 官方 + glm 第三方），返回其路径。 */
function writeProfileConfig(repoDir: string): string {
  mkdirSync(join(repoDir, '.caw'), { recursive: true })
  const configPath = join(repoDir, '.caw', 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      provider: 'anthropic',
      profiles: {
        anthropic: {
          baseUrl: null,
          authTokenEnv: 'ANTHROPIC_API_KEY',
          modelMapping: { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5', opus: 'claude-opus-4-8' },
          extraEnv: {},
        },
        glm: {
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          authTokenEnv: 'ZHIPU_API_KEY',
          modelMapping: { haiku: 'glm-4.7', sonnet: 'glm-5.2', opus: 'glm-5.2' },
          extraEnv: { API_TIMEOUT_MS: '3000000' },
        },
      },
    }),
    'utf8',
  )
  return configPath
}

/**
 * 构造 fake invocation 工厂：捕获构造入参（断言 model / providerEnv），run() 时驱动注入的
 * onMessage 回调（模拟 SDK 流式 message）后返回固定 SdkRunReport。
 */
function fakeInvocationFactory(
  messages: readonly SDKMessage[],
  report: SdkRunReport,
): { factory: InvocationFactory; captured: { opts?: Parameters<InvocationFactory>[0] } } {
  const captured: { opts?: Parameters<InvocationFactory>[0] } = {}
  return {
    factory: (opts) => {
      captured.opts = opts
      return {
        name: 'fake-sdk',
        async run() {
          for (const m of messages) opts.onMessage?.(m)
          return report
        },
      }
    },
    captured,
  }
}

/** 构造合法 SdkRunReport（completed + review，供 ClaudeSdkExecutor 落 .result.md）。 */
function validSdkReport(): SdkRunReport {
  return {
    executionStatus: 'completed',
    modifiedFiles: [],
    createdFiles: [],
    deletedFiles: [],
    verification: [],
    globalUpdateRequests: { progress: [], decisions: [], issues: [] },
    nextAction: 'review',
    summary: 'fake 执行完成',
  }
}

/** fake assistant 消息（含 text + tool_use 块，供 §7 流式渲染断言）。 */
function fakeAssistantMessage(): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [
        { type: 'text', text: '读取源文件' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'src/x.ts' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    parent_tool_use_id: null,
    uuid: 'uuid-assistant',
    session_id: 'sess-1',
  } as unknown as SDKMessage
}

/** fake result 消息（携带 cost/usage 终止统计，供 §7 cost 采集断言）。 */
function fakeResultMessage(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0567,
    is_error: false,
    duration_ms: 8000,
    duration_api_ms: 6000,
    num_turns: 4,
    result: '任务完成',
    session_id: 'sess-1',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  } as unknown as SDKMessage
}

describe('task:run — assembleExecutor composition root', () => {
  it('--executor dry-run → DryRunLocalExecutor，cost 为 undefined', () => {
    const { executor, observability } = assembleExecutor({
      projectRoot: root,
      taskId: 'TASK-350',
      executorKind: 'dry-run',
      stream: false,
      wireSigInt: false,
    })
    expect(executor.name).toBe('dry-run-local')
    expect(observability.getCost()).toBeUndefined()
    observability.close()
  })

  it('auto（未指定 executor）+ token 缺失 → 抛 ProviderTokenMissing 不静默', () => {
    const configPath = writeProfileConfig(root)
    expect(() =>
      assembleExecutor({
        projectRoot: root,
        taskId: 'TASK-351',
        configPath,
        env: {}, // 无 ANTHROPIC_API_KEY
        stream: false,
        wireSigInt: false,
      }),
    ).toThrow(/token 环境变量.*未设置/)
  })

  it('--executor sdk + token 就位 → ClaudeSdkExecutor + invocation 注入 providerEnv', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeInvocationFactory([], validSdkReport())
    const { executor } = assembleExecutor({
      projectRoot: root,
      taskId: 'TASK-352',
      executorKind: 'sdk',
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      invocationFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(executor.name).toBe('claude-sdk')
    // assembleExecutor 内已调用工厂，断言 providerEnv 注入官方 token 键。
    expect(captured.opts?.providerEnv['ANTHROPIC_API_KEY']).toBe('sk-test')
    expect(captured.opts?.providerEnv['ANTHROPIC_BASE_URL']).toBeUndefined()
  })

  it('--provider glm + ZHIPU_API_KEY → invocation 注入第三方 token 键 + baseUrl', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeInvocationFactory([], validSdkReport())
    assembleExecutor({
      projectRoot: root,
      taskId: 'TASK-353',
      provider: 'glm',
      configPath,
      env: { ZHIPU_API_KEY: 'zhipu-test' },
      invocationFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(captured.opts?.providerEnv['ANTHROPIC_AUTH_TOKEN']).toBe('zhipu-test')
    expect(captured.opts?.providerEnv['ANTHROPIC_BASE_URL']).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(captured.opts?.providerEnv['ANTHROPIC_DEFAULT_SONNET_MODEL']).toBe('glm-5.2')
  })

  it('--model 覆盖具体模型名 → invocation 工厂收到 model 字段', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeInvocationFactory([], validSdkReport())
    assembleExecutor({
      projectRoot: root,
      taskId: 'TASK-354',
      model: 'custom-model-x',
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      invocationFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(captured.opts?.model).toBe('custom-model-x')
  })

  it('非法 executorKind → 抛错不静默', () => {
    expect(() =>
      assembleExecutor({
        projectRoot: root,
        taskId: 'TASK-355',
        executorKind: 'foo' as 'dry-run',
        stream: false,
        wireSigInt: false,
      }),
    ).toThrow(/--executor 只支持 dry-run \| sdk/)
  })
})

describe('task:run — SDK 路径可观测性（§7 流式 + 日志 + cost）', () => {
  it('fake invocation 驱动 onMessage → cost 采集 + 日志含逐消息记录 + 终端流式渲染', () => {
    const configPath = writeProfileConfig(root)
    const { factory } = fakeInvocationFactory([fakeAssistantMessage(), fakeResultMessage()], validSdkReport())
    const logs = spyOnConsole('log')

    const { executor, observability } = assembleExecutor({
      projectRoot: root,
      taskId: 'TASK-360',
      executorKind: 'sdk',
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      invocationFactory: factory,
      stream: true,
      wireSigInt: false,
    })

    // 触发一次执行：ClaudeSdkExecutor → invocation.run → 驱动 onMessage（流式 + cost 采集 + 日志落盘）。
    return executor
      .execute({
        task_id: 'TASK-360',
        worktree_path: root,
        result_file: join(root, 'docs', 'tasks', 'TASK-360.result.md'),
        context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
        permission_boundary: {
          allowed_paths: [],
          forbidden_paths: [],
          permissions: [],
          verification_commands: [],
        },
        startup_prompt: '执行 TASK-360',
      })
      .then(() => {
        // cost 采集自 result 消息。
        const cost = observability.getCost()
        expect(cost).toBeDefined()
        expect(cost?.totalCostUsd).toBeCloseTo(0.0567, 4)
        expect(cost?.inputTokens).toBe(100)
        expect(cost?.outputTokens).toBe(200)
        expect(cost?.numTurns).toBe(4)
        expect(cost?.durationMs).toBe(8000)

        // 完整日志文件存在且含逐消息记录（assistant + result）。
        expect(existsSync(observability.logFile)).toBe(true)
        const logContent = readFileSync(observability.logFile, 'utf8')
        expect(logContent).toContain('assistant')
        expect(logContent).toContain('result')
        expect(logContent).toContain('turn ')

        // 终端流式渲染：assistant 的 tool_use（Read）打印到 console。
        const streamed = logs.join('\n')
        expect(streamed).toContain('Read')
        expect(streamed).toContain('src/x.ts')

        observability.close()
      })
  })
})

describe('task:run — runTaskWithAssembly e2e（装配 + 编排 + cost 入 outcome）', () => {
  it('SDK 路径（fake invocation）→ outcome.executor=claude-sdk、cost 非空、状态流转 reviewing', async () => {
    const task = mkTask({ id: 'TASK-370', name: 'sdkrun', noReview: false })
    commitTaskDef(root, task)
    const configPath = writeProfileConfig(root)
    const { factory } = fakeInvocationFactory([fakeResultMessage()], validSdkReport())

    const outcome = await runTaskWithAssembly('TASK-370', {
      projectRoot: root,
      worktreesDir,
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      invocationFactory: factory,
      nodeModulesRestorer: noopNodeModules,
      stream: false,
      wireSigInt: false,
    })

    expect(outcome.executor).toBe('claude-sdk')
    expect(outcome.finalStatus).toBe('reviewing')
    expect(outcome.cost).toBeDefined()
    expect(outcome.cost?.totalCostUsd).toBeCloseTo(0.0567, 4)
  })
})

describe('task:run — runCli 装配选项（--executor）', () => {
  it('--executor dry-run → 成功退出码（reviewing 路径）', async () => {
    const task = mkTask({ id: 'TASK-380', name: 'cli', noReview: false })
    commitTaskDef(root, task)

    const exit = await runCli([
      'task:run',
      'TASK-380',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
      '--executor',
      'dry-run',
    ])
    expect(exit).toBe(CliExitCode.Success)
  })

  it('--executor foo（非法值）→ 非零退出码', async () => {
    const task = mkTask({ id: 'TASK-381', name: 'cli', noReview: false })
    commitTaskDef(root, task)

    const exit = await runCli([
      'task:run',
      'TASK-381',
      '--project-root',
      root,
      '--executor',
      'foo',
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
function fakeFailedExecutor(taskId: TaskId): TaskExecutorPort {
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

/* ============================================================ *
 * TASK-040:fake runner / 路径越界 executor / 模型 verification executor
 * ============================================================ */

/** 构造合法 .result.md（可选模型自报 verification），模拟 Executor 产出。 */
function fakeResultExecutor(
  taskId: TaskId,
  verification: ResultVerification[] = [],
): TaskExecutorPort {
  return {
    name: 'fake-result',
    async execute(input) {
      const result: ResultFrontmatter = {
        task_id: taskId,
        execution_status: 'completed',
        modified_files: [],
        created_files: [],
        deleted_files: [],
        execution_commits: [],
        verification,
        global_update_requests: { progress: [], decisions: [], issues: [] },
        next_action: 'review',
      }
      writeFileSync(input.result_file, serializeDocument(result, `# ${taskId} fake\n`), 'utf8')
      return { result_file: input.result_file, execution_status: 'completed' }
    },
  }
}

/** 构造越界 Executor：产出合法 result + 在 worktree 写一个 allowed 外文件（模拟模型越界）。 */
function trespassingExecutor(taskId: TaskId, trespassRelPath: string): TaskExecutorPort {
  return {
    name: 'fake-trespass',
    async execute(input) {
      const result: ResultFrontmatter = {
        task_id: taskId,
        execution_status: 'completed',
        modified_files: [],
        created_files: [],
        deleted_files: [],
        execution_commits: [],
        verification: [],
        global_update_requests: { progress: [], decisions: [], issues: [] },
        next_action: 'review',
      }
      writeFileSync(input.result_file, serializeDocument(result, `# ${taskId} fake\n`), 'utf8')
      // 模拟模型越界：写一个 allowed 外文件。
      const full = join(input.worktree_path, trespassRelPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, '越界内容\n', 'utf8')
      return { result_file: input.result_file, execution_status: 'completed' }
    },
  }
}

/** 构造 fake VerificationRunnerPort：按命令脚本化返回结果。 */
function fakeRunner(scripts: Record<string, VerificationRunnerResult>): VerificationRunnerPort {
  return {
    name: 'fake-runner',
    async run(input: VerificationRunnerInput): Promise<VerificationRunnerResult> {
      const r = scripts[input.command]
      if (!r) throw new Error(`fake runner 未脚本化命令：${input.command}`)
      return r
    },
  }
}

/** fake runner passed 结果。 */
function passedRunner(command: string): VerificationRunnerResult {
  return { command, result: 'passed', exitCode: 0, durationMs: 100, outputSummary: `${command} 通过` }
}

/** fake runner failed 结果。 */
function failedRunner(command: string): VerificationRunnerResult {
  return { command, result: 'failed', exitCode: 1, durationMs: 200, outputSummary: `${command} 失败摘要` }
}

/* ============================================================ *
 * TASK-040:路径审计 + 系统验证接入（ExecuteTaskUseCase 经可选 Port 注入）
 * ============================================================ */

describe('task:run — TASK-040 路径审计 + 系统验证接入', () => {
  it('路径越界 → blocked(needs-human)+ pathAudit.ok=false + 越界文件入违规清单', async () => {
    const task = mkTask({ id: 'TASK-090', name: 'trespass', allowedPaths: ['src/allowed.ts'] })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-090', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      workspaceInspector: new WorktreeAdapter(root, worktreesDir),
      executor: trespassingExecutor('TASK-090', 'docs/out-of-scope.md'),
    })

    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.pathAudit?.ok).toBe(false)
    expect(
      outcome.pathAudit?.violations.some((v) => v.path === 'docs/out-of-scope.md'),
    ).toBe(true)
    expect(mainRepo().readTask('TASK-090').status).toBe('blocked')
  })

  it('系统验证 passed（普通任务）→ reviewing（交 Reviewer）', async () => {
    const task = mkTask({ id: 'TASK-091', name: 'svp', noReview: false })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-091', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      verificationRunner: fakeRunner({
        'npm run typecheck': passedRunner('npm run typecheck'),
      }),
    })

    expect(outcome.finalStatus).toBe('reviewing')
    expect(outcome.systemVerification?.status).toBe('passed')
  })

  it('系统验证 passed（no_review）→ done', async () => {
    const task = mkTask({ id: 'TASK-092', name: 'svdone', noReview: true })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-092', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      verificationRunner: fakeRunner({
        'npm run typecheck': passedRunner('npm run typecheck'),
      }),
    })

    expect(outcome.finalStatus).toBe('done')
  })

  it('系统验证 failed（no_review）→ blocked（完成门禁）', async () => {
    const task = mkTask({ id: 'TASK-093', name: 'svblock', noReview: true })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-093', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      verificationRunner: fakeRunner({
        'npm run typecheck': failedRunner('npm run typecheck'),
      }),
    })

    expect(outcome.finalStatus).toBe('blocked')
    expect(outcome.systemVerification?.status).toBe('blocked')
  })

  it('模型自报 passed + 系统验证 failed → 以系统结果为准（no_review blocked,AC-010）', async () => {
    const task = mkTask({ id: 'TASK-094', name: 'override', noReview: true })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-094', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      // Executor 写模型自报 passed verification。
      executor: fakeResultExecutor('TASK-094', [
        { command: 'npm run typecheck', result: 'passed', notes: '模型自报通过' },
      ]),
      // 系统真实执行 failed。
      verificationRunner: fakeRunner({
        'npm run typecheck': failedRunner('npm run typecheck'),
      }),
    })

    // 门禁只认系统记录 → blocked（模型 passed 被系统 failed 覆盖）。
    expect(outcome.finalStatus).toBe('blocked')
    const rec = outcome.systemVerification?.verification.find(
      (v) => v.command === 'npm run typecheck',
    )
    expect(rec?.result).toBe('failed')
    expect(rec?.source).toBe('system')
  })

  it('DryRun 只写 .result.md → 路径审计排除 result_file 后通过（不误判越界）', async () => {
    const task = mkTask({
      id: 'TASK-095',
      name: 'resultok',
      noReview: false,
      allowedPaths: ['src/x.ts'],
    })
    commitTaskDef(root, task)

    const outcome = await runTask('TASK-095', {
      projectRoot: root,
      worktreesDir,
      nodeModulesRestorer: noopNodeModules,
      workspaceInspector: new WorktreeAdapter(root, worktreesDir),
      // 不注入 runner：聚焦路径审计（result_file 排除）。
    })

    // DryRun 只写 .result.md（默认允许），排除后无越界 → 审计过,普通任务 reviewing。
    expect(outcome.pathAudit?.ok).toBe(true)
    expect(outcome.finalStatus).toBe('reviewing')
  })
})
