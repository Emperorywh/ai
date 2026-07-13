import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { TaskExecutionAgentPort } from '../application/ports.js'
import {
  TASK_EXECUTION_JSON_SCHEMA,
  TaskExecutionReportSchema,
  type TaskExecutionReport,
  type TaskRecord,
} from '../core/workflow.js'

const EXECUTION_SYSTEM_APPEND = `## 当前工作流约束

你正在一个全新的、与其他任务对话历史隔离的 Claude Code 会话中执行单个任务。

1. 编码前先显式查找并阅读适用的 AGENTS.md、CLAUDE.md，再阅读注入的总规格、历史进度、当前任务，并检查现有代码架构和数据流。
2. 只实现当前任务需求，不提前实现后续任务，不添加 legacy、fallback、deprecated 或灰度逻辑。
3. 如果现有架构不适合当前需求，先做职责清晰的必要重构，不写临时 patch。
4. 新增或修改的复杂代码写多行简体中文注释，不格式化无关代码。
5. 不修改工作流事实文档 docs/SPEC.md、docs/PROGRESS.md 和 docs/tasks/*.md，它们由外层工作流维护。
6. 完成后执行与当前任务风险匹配的非浏览器验证。只有需求和验收标准真正满足时才能报告 completed。
7. 若需要用户决策、外部权限或无法满足验收标准，报告 blocked，并明确 blocker。
8. progress 必须说明后续独立任务需要知道的已完成能力、约束和重要架构事实。`

export type ActivityReporter = (message: string) => void

/**
 * Claude Code 适配器只负责执行已经存在的任务文档。
 * 规格访谈和任务规划已移出运行时，由外部 AI 工具按照初始化提示词完成。
 */
export class ClaudeCodeTaskAgent implements TaskExecutionAgentPort {
  constructor(
    private readonly projectRoot: string,
    private readonly reportActivity: ActivityReporter = () => undefined,
  ) {}

  executeTask(input: {
    readonly specification: string
    readonly progress: string
    readonly task: TaskRecord
  }): Promise<TaskExecutionReport> {
    return this.runExecutionSession(buildExecutionPrompt(input.specification, input.progress, input.task))
  }

  private async runExecutionSession(prompt: string): Promise<TaskExecutionReport> {
    const abortController = new AbortController()
    const abort = (): void => abortController.abort()
    process.once('SIGINT', abort)

    const options: Options = {
      cwd: this.projectRoot,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: EXECUTION_SYSTEM_APPEND,
      },
      outputFormat: {
        type: 'json_schema',
        schema: TASK_EXECUTION_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
      abortController,
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: false,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      /**
       * 每个任务只通过规格、进度和任务文档恢复上下文，不依赖可恢复会话。
       * 禁止落盘 SDK 对话记录，使“独立任务会话”成为明确的运行时契约。
       */
      persistSession: false,
    }

    let result: SDKResultMessage | null = null
    try {
      for await (const message of query({ prompt, options })) {
        reportSdkActivity(message, this.reportActivity)
        if (message.type === 'result') result = message
      }
    } finally {
      process.removeListener('SIGINT', abort)
    }

    if (!result) throw new Error('Claude Agent SDK 会话结束，但没有返回结果')
    if (result.subtype !== 'success') {
      throw new Error(`Claude Code 执行失败：${result.errors.join('；') || result.subtype}`)
    }
    return TaskExecutionReportSchema.parse(result.structured_output)
  }
}

/**
 * 每个执行 prompt 都显式携带总目标、已完成事实和当前需求。
 * 三段工作流事实是任务会话的唯一跨任务上下文，不复用历史 SDK Session。
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
 * 活动上报保持在 SDK 边界内，CLI 不需要理解 Claude 消息协议。
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
