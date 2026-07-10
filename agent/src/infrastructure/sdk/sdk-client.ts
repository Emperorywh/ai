/**
 * Claude Agent SDK 会话工厂（infrastructure/sdk/sdk-client.ts）。
 *
 * 本文件集中 @anthropic-ai/claude-agent-sdk 的 query() 装配 + 流式消费 + abort + cost/usage 采集，
 * 作为「一次自主会话」的可复用工厂，供 ClaudeSdkInvocation（TASK-032）与 SDK 版 Reviewer（TASK-033）
 * 复用，避免两处重复装配 query/流式/cost 逻辑（SPEC_claude-sdk-integration.md §13.1）。
 *
 * 分层定位（ARCHITECTURE §3 / TASK-030 §8）：纯 infrastructure——依赖 SDK 包（value import query +
 * type import 类型），不反向依赖 application/cli；不承载任务领域逻辑（JSON 提取 / 重试 / 降级 / 容错
 * 分类在 TASK-032）——只做「装 options → 跑 query → 回流式与终止信息」（TASK-030 §2 / §9）。
 *
 * 字段名以 SPEC §12 校准（已对照安装版 0.3.206 .d.ts）：
 *   - abortController（⚠ 非 abortControllerSignal）/ systemPrompt（preset + append，⚠ 非 customSystemPrompt）
 *   - env（REPLACES 子进程环境，调用方须展开 process.env，SPEC §12 / §6）/ settingSources
 *   - includePartialMessages:true（开 stream_event 流式，SPEC §7）
 *   - permissionMode:'bypassPermissions'（⚠ 须同时设 allowDangerouslySkipPermissions:true——安装版 .d.ts
 *     Options 注释 1695/1707-1711 硬性要求，SPEC §12 未列此字段，R-API 差异已记 DECISIONS/ISSUES）
 *   - stderr（子进程 stderr 回调，SPEC §7 日志）
 *   - 不传：canUseTool（F3 纯软约束）/ maxTurns（F4 无硬上限）/ resume·continue·forkSession（§2.2 不续跑）
 *
 * 多 provider：env / model / systemPrompt.append 由调用方（032/033 经 031）组装后传入，sdk-client
 * 只透传到 options（TASK-030 §8「sdk-client 接收已组装好的 env/options，不读配置」）。
 */
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type {
  Options,
  SDKMessage,
  SDKResultMessage,
  SettingSource,
} from '@anthropic-ai/claude-agent-sdk'

/* ============================================================ *
 * 注入式 query 句柄（测试用 fake 覆盖真实 SDK query）
 * ============================================================ */

/**
 * 可注入的 query 函数类型——把「真实 SDK query 调用」隔离为可替换的注入点。
 *
 * runSdkSession 默认用 defaultSdkQuery（真实 SDK query）；测试注入返回各种 SDKMessage 序列的
 * fake query，断言流式消费与终止信息采集（TASK-030 §11）。query 的真实运行时依赖（spawn 子进程、
 * 联网）由此隔离，单测零真实 API、CI 稳定（SPEC §11）。
 */
export type SdkQueryFn = (params: {
  prompt: string
  options: Options
}) => AsyncIterable<SDKMessage>

/**
 * 默认 query：真实 SDK query 的注入适配。
 *
 * SDK 原生 query 接受 `prompt: string | AsyncIterable<SDKUserMessage>` 且 `options?` 可选、返回
 * `Query extends AsyncGenerator<SDKMessage>`；本适配把入参收窄为 SdkQueryFn 形态（prompt 限 string、
 * options 必传）、返回收窄为 AsyncIterable<SDKMessage>，使 runSdkSession 的注入点类型统一。生产
 * 调用方直接 runSdkSession(input) 即用真实 SDK（SPEC §4.1 自主 query）。
 */
export const defaultSdkQuery: SdkQueryFn = ({ prompt, options }) =>
  sdkQuery({ prompt, options })

/* ============================================================ *
 * 会话入参 / 出参
 * ============================================================ */

/**
 * sdk-client 会话入参（由 ClaudeSdkInvocation / Reviewer 经 Provider Profile 组装后传入）。
 *
 * 全部字段经调用方组装（TASK-030 §8「sdk-client 接收已组装好的 env/options，不读配置」）：
 *   - prompt：自主会话的初始提示（startup_prompt + Context Pack 清单，SPEC §4.1 / §4.6）。
 *   - cwd：worktree 根，模型在此目录读写 / 跑 bash（SPEC §12 cwd 项）。
 *   - env：多 provider 切换的核心——调用方按 SPEC §6 组装规则（{ ...process.env, <token注入键>,
 *     ANTHROPIC_BASE_URL?, 三档映射, ...extraEnv }）后传入；⚠ 传 env 整体替换子进程环境，
 *     调用方负责展开 process.env（SPEC §12 env 项 / §6）。
 *   - systemPromptAppend：追加到 claude_code preset 的边界 / 权限清单 / 产出指令声明（SPEC §4.4/§4.6）。
 *   - abortController：SIGINT 接入的中断控制器（SPEC §9）。
 *   - onMessage：每条 SDKMessage 到达时的流式回调（SPEC §7 实时输出 + 完整日志，调用方渲染终端/落日志）。
 */
export interface SdkSessionInput {
  readonly prompt: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly systemPromptAppend: string
  readonly model?: string
  readonly abortController: AbortController
  readonly settingSources?: readonly SettingSource[]
  readonly stderr?: (data: string) => void
  readonly onMessage?: (message: SDKMessage) => void
}

/**
 * sdk-client 会话出参——从 result 消息采集的终止信息（SPEC §12 第 5 条终止字段）。
 *
 * sdk-client 只采集 + 结构化呈现，不据其判定 executionStatus（那是 TASK-032 invocation 依据
 * subtype / is_error 结合 JSON 产出综合判定）。raw resultMessage 一并返回，供调用方取
 * permission_denials / errors 等额外字段做容错分类（SPEC §8）。
 */
export interface SdkSessionReport {
  /** result.subtype（success / error_during_execution / error_max_turns / error_max_budget_usd / ...）。 */
  readonly subtype: string
  readonly totalCostUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheCreationInputTokens: number
  readonly cacheReadInputTokens: number
  readonly numTurns: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly isError: boolean
  /** success 时模型产出的 result 文本（error 态为 null；注意这是 SDK 会话级 result，非任务 JSON 产出）。 */
  readonly resultText: string | null
  /** 原始 result 消息（供调用方取 permission_denials / errors / modelUsage 等额外字段）。 */
  readonly resultMessage: SDKResultMessage
}

/* ============================================================ *
 * options 装配（§12 字段校准）
 * ============================================================ */

/**
 * 装配 SDK query options（SPEC §12 字段校准，对照安装版 0.3.206 .d.ts）。
 *
 * 字段名严格按 §12：abortController（非 abortControllerSignal）/ systemPrompt（preset+append，非
 * customSystemPrompt）/ settingSources / includePartialMessages / env / permissionMode / stderr。
 *
 * 关键：permissionMode 'bypassPermissions' 必须同时 allowDangerouslySkipPermissions:true——安装版 .d.ts
 * 硬性要求（Options 注释 1695/1707-1711），SPEC §12 未列此字段，系 R-API 差异（记 DECISIONS/ISSUES，
 * 回写 SPEC §12）。不设则 SDK 拒绝 bypassPermissions。
 *
 * 不传（§12 / §0 F1-F4）：canUseTool（F3 纯软约束不挂拦截）/ maxTurns（F4 无硬上限）/ resume·continue·
 * forkSession（§2.2 不续跑）/ maxThinkingTokens（按 provider，§12 不传）/ allowedTools（F3 用默认全集）。
 */
export function buildSdkOptions(input: SdkSessionInput): Options {
  return {
    cwd: input.cwd,
    // F3 纯软约束：最宽权限模式 + 必须显式确认（安装版 .d.ts 硬性要求，R-API 差异）。
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // 用 Claude Code 内置系统提示 preset，append 追加本规格边界 / 产出指令（§12 systemPrompt 项）。
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: input.systemPromptAppend,
    },
    // 默认加载 project 级配置（worktree 内 .claude/settings.json / CLAUDE.md），§12 settingSources 项。
    // input.settingSources 为 readonly，展开为 mutable 满足 Options.settingSources: SettingSource[]。
    settingSources: [...(input.settingSources ?? (['project'] as const))],
    // §7 实时流式：开启后额外收到 type:'stream_event' 的 partial 消息。
    includePartialMessages: true,
    // §9 中断：SIGINT → controller.abort() → SDK 抛 AbortError。
    abortController: input.abortController,
    // §7 日志：子进程 stderr 转入日志文件（调用方提供落盘回调）。
    stderr: input.stderr,
    // §6 多 provider：env / model 由调用方组装透传；⚠ env 整体替换子进程环境，调用方须展开 process.env。
    env: input.env,
    // model 可选：provider profile 映射值（§6 档位映射）；未提供则用 SDK 默认模型。
    ...(input.model !== undefined ? { model: input.model } : {}),
    // 显式不传：canUseTool / maxTurns / resume / continue / forkSession / maxThinkingTokens / allowedTools（见上方注释）。
  }
}

/* ============================================================ *
 * result 终止信息采集
 * ============================================================ */

/**
 * 从 result 消息采集终止信息为 SdkSessionReport（纯结构化，不判 executionStatus）。
 *
 * usage 字段名按 §12（input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens）；
 * result.usage 类型为 NonNullableUsage（BetaUsage 的 non-nullable 映射）。cache_* 在 BetaUsage 中可选，
 * 缺失按 0；input/output 经 ?? 0 防御（NonNullableUsage 下应为 required，统一兜底更稳健）。
 * success 时取 result.result 文本；error 态无 result 字段（TS 经 subtype==='success' 判别收窄安全访问）。
 */
export function collectResult(result: SDKResultMessage): SdkSessionReport {
  const usage = result.usage
  return {
    subtype: result.subtype,
    totalCostUsd: result.total_cost_usd,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    numTurns: result.num_turns,
    durationMs: result.duration_ms,
    durationApiMs: result.duration_api_ms,
    isError: result.is_error,
    resultText: result.subtype === 'success' ? result.result : null,
    resultMessage: result,
  }
}

/* ============================================================ *
 * 会话主入口
 * ============================================================ */

/**
 * 运行一次自主 SDK 会话（SPEC §4.1 F1 自主执行）。
 *
 * 链路（TASK-030 §9）：buildSdkOptions 装 options → queryFn 跑 query → for-await 消费 SDKMessage
 * 流（每条经 onMessage 回调透传，供 §7 实时流式 + 完整日志）→ 命中 type:'result' 采集终止信息 →
 * 返回 SdkSessionReport。
 *
 * 中断（§9）：abortController.abort() 后 SDK 经 for-await 抛 AbortError，本函数不捕获——AbortError
 * 自然向上传播，调用方据此产出降级 result（保留 worktree）。其他技术性错误同样向上传播（容错分类
 * 归 TASK-032）。
 *
 * 异常终止（非 abort、流结束但无 result）：SDK 契约下 result 是流末尾消息，缺失视为非法状态，抛错
 * 不静默（AGENTS §3）。
 *
 * @param input 会话入参（调用方组装）
 * @param queryFn 可注入的 query（默认 defaultSdkQuery 真实 SDK；测试传 fake 覆盖）
 */
export async function runSdkSession(
  input: SdkSessionInput,
  queryFn: SdkQueryFn = defaultSdkQuery,
): Promise<SdkSessionReport> {
  const options = buildSdkOptions(input)
  const stream = queryFn({ prompt: input.prompt, options })

  let resultMessage: SDKResultMessage | null = null
  for await (const message of stream) {
    input.onMessage?.(message)
    if (message.type === 'result') {
      resultMessage = message
    }
  }

  if (resultMessage === null) {
    throw new Error(
      'SDK 会话流结束但未收到 type:"result" 消息（异常终止；abort 会在到达此处前以 AbortError 抛出）',
    )
  }

  return collectResult(resultMessage)
}
