import type { Options } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeCodeSessionKind = 'interview' | 'planning' | 'execution'

type ClaudeCodeSessionAccessOptions = Pick<
  Options,
  'permissionMode' | 'tools' | 'allowedTools' | 'allowDangerouslySkipPermissions'
>

const INTERVIEW_READ_TOOLS = ['Read', 'Grep', 'Glob']

/**
 * 三类产品会话的工具暴露与批准策略集中在同一处维护。
 * `tools` 决定模型能看到什么，`allowedTools` 决定哪些工具无需交互确认，
 * 两者同时设置才能让访谈稳定读取本地资料且无法越权写入或执行命令。
 */
export function resolveClaudeCodeSessionAccess(
  kind: ClaudeCodeSessionKind,
): ClaudeCodeSessionAccessOptions {
  switch (kind) {
    case 'interview':
      return {
        permissionMode: 'dontAsk',
        tools: [...INTERVIEW_READ_TOOLS],
        allowedTools: [...INTERVIEW_READ_TOOLS],
      }
    case 'planning':
      return {
        permissionMode: 'dontAsk',
        tools: [],
      }
    case 'execution':
      return {
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }
  }
}
