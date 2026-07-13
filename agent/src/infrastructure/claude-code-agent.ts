import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { CodingAgentPort, InterviewMessage } from '../application/ports.js'
import {
  INTERVIEW_REPLY_JSON_SCHEMA,
  InterviewReplySchema,
  TASK_EXECUTION_JSON_SCHEMA,
  TASK_PLAN_JSON_SCHEMA,
  TaskExecutionReportSchema,
  TaskPlanSchema,
  type InterviewReply,
  type TaskDraft,
  type TaskExecutionReport,
  type TaskRecord,
} from '../core/workflow.js'
import {
  resolveClaudeCodeSessionAccess,
  type ClaudeCodeSessionKind,
} from './claude-code-session-policy.js'

/**
 * 访谈负责澄清产品需求，也允许核对用户明确提供的本地需求资料。
 * 文件访问由会话策略限制为只读工具，系统提示词只决定何时应主动读取。
 */
const INTERVIEW_SYSTEM_PROMPT = `你是一名资深产品分析师，负责通过深度访谈把模糊需求变成可验收的产品规格。

规则：
1. 只讨论需求，不设计技术架构或指定实现方式。
2. 初始需求明确提供本地文件或目录时，优先使用只读工具检查相关内容，不要求用户重复粘贴能够读取的资料。
3. 每轮最多提出一个最有信息增益的问题，问题要具体、易回答。
4. 主动覆盖目标、用户、核心流程、范围、非目标、业务规则、数据、状态、异常、边界和验收标准。
5. 不要重复已经回答的问题；能合理推导的内容直接推导并在规格中标明。
6. 信息足够时返回完整 Markdown 规格，status 设为 complete；否则 status 设为 question。
7. complete 时 question 必须为空；question 时 specification 必须为空。
8. 规格必须清楚区分目标、范围、非目标、核心流程、功能需求、业务规则、边界情况和验收标准。`

const PLANNING_SYSTEM_PROMPT = `你是一名需求规划师，负责把最终规格拆成可顺序执行的最小任务。

规则：
1. 每个任务只描述用户可观察需求和验收标准，不指定文件、目录、框架、类名、函数名或实现方案。
2. 任务按执行顺序排列；后续任务可以假设前面任务已经完成。
3. 每个任务必须职责单一、边界明确，并能由一个独立 Claude Code 会话完成。
4. 不创建 Reviewer、文档治理、发布、灰度、兼容、迁移或平台化任务，除非规格明确要求。
5. 避免把同一需求重复拆到多个任务，也不要提前实现未来扩展点。
6. 验收标准必须可观察、可验证，但不要冻结验证工具。`

const EXECUTION_SYSTEM_APPEND = `## 当前工作流约束

你正在一个全新的、与其他任务对话历史隔离的 Claude Code 会话中执行单个任务。

1. 编码前先阅读注入的总规格、历史进度、当前任务，并检查现有代码架构和数据流。
2. 只实现当前任务需求，不提前实现后续任务，不添加 legacy、fallback、deprecated 或灰度逻辑。
3. 如果现有架构不适合当前需求，先做职责清晰的必要重构，不写临时 patch。
4. 遵守项目 AGENTS.md；新增或修改的复杂代码写多行简体中文注释，不格式化无关代码。
5. 不修改工作流事实文档 docs/SPEC.md、docs/PROGRESS.md 和 docs/tasks/*.md，它们由外层工作流维护。
6. 完成后执行与当前任务风险匹配的非浏览器验证。只有需求和验收标准真正满足时才能报告 completed。
7. 若需要用户决策、外部权限或无法满足验收标准，报告 blocked，并明确 blocker。
8. progress 必须说明后续独立任务需要知道的已完成能力、约束和重要架构事实。`

export type ActivityReporter = (message: string) => void

interface StructuredSessionInput<T> {
  readonly prompt: string
  readonly systemPrompt: Options['systemPrompt']
  readonly outputSchema: Record<string, unknown>
  readonly validator: z.ZodType<T>
  readonly sessionKind: ClaudeCodeSessionKind
}

/**
 * Claude Code 适配器集中处理 SDK 查询、结构化输出和中断。
 * 三个产品动作共享一个稳定会话入口，但各自拥有独立 prompt 与输出模型。
 */
export class ClaudeCodeAgent implements CodingAgentPort {
  constructor(
    private readonly projectRoot: string,
    private readonly reportActivity: ActivityReporter = () => undefined,
  ) {}

  interview(
    initialRequirement: string,
    transcript: readonly InterviewMessage[],
  ): Promise<InterviewReply> {
    const prompt = [
      '# 初始需求',
      initialRequirement,
      '',
      '# 已完成的访谈记录',
      transcript.length > 0 ? JSON.stringify(transcript, null, 2) : '（尚未开始追问）',
      '',
      '请判断信息是否足够。若不足，提出下一项最关键问题；若足够，生成最终规格。',
    ].join('\n')
    return this.runStructuredSession({
      prompt,
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
      outputSchema: INTERVIEW_REPLY_JSON_SCHEMA as unknown as Record<string, unknown>,
      validator: InterviewReplySchema,
      sessionKind: 'interview',
    })
  }

  async createTaskPlan(specification: string): Promise<readonly TaskDraft[]> {
    const plan = await this.runStructuredSession({
      prompt: `# 最终规格\n\n${specification}\n\n请据此生成最小、顺序执行的需求任务。`,
      systemPrompt: PLANNING_SYSTEM_PROMPT,
      outputSchema: TASK_PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
      validator: TaskPlanSchema,
      sessionKind: 'planning',
    })
    return plan.tasks
  }

  executeTask(input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport> {
    return this.runStructuredSession({
      prompt: buildExecutionPrompt(input.specification, input.progress, input.task),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: EXECUTION_SYSTEM_APPEND,
      },
      outputSchema: TASK_EXECUTION_JSON_SCHEMA as unknown as Record<string, unknown>,
      validator: TaskExecutionReportSchema,
      sessionKind: 'execution',
    })
  }

  private async runStructuredSession<T>(input: StructuredSessionInput<T>): Promise<T> {
    const abortController = new AbortController()
    const abort = (): void => abortController.abort()
    process.once('SIGINT', abort)

    const options: Options = {
      cwd: this.projectRoot,
      systemPrompt: input.systemPrompt,
      outputFormat: { type: 'json_schema', schema: input.outputSchema },
      abortController,
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: false,
      /**
       * 会话类型显式决定工具能力，SDK 细节不会泄漏到应用用例。
       * 结构化输出失败由 SDK 自身的有限重试负责，不再设置单轮上限截断校验流程。
       */
      ...resolveClaudeCodeSessionAccess(input.sessionKind),
    }

    let result: SDKResultMessage | null = null
    try {
      for await (const message of query({ prompt: input.prompt, options })) {
        if (input.sessionKind === 'execution') reportSdkActivity(message, this.reportActivity)
        if (message.type === 'result') result = message
      }
    } finally {
      process.removeListener('SIGINT', abort)
    }

    if (!result) throw new Error('Claude Agent SDK 会话结束，但没有返回结果')
    if (result.subtype !== 'success') {
      throw new Error(`Claude Code 执行失败：${result.errors.join('；') || result.subtype}`)
    }
    return input.validator.parse(result.structured_output)
  }
}

/**
 * 每个执行 prompt 都显式携带总目标、已完成事实和当前需求。
 * 这三段内容构成独立会话的全部工作流上下文，不复用任何历史 session。
 */
function buildExecutionPrompt(specification: string, progress: string, task: TaskRecord): string {
  return [
    '# 总目标与完整规格',
    '',
    specification,
    '',
    '# 以前完成了什么',
    '',
    progress,
    '',
    '# 现在要做什么',
    '',
    task.document,
    '',
    '请直接检查当前代码并完整实现当前任务。',
  ].join('\n')
}

/**
 * 终端只展示工具活动，不回显模型的结构化 JSON。
 * 这样长任务有可见反馈，同时保持 CLI 输出简洁且不耦合具体工具参数。
 */
function reportSdkActivity(message: SDKMessage, reporter: ActivityReporter): void {
  if (message.type !== 'assistant') return
  const candidate = message as unknown as { message?: { content?: unknown[] } }
  for (const block of candidate.message?.content ?? []) {
    if (!block || typeof block !== 'object') continue
    const tool = block as { type?: unknown; name?: unknown }
    if (tool.type === 'tool_use' && typeof tool.name === 'string') {
      reporter(`Claude Code 正在使用工具：${tool.name}`)
    }
  }
}
