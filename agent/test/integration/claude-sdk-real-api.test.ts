/**
 * TASK-035 集成测试：task:review CLI 接线（assembleReviewer composition root）+ CI 真实 API 契约。
 *
 * 分两层：
 *  1. 装配单元 / e2e（fake reviewer factory 驱动 onMessage）—— 验 composition root 装配策略
 *     （--reviewer local/sdk/auto 三态 + key 缺失回退 LocalReviewer，与 task:run 的关键差异）+
 *     reviewTaskWithAssembly 编排 + cost 入 outcome + runCli --reviewer 选项。零真实 API。
 *  2. CI 真实 API 契约（SPEC §11/§14-7/8）—— 有 ANTHROPIC_API_KEY / ZHIPU_API_KEY 时跑最小
 *     审查任务，断言契约（review_result ∈ 合法枚举 + system init model 反映档位映射）不断言文本；
 *     无 key 时该子集 skip 且显式标注（不静默通过）。
 *
 * 装配测试经 fake ReviewerFactory（捕获入参 + 驱动注入的 onMessage 回调模拟 SDK 流式）隔离真实 SDK，
 * 与 task-run.test.ts 的 fakeInvocationFactory 同构。CI 真实 API 经 ClaudeSdkReviewer（TASK-033）
 * 真实调用——TASK-035 接线的注入对象，结构兼容 Reviewer 契约（ARCHITECTURE §4）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ClaudeSdkReviewer, serializeDocument, TaskDocRepository } from '../../src/infrastructure/index.js'
import {
  assembleReviewer,
  LocalReviewer,
  reviewTaskWithAssembly,
  type ReviewerFactory,
} from '../../src/cli/commands/task-review.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'
import { composeProviderEnv, parseProfileConfig, resolveProfile } from '../../src/cli/config/provider-profile.js'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ResultFrontmatter, TaskFrontmatter, TaskId, TaskStatus } from '../../src/core/index.js'

/* ============================================================ *
 * 夹具：临时目录 + profile 配置 + fake reviewer factory + fake SDK 消息
 * ============================================================ */

let root = ''
let worktreesDir = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'task035-'))
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

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
          modelMapping: {
            haiku: 'claude-haiku-4-5',
            sonnet: 'claude-sonnet-5',
            opus: 'claude-opus-4-8',
          },
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
 * 构造 fake reviewer 工厂：捕获构造入参（断言 model / providerEnv / 回调注入），review() 时驱动
 * 注入的 onMessage 回调（模拟 SDK 流式 message）后返回固定审查结论。
 */
function fakeReviewerFactory(
  messages: readonly SDKMessage[],
  outcome: {
    review_result: 'approved' | 'rejected' | 'needs-human-confirmation'
    required_changes?: string[]
    findings?: string[]
  },
): { factory: ReviewerFactory; captured: { opts?: Parameters<ReviewerFactory>[0] } } {
  const captured: { opts?: Parameters<ReviewerFactory>[0] } = {}
  return {
    factory: (opts) => {
      captured.opts = opts
      return {
        name: 'fake-sdk-reviewer',
        async review() {
          for (const m of messages) opts.onMessage?.(m)
          return {
            review_result: outcome.review_result,
            required_changes: outcome.required_changes ?? [],
            findings: outcome.findings ?? [],
          }
        },
      }
    },
    captured,
  }
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
    result: '审查完成',
    session_id: 'sess-1',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  } as unknown as SDKMessage
}

/** 捕获 console.warn 全部调用参数（断言回退 LocalReviewer 的显著告警）。 */
function spyOnWarn(): string[] {
  const buffer: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    buffer.push(args.map((a) => String(a)).join(' '))
  })
  return buffer
}

/* ============================================================ *
 * 夹具：reviewing 态（临时 git 仓库 + worktree + .result.md，复用 task-review.test.ts 模式）
 * ============================================================ */

/** 执行 git 命令，退出码非 0 抛错。 */
function gitOk(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  if ((r.status ?? -1) !== 0) {
    throw new Error(`git ${args.join(' ')} 失败（${r.status}）：${r.stderr}`)
  }
  return (r.stdout ?? '').trim()
}

/** 初始化带初始提交的 main 分支临时仓库。 */
function initRepo(repoDir: string): void {
  gitOk(['init', '-b', 'main'], repoDir)
  gitOk(['config', 'user.email', 'reviewer@example.com'], repoDir)
  gitOk(['config', 'user.name', 'Reviewer'], repoDir)
  writeFileSync(join(repoDir, 'README.md'), '# init\n')
  writeFileSync(join(repoDir, '.gitignore'), '.worktrees/\nnode_modules/\n')
  gitOk(['add', '.'], repoDir)
  gitOk(['commit', '-m', 'init: 初始提交'], repoDir)
}

/** 任务文件名（去 docs/tasks/ 前缀与 .result.md 后缀）。 */
function fileStem(task: TaskFrontmatter): string {
  const rf = task.workflow_outputs.result_file
  return rf.slice('docs/tasks/'.length, rf.length - '.result.md'.length)
}

/** 构造合法 TaskFrontmatter（默认 reviewing / page）。 */
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

/** 构造合法 .result.md frontmatter（默认 completed + review）。 */
function mkResult(taskId: TaskId): ResultFrontmatter {
  return {
    task_id: taskId,
    execution_status: 'completed',
    modified_files: ['src/x.ts'],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: [{ command: 'npm run typecheck', result: 'passed', notes: 'fake 通过' }],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
}

/** 搭建 reviewing 态：提交任务定义 → 创建 worktree → 在 worktree 写 .result.md → 置 reviewing。 */
function setupReviewing(task: TaskFrontmatter, result: ResultFrontmatter): string {
  initRepo(root)
  mkdirSync(join(root, 'docs', 'tasks'), { recursive: true })
  writeFileSync(
    join(root, 'docs', 'tasks', `${fileStem(task)}.md`),
    serializeDocument({ ...task, status: 'ready' }, `# ${task.id}\n`),
  )
  gitOk(['add', 'docs'], root)
  gitOk(['commit', '-m', `chore: 任务定义 ${task.id}`], root)
  const wtPath = join(worktreesDir, task.id)
  gitOk(['worktree', 'add', '-b', `task/${task.id}`, wtPath, 'main'], root)
  writeFileSync(
    join(wtPath, task.workflow_outputs.result_file),
    serializeDocument(result, `# ${task.id} 执行结果\n`),
  )
  new TaskDocRepository(join(root, 'docs', 'tasks')).writeTask({ ...task, status: 'reviewing' })
  return wtPath
}

/* ============================================================ *
 * assembleReviewer composition root（TASK-035：profile → env → reviewer）
 * ============================================================ */

describe('task:review — assembleReviewer composition root', () => {
  it('--reviewer local → LocalReviewer，cost 为 undefined', () => {
    const { reviewer, observability } = assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-501',
      reviewerKind: 'local',
      stream: false,
      wireSigInt: false,
    })
    expect(reviewer.name).toBe('local-reviewer')
    expect(reviewer).toBeInstanceOf(LocalReviewer)
    expect(observability.getCost()).toBeUndefined()
    observability.close()
  })

  it('auto + 无配置文件 → 回退 LocalReviewer + 显著告警（不报错，与 task:run 关键差异）', () => {
    const warns = spyOnWarn()
    // 临时目录无 .caw/config.json（readProfileConfig 抛 ENOENT）。
    const { reviewer, observability } = assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-502',
      stream: false,
      wireSigInt: false,
    })
    expect(reviewer.name).toBe('local-reviewer')
    const w = warns.join('\n')
    expect(w).toContain('SDK reviewer 装配失败')
    expect(w).toContain('回退 LocalReviewer')
    observability.close()
  })

  it('auto + token 缺失 → 回退 LocalReviewer + 显著告警（不报错，§12 兜底）', () => {
    const configPath = writeProfileConfig(root)
    const warns = spyOnWarn()
    const { reviewer, observability } = assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-503',
      configPath,
      env: {}, // 无 ANTHROPIC_API_KEY
      stream: false,
      wireSigInt: false,
    })
    expect(reviewer.name).toBe('local-reviewer')
    expect(warns.join('\n')).toContain('回退 LocalReviewer')
    observability.close()
  })

  it('--reviewer sdk + token 就位 → fake factory 收到 providerEnv + 回调注入', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeReviewerFactory([], { review_result: 'approved' })
    const { reviewer, observability } = assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-504',
      reviewerKind: 'sdk',
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      reviewerFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(reviewer.name).toBe('fake-sdk-reviewer')
    // assembleReviewer 已调工厂，断言 providerEnv 注入官方 token 键 + 可观测回调注入。
    expect(captured.opts?.providerEnv['ANTHROPIC_API_KEY']).toBe('sk-test')
    expect(captured.opts?.providerEnv['ANTHROPIC_BASE_URL']).toBeUndefined()
    expect(captured.opts?.onMessage).toBe(observability.onMessage)
    expect(captured.opts?.abortController).toBe(observability.abortController)
    observability.close()
  })

  it('--reviewer sdk + token 缺失 → 抛错不回退（显式 SDK，对称 task:run --executor sdk）', () => {
    const configPath = writeProfileConfig(root)
    expect(() =>
      assembleReviewer({
        projectRoot: root,
        taskId: 'TASK-505',
        reviewerKind: 'sdk',
        configPath,
        env: {},
        stream: false,
        wireSigInt: false,
      }),
    ).toThrow(/token 环境变量.*未设置/)
  })

  it('--provider glm + ZHIPU_API_KEY → factory 注入第三方 token 键 + baseUrl + 档位映射', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeReviewerFactory([], { review_result: 'approved' })
    assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-506',
      provider: 'glm',
      configPath,
      env: { ZHIPU_API_KEY: 'zhipu-test' },
      reviewerFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(captured.opts?.providerEnv['ANTHROPIC_AUTH_TOKEN']).toBe('zhipu-test')
    expect(captured.opts?.providerEnv['ANTHROPIC_BASE_URL']).toBe(
      'https://open.bigmodel.cn/api/anthropic',
    )
    expect(captured.opts?.providerEnv['ANTHROPIC_DEFAULT_SONNET_MODEL']).toBe('glm-5.2')
  })

  it('--model 覆盖具体模型名 → factory 收到 model 字段', () => {
    const configPath = writeProfileConfig(root)
    const { factory, captured } = fakeReviewerFactory([], { review_result: 'approved' })
    assembleReviewer({
      projectRoot: root,
      taskId: 'TASK-507',
      model: 'custom-model-x',
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      reviewerFactory: factory,
      stream: false,
      wireSigInt: false,
    })
    expect(captured.opts?.model).toBe('custom-model-x')
  })

  it('非法 reviewerKind → 抛错不静默', () => {
    expect(() =>
      assembleReviewer({
        projectRoot: root,
        taskId: 'TASK-508',
        reviewerKind: 'foo' as 'local',
        stream: false,
        wireSigInt: false,
      }),
    ).toThrow(/--reviewer 只支持 local \| sdk/)
  })
})

/* ============================================================ *
 * reviewTaskWithAssembly e2e（装配 + 编排 + cost 入 outcome）
 * ============================================================ */

describe('task:review — reviewTaskWithAssembly e2e（装配 + 编排 + cost 入 outcome）', () => {
  it('SDK 路径（fake reviewer 驱动 onMessage）→ reviewer=fake、finalStatus done、cost 非空', async () => {
    const task = mkTask({ id: 'TASK-510', name: 'sdkrun' })
    setupReviewing(task, mkResult('TASK-510'))
    const configPath = writeProfileConfig(root)
    const { factory } = fakeReviewerFactory([fakeResultMessage()], { review_result: 'approved' })

    const outcome = await reviewTaskWithAssembly('TASK-510', {
      projectRoot: root,
      worktreesDir,
      configPath,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      reviewerFactory: factory,
      stream: false,
      wireSigInt: false,
    })

    expect(outcome.reviewer).toBe('fake-sdk-reviewer')
    expect(outcome.reviewResult).toBe('approved')
    expect(outcome.finalStatus).toBe('done')
    expect(outcome.merged).toBe(true)
    // cost 采集自 fake result 消息（§7）。
    expect(outcome.cost).toBeDefined()
    expect(outcome.cost?.totalCostUsd).toBeCloseTo(0.0567, 4)
    expect(outcome.cost?.inputTokens).toBe(100)
    expect(outcome.cost?.numTurns).toBe(4)
  })

  it('auto + 无配置（runCli 等价路径）→ 回退 LocalReviewer → approved → done（不破既有工作流）', async () => {
    const task = mkTask({ id: 'TASK-511', name: 'autofallback' })
    setupReviewing(task, mkResult('TASK-511'))
    // 不写 .caw/config.json → auto 装配失败 → 回退 LocalReviewer。
    const outcome = await reviewTaskWithAssembly('TASK-511', {
      projectRoot: root,
      worktreesDir,
      stream: false,
      wireSigInt: false,
    })
    expect(outcome.reviewer).toBe('local-reviewer')
    expect(outcome.reviewResult).toBe('approved')
    expect(outcome.finalStatus).toBe('done')
    // LocalReviewer 无 SDK 会话 → cost 为 undefined。
    expect(outcome.cost).toBeUndefined()
  })
})

/* ============================================================ *
 * runCli --reviewer 选项
 * ============================================================ */

describe('task:review — runCli --reviewer 选项', () => {
  it('--reviewer local → 成功退出码（approved → done + 合并）', async () => {
    const task = mkTask({ id: 'TASK-520', name: 'cli' })
    setupReviewing(task, mkResult('TASK-520'))

    const exit = await runCli([
      'task:review',
      'TASK-520',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
      '--reviewer',
      'local',
    ])
    expect(exit).toBe(CliExitCode.Success)
  })

  it('--reviewer foo（非法值）→ 非零退出码', async () => {
    const task = mkTask({ id: 'TASK-521', name: 'clifail' })
    setupReviewing(task, mkResult('TASK-521'))

    const exit = await runCli([
      'task:review',
      'TASK-521',
      '--project-root',
      root,
      '--worktrees-dir',
      worktreesDir,
      '--reviewer',
      'foo',
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * CI 真实 API 契约（SPEC §11 / §14-7/8）—— 有 key 跑、无 key skip 显式标注
 * ============================================================ */

/** 最小审查夹具：临时目录 + 最小 .result.md（供 ClaudeSdkReviewer 真实审查）。 */
function setupMinimalWorktree(prefix: string): { wtDir: string; result: ResultFrontmatter; resultFile: string } {
  const wtDir = mkdtempSync(join(tmpdir(), `ci-${prefix}-`))
  const resultFile = 'docs/tasks/TASK-CI.result.md'
  const result: ResultFrontmatter = {
    task_id: 'TASK-CI',
    execution_status: 'completed',
    modified_files: ['src/x.ts'],
    created_files: [],
    deleted_files: [],
    execution_commits: [],
    verification: [{ command: 'npm run typecheck', result: 'passed', notes: 'CI 最小任务' }],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
  mkdirSync(join(wtDir, 'docs', 'tasks'), { recursive: true })
  writeFileSync(join(wtDir, resultFile), serializeDocument(result, '# TASK-CI 执行结果\n'))
  // 改动文件（让模型 git diff / Read 有内容可查，控成本最小）。
  writeFileSync(join(wtDir, 'src', 'x.ts'), '// CI 最小改动\n')
  return { wtDir, result, resultFile }
}

/**
 * 真实 API 跑最小审查任务 + 断言契约（SPEC §11 不断言文本）。
 *
 * 经 ClaudeSdkReviewer（TASK-033，TASK-035 接线注入对象）真实调用：SdkReviewOutcome 的 review_result
 * ∈ 合法枚举即等价于 .review.md 过 ReviewFrontmatterSchema（review_result 是 Schema 的枚举字段）。
 * onMessage 捕获 system init 消息的 model 字段，断言反映 provider 档位映射（§14-8 启动校验）。
 */
async function runRealReviewContract(
  providerName: 'anthropic' | 'glm',
  modelPrefix: string,
): Promise<void> {
  const { wtDir, result, resultFile } = setupMinimalWorktree(providerName)
  // profile 配置（与 caw init DEFAULT_PROFILE_CONFIG 同源，控最小成本）。
  const config = parseProfileConfig(
    JSON.stringify({
      provider: providerName,
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
  )
  const providerEnv = composeProviderEnv(config)
  const { profile } = resolveProfile(config, providerName)

  // 捕获 system init 消息的 model（§14-8 启动校验：反映档位映射）。
  let initModel: string | undefined
  const onMessage = (m: SDKMessage): void => {
    if (m.type === 'system') {
      const sub = (m as { subtype?: string }).subtype
      if (sub === 'init') initModel = (m as { model?: string }).model
    }
  }

  const reviewer = new ClaudeSdkReviewer({
    providerEnv,
    model: profile.modelMapping.haiku,
    onMessage,
    abortController: new AbortController(),
  })

  try {
    const outcome = await reviewer.review({
      task_id: 'TASK-CI',
      result,
      worktree_path: wtDir,
      result_file: resultFile,
    })
    // 契约断言（不断言文本）：review_result ∈ 合法枚举 + 结构字段为数组。
    expect(['approved', 'rejected', 'needs-human-confirmation']).toContain(outcome.review_result)
    expect(Array.isArray(outcome.required_changes)).toBe(true)
    expect(Array.isArray(outcome.findings)).toBe(true)
    // §14-8：system init model 反映 provider 档位映射。
    expect(initModel).toBeTruthy()
    expect(initModel).toContain(modelPrefix)
  } finally {
    rmSync(wtDir, { recursive: true, force: true })
  }
}

const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY
const hasGlmKey = !!process.env.ZHIPU_API_KEY

describe.skipIf(!hasAnthropicKey)(
  'CI 真实 API 契约 — anthropic（有 ANTHROPIC_API_KEY，SPEC §14-7）',
  () => {
    it(
      '跑最小审查任务 → review_result ∈ 合法枚举 + system init model 反映 anthropic 档位',
      async () => {
        await runRealReviewContract('anthropic', 'claude-')
      },
      180_000,
    )
  },
)

describe.skipIf(hasAnthropicKey)(
  'CI 真实 API 契约 — anthropic（无 key skip，显式标注不静默）',
  () => {
    it('ANTHROPIC_API_KEY 未设置 → 该子集 skip（显式标注，不静默通过）', () => {
      // 本测试仅在有 key 时跳过、无 key 时跑（显式标注 skip 意图），避免 CI 静默 pass。
      console.warn(
        'CI skip: ANTHROPIC_API_KEY 未设置——真实 API 契约子集（anthropic）未跑。' +
          '在 CI 配置该 secret 后该子集自动启用（describe.skipIf 条件反转）。',
      )
      expect(hasAnthropicKey).toBe(false)
    })
  },
)

describe.skipIf(!hasGlmKey)('CI 真实 API 契约 — glm（有 ZHIPU_API_KEY，SPEC §14-8 多 provider）', () => {
  it(
    '--provider glm 跑通最小审查任务 → review_result ∈ 合法枚举 + model 反映 GLM 档位映射',
    async () => {
      await runRealReviewContract('glm', 'glm-')
    },
    180_000,
  )
})

describe.skipIf(hasGlmKey)('CI 真实 API 契约 — glm（无 key skip，显式标注不静默）', () => {
  it('ZHIPU_API_KEY 未设置 → 该子集 skip（显式标注，不静默通过）', () => {
    console.warn(
      'CI skip: ZHIPU_API_KEY 未设置——真实 API 契约子集（glm）未跑。' +
        '在 CI 配置该 secret 后该子集自动启用（describe.skipIf 条件反转）。',
    )
    expect(hasGlmKey).toBe(false)
  })
})
