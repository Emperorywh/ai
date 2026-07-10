import { describe, expect, it } from 'vitest'
import {
  ClaudeSdkInvocationImpl,
  classifyFault,
  extractResultJson,
  type ClaudeSdkInvocationOptions,
} from '../../../src/infrastructure/index.js'
import type {
  SdkRunInput,
  SdkRunReport,
} from '../../../src/infrastructure/sdk/claude-sdk-adapter.js'
import type {
  SdkSessionInput,
  SdkSessionReport,
} from '../../../src/infrastructure/sdk/sdk-client.js'

/* ============================================================ *
 * 夹具构造
 * ============================================================ */

/** 构造合法 SdkRunInput（TASK-022 + 两条验证命令）。 */
function makeInput(): SdkRunInput {
  return {
    worktreePath: '/fake/worktree',
    startupPrompt: [
      '你现在是本项目的 Task Executor。',
      '',
      '本次上下文只执行 docs/tasks/TASK-022-foo.md。',
    ].join('\n'),
    contextPack: {
      required_docs: ['AGENTS.md', 'docs/ARCHITECTURE.md'],
      optional_doc_excerpts: [],
      source_files: ['src/core/foo.ts'],
    },
    permissionBoundary: {
      allowed_paths: ['src/infrastructure/sdk/'],
      forbidden_paths: ['src/core/'],
      permissions: ['write_files'],
      verification_commands: [
        { command: 'npm run typecheck', source: 'project', requires_permissions: [] },
        { command: 'npm test -- infrastructure/sdk', source: 'task', requires_permissions: [] },
      ],
    },
  }
}

/** 构造 SdkSessionReport（默认 success + 非空 resultText，resultMessage 留空对象占位）。 */
function sessionReport(
  resultText: string | null,
  overrides?: Partial<SdkSessionReport>,
): SdkSessionReport {
  return {
    subtype: 'success',
    totalCostUsd: 0.0123,
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    numTurns: 3,
    durationMs: 5000,
    durationApiMs: 4000,
    isError: false,
    resultText,
    // 本实现不读 resultMessage 字段，测试用空对象占位（满足类型）。
    resultMessage: {} as SdkSessionReport['resultMessage'],
    ...overrides,
  }
}

/** 构造 ```result-frontmatter fenced 块文本。 */
function fenced(json: string): string {
  return '```result-frontmatter\n' + json + '\n```'
}

/** 模型合法产出的 JSON（completed + 一条 passed 验证）。 */
function validResultJson(): string {
  return JSON.stringify({
    executionStatus: 'completed',
    modifiedFiles: ['src/foo.ts'],
    createdFiles: ['docs/new.md'],
    deletedFiles: [],
    verification: [
      { command: 'npm run typecheck', result: 'passed', notes: '' },
      { command: 'npm test -- infrastructure/sdk', result: 'passed', notes: '' },
    ],
    globalUpdateRequests: { progress: [], decisions: [], issues: [] },
    nextAction: 'review',
    summary: '任务完成',
  })
}

/** 队列式 fake 会话执行器：按序返回 report 或抛 error，记录每次入参。 */
function sessionQueue(
  behaviors: ReadonlyArray<SdkSessionReport | Error>,
): {
  runSession: ClaudeSdkInvocationOptions['runSession']
  calls: SdkSessionInput[]
} {
  const calls: SdkSessionInput[] = []
  let i = 0
  return {
    runSession: async (input: SdkSessionInput) => {
      calls.push(input)
      const behavior = behaviors[i]
      i++
      if (behavior === undefined) {
        throw new Error(`sessionQueue 耗尽：第 ${i} 次调用无预设行为（测试行为数组不足）`)
      }
      if (behavior instanceof Error) {
        throw behavior
      }
      return behavior
    },
    calls,
  }
}

/** 记录延迟的瞬时 sleep（测试不实际等待）。 */
function recordingSleep(): {
  sleep: (ms: number) => Promise<void>
  delays: number[]
} {
  const delays: number[] = []
  return {
    sleep: async (ms: number) => {
      delays.push(ms)
    },
    delays,
  }
}

/** 用 fake 装配 invocation 的便利工厂（默认瞬时 sleep + 零抖动 + 不重试退避基数小）。 */
function makeInvocation(
  opts: Omit<ClaudeSdkInvocationOptions, 'providerEnv'> &
    Partial<Pick<ClaudeSdkInvocationOptions, 'providerEnv'>>,
): ClaudeSdkInvocationImpl {
  return new ClaudeSdkInvocationImpl({
    providerEnv: { ANTHROPIC_API_KEY: 'fake-key' },
    ...opts,
  })
}

/* ============================================================ *
 * classifyFault（§8 容错分类）
 * ============================================================ */

describe('classifyFault', () => {
  it('AbortError 归 abort', () => {
    const e = new Error('The user aborted a request')
    e.name = 'AbortError'
    expect(classifyFault(e)).toBe('abort')
  })

  it('消息含 abort 归 abort', () => {
    expect(classifyFault(new Error('operation aborted'))).toBe('abort')
  })

  it('401 / 403 / unauthor / forbidden / invalid api key 归 auth', () => {
    expect(classifyFault(new Error('Request failed with status 401 Unauthorized'))).toBe('auth')
    expect(classifyFault(new Error('403 Forbidden'))).toBe('auth')
    expect(classifyFault(new Error('Unauthorized access'))).toBe('auth')
    expect(classifyFault(new Error('forbidden resource'))).toBe('auth')
    expect(classifyFault(new Error('Invalid API Key provided'))).toBe('auth')
    expect(classifyFault(new Error('authentication failed for token'))).toBe('auth')
  })

  it('429 / 5xx / ECONNRESET / fetch failed / timeout / rate limit 归 network', () => {
    expect(classifyFault(new Error('Request failed with status 429'))).toBe('network')
    expect(classifyFault(new Error('500 Internal Server Error'))).toBe('network')
    expect(classifyFault(new Error('503 Service Unavailable'))).toBe('network')
    expect(classifyFault(new Error('ECONNRESET socket hang up'))).toBe('network')
    expect(classifyFault(new Error('fetch failed'))).toBe('network')
    expect(classifyFault(new Error('request timeout'))).toBe('network')
    expect(classifyFault(new Error('rate limit exceeded'))).toBe('network')
    expect(classifyFault(new Error('ETIMEDOUT'))).toBe('network')
  })

  it('不把更长数字串里的 401/429/500 误判（须独立数字）', () => {
    expect(classifyFault(new Error('error code 14013 unknown'))).toBe('unknown')
    expect(classifyFault(new Error('processed 4290 items'))).toBe('unknown')
    expect(classifyFault(new Error('exit code 5000'))).toBe('unknown')
  })

  it('其余归 unknown', () => {
    expect(classifyFault(new TypeError('something broke'))).toBe('unknown')
    expect(classifyFault(new Error('unexpected payload'))).toBe('unknown')
    expect(classifyFault('string error')).toBe('unknown')
  })
})

/* ============================================================ *
 * extractResultJson（§4.2 fenced 块提取）
 * ============================================================ */

describe('extractResultJson', () => {
  it('从 ```result-frontmatter 块提取并 JSON.parse', () => {
    const text = '我完成了任务。\n```result-frontmatter\n{"a":1}\n```\n'
    expect(extractResultJson(text)).toEqual({ ok: true, data: { a: 1 } })
  })

  it('有多块时取最后一块', () => {
    const text =
      '```result-frontmatter\n{"a":1}\n```\n说明\n```result-frontmatter\n{"b":2}\n```'
    expect(extractResultJson(text)).toEqual({ ok: true, data: { b: 2 } })
  })

  it('无 result-frontmatter 块时回退 ```json 块', () => {
    const text = '```json\n{"c":3}\n```'
    expect(extractResultJson(text)).toEqual({ ok: true, data: { c: 3 } })
  })

  it('result-frontmatter 块存在但 JSON 非法 → 报 json-parse 失败（不回退 json 块）', () => {
    const text = '```result-frontmatter\n{bad json}\n```\n```json\n{"ok":true}\n```'
    const result = extractResultJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('json-parse')
    }
  })

  it('无任何 fenced 块 → no-fenced-block', () => {
    const result = extractResultJson('纯文本输出，无 JSON 块')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no-fenced-block')
    }
  })

  it('null / 空串 → no-fenced-block', () => {
    expect(extractResultJson(null).ok).toBe(false)
    expect(extractResultJson('   ').ok).toBe(false)
  })
})

/* ============================================================ *
 * ClaudeSdkInvocationImpl
 * ============================================================ */

describe('ClaudeSdkInvocationImpl', () => {
  it('name 为 claude-sdk', () => {
    expect(makeInvocation({}).name).toBe('claude-sdk')
  })

  /* ---- 正常产出 + 入参装配 ---- */

  it('正常产出：模型产合法 JSON → SdkRunReport 字段正确 + 会话只调一次', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const inv = makeInvocation({ runSession })
    const report = await inv.run(makeInput())

    expect(report.executionStatus).toBe('completed')
    expect(report.nextAction).toBe('review')
    expect(report.modifiedFiles).toEqual(['src/foo.ts'])
    expect(report.createdFiles).toEqual(['docs/new.md'])
    expect(report.deletedFiles).toEqual([])
    expect(report.verification).toHaveLength(2)
    expect(report.verification[0]).toMatchObject({
      command: 'npm run typecheck',
      result: 'passed',
    })
    expect(report.globalUpdateRequests).toEqual({
      progress: [],
      decisions: [],
      issues: [],
    })
    // summary 含模型摘要 + cost 行。
    expect(report.summary).toContain('任务完成')
    expect(report.summary).toContain('$0.0123')
    expect(report.summary).toContain('3 轮')
    // 只调用一次（无重试）。
    expect(calls).toHaveLength(1)
  })

  it('SdkRunInput 正确投影为 SdkSessionInput（cwd/env/model/append/prompt）', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const inv = makeInvocation({
      runSession,
      providerEnv: { ANTHROPIC_API_KEY: 'key-1', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7' },
      model: 'glm-5.2',
    })
    const input = makeInput()
    await inv.run(input)

    const sess = calls[0]
    expect(sess).toBeDefined()
    expect(sess?.cwd).toBe(input.worktreePath)
    expect(sess?.env).toEqual({
      ANTHROPIC_API_KEY: 'key-1',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7',
    })
    expect(sess?.model).toBe('glm-5.2')
    expect(sess?.abortController).toBeDefined()
    // prompt 含 startup_prompt + Context Pack 清单。
    expect(sess?.prompt).toContain('本次上下文只执行 docs/tasks/TASK-022-foo.md')
    expect(sess?.prompt).toContain('AGENTS.md')
    expect(sess?.prompt).toContain('src/core/foo.ts')
    // systemPromptAppend 含边界声明 + §4.2 产出契约。
    expect(sess?.systemPromptAppend).toContain('执行边界')
    expect(sess?.systemPromptAppend).toContain('src/infrastructure/sdk/')
    expect(sess?.systemPromptAppend).toContain('src/core/')
    expect(sess?.systemPromptAppend).toContain('result-frontmatter')
  })

  it('model 省略时 SdkSessionInput 不含 model 键（用 SDK 默认模型）', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const inv = makeInvocation({ runSession })
    await inv.run(makeInput())

    expect(calls[0]).toBeDefined()
    expect('model' in (calls[0] as SdkSessionInput)).toBe(false)
  })

  /* ---- JSON 重试（§4.3）---- */

  it('JSON parse 失败：重试 N=2 次后第 3 次成功 → 共调 3 次，report 正常', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport(fenced('{bad json 1}')), // 首次非法
      sessionReport(fenced('{bad json 2}')), // 重试 1 非法
      sessionReport(fenced(validResultJson())), // 重试 2 成功
    ])
    const inv = makeInvocation({ runSession, jsonRetryMax: 2 })
    const report = await inv.run(makeInput())

    expect(report.executionStatus).toBe('completed')
    expect(calls).toHaveLength(3)
    // 重试 prompt 含 parse 反馈（§4.3「把 safeParse.error 作为反馈追加进对话」）。
    expect(calls[1]?.prompt).toContain('上次产出校验失败')
    // 首次 prompt 无反馈。
    expect(calls[0]?.prompt).not.toContain('上次产出校验失败')
  })

  it('缺 fenced 块同样触发 JSON 重试', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport('纯文本无 JSON 块'),
      sessionReport(fenced(validResultJson())),
    ])
    const inv = makeInvocation({ runSession, jsonRetryMax: 2 })
    const report = await inv.run(makeInput())

    expect(report.executionStatus).toBe('completed')
    expect(calls).toHaveLength(2)
  })

  it('JSON 重试耗尽：降级 failed+needs-human，verification skipped，issues 记 parse 错', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport(fenced('{bad}')),
      sessionReport(fenced('{bad}')),
      sessionReport(fenced('{bad}')),
    ])
    const inv = makeInvocation({ runSession, jsonRetryMax: 2 })
    const report = await inv.run(makeInput())

    // 首次 + 2 次重试 = 3 次。
    expect(calls).toHaveLength(3)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
    // 三类文件清单留空。
    expect(report.modifiedFiles).toEqual([])
    // verification 全 skipped，保留 allowlist 命令顺序。
    expect(report.verification).toHaveLength(2)
    expect(report.verification.every((v) => v.result === 'skipped')).toBe(true)
    expect(report.verification[0]?.command).toBe('npm run typecheck')
    // issues 记 parse 错（提取失败 / 校验失败均为「JSON parse 失败」降级路径）。
    expect(report.globalUpdateRequests.issues).toHaveLength(1)
    expect(report.globalUpdateRequests.issues[0]?.title).toContain('重试耗尽')
    expect(report.globalUpdateRequests.issues[0]?.status).toBe('open')
    expect(report.globalUpdateRequests.issues[0]?.created_from_task).toBe('TASK-022')
  })

  it('JSON safeParse 失败（字段非法）也触发重试与降级', async () => {
    // executionStatus / nextAction 给非法枚举值 → safeParse 失败。
    const badFieldJson = fenced(
      JSON.stringify({
        executionStatus: 'WRONG',
        nextAction: 'review',
      }),
    )
    const { runSession, calls } = sessionQueue([
      sessionReport(badFieldJson),
      sessionReport(badFieldJson),
      sessionReport(badFieldJson),
    ])
    const inv = makeInvocation({ runSession, jsonRetryMax: 2 })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(3)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
  })

  /* ---- 容错分类（§8）---- */

  it('鉴权错：立即 failed，不重试（会话只调一次）', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('Request failed with status 401 Unauthorized'),
    ])
    const inv = makeInvocation({ runSession })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(1)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
    expect(report.globalUpdateRequests.issues[0]?.title).toContain('鉴权')
  })

  it('网络错：指数退避重试 techRetryMax=3 次耗尽后降级 failed', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('Request failed with status 503'),
      new Error('ECONNRESET'),
      new Error('429 Too Many Requests'),
      new Error('500 Internal Server Error'),
    ])
    const rec = recordingSleep()
    const inv = makeInvocation({
      runSession,
      sleep: rec.sleep,
      random: () => 0, // 零抖动，延迟 = base × 2^n
      techRetryMax: 3,
      backoffBaseMs: 1000,
    })
    const report = await inv.run(makeInput())

    // 首次 + 3 次重试 = 4 次。
    expect(calls).toHaveLength(4)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
    expect(report.globalUpdateRequests.issues[0]?.title).toContain('网络')
    // 退避延迟序列：1000, 2000, 4000（base × 2^0/1/2）。
    expect(rec.delays).toEqual([1000, 2000, 4000])
  })

  it('网络错重试中成功：退避 2 次后第 3 次成功', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('fetch failed'),
      new Error('fetch failed'),
      sessionReport(fenced(validResultJson())),
    ])
    const rec = recordingSleep()
    const inv = makeInvocation({
      runSession,
      sleep: rec.sleep,
      random: () => 0,
      techRetryMax: 3,
    })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(3)
    expect(rec.delays).toEqual([1000, 2000])
    expect(report.executionStatus).toBe('completed')
  })

  it('SIGINT abort：捕获 AbortError，产降级 result（blocked+needs-human），会话只调一次', async () => {
    const abortErr = new Error('The user aborted a request')
    abortErr.name = 'AbortError'
    const { runSession, calls } = sessionQueue([abortErr])
    const inv = makeInvocation({ runSession })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(1)
    // §9 中断：blocked（保留 worktree）+ needs-human。
    expect(report.executionStatus).toBe('blocked')
    expect(report.nextAction).toBe('needs-human')
    expect(report.globalUpdateRequests.issues[0]?.title).toContain('中断')
  })

  it('abortController 预先 abort：run 直接降级，不调用会话', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const controller = new AbortController()
    controller.abort()
    const inv = makeInvocation({ runSession, abortController: controller })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(0)
    expect(report.executionStatus).toBe('blocked')
    expect(report.nextAction).toBe('needs-human')
  })

  it('is_error 会话：降级 failed+needs-human（非瞬时，不重试），summary 含 subtype', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport('模型拒绝执行', { isError: true, subtype: 'error_during_execution' }),
    ])
    const inv = makeInvocation({ runSession })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(1)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
    expect(report.summary).toContain('error_during_execution')
  })

  it('unknown 错误：显式降级 failed+needs-human，不静默', async () => {
    const { runSession, calls } = sessionQueue([new TypeError('unexpected structure')])
    const inv = makeInvocation({ runSession })
    const report = await inv.run(makeInput())

    expect(calls).toHaveLength(1)
    expect(report.executionStatus).toBe('failed')
    expect(report.nextAction).toBe('needs-human')
    expect(report.globalUpdateRequests.issues[0]?.title).toContain('未知')
    expect(report.summary).toContain('unexpected structure')
  })

  /* ---- §7 可观测回调透传 ---- */

  it('onMessage / stderr 经构造注入透传到 SdkSessionInput', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const onMessage = (): void => {}
    const stderr = (): void => {}
    const inv = makeInvocation({ runSession, onMessage, stderr })
    await inv.run(makeInput())

    expect(calls[0]?.onMessage).toBe(onMessage)
    expect(calls[0]?.stderr).toBe(stderr)
  })

  /* ---- 降级 verification 一致性（§4.3 verification 标 skipped）---- */

  it('降级时空 verification allowlist → verification 为空数组（仍为合法 SdkRunReport）', async () => {
    const { runSession } = sessionQueue([new Error('401 Unauthorized')])
    const inv = makeInvocation({ runSession })
    const input: SdkRunInput = {
      ...makeInput(),
      permissionBoundary: {
        allowed_paths: ['src/infrastructure/sdk/'],
        forbidden_paths: ['src/core/'],
        permissions: ['write_files'],
        verification_commands: [],
      },
    }
    const report = await inv.run(input)

    expect(report.executionStatus).toBe('failed')
    expect(report.verification).toEqual([])
  })

  /* ---- 返回的 report 形态契约（可被 ClaudeSdkExecutor 消费）---- */

  it('正常产出 report 满足 SdkRunReport 形态（executionStatus 三值之一 + nextAction 合法）', async () => {
    const { runSession } = sessionQueue([sessionReport(fenced(validResultJson()))])
    const inv = makeInvocation({ runSession })
    const report: SdkRunReport = await inv.run(makeInput())

    expect(['completed', 'blocked', 'failed']).toContain(report.executionStatus)
    expect(['review', 'retry', 'needs-human', 'cancel']).toContain(report.nextAction)
    expect(Array.isArray(report.modifiedFiles)).toBe(true)
    expect(Array.isArray(report.globalUpdateRequests.issues)).toBe(true)
  })
})
