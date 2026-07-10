/**
 * ClaudeSdkInvocation 真实实现（infrastructure/sdk/claude-sdk-invocation-impl.ts）。
 *
 * 本文件实现 ClaudeSdkInvocation 接口（claude-sdk-adapter.ts）的真实调用类：经
 * sdk-client（TASK-030）的 runSdkSession 跑一次自主 SDK query，从模型末尾产出的
 * ```result-frontmatter fenced 块提取 JSON（§4.2）→ safeParse → JSON 重试降级（§4.3）→
 * 容错分类（§8）→ 中断处理（§9），返回 SdkRunReport 供 ClaudeSdkExecutor 落 .result.md。
 *
 * ClaudeSdkExecutor 编排逻辑（claude-sdk-adapter.ts:248）**不变**——本实现只消费
 * SdkRunInput、产 SdkRunReport，契约不改（任务 §7）。
 *
 * 分层定位（ARCHITECTURE §3 / 任务 §8）：纯 infrastructure——依赖 sdk-client（同层）+
 * core Schema（type + 运行时校验）+ claude-sdk-adapter 契约类型（同层），不反向依赖
 * application/cli；provider 配置（env/model）由 CLI composition root（TASK-034）经
 * provider-profile（TASK-031）组装后**经构造函数注入**，本实现不读配置文件、不 import cli/config
 * （SdkRunInput 契约不改，任务 §8）。
 *
 * 测试（任务 §11）：runSession（会话执行）与 sleep（退避等待）经构造函数注入，单测注入
 * 返回各种 report / 抛各种错误的 fake 会话与瞬时 sleep，断言重试 / 降级 / 容错分类路径，
 * 零真实 API（真实 API 在 TASK-035 CI）。
 *
 * 权威来源：docs/SPEC_claude-sdk-integration.md §4（执行模型）/ §8（容错分类）/ §9（中断）/
 * §12（SDK API）。
 */
import { z } from 'zod'
import {
  ExecutionStatusSchema,
  GlobalUpdateRequestsSchema,
  NextActionSchema,
  ResultVerificationSchema,
  type ContextPack,
  type Issue,
  type IssueSeverity,
} from '../../core/index.js'
import {
  type ClaudeSdkInvocation,
  type SdkRunInput,
  type SdkRunReport,
} from './claude-sdk-adapter.js'
import {
  runSdkSession,
  type SdkSessionInput,
  type SdkSessionReport,
} from './sdk-client.js'

/* ============================================================ *
 * 模型产出 JSON 的校验 schema（§4.2 F2，SdkRunReport 形态 / camelCase）
 * ============================================================ */

/**
 * 模型在输出末尾产出的 result-frontmatter JSON schema（§4.2）。
 *
 * §4.2 规定模型产出的 JSON 字段对齐 SdkRunReport（camelCase：executionStatus /
 * modifiedFiles / createdFiles / deletedFiles / verification / globalUpdateRequests /
 * nextAction / 可选 summary），**不含** execution_commits（Executor 契约本就留空、由
 * Orchestrator 回填）与 task_id（executor 落盘时从 ExecuteInput 补）。
 *
 * ⚠ SPEC 张力（任务 §2 文字提「ResultFrontmatterSchema.safeParse」，但 §4.2 示例与
 * SdkRunReport 字段名为 camelCase，而 ResultFrontmatterSchema 是 snake_case：
 * execution_status / modified_files ……，二者字段名不同，用 ResultFrontmatterSchema
 * 直接 safeParse camelCase JSON 必失败）。本实现据 §4.2 显式示例，复用同一套子 schema
 * （ExecutionStatusSchema / NextActionSchema / ResultVerificationSchema /
 * GlobalUpdateRequestsSchema）以 camelCase 键定义专属校验 schema；snake_case 落盘映射
 * 由 ClaudeSdkExecutor（claude-sdk-adapter.ts:259）负责。裁定记 DEC-033。
 *
 * R-JSON 容错：modifiedFiles/createdFiles/deletedFiles/verification 与 globalUpdateRequests
 * 给 default，模型漏报空数组 / 漏整个 globalUpdateRequests 时不至于误判 parse 失败触发重试；
 * 仅 executionStatus + nextAction 两核心字段硬性必填。
 */
const SdkResultJsonSchema = z.object({
  executionStatus: ExecutionStatusSchema,
  nextAction: NextActionSchema,
  modifiedFiles: z.array(z.string()).default([]),
  createdFiles: z.array(z.string()).default([]),
  deletedFiles: z.array(z.string()).default([]),
  verification: z.array(ResultVerificationSchema).default([]),
  globalUpdateRequests: GlobalUpdateRequestsSchema.default({
    progress: [],
    decisions: [],
    issues: [],
  }),
  summary: z.string().optional(),
})
type SdkResultJson = z.infer<typeof SdkResultJsonSchema>

/* ============================================================ *
 * 容错分类（§8）——按错误特征判定故障类型
 * ============================================================ */

/** §8 故障分类（决定重试 / 降级策略）。 */
export type FaultCategory = 'abort' | 'auth' | 'network' | 'unknown'

/**
 * 按 §8 把 SDK 抛出的错误分类为故障类型（纯函数，AGENTS §3 显式化容错）。
 *
 * SDK 错误体系（具体 class / code）未在 SPEC 全列，且随版本变动（R-API），故以错误名 +
 * 消息文本的**显式**启发式分类（非隐藏兼容逻辑——分类规则全在本函数内可审、§8 逐条对应）：
 *   - abort：AbortError（SIGINT 触发 controller.abort()，§9）或消息含 abort；
 *   - auth：鉴权 / 配置错（401/403、unauthor/forbidden、invalid key/token/credential、
 *     authentication）——§8「立即 failed 不重试」；
 *   - network：网络 / 5xx / 限流（429、5xx、ECONN*、ETIMEDOUT、fetch failed、network、
 *     socket、timeout、rate limit）——§8「指数退避重试」；
 *   - unknown：其余——非重试类，显式降级（不静默吞错，错误摘要写入 issues）。
 *
 * HTTP 状态码以 `\bNNN\b` 形式匹配独立数字，避免误吞更长数字串。
 */
export function classifyFault(error: unknown): FaultCategory {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'abort'
  }
  const text = (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase()
  if (text.includes('abort')) {
    return 'abort'
  }
  // 鉴权 / 配置错（§8 第一行）。
  if (
    /(?:^|\D)(?:401|403)(?:\D|$)/.test(text) ||
    text.includes('unauthor') ||
    text.includes('forbidden') ||
    text.includes('authentication') ||
    /invalid[\s\S]{0,40}(?:api[\s_]*key|token|credential)/.test(text)
  ) {
    return 'auth'
  }
  // 网络 / 5xx / 限流（§8 第二行）。
  if (
    /(?:^|\D)(?:429|5\d{2})(?:\D|$)/.test(text) ||
    text.includes('econn') ||
    text.includes('etimedout') ||
    text.includes('enetunreach') ||
    text.includes('eai_again') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('timeout') ||
    text.includes('rate limit') ||
    text.includes('rate_limit')
  ) {
    return 'network'
  }
  return 'unknown'
}

/* ============================================================ *
 * JSON 提取（§4.2 fenced 块）
 * ============================================================ */

/** ```result-frontmatter fenced 块（§4.2 指定标记），全局匹配取最后一块。 */
const FENCED_RESULT_RE = /```result-frontmatter[ \t]*\r?\n([\s\S]*?)```/g
/** 回退标记：```json fenced 块（模型未用指定标记时兜底）。 */
const FENCED_JSON_RE = /```json[ \t]*\r?\n([\s\S]*?)```/g

/** JSON 提取结果判别联合。 */
export type ExtractResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'no-fenced-block' | 'json-parse'; detail: string }

/**
 * 从模型输出文本提取末尾的 result-frontmatter JSON（§4.2，纯函数）。
 *
 * 定位规则（§4.2「由实现任务固定」）：优先匹配 ```result-frontmatter fenced 块，缺失时回退
 * ```json，取**最后一块**（模型可能先输出示例块再产出真实块），JSON.parse 其内容。
 *
 * @param resultText SDK result 消息的文本（success 态非空，error 态为 null）
 */
export function extractResultJson(resultText: string | null): ExtractResult {
  if (resultText === null || resultText.trim() === '') {
    return {
      ok: false,
      reason: 'no-fenced-block',
      detail: '模型未产出文本（resultText 为空，会话未正常完成）',
    }
  }
  // 优先 ```result-frontmatter；缺失才回退 ```json（若 result-frontmatter 块存在但
  // JSON 非法，直接报 json-parse 失败交重试修正，不再退而求 json 块）。
  let matches = [...resultText.matchAll(FENCED_RESULT_RE)]
  if (matches.length === 0) {
    matches = [...resultText.matchAll(FENCED_JSON_RE)]
  }
  if (matches.length === 0) {
    return {
      ok: false,
      reason: 'no-fenced-block',
      detail: '模型输出未包含 ```result-frontmatter 或 ```json fenced 块',
    }
  }
  const lastMatch = matches[matches.length - 1]
  const content = lastMatch?.[1] ?? ''
  try {
    return { ok: true, data: JSON.parse(content) }
  } catch (error) {
    return {
      ok: false,
      reason: 'json-parse',
      detail: `JSON.parse 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/* ============================================================ *
 * 会话 prompt / systemPrompt.append 装配（§4.1 / §4.4 / §4.6 / §4.2）
 * ============================================================ */

/** §4.2 产出契约指令（注入 systemPrompt.append，要求模型末尾产出 result-frontmatter JSON）。 */
const JSON_OUTPUT_INSTRUCTION = `## 产出契约（任务结束时必须在输出最后产出一个 fenced 块）

完成 / 阻塞 / 失败后，必须在你的自然语言输出最末尾产出且仅产出一个如下格式的 fenced 块（标记名 result-frontmatter，JSON 须合法可解析）：

\`\`\`result-frontmatter
{
  "executionStatus": "completed | blocked | failed",
  "modifiedFiles": ["..."],
  "createdFiles": ["..."],
  "deletedFiles": ["..."],
  "verification": [{ "command": "...", "result": "passed | failed | skipped", "notes": "..." }],
  "globalUpdateRequests": { "progress": [], "decisions": [], "issues": [] },
  "nextAction": "review | retry | needs-human | cancel",
  "summary": "可选的人工可读摘要"
}
\`\`\`

要求：verification 全字段由你实跑验证命令后自报；executionStatus 与 nextAction 组合须合法（completed+review / blocked+needs-human 或 retry / failed+needs-human 或 retry）；多余文本不得出现在 JSON 块内。`

/**
 * 组装会话 prompt（§4.1 / §4.6）。
 *
 * §18 startup_prompt（已含必读核心 + 任务文件 + 边界声明）+ Context Pack 文件清单（§4.6
 * 「只注入文件清单，不预读文件内容塞 prompt」；模型在 worktree 内用 SDK Read 工具按清单自读）。
 * JSON 重试时把 parse 错误反馈追加在 prompt 末尾（新会话无对话历史，§2.2 不续跑）。
 */
function buildSessionPrompt(input: SdkRunInput, feedback: string): string {
  const parts = [input.startupPrompt, '', buildContextPackList(input.contextPack)]
  if (feedback) {
    parts.push('', feedback)
  }
  return parts.join('\n')
}

/** Context Pack 清单渲染（§4.6 文件列表）。 */
function buildContextPackList(contextPack: ContextPack): string {
  const lines = ['## Context Pack 清单（按清单自读，不得自行扩展）']
  lines.push('### required_docs')
  for (const doc of contextPack.required_docs) {
    lines.push(`- ${doc}`)
  }
  if (contextPack.optional_doc_excerpts.length > 0) {
    lines.push('### optional_doc_excerpts')
    for (const excerpt of contextPack.optional_doc_excerpts) {
      lines.push(`- ${excerpt}`)
    }
  }
  lines.push('### source_files')
  for (const file of contextPack.source_files) {
    lines.push(`- ${file}`)
  }
  return lines.join('\n')
}

/**
 * 组装 systemPrompt.append（§4.4 / §4.2）。
 *
 * §4.4 权限软约束：permission_boundary 的 allowed/forbidden/permissions/verification 全部
 * 经 prompt 声明注入（不挂 canUseTool，F3），越界由模型自主在 issues 自报 + nextAction 设
 * needs-human。§4.2 产出契约指令紧随其后。二者稳定注入（不随 JSON 重试变化）。
 */
function buildSystemPromptAppend(input: SdkRunInput): string {
  return `${buildBoundaryDeclaration(input)}\n\n${JSON_OUTPUT_INSTRUCTION}`
}

/** §4.4 权限边界声明（注入 systemPrompt.append）。 */
function buildBoundaryDeclaration(input: SdkRunInput): string {
  const boundary = input.permissionBoundary
  return [
    '## 执行边界（软约束：越界须在 globalUpdateRequests.issues 自报并把 nextAction 设为 needs-human）',
    `- 允许写入路径（allowed_paths）：${
      boundary.allowed_paths.length > 0 ? boundary.allowed_paths.join(', ') : '（无）'
    }`,
    `- 禁止写入路径（forbidden_paths）：${
      boundary.forbidden_paths.length > 0 ? boundary.forbidden_paths.join(', ') : '（无）'
    }`,
    `- 已声明能力（permissions）：${
      boundary.permissions.length > 0 ? boundary.permissions.join(', ') : '（无）'
    }`,
    `- 验证命令（verification_commands）：${
      boundary.verification_commands.map((cmd) => cmd.command).join(', ') || '（无）'
    }`,
  ].join('\n')
}

/**
 * 组装 JSON 重试反馈（§4.3「把 safeParse.error 作为反馈追加进对话」）。
 *
 * 告知模型上次产出校验失败的具体原因，要求重新产出合法 result-frontmatter JSON 块。
 */
function buildParseFeedback(detail: string): string {
  return `## 上次产出校验失败，请修正

上次你产出的 result-frontmatter JSON 未通过校验，原因：${detail}

请重新完整执行任务，并在输出最末尾只补一个合法的 \`\`\`result-frontmatter JSON 块（字段见产出契约），不要重复此错误。`
}

/* ============================================================ *
 * 降级 SdkRunReport 构造（§4.3 / §8 / §9）
 * ============================================================ */

/**
 * 构造降级 SdkRunReport（§4.3 parse 耗尽 / §8 容错 / §9 中断的统一降级形态）。
 *
 * - executionStatus / nextAction 由调用方按 §4.3 §8 §9 指定（failed+needs-human 为主，
 *   中断为 blocked+needs-human，§9）；
 * - 三类文件清单留空（降级下不可信提取结果，由人工 / Orchestrator 检查 worktree）；
 * - verification 全标 skipped（§4.3「verification 标 skipped」），保留 allowlist 命令顺序；
 * - 故障记入 globalUpdateRequests.issues 一条提议项（id 留空，Orchestrator 回写分配 ISS-XXX）。
 */
function degradedReport(
  input: SdkRunInput,
  executionStatus: 'failed' | 'blocked',
  nextAction: 'needs-human' | 'retry',
  issueTitle: string,
  issueSeverity: IssueSeverity,
  recommendedAction: string,
  summary: string,
): SdkRunReport {
  const issue: Issue = {
    id: '',
    title: issueTitle,
    status: 'open',
    severity: issueSeverity,
    scope: 'infrastructure/sdk',
    created_from_task: extractTaskIdFromPrompt(input.startupPrompt),
    owner: '',
    recommended_action: recommendedAction,
  }
  return {
    executionStatus,
    modifiedFiles: [],
    createdFiles: [],
    deletedFiles: [],
    verification: input.permissionBoundary.verification_commands.map((cmd) => ({
      command: cmd.command,
      result: 'skipped',
      notes: '执行降级，未实际完成验证',
    })),
    globalUpdateRequests: { progress: [], decisions: [], issues: [issue] },
    nextAction,
    summary,
  }
}

/** 成功路径：模型 JSON（camelCase）+ 会话 cost 摘要 → SdkRunReport（纯映射）。 */
function mapToSdkRunReport(data: SdkResultJson, report: SdkSessionReport): SdkRunReport {
  const costLine =
    `（cost $${report.totalCostUsd.toFixed(4)}，${report.numTurns} 轮，` +
    `input ${report.inputTokens}/output ${report.outputTokens} tokens，${report.durationMs}ms）`
  const baseSummary = data.summary && data.summary.trim() !== '' ? data.summary : 'SDK 会话正常完成。'
  return {
    executionStatus: data.executionStatus,
    modifiedFiles: [...data.modifiedFiles],
    createdFiles: [...data.createdFiles],
    deletedFiles: [...data.deletedFiles],
    verification: [...data.verification],
    globalUpdateRequests: data.globalUpdateRequests,
    nextAction: data.nextAction,
    summary: `${baseSummary} ${costLine}`,
  }
}

/* ============================================================ *
 * 小工具
 * ============================================================ */

/** 真实退避等待（默认注入；测试注入瞬时 sleep）。 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 错误转可读文本（unknown → string）。 */
function errText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

/** Zod 错误转可读摘要（path + message，分号分隔）。 */
function zodErrorSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/** 从 startup_prompt 提取 TASK-XXX（issue.created_from_task 用；§18 模板恒含任务文件路径）。 */
function extractTaskIdFromPrompt(prompt: string): string {
  const match = prompt.match(/TASK-\d+/)
  return match?.[0] ?? 'TASK-000'
}

/* ============================================================ *
 * 会话执行句柄类型
 * ============================================================ */

/** 可注入的会话执行器（默认真实 runSdkSession；测试注入 fake）。 */
type SessionRunner = (input: SdkSessionInput) => Promise<SdkSessionReport>
/** §7 流式消息回调类型（经 SdkSessionInput 派生，避免直接 import SDK 类型）。 */
type MessageHandler = NonNullable<SdkSessionInput['onMessage']>
/** §7 stderr 回调类型。 */
type StderrHandler = NonNullable<SdkSessionInput['stderr']>

/* ============================================================ *
 * ClaudeSdkInvocationImpl —— 真实实现
 * ============================================================ */

/**
 * ClaudeSdkInvocation 的构造选项。
 *
 * provider 配置（env/model）与可观测回调（§7）由 CLI composition root（TASK-034）经
 * provider-profile（TASK-031）组装后注入；runSession / sleep / random 为测试注入点。
 */
export interface ClaudeSdkInvocationOptions {
  /** provider env（§6 组装公式产出，SDK env 整体替换子进程环境）。 */
  readonly providerEnv: Readonly<Record<string, string>>
  /** provider 模型映射值（§6 三档之一），省略用 SDK 默认模型。 */
  readonly model?: string
  /** 会话执行器（默认真实 runSdkSession；测试注入 fake 返回各种 report / 抛各种错误）。 */
  readonly runSession?: SessionRunner
  /** 退避等待（默认真实 setTimeout；测试注入瞬时以加速）。 */
  readonly sleep?: (ms: number) => Promise<void>
  /** 抖动随机源（默认 Math.random；测试注入确定性函数）。 */
  readonly random?: () => number
  /** JSON 重试上限（§4.3，默认 2 = 首次 + 2 次重试）。 */
  readonly jsonRetryMax?: number
  /** 网络重试上限（§8「最多 3 次」，默认 3）。 */
  readonly techRetryMax?: number
  /** 指数退避基数毫秒（§8「基础 1s × 2^n」，默认 1000）。 */
  readonly backoffBaseMs?: number
  /** SIGINT 接入的中断控制器（§9，CLI 034 注入并 wire SIGINT；默认新建仅供单测）。 */
  readonly abortController?: AbortController
  /** §7 流式消息回调（CLI 034 注入终端渲染 / 日志落盘）。 */
  readonly onMessage?: MessageHandler
  /** §7 子进程 stderr 回调（CLI 034 注入日志落盘）。 */
  readonly stderr?: StderrHandler
}

/**
 * ClaudeSdkInvocation 真实实现：自主 SDK 会话 + JSON 提取重试降级 + 容错分类 + 中断处理。
 *
 * run(SdkRunInput) 链路（任务 §9）：
 *   组装会话 prompt + systemPrompt.append → runSession 跑自主 query →
 *   技术性异常按 §8 分类（abort/auth 立即降级、network 指数退避重试耗尽降级、unknown 降级）→
 *   会话 is_error 降级（session 级错误非瞬时，不重试）→
 *   提取末尾 result-frontmatter JSON（§4.2）→ safeParse（§4.3）→ 失败带反馈重试 N 次 →
 *   耗尽降级 failed+needs-human（verification skipped + issues 记 parse 错）→
 *   成功映射 SdkRunReport（补 cost 摘要）。
 *
 * 中断（§9）：abortController 跨重试共享，SIGINT → controller.abort() → SDK 抛 AbortError
 * （或正常返回），二者兼容——本实现 try/catch AbortError 产降级 result、保留 worktree 不回滚。
 *
 * 重试幂等（§8）：同一 run 内重试不产生重复 frontmatter（每次会话独立、最终只产一份 report）；
 * 重试上限耗尽必显式降级，不静默吞错。
 */
export class ClaudeSdkInvocationImpl implements ClaudeSdkInvocation {
  readonly name = 'claude-sdk'

  private readonly providerEnv: Readonly<Record<string, string>>
  private readonly model?: string
  private readonly runSession: SessionRunner
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private readonly jsonRetryMax: number
  private readonly techRetryMax: number
  private readonly backoffBaseMs: number
  private readonly abortController: AbortController
  private readonly onMessage?: MessageHandler
  private readonly stderr?: StderrHandler

  constructor(opts: ClaudeSdkInvocationOptions) {
    this.providerEnv = opts.providerEnv
    this.model = opts.model
    // 默认包一层去掉 queryFn 注入参数（本实现不暴露 queryFn 注入，runSession 注入已足够测试）。
    this.runSession = opts.runSession ?? ((input) => runSdkSession(input))
    this.sleep = opts.sleep ?? defaultSleep
    this.random = opts.random ?? Math.random
    this.jsonRetryMax = opts.jsonRetryMax ?? 2
    this.techRetryMax = opts.techRetryMax ?? 3
    this.backoffBaseMs = opts.backoffBaseMs ?? 1000
    this.abortController = opts.abortController ?? new AbortController()
    this.onMessage = opts.onMessage
    this.stderr = opts.stderr
  }

  async run(input: SdkRunInput): Promise<SdkRunReport> {
    const baseAppend = buildSystemPromptAppend(input)

    let jsonRetries = 0
    let techRetries = 0
    let feedback = ''

    // 有界重试循环：每次迭代要么 return（成功 / 降级），要么 continue（消耗一个重试预算）。
    // 总迭代上限 = 1（首次）+ jsonRetryMax（JSON 重试）+ techRetryMax（网络重试）；
    // 循环内所有非 return 路径必消耗某一计数器，故不会越过此界（尾 return 为类型安全兜底）。
    const maxIterations = 1 + this.jsonRetryMax + this.techRetryMax
    for (let i = 0; i < maxIterations; i++) {
      // abortController 跨重试共享：中断已触发则直接降级，不继续重试（§9）。
      if (this.abortController.signal.aborted) {
        return degradedReport(
          input,
          'blocked',
          'needs-human',
          'SDK 会话被中断（SIGINT/abort）',
          'high',
          '检查 worktree 已做改动后决定重跑（restart_on_retry）或人工介入',
          'SDK 会话经 abortController.abort() 中断，保留 worktree 与已做文件改动，未自动回滚。',
        )
      }

      const sessionInput: SdkSessionInput = {
        prompt: buildSessionPrompt(input, feedback),
        cwd: input.worktreePath,
        env: this.providerEnv,
        systemPromptAppend: baseAppend,
        abortController: this.abortController,
        onMessage: this.onMessage,
        stderr: this.stderr,
        // model 省略时透传 undefined → SdkSessionInput 不含 model 键 → buildSdkOptions 用 SDK 默认。
        ...(this.model !== undefined ? { model: this.model } : {}),
      }

      let report: SdkSessionReport
      try {
        report = await this.runSession(sessionInput)
      } catch (error) {
        const category = classifyFault(error)
        if (category === 'abort') {
          // §9 中断：保留 worktree，产降级 result（blocked + needs-human）。
          return degradedReport(
            input,
            'blocked',
            'needs-human',
            'SDK 会话被中断（SIGINT/abort）',
            'high',
            '检查 worktree 已做改动后决定重跑（restart_on_retry）或人工介入',
            `SDK 会话被中断（${errText(error)}），保留 worktree 与已做改动，未自动回滚。`,
          )
        }
        if (category === 'auth') {
          // §8 鉴权 / 配置错：立即 failed，不重试。
          return degradedReport(
            input,
            'failed',
            'needs-human',
            'SDK 鉴权 / 配置失败',
            'high',
            `核查 provider token / model 配置后重试：${errText(error)}`,
            `SDK 会话鉴权或配置失败，按 §8 不重试：${errText(error)}`,
          )
        }
        if (category === 'network') {
          // §8 网络 / 5xx / 限流：指数退避重试，耗尽降级。
          if (techRetries < this.techRetryMax) {
            await this.sleep(this.backoff(techRetries))
            techRetries++
            continue
          }
          return degradedReport(
            input,
            'failed',
            'needs-human',
            'SDK 网络故障重试耗尽',
            'high',
            `核查网络 / provider 端点可用性后重试：${errText(error)}`,
            `SDK 会话网络故障，指数退避重试 ${this.techRetryMax} 次仍失败：${errText(error)}`,
          )
        }
        // unknown：非重试类技术失败，显式降级（不静默吞错，§8）。
        return degradedReport(
          input,
          'failed',
          'needs-human',
          'SDK 会话未知错误',
          'medium',
          `排查错误后重试：${errText(error)}`,
          `SDK 会话抛出未知错误，显式降级不静默：${errText(error)}`,
        )
      }

      // 会话正常返回——session 级错误（is_error）非瞬时（多为 safety 拒绝 / 执行错误），不重试。
      if (report.isError) {
        return degradedReport(
          input,
          'failed',
          'needs-human',
          'SDK 会话以错误态结束',
          'medium',
          `据 subtype=${report.subtype} 排查（可能为 safety 拒绝或执行错误）`,
          `SDK 会话以错误态结束（subtype=${report.subtype}），模型未正常完成。`,
        )
      }

      // 提取模型末尾 result-frontmatter JSON（§4.2）。
      const extracted = extractResultJson(report.resultText)
      if (!extracted.ok) {
        if (jsonRetries < this.jsonRetryMax) {
          feedback = buildParseFeedback(extracted.detail)
          jsonRetries++
          continue
        }
        return degradedReport(
          input,
          'failed',
          'needs-human',
          '模型产出 JSON 提取失败重试耗尽',
          'medium',
          `人工核查模型输出后重试：${extracted.detail}`,
          `模型产出的 result-frontmatter JSON 经 ${this.jsonRetryMax} 次重试仍提取失败：${extracted.detail}`,
        )
      }

      // safeParse 模型 JSON（camelCase，§4.2 SdkRunReport 形态；裁定见文件头）。
      const parsed = SdkResultJsonSchema.safeParse(extracted.data)
      if (!parsed.success) {
        if (jsonRetries < this.jsonRetryMax) {
          feedback = buildParseFeedback(zodErrorSummary(parsed.error))
          jsonRetries++
          continue
        }
        return degradedReport(
          input,
          'failed',
          'needs-human',
          '模型产出 JSON 校验失败重试耗尽',
          'medium',
          `人工核查模型输出后重试：${zodErrorSummary(parsed.error)}`,
          `模型产出的 JSON 经 ${this.jsonRetryMax} 次重试仍校验失败：${zodErrorSummary(parsed.error)}`,
        )
      }

      // 成功：映射 SdkRunReport（补 cost 摘要行）。
      return mapToSdkRunReport(parsed.data, report)
    }

    // 理论不可达（循环内所有路径 return 或 continue 至计数器耗尽后 return）；
    // 保留为类型安全兜底——若逻辑被改动导致漏 return，显式降级而非返回 undefined。
    return degradedReport(
      input,
      'failed',
      'needs-human',
      'SDK 调用重试循环异常退出',
      'medium',
      '排查 invocation 重试逻辑（不应到达此处）',
      'invocation 重试循环异常退出（不应到达的兜底分支），请排查实现。',
    )
  }

  /**
   * 指数退避延迟（§8「基础 1s × 2^n，带抖动」）。
   *
   * base = backoffBaseMs × 2^attempt；抖动 = random × backoffBaseMs × 0.5（半区间抖动，
   * 避免重试惊群）。测试注入 random: () => 0 得确定性 base × 2^attempt 序列。
   */
  private backoff(attempt: number): number {
    const base = this.backoffBaseMs * Math.pow(2, attempt)
    const jitter = this.random() * this.backoffBaseMs * 0.5
    return Math.round(base + jitter)
  }
}
