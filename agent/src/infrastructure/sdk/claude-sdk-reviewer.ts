/**
 * SDK 版 Reviewer 真实实现（infrastructure/sdk/claude-sdk-reviewer.ts）。
 *
 * 本文件实现 Reviewer 契约（cli/commands/task-review.ts）的真实调用类 ClaudeSdkReviewer：
 * 经 sdk-client（TASK-030）的 runSdkSession 起一次**独立审查会话**（与执行会话分离，§5 /
 * Readme §5.2-5.3 职责分离，不共享对话历史），以 input.result（.result.md frontmatter）+
 * worktree 内实际改动（模型用 Read / Bash(git diff) 自读）为审查对象，prompt 要求模型对照
 * Readme §15 审查清单产出 JSON → ReviewOutcome。
 *
 * 链路（任务 §9）：组装审查 prompt + systemPrompt.append → runSdkSession 跑独立 query →
 * 技术性异常按 §8 分类（abort/auth 立即降级、network 指数退避重试耗尽降级、unknown 降级）→
 * 会话 is_error 降级 → 提取末尾 review-frontmatter JSON（snake_case）→ safeParse（§4.3）→
 * 失败带反馈重试 N 次 → 耗尽降级 needs-human-confirmation（findings 记 parse 错，不伪造 approved）→
 * 成功映射 ReviewOutcome。
 *
 * 分层定位（ARCHITECTURE §3 / 任务 §8）：纯 infrastructure——依赖 sdk-client（同层）+
 * claude-sdk-invocation-impl（同层，复用 classifyFault 容错分类纯函数）+ core Schema（type +
 * 运行时校验）。**不反向依赖 application/cli**：Reviewer/ReviewInput/ReviewOutcome 契约定义在
 * cli/commands/task-review.ts（forbidden_paths），本实现不 import 该文件，而是本地定义**结构
 * 对齐**的入参/出参类型（SdkReviewInput / SdkReviewOutcome），靠 TS 结构类型兼容让 CLI composition
 * root（TASK-035）wiring 注入（ARCHITECTURE §4「infra 实现类无需显式 implements」）。provider
 * 配置（env/model）经构造函数注入（同 TASK-032 模式，env/model 来自 TASK-031 组装产物）。
 *
 * 测试（任务 §11）：runSession（会话执行）与 sleep（退避等待）经构造函数注入，单测注入返回各种
 * report / 抛各种错误的 fake 会话与瞬时 sleep，断言重试 / 降级 / 容错分类路径，零真实 API
 * （真实 API 在 TASK-035 CI）。
 *
 * 权威来源：docs/SPEC_claude-sdk-integration.md §5（审查模型）/ §4.3（JSON 重试降级）/ §8（容错
 * 分类）/ §9（中断）；Readme.md §15（审查清单）。
 */
import { z } from 'zod'
import {
  ReviewResultSchema,
  type ResultFrontmatter,
  type ReviewResult,
} from '../../core/index.js'
import {
  classifyFault,
  type FaultCategory,
} from './claude-sdk-invocation-impl.js'
import {
  runSdkSession,
  type SdkSessionInput,
  type SdkSessionReport,
} from './sdk-client.js'

/* ============================================================ *
 * 入参 / 出参类型——结构对齐 cli/commands/task-review.ts 的 Reviewer 契约
 * ============================================================ */

/**
 * Reviewer 审查入参——结构对齐 cli/commands/task-review.ts 的 ReviewInput（§3）。
 *
 * 不 import cli 契约（infra 不依赖 cli + forbidden_paths），靠 TS 结构类型兼容：字段与
 * ReviewInput 完全一致（task_id / result / worktree_path / result_file），TASK-035 wiring
 * 注入时 ClaudeSdkReviewer 结构兼容 Reviewer（ARCHITECTURE §4）。
 */
export interface SdkReviewInput {
  /** 当前任务 id。 */
  readonly task_id: string
  /** 被审查的 .result.md frontmatter（execution_status / verification / 改动清单）。 */
  readonly result: ResultFrontmatter
  /** worktree 根目录（任务改动所在，供审查会话用 Read/diff 自读）。 */
  readonly worktree_path: string
  /** .result.md 相对仓库路径（供审查会话 Read 全文，含 global_update_requests 更新建议）。 */
  readonly result_file: string
}

/**
 * 审查结论（不含 skipped——skipped 专用于 no_review 的 Orchestrator 占位审查，不由 Reviewer 产出）。
 * 对齐 ReviewResult 排除 skipped 后的三值。
 */
type ReviewVerdict = Exclude<ReviewResult, 'skipped'>

/**
 * Reviewer 审查出参——结构对齐 cli/commands/task-review.ts 的 ReviewOutcome（§3）。
 *
 * 字段与 ReviewOutcome 完全一致（review_result / required_changes / findings）；不含 task_id /
 * reviewer / reviewed_at（由命令层补全为 ReviewFrontmatter）。TS 结构类型兼容 Reviewer 契约。
 */
export interface SdkReviewOutcome {
  /** 审查结论（approved / rejected / needs-human-confirmation）。 */
  readonly review_result: ReviewVerdict
  /** 必须修改项（rejected / needs-human-confirmation 时填写，§15）。 */
  readonly required_changes: readonly string[]
  /** 审查发现清单。 */
  readonly findings: readonly string[]
}

/* ============================================================ *
 * 模型产出 JSON 的校验 schema（§4.2 F2，snake_case / ReviewOutcome 形态）
 * ============================================================ */

/**
 * 模型在输出末尾产出的 review-frontmatter JSON schema（§5）。
 *
 * ⚠ 审查侧模型 JSON 为 **snake_case**（review_result / required_changes / findings），与执行侧
 * （TASK-032）的 camelCase（executionStatus / modifiedFiles / ...）不同——审查侧字段名直接对齐
 * ReviewOutcome 接口（task-review.ts:89），无需 camelCase→snake_case 转换，直接 safeParse。
 *
 * review_result 复用 ReviewResultSchema 并 exclude(['skipped'])（skipped 由 Orchestrator 为
 * no_review 任务生成，不经 Reviewer，§5）；required_changes / findings 给 default 容 R-JSON 漏报
 * （模型漏报空数组时不至于误判 parse 失败触发重试）。
 */
const ReviewJsonSchema = z.object({
  review_result: ReviewResultSchema.exclude(['skipped']),
  required_changes: z.array(z.string()).default([]),
  findings: z.array(z.string()).default([]),
})
type ReviewJson = z.infer<typeof ReviewJsonSchema>

/* ============================================================ *
 * JSON 提取（§5 review-frontmatter fenced 块）
 * ============================================================ */

/** ```review-frontmatter fenced 块（审查产出指定标记，与 result-frontmatter 对称），全局匹配取最后一块。 */
const FENCED_REVIEW_RE = /```review-frontmatter[ \t]*\r?\n([\s\S]*?)```/g
/** 回退标记：```json fenced 块（模型未用指定标记时兜底）。 */
const FENCED_JSON_RE = /```json[ \t]*\r?\n([\s\S]*?)```/g

/** JSON 提取结果判别联合。 */
export type ReviewExtractResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'no-fenced-block' | 'json-parse'; detail: string }

/**
 * 从模型输出文本提取末尾的 review-frontmatter JSON（§5，纯函数）。
 *
 * 定位规则与执行侧 extractResultJson（claude-sdk-invocation-impl.ts）同构，仅 fenced 标记不同
 * （review-frontmatter vs result-frontmatter）：优先匹配 ```review-frontmatter 块，缺失回退
 * ```json，取**最后一块**（模型可能先输出示例块再产出真实块），JSON.parse 其内容。
 *
 * @param resultText SDK result 消息的文本（success 态非空，error 态为 null）
 */
export function extractReviewJson(resultText: string | null): ReviewExtractResult {
  if (resultText === null || resultText.trim() === '') {
    return {
      ok: false,
      reason: 'no-fenced-block',
      detail: '模型未产出文本（resultText 为空，审查会话未正常完成）',
    }
  }
  // 优先 ```review-frontmatter；缺失才回退 ```json（若 review-frontmatter 块存在但
  // JSON 非法，直接报 json-parse 失败交重试修正，不再退而求 json 块）。
  let matches = [...resultText.matchAll(FENCED_REVIEW_RE)]
  if (matches.length === 0) {
    matches = [...resultText.matchAll(FENCED_JSON_RE)]
  }
  if (matches.length === 0) {
    return {
      ok: false,
      reason: 'no-fenced-block',
      detail: '模型输出未包含 ```review-frontmatter 或 ```json fenced 块',
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
 * 审查清单（Readme §15）+ 产出契约指令
 * ============================================================ */

/**
 * 审查清单（Readme §15「Reviewer 审查清单」全部 14 项）。
 *
 * 注入 systemPrompt.append，要求模型逐项核查。审查清单是 Readme 的权威内容（非 SPEC 新增），
 * 此处为清单文本单一来源（Readme §15 的机器可注入形式）。
 */
const REVIEW_CHECKLIST_ITEMS: readonly string[] = [
  '当前任务目标是否完成。',
  '是否修改了禁止修改范围。',
  '是否提前实现后续任务。',
  '是否违反分层设计。',
  '是否存在跨层调用。',
  '是否存在重复逻辑。',
  '是否存在隐式状态。',
  '是否存在巨型函数或巨型组件。',
  '是否新增临时 patch。',
  '是否在 .result.md 中提供必要的 docs/PROGRESS.md 更新建议。',
  '是否生成 .result.md。',
  '是否在 .result.md 中记录必要架构决策更新建议。',
  '是否在 .result.md 中记录未解决问题更新建议。',
  '是否通过必要验证。',
]

/** §5 产出契约指令（注入 systemPrompt.append，要求模型末尾产出 review-frontmatter JSON）。 */
const REVIEW_JSON_OUTPUT_INSTRUCTION = `## 产出契约（审查结束时必须在输出最后产出一个 fenced 块）

完成审查后，必须在你的自然语言输出最末尾产出且仅产出一个如下格式的 fenced 块（标记名 review-frontmatter，JSON 须合法可解析）：

\`\`\`review-frontmatter
{
  "review_result": "approved | rejected | needs-human-confirmation",
  "required_changes": ["..."],
  "findings": ["..."]
}
\`\`\`

要求：review_result 取 approved（审查通过）/ rejected（需返工）/ needs-human-confirmation（需人工确认）；rejected 与 needs-human-confirmation 时 required_changes 必须给出具体修改项，approved 时 required_changes 应为空；findings 记录审查发现；多余文本不得出现在 JSON 块内。`

/* ============================================================ *
 * 会话 prompt / systemPrompt.append 装配（§5 / Readme §15）
 * ============================================================ */

/**
 * 组装审查会话 prompt（§5）。
 *
 * 审查任务说明 + 被审查执行结果摘要（.result.md frontmatter 关键字段）+ worktree / result_file
 * 路径（供模型用 Read / Bash(git diff) 读取 .result.md 全文与 worktree 实际改动）。
 * JSON 重试时把 parse 错误反馈追加在 prompt 末尾（新会话无对话历史，§2.2 不续跑）。
 */
function buildReviewPrompt(input: SdkReviewInput, feedback: string): string {
  const parts = [
    `## 审查任务\n\n你是 Reviewer，审查任务 ${input.task_id} 的执行结果。请对照下方审查清单逐项核查，先用工具读取证据再做判断。`,
    '',
    buildResultSummary(input.result),
    '',
    `被审查的 .result.md 全文位于 worktree 内：\`${input.result_file}\`（含 global_update_requests 的全局文档更新建议，请用 Read 读取全文）。`,
    `任务执行改动位于 worktree：\`${input.worktree_path}\`（请用 Bash 跑 \`git diff\` / \`git status\` 自读实际改动，对照声明清单核验）。`,
  ]
  if (feedback) {
    parts.push('', feedback)
  }
  return parts.join('\n')
}

/**
 * 被审查执行结果摘要（.result.md frontmatter 关键字段，注入审查 prompt）。
 *
 * 序列化执行事实摘要（task_id / execution_status / next_action / 三类文件清单 / verification 结果）
 * 供模型快速定位；global_update_requests 全文让模型从 .result.md 文件读取（避免 prompt 过长）。
 */
function buildResultSummary(result: ResultFrontmatter): string {
  const lines: string[] = ['### 被审查执行结果摘要（.result.md frontmatter）']
  lines.push(`- task_id: ${result.task_id}`)
  lines.push(`- execution_status: ${result.execution_status}`)
  lines.push(`- next_action: ${result.next_action}`)
  lines.push(`- modified_files: ${formatPathList(result.modified_files)}`)
  lines.push(`- created_files: ${formatPathList(result.created_files)}`)
  lines.push(`- deleted_files: ${formatPathList(result.deleted_files)}`)
  lines.push('- verification:')
  if (result.verification.length === 0) {
    lines.push('    - （无）')
  } else {
    for (const v of result.verification) {
      lines.push(`    - [${v.result}] ${v.command}${v.notes.trim() !== '' ? ` — ${v.notes}` : ''}`)
    }
  }
  return lines.join('\n')
}

/** 路径清单渲染（空则标「无」）。 */
function formatPathList(paths: readonly string[]): string {
  return paths.length > 0 ? paths.join(', ') : '（无）'
}

/**
 * 组装 systemPrompt.append（Readme §15 审查清单 + §5 产出契约指令）。
 *
 * 审查清单 + 产出契约指令稳定注入（不随 JSON 重试变化）；审查会话无 permission_boundary（审查不
 * 执行任务，只读 worktree 核查），故不注入执行侧的边界声明。
 */
function buildReviewSystemPromptAppend(): string {
  const checklist = REVIEW_CHECKLIST_ITEMS.map((item) => `- ${item}`).join('\n')
  return `## 审查清单（逐项核查，Readme §15）\n${checklist}\n\n${REVIEW_JSON_OUTPUT_INSTRUCTION}`
}

/**
 * 组装 JSON 重试反馈（§4.3「把 safeParse.error 作为反馈追加进对话」）。
 *
 * 告知模型上次产出校验失败的具体原因，要求重新产出合法 review-frontmatter JSON 块。
 */
function buildParseFeedback(detail: string): string {
  return `## 上次产出校验失败，请修正

上次你产出的 review-frontmatter JSON 未通过校验，原因：${detail}

请重新审查并只补一个合法的 \`\`\`review-frontmatter JSON 块（字段见产出契约），不要重复此错误。`
}

/* ============================================================ *
 * 降级 / 成功映射 ReviewOutcome（§4.3 / §8 / §9）
 * ============================================================ */

/**
 * 构造降级 SdkReviewOutcome（§4.3 parse 耗尽 / §8 容错 / §9 中断的统一降级形态）。
 *
 * 审查侧降级统一为 review_result: needs-human-confirmation（**不伪造 approved**，§5 / §15），
 * required_changes 留空（审查未完成无法给出具体修改项），findings 记降级原因（含 task_id 便于追溯）。
 * 与执行侧 degradedReport（failed+needs-human + issues 记故障）对称，但 ReviewOutcome 无 issue /
 * verification 字段，故降级形态更简（只产 findings）。
 */
function degradedOutcome(input: SdkReviewInput, reason: string): SdkReviewOutcome {
  return {
    review_result: 'needs-human-confirmation',
    required_changes: [],
    findings: [`任务 ${input.task_id} 审查降级为 needs-human-confirmation：${reason}`],
  }
}

/** 成功路径：模型 JSON（snake_case）→ SdkReviewOutcome（纯映射）。 */
function mapToReviewOutcome(data: ReviewJson): SdkReviewOutcome {
  return {
    review_result: data.review_result,
    required_changes: [...data.required_changes],
    findings: [...data.findings],
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
 * ClaudeSdkReviewerOptions —— 构造选项
 * ============================================================ */

/**
 * ClaudeSdkReviewer 的构造选项。
 *
 * provider 配置（env/model）与可观测回调（§7）由 CLI composition root（TASK-035）经
 * provider-profile（TASK-031）组装后注入；runSession / sleep / random 为测试注入点。
 * 字段集与 ClaudeSdkInvocationImpl（TASK-032）对齐，保持两 SDK 会话类同构。
 */
export interface ClaudeSdkReviewerOptions {
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
  /** SIGINT 接入的中断控制器（§9，CLI 035 注入并 wire SIGINT；默认新建仅供单测）。 */
  readonly abortController?: AbortController
  /** §7 流式消息回调（CLI 035 注入终端渲染 / 日志落盘）。 */
  readonly onMessage?: MessageHandler
  /** §7 子进程 stderr 回调（CLI 035 注入日志落盘）。 */
  readonly stderr?: StderrHandler
}

/* ============================================================ *
 * ClaudeSdkReviewer —— SDK 版 Reviewer 真实实现
 * ============================================================ */

/**
 * SDK 版 Reviewer：独立审查 SDK 会话 + JSON 提取重试降级 + 容错分类 + 中断处理。
 *
 * review(SdkReviewInput) 链路（任务 §9）：
 *   组装审查 prompt + systemPrompt.append → runSession 跑独立 query →
 *   技术性异常按 §8 分类（abort/auth 立即降级、network 指数退避重试耗尽降级、unknown 降级）→
 *   会话 is_error 降级（session 级错误非瞬时，不重试）→
 *   提取末尾 review-frontmatter JSON（§5）→ safeParse（§4.3）→ 失败带反馈重试 N 次 →
 *   耗尽降级 needs-human-confirmation（findings 记 parse 错，不伪造 approved）→
 *   成功映射 SdkReviewOutcome。
 *
 * 降级（§4.3 / §8 / §9）统一为 review_result: needs-human-confirmation + findings 记原因
 * （审查未完成时保留 worktree 供人工审查，不伪造 approved）。
 *
 * 中断（§9）：abortController 跨重试共享，SIGINT → controller.abort() → SDK 抛 AbortError
 * （或正常返回），二者兼容——本实现 try/catch AbortError 产降级 outcome、保留 worktree。
 *
 * 与执行侧（ClaudeSdkInvocationImpl）对称但独立：两个独立会话（执行 / 审查职责分离，§5），
 * 不共享对话历史；字段形态不同（执行 camelCase、审查 snake_case）。
 */
export class ClaudeSdkReviewer {
  readonly name = 'claude-sdk-reviewer'

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

  constructor(opts: ClaudeSdkReviewerOptions) {
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

  async review(input: SdkReviewInput): Promise<SdkReviewOutcome> {
    const baseAppend = buildReviewSystemPromptAppend()

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
        return degradedOutcome(
          input,
          'SDK 审查会话被中断（SIGINT/abort），保留 worktree 供人工审查。',
        )
      }

      const sessionInput: SdkSessionInput = {
        prompt: buildReviewPrompt(input, feedback),
        cwd: input.worktree_path,
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
        const category: FaultCategory = classifyFault(error)
        if (category === 'abort') {
          // §9 中断：保留 worktree，产降级 outcome（needs-human-confirmation）。
          return degradedOutcome(
            input,
            `SDK 审查会话被中断（${errText(error)}），保留 worktree 与已做改动。`,
          )
        }
        if (category === 'auth') {
          // §8 鉴权 / 配置错：立即降级，不重试。
          return degradedOutcome(
            input,
            `SDK 鉴权 / 配置失败，按 §8 不重试：${errText(error)}。`,
          )
        }
        if (category === 'network') {
          // §8 网络 / 5xx / 限流：指数退避重试，耗尽降级。
          if (techRetries < this.techRetryMax) {
            await this.sleep(this.backoff(techRetries))
            techRetries++
            continue
          }
          return degradedOutcome(
            input,
            `SDK 网络故障指数退避重试 ${this.techRetryMax} 次仍失败：${errText(error)}。`,
          )
        }
        // unknown：非重试类技术失败，显式降级（不静默吞错，§8）。
        return degradedOutcome(
          input,
          `SDK 审查会话未知错误，显式降级不静默：${errText(error)}。`,
        )
      }

      // 会话正常返回——session 级错误（is_error）非瞬时（多为 safety 拒绝 / 执行错误），不重试。
      if (report.isError) {
        return degradedOutcome(
          input,
          `SDK 审查会话以错误态结束（subtype=${report.subtype}），模型未正常完成。`,
        )
      }

      // 提取模型末尾 review-frontmatter JSON（§5）。
      const extracted = extractReviewJson(report.resultText)
      if (!extracted.ok) {
        if (jsonRetries < this.jsonRetryMax) {
          feedback = buildParseFeedback(extracted.detail)
          jsonRetries++
          continue
        }
        return degradedOutcome(
          input,
          `审查 JSON 提取失败重试耗尽（${this.jsonRetryMax} 次）：${extracted.detail}。`,
        )
      }

      // safeParse 模型 JSON（snake_case，ReviewOutcome 形态）。
      const parsed = ReviewJsonSchema.safeParse(extracted.data)
      if (!parsed.success) {
        if (jsonRetries < this.jsonRetryMax) {
          feedback = buildParseFeedback(zodErrorSummary(parsed.error))
          jsonRetries++
          continue
        }
        return degradedOutcome(
          input,
          `审查 JSON 校验失败重试耗尽（${this.jsonRetryMax} 次）：${zodErrorSummary(parsed.error)}。`,
        )
      }

      // 成功：映射 SdkReviewOutcome。
      return mapToReviewOutcome(parsed.data)
    }

    // 理论不可达（循环内所有路径 return 或 continue 至计数器耗尽后 return）；
    // 保留为类型安全兜底——若逻辑被改动导致漏 return，显式降级而非返回 undefined。
    return degradedOutcome(
      input,
      'SDK 审查重试循环异常退出（不应到达的兜底分支），请排查实现。',
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
