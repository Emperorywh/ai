import { describe, expect, it } from 'vitest'
import {
  ClaudeSdkReviewer,
  extractReviewJson,
  type ClaudeSdkReviewerOptions,
  type SdkReviewInput,
  type SdkReviewOutcome,
} from '../../../src/infrastructure/index.js'
import type { ResultFrontmatter } from '../../../src/core/index.js'
import type {
  SdkSessionInput,
  SdkSessionReport,
} from '../../../src/infrastructure/sdk/sdk-client.js'

// 注：ClaudeSdkReviewer 不 import cli 的 Reviewer 契约（分层 infra↛cli + forbidden_paths），
// 靠 TS 结构类型兼容让 TASK-035 wiring 注入（ARCHITECTURE §4「无需 implements」）。结构兼容性
// 由 TASK-035 在 task-review.ts 内的 wiring typecheck 自然验证（单一 ResultFrontmatter identity，
// 不触发 test 跨文件类型 identity 怪异），故本测试不内联 cli 类型断言。

/* ============================================================ *
 * 夹具构造
 * ============================================================ */

/** 构造合法 ResultFrontmatter（被审查的 .result.md frontmatter，completed + 两条 passed 验证）。 */
function makeResultFrontmatter(overrides?: Partial<ResultFrontmatter>): ResultFrontmatter {
  const base: ResultFrontmatter = {
    task_id: 'TASK-099',
    execution_status: 'completed',
    modified_files: ['src/foo.ts'],
    created_files: ['docs/bar.md'],
    deleted_files: [],
    execution_commits: [],
    verification: [
      { command: 'npm run typecheck', result: 'passed', notes: '' },
      { command: 'npm test', result: 'passed', notes: '全绿' },
    ],
    global_update_requests: { progress: [], decisions: [], issues: [] },
    next_action: 'review',
  }
  return { ...base, ...overrides }
}

/** 构造合法 SdkReviewInput（结构对齐 ReviewInput：task_id / result / worktree_path / result_file）。 */
function makeReviewInput(overrides?: Partial<SdkReviewInput>): SdkReviewInput {
  return {
    task_id: 'TASK-099',
    result: makeResultFrontmatter(),
    worktree_path: '/fake/worktree',
    result_file: 'docs/tasks/TASK-099-foo.result.md',
    ...overrides,
  }
}

/** 构造 SdkSessionReport（默认 success + 非空 resultText，resultMessage 留空对象占位）。 */
function sessionReport(
  resultText: string | null,
  overrides?: Partial<SdkSessionReport>,
): SdkSessionReport {
  return {
    subtype: 'success',
    totalCostUsd: 0.0088,
    inputTokens: 80,
    outputTokens: 160,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    numTurns: 2,
    durationMs: 4000,
    durationApiMs: 3000,
    isError: false,
    resultText,
    // 本实现不读 resultMessage 字段，测试用空对象占位（满足类型）。
    resultMessage: {} as SdkSessionReport['resultMessage'],
    ...overrides,
  }
}

/** 构造 ```review-frontmatter fenced 块文本。 */
function fencedReview(json: string): string {
  return '```review-frontmatter\n' + json + '\n```'
}

/** 模型合法产出（approved，空 required_changes + 一条 finding）。 */
function approvedJson(): string {
  return JSON.stringify({
    review_result: 'approved',
    required_changes: [],
    findings: ['审查通过，代码符合规范'],
  })
}

/** 模型合法产出（rejected，非空 required_changes）。 */
function rejectedJson(): string {
  return JSON.stringify({
    review_result: 'rejected',
    required_changes: ['必须补充单元测试', '必须修复分层越界'],
    findings: ['发现 src/core 反向依赖 application'],
  })
}

/** 队列式 fake 会话执行器：按序返回 report 或抛 error，记录每次入参。 */
function sessionQueue(
  behaviors: ReadonlyArray<SdkSessionReport | Error>,
): {
  runSession: ClaudeSdkReviewerOptions['runSession']
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

/** 用 fake 装配 reviewer 的便利工厂（默认填 providerEnv）。 */
function makeReviewer(
  opts: Omit<ClaudeSdkReviewerOptions, 'providerEnv'> &
    Partial<Pick<ClaudeSdkReviewerOptions, 'providerEnv'>>,
): ClaudeSdkReviewer {
  return new ClaudeSdkReviewer({
    providerEnv: { ANTHROPIC_API_KEY: 'fake-key' },
    ...opts,
  })
}

/* ============================================================ *
 * extractReviewJson（§5 fenced 块提取）
 * ============================================================ */

describe('extractReviewJson', () => {
  it('从 ```review-frontmatter 块提取并 JSON.parse', () => {
    const text = '审查完成。\n```review-frontmatter\n{"a":1}\n```\n'
    expect(extractReviewJson(text)).toEqual({ ok: true, data: { a: 1 } })
  })

  it('有多块时取最后一块', () => {
    const text =
      '```review-frontmatter\n{"a":1}\n```\n说明\n```review-frontmatter\n{"b":2}\n```'
    expect(extractReviewJson(text)).toEqual({ ok: true, data: { b: 2 } })
  })

  it('无 review-frontmatter 块时回退 ```json 块', () => {
    const text = '```json\n{"c":3}\n```'
    expect(extractReviewJson(text)).toEqual({ ok: true, data: { c: 3 } })
  })

  it('review-frontmatter 块存在但 JSON 非法 → 报 json-parse 失败（不回退 json 块）', () => {
    const text = '```review-frontmatter\n{bad json}\n```\n```json\n{"ok":true}\n```'
    const result = extractReviewJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('json-parse')
    }
  })

  it('无任何 fenced 块 → no-fenced-block', () => {
    const result = extractReviewJson('纯文本输出，无 JSON 块')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no-fenced-block')
    }
  })

  it('null / 空串 → no-fenced-block', () => {
    expect(extractReviewJson(null).ok).toBe(false)
    expect(extractReviewJson('   ').ok).toBe(false)
  })
})

/* ============================================================ *
 * ClaudeSdkReviewer
 * ============================================================ */

describe('ClaudeSdkReviewer', () => {
  it('name 为 claude-sdk-reviewer', () => {
    expect(makeReviewer({}).name).toBe('claude-sdk-reviewer')
  })

  /* ---- 正常产出 + 入参装配 ---- */

  it('正常产出：模型产合法 approved JSON → ReviewOutcome 字段正确 + 会话只调一次', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fencedReview(approvedJson()))])
    const reviewer = makeReviewer({ runSession })
    const outcome: SdkReviewOutcome = await reviewer.review(makeReviewInput())

    expect(outcome.review_result).toBe('approved')
    expect(outcome.required_changes).toEqual([])
    expect(outcome.findings).toEqual(['审查通过，代码符合规范'])
    // 只调用一次（无重试）。
    expect(calls).toHaveLength(1)
  })

  it('正常产出：模型产 rejected JSON → required_changes 透传', async () => {
    const { runSession } = sessionQueue([sessionReport(fencedReview(rejectedJson()))])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(outcome.review_result).toBe('rejected')
    expect(outcome.required_changes).toEqual(['必须补充单元测试', '必须修复分层越界'])
    expect(outcome.findings).toEqual(['发现 src/core 反向依赖 application'])
  })

  it('SdkReviewInput 正确投影为 SdkSessionInput（cwd=worktree/env/model/append/prompt）', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fencedReview(approvedJson()))])
    const reviewer = makeReviewer({
      runSession,
      providerEnv: { ANTHROPIC_AUTH_TOKEN: 'glm-token', ANTHROPIC_BASE_URL: 'https://glm' },
      model: 'glm-5.2',
    })
    const input = makeReviewInput()
    await reviewer.review(input)

    const sess = calls[0]
    expect(sess).toBeDefined()
    // cwd = worktree_path（模型在此读改动）。
    expect(sess?.cwd).toBe(input.worktree_path)
    expect(sess?.env).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'glm-token',
      ANTHROPIC_BASE_URL: 'https://glm',
    })
    expect(sess?.model).toBe('glm-5.2')
    expect(sess?.abortController).toBeDefined()
    // prompt 含 task_id + 执行结果摘要 + worktree/result_file 路径。
    expect(sess?.prompt).toContain('TASK-099')
    expect(sess?.prompt).toContain('completed')
    expect(sess?.prompt).toContain(input.worktree_path)
    expect(sess?.prompt).toContain(input.result_file)
    expect(sess?.prompt).toContain('src/foo.ts')
    // systemPromptAppend 含审查清单（Readme §15）+ review-frontmatter 产出契约。
    expect(sess?.systemPromptAppend).toContain('审查清单')
    expect(sess?.systemPromptAppend).toContain('禁止修改范围')
    expect(sess?.systemPromptAppend).toContain('分层设计')
    expect(sess?.systemPromptAppend).toContain('review-frontmatter')
    expect(sess?.systemPromptAppend).toContain('needs-human-confirmation')
  })

  it('model 省略时 SdkSessionInput 不含 model 键（用 SDK 默认模型）', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fencedReview(approvedJson()))])
    const reviewer = makeReviewer({ runSession })
    await reviewer.review(makeReviewInput())

    expect(calls[0]).toBeDefined()
    expect('model' in (calls[0] as SdkSessionInput)).toBe(false)
  })

  /* ---- JSON 重试（§4.3，耗尽降级 needs-human-confirmation 不伪造 approved）---- */

  it('JSON parse 失败：重试 N=2 次后第 3 次成功 → 共调 3 次，outcome 正常', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport(fencedReview('{bad json 1}')), // 首次非法
      sessionReport(fencedReview('{bad json 2}')), // 重试 1 非法
      sessionReport(fencedReview(approvedJson())), // 重试 2 成功
    ])
    const reviewer = makeReviewer({ runSession, jsonRetryMax: 2 })
    const outcome = await reviewer.review(makeReviewInput())

    expect(outcome.review_result).toBe('approved')
    expect(calls).toHaveLength(3)
    // 重试 prompt 含 parse 反馈（§4.3「把 safeParse.error 作为反馈追加进对话」）。
    expect(calls[1]?.prompt).toContain('上次产出校验失败')
    // 首次 prompt 无反馈。
    expect(calls[0]?.prompt).not.toContain('上次产出校验失败')
  })

  it('缺 fenced 块同样触发 JSON 重试', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport('纯文本无 JSON 块'),
      sessionReport(fencedReview(approvedJson())),
    ])
    const reviewer = makeReviewer({ runSession, jsonRetryMax: 2 })
    const outcome = await reviewer.review(makeReviewInput())

    expect(outcome.review_result).toBe('approved')
    expect(calls).toHaveLength(2)
  })

  it('JSON 重试耗尽：降级 needs-human-confirmation + findings 记 parse 错（不伪造 approved）', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport(fencedReview('{bad}')),
      sessionReport(fencedReview('{bad}')),
      sessionReport(fencedReview('{bad}')),
    ])
    const reviewer = makeReviewer({ runSession, jsonRetryMax: 2 })
    const outcome = await reviewer.review(makeReviewInput())

    // 首次 + 2 次重试 = 3 次。
    expect(calls).toHaveLength(3)
    // §5：耗尽降级 needs-human-confirmation，不伪造 approved。
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.required_changes).toEqual([])
    // findings 记降级原因（含 task_id 便于追溯）。
    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]).toContain('TASK-099')
    expect(outcome.findings[0]).toContain('重试耗尽')
  })

  it('JSON safeParse 失败（review_result 非法枚举）也触发重试与降级', async () => {
    // review_result 给非法值 → safeParse 失败。
    const badFieldJson = fencedReview(
      JSON.stringify({ review_result: 'WRONG', required_changes: [], findings: [] }),
    )
    const { runSession, calls } = sessionQueue([
      sessionReport(badFieldJson),
      sessionReport(badFieldJson),
      sessionReport(badFieldJson),
    ])
    const reviewer = makeReviewer({ runSession, jsonRetryMax: 2 })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(3)
    expect(outcome.review_result).toBe('needs-human-confirmation')
  })

  it('模型漏报 required_changes/findings（给 default）不触发重试', async () => {
    // 只给 review_result，其余两字段靠 schema default 容漏。
    const sparse = fencedReview(JSON.stringify({ review_result: 'approved' }))
    const { runSession } = sessionQueue([sessionReport(sparse)])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(outcome.review_result).toBe('approved')
    expect(outcome.required_changes).toEqual([])
    expect(outcome.findings).toEqual([])
  })

  /* ---- 容错分类（§8）---- */

  it('鉴权错：立即降级 needs-human-confirmation，不重试（会话只调一次）', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('Request failed with status 401 Unauthorized'),
    ])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(1)
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('鉴权')
  })

  it('网络错：指数退避重试 techRetryMax=3 次耗尽后降级', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('Request failed with status 503'),
      new Error('ECONNRESET'),
      new Error('429 Too Many Requests'),
      new Error('500 Internal Server Error'),
    ])
    const rec = recordingSleep()
    const reviewer = makeReviewer({
      runSession,
      sleep: rec.sleep,
      random: () => 0, // 零抖动，延迟 = base × 2^n
      techRetryMax: 3,
      backoffBaseMs: 1000,
    })
    const outcome = await reviewer.review(makeReviewInput())

    // 首次 + 3 次重试 = 4 次。
    expect(calls).toHaveLength(4)
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('网络')
    // 退避延迟序列：1000, 2000, 4000（base × 2^0/1/2）。
    expect(rec.delays).toEqual([1000, 2000, 4000])
  })

  it('网络错重试中成功：退避 2 次后第 3 次成功', async () => {
    const { runSession, calls } = sessionQueue([
      new Error('fetch failed'),
      new Error('fetch failed'),
      sessionReport(fencedReview(approvedJson())),
    ])
    const rec = recordingSleep()
    const reviewer = makeReviewer({
      runSession,
      sleep: rec.sleep,
      random: () => 0,
      techRetryMax: 3,
    })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(3)
    expect(rec.delays).toEqual([1000, 2000])
    expect(outcome.review_result).toBe('approved')
  })

  /* ---- 中断（§9）---- */

  it('SIGINT abort：捕获 AbortError，产降级 outcome（needs-human-confirmation），会话只调一次', async () => {
    const abortErr = new Error('The user aborted a request')
    abortErr.name = 'AbortError'
    const { runSession, calls } = sessionQueue([abortErr])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(1)
    // §9 中断：needs-human-confirmation（保留 worktree 供人工审查）。
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('中断')
  })

  it('abortController 预先 abort：review 直接降级，不调用会话', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fencedReview(approvedJson()))])
    const controller = new AbortController()
    controller.abort()
    const reviewer = makeReviewer({ runSession, abortController: controller })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(0)
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('中断')
  })

  /* ---- 会话级错误 / unknown ---- */

  it('is_error 会话：降级 needs-human-confirmation（非瞬时，不重试），findings 含 subtype', async () => {
    const { runSession, calls } = sessionQueue([
      sessionReport('模型拒绝执行', { isError: true, subtype: 'error_during_execution' }),
    ])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(1)
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('error_during_execution')
  })

  it('unknown 错误：显式降级 needs-human-confirmation，不静默', async () => {
    const { runSession, calls } = sessionQueue([new TypeError('unexpected structure')])
    const reviewer = makeReviewer({ runSession })
    const outcome = await reviewer.review(makeReviewInput())

    expect(calls).toHaveLength(1)
    expect(outcome.review_result).toBe('needs-human-confirmation')
    expect(outcome.findings[0]).toContain('未知')
    expect(outcome.findings[0]).toContain('unexpected structure')
  })

  /* ---- §7 可观测回调透传 ---- */

  it('onMessage / stderr 经构造注入透传到 SdkSessionInput', async () => {
    const { runSession, calls } = sessionQueue([sessionReport(fencedReview(approvedJson()))])
    const onMessage = (): void => {}
    const stderr = (): void => {}
    const reviewer = makeReviewer({ runSession, onMessage, stderr })
    await reviewer.review(makeReviewInput())

    expect(calls[0]?.onMessage).toBe(onMessage)
    expect(calls[0]?.stderr).toBe(stderr)
  })

  /* ---- 降级形态契约（可被 task-review applyReview 消费）---- */

  it('所有降级路径统一产 needs-human-confirmation + findings（approved/rejected 不会被伪造）', async () => {
    const cases: Array<{ label: string; behavior: SdkSessionReport | Error }> = [
      { label: '鉴权', behavior: new Error('401 Unauthorized') },
      { label: '网络', behavior: new Error('503') },
      { label: 'unknown', behavior: new TypeError('boom') },
      {
        label: 'is_error',
        behavior: sessionReport('', { isError: true, subtype: 'error_during_execution' }),
      },
    ]
    for (const { label, behavior } of cases) {
      const { runSession } = sessionQueue([behavior])
      const reviewer = makeReviewer({ runSession, techRetryMax: 0 })
      const outcome = await reviewer.review(makeReviewInput())
      expect(outcome.review_result, label).toBe('needs-human-confirmation')
      expect(outcome.required_changes, label).toEqual([])
      expect(outcome.findings.length, label).toBeGreaterThan(0)
    }
  })

  it('返回的 outcome 形态满足 ReviewOutcome 契约（review_result 合法 + 数组字段）', async () => {
    const { runSession } = sessionQueue([sessionReport(fencedReview(rejectedJson()))])
    const reviewer = makeReviewer({ runSession })
    const outcome: SdkReviewOutcome = await reviewer.review(makeReviewInput())

    expect(['approved', 'rejected', 'needs-human-confirmation']).toContain(outcome.review_result)
    expect(Array.isArray(outcome.required_changes)).toBe(true)
    expect(Array.isArray(outcome.findings)).toBe(true)
  })
})
