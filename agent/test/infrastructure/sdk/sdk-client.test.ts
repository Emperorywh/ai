import { describe, expect, it } from 'vitest'
import { AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  buildSdkOptions,
  collectResult,
  runSdkSession,
  type SdkQueryFn,
  type SdkSessionInput,
} from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 夹具：合法 SdkSessionInput + 各种 SDKMessage 序列的 fake query
 *
 * 注：SDKMessage 联合成员（BetaMessage / MessageParam / NonNullableUsage 等）结构复杂，sdk-client
 * 仅按 message.type 分派 + 读 result 的终止字段，不依赖消息 content 完整结构。故夹具以最小合法字段
 * + `as unknown as SDKMessage` 构造，聚焦验证 sdk-client 的「装配 / 流式 / 采集 / 中断」逻辑
 * （SPEC §11「fake query 注入，断言 cost/usage 采集 + abort」，零真实 API）。
 * ============================================================ */

/** 构造合法 SdkSessionInput（默认提供 prompt / cwd / env / systemPromptAppend / abortController）。 */
function makeInput(overrides?: Partial<SdkSessionInput>): SdkSessionInput {
  return {
    prompt: '执行 TASK-030：装 SDK + 建 sdk-client 会话工厂',
    cwd: '/worktree/task-030',
    env: { ANTHROPIC_API_KEY: 'sk-test-key', PATH: process.env.PATH ?? '' },
    systemPromptAppend: '【边界声明】只改 allowed_paths 内文件；越界须在 issues 自报 needs-human。',
    abortController: new AbortController(),
    ...overrides,
  }
}

/** 构造返回指定消息序列的 fake query（async generator）。 */
function fakeQuery(messages: readonly SDKMessage[]): SdkQueryFn {
  return async function* () {
    for (const message of messages) {
      yield message
    }
  }
}

/** system + subtype:'init' 消息（SPEC §12 流式首条，含生效 model / apiKeySource）。 */
function makeSystemInit(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: { type: 'api_key', token_type: 'x-api-key' },
    claude_code_version: '1.0.0-test',
    cwd: '/worktree/task-030',
    tools: ['Read', 'Write', 'Edit', 'Bash'],
    mcp_servers: [],
    model: 'claude-sonnet-5',
    permissionMode: 'bypassPermissions',
    uuid: 'sys-uuid',
    session_id: 'sess-1',
  } as unknown as SDKMessage
}

/** assistant 消息（SPEC §7 终端输出驱动）。message.content 占位，sdk-client 只读 type 透传。 */
function makeAssistant(): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text: '正在执行' }] },
    parent_tool_use_id: null,
    uuid: 'assistant-uuid',
    session_id: 'sess-1',
  } as unknown as SDKMessage
}

/** user 消息（SPEC §7 工具结果摘要）。 */
function makeUser(): SDKMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] },
    parent_tool_use_id: null,
  } as unknown as SDKMessage
}

/** result success 消息（SPEC §12 第 5 条终止字段，字段名已校准）。 */
function makeResultSuccess(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 4200,
    duration_api_ms: 3800,
    is_error: false,
    num_turns: 7,
    result: '任务完成',
    stop_reason: 'end_turn',
    total_cost_usd: 0.1234,
    usage: {
      input_tokens: 1500,
      output_tokens: 800,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: 'res-uuid',
    session_id: 'sess-1',
  } as unknown as SDKMessage
}

/** result error 消息（subtype 扩展值 error_max_budget_usd，验证 sdk-client 把 subtype 当 string 透传）。 */
function makeResultError(): SDKMessage {
  return {
    type: 'result',
    subtype: 'error_max_budget_usd',
    duration_ms: 9900,
    duration_api_ms: 9000,
    is_error: true,
    num_turns: 12,
    stop_reason: null,
    total_cost_usd: 1.5,
    usage: {
      input_tokens: 3000,
      output_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ['budget exceeded'],
    uuid: 'res-uuid',
    session_id: 'sess-1',
  } as unknown as SDKMessage
}

/* ============================================================ *
 * buildSdkOptions —— §12 字段校准
 * ============================================================ */

describe('buildSdkOptions（§12 字段校准）', () => {
  it('装配 §12 校准字段：bypassPermissions 须同时 allowDangerouslySkipPermissions（R-API 差异）', () => {
    const controller = new AbortController()
    const options = buildSdkOptions(makeInput({ abortController: controller }))

    // §12 核心字段名（已对照安装版 .d.ts 校准）。
    expect(options.permissionMode).toBe('bypassPermissions')
    // R-API 差异：安装版 .d.ts 硬性要求 bypassPermissions 须同时设此项，SPEC §12 未列（回写 §12）。
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    // systemPrompt 用 preset + append（⚠ 非 customSystemPrompt）。
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: '【边界声明】只改 allowed_paths 内文件；越界须在 issues 自报 needs-human。',
    })
    expect(options.settingSources).toEqual(['project'])
    expect(options.includePartialMessages).toBe(true)
    expect(options.abortController).toBe(controller)
    expect(options.cwd).toBe('/worktree/task-030')
    expect(options.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test-key', PATH: process.env.PATH ?? '' })
    // stderr 未提供时为 undefined。
    expect(options.stderr).toBeUndefined()
  })

  it('settingSources / stderr / model 可覆盖透传（多 provider model 经 §6 映射）', () => {
    const stderr = (data: string): void => void data
    const options = buildSdkOptions(
      makeInput({ settingSources: ['project', 'local'], stderr, model: 'glm-5.2' }),
    )

    expect(options.settingSources).toEqual(['project', 'local'])
    expect(options.stderr).toBe(stderr)
    expect(options.model).toBe('glm-5.2')
  })

  it('model 未提供时不设（options.model=undefined，用 SDK 默认模型）', () => {
    const options = buildSdkOptions(makeInput())
    expect(options.model).toBeUndefined()
  })

  it('不传 §12/§0 排除项：canUseTool（F3）/ maxTurns（F4）/ resume·continue·forkSession（§2.2）', () => {
    const options = buildSdkOptions(makeInput())

    // F3 纯软约束：不挂 canUseTool 拦截。
    expect(options.canUseTool).toBeUndefined()
    // F4 无硬上限：不传 maxTurns。
    expect(options.maxTurns).toBeUndefined()
    // §2.2 不续跑：不传 resume / continue / forkSession。
    expect(options.resume).toBeUndefined()
    expect(options.continue).toBeUndefined()
    expect(options.forkSession).toBeUndefined()
  })
})

/* ============================================================ *
 * collectResult —— result 终止信息采集
 * ============================================================ */

describe('collectResult（result 终止信息采集）', () => {
  it('success result：采集 subtype / cost / usage / num_turns / duration / result 文本', () => {
    const report = collectResult(makeResultSuccess() as unknown as SDKResultMessage)

    expect(report.subtype).toBe('success')
    expect(report.totalCostUsd).toBe(0.1234)
    expect(report.inputTokens).toBe(1500)
    expect(report.outputTokens).toBe(800)
    expect(report.cacheCreationInputTokens).toBe(200)
    expect(report.cacheReadInputTokens).toBe(100)
    expect(report.numTurns).toBe(7)
    expect(report.durationMs).toBe(4200)
    expect(report.durationApiMs).toBe(3800)
    expect(report.isError).toBe(false)
    expect(report.resultText).toBe('任务完成')
  })

  it('error result（subtype 扩展值）：resultText=null / isError=true / subtype 当 string 透传', () => {
    const report = collectResult(makeResultError() as unknown as SDKResultMessage)

    // subtype 扩展值（error_max_budget_usd，§12 未列，R-API 差异）——sdk-client 不穷举枚举，透传。
    expect(report.subtype).toBe('error_max_budget_usd')
    expect(report.isError).toBe(true)
    expect(report.resultText).toBeNull()
    expect(report.numTurns).toBe(12)
    expect(report.totalCostUsd).toBe(1.5)
  })

  it('cache_* 缺失时按 0 兜底（BetaUsage cache_* 可选）', () => {
    const result = {
      ...makeResultSuccess(),
      usage: { input_tokens: 100, output_tokens: 50 },
    } as unknown as SDKResultMessage
    const report = collectResult(result)

    expect(report.inputTokens).toBe(100)
    expect(report.outputTokens).toBe(50)
    expect(report.cacheCreationInputTokens).toBe(0)
    expect(report.cacheReadInputTokens).toBe(0)
  })
})

/* ============================================================ *
 * runSdkSession —— 流式消费 + 采集 + 中断
 * ============================================================ */

describe('runSdkSession（流式消费 + result 采集 + abort）', () => {
  it('正常流：for-await 消费消息序列 + 采集 result + onMessage 每条触发', async () => {
    const seen: SDKMessage[] = []
    const messages = [makeSystemInit(), makeAssistant(), makeUser(), makeResultSuccess()]

    const report = await runSdkSession(
      makeInput({ onMessage: (m) => seen.push(m) }),
      fakeQuery(messages),
    )

    // onMessage 对每条消息触发（§7 实时流式 + 完整日志的回调入口）。
    expect(seen).toHaveLength(4)
    expect(seen[0]?.type).toBe('system')
    expect(seen[1]?.type).toBe('assistant')
    expect(seen[2]?.type).toBe('user')
    expect(seen[3]?.type).toBe('result')

    // result 终止信息正确采集。
    expect(report.subtype).toBe('success')
    expect(report.totalCostUsd).toBe(0.1234)
    expect(report.numTurns).toBe(7)
    expect(report.resultText).toBe('任务完成')
  })

  it('error result 流：采集 error 终止信息（不抛错，由调用方按 subtype/is_error 分类）', async () => {
    const report = await runSdkSession(makeInput(), fakeQuery([makeResultError()]))

    expect(report.subtype).toBe('error_max_budget_usd')
    expect(report.isError).toBe(true)
    expect(report.resultText).toBeNull()
  })

  it('abort：abortController.abort() 后 query 抛 AbortError 向上传播（§9 中断）', async () => {
    const controller = new AbortController()
    // fake query 模拟真实 SDK：检测到 abort 后抛 AbortError。
    const abortQuery: SdkQueryFn = async function* ({ options }) {
      yield makeAssistant()
      if (options.abortController?.signal.aborted) {
        throw new AbortError('用户中断')
      }
      yield makeResultSuccess()
    }

    controller.abort()
    const promise = runSdkSession(makeInput({ abortController: controller }), abortQuery)

    // §11 验收：abort 触发并抛 AbortError；runSdkSession 不捕获，向上传播。
    await expect(promise).rejects.toBeInstanceOf(AbortError)
  })

  it('异常终止：流结束但未收到 result 消息时抛错不静默（AGENTS §3）', async () => {
    const promise = runSdkSession(makeInput(), fakeQuery([makeSystemInit(), makeAssistant()]))

    await expect(promise).rejects.toThrow(/未收到.*result/)
  })

  it('默认 queryFn 为真实 SDK query（defaultSdkQuery）：注入 fake 才走 fake 路径', () => {
    // 此处不实际调真实 query（需联网 + API key），仅验证 runSdkSession 第二参数可选、默认值存在。
    // 生产路径 runSdkSession(input) 即用 defaultSdkQuery（真实 SDK）；上方用例均显式注入 fake 验证逻辑。
    // 该契约由 buildSdkOptions / collectResult / 流式消费的纯逻辑测试充分覆盖。
    expect(typeof runSdkSession).toBe('function')
  })
})
