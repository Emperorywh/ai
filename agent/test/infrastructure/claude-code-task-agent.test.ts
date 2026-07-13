import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeTaskAgent } from '../../src/infrastructure/claude-code-task-agent.js'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const queryMock = vi.mocked(query)

/**
 * 每次 SDK 调用都创建独立异步消息流，只模拟任务适配器依赖的最小协议。
 * 测试重点是执行权限、显式上下文和不可恢复会话配置。
 */
function mockStructuredOutput(output: unknown): void {
  queryMock.mockImplementation(() => {
    async function* messages(): AsyncGenerator<SDKMessage, void> {
      yield {
        type: 'result',
        subtype: 'success',
        structured_output: output,
      } as unknown as SDKMessage
    }

    return messages() as ReturnType<typeof query>
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('ClaudeCodeTaskAgent', () => {
  it('使用显式工作流上下文启动不可恢复的完整执行会话', async () => {
    mockStructuredOutput({
      status: 'completed',
      summary: '已完成',
      progress: '地图能力已实现',
      changedFiles: ['src/map.ts'],
      verification: ['npm test'],
      blocker: '',
    })
    const agent = new ClaudeCodeTaskAgent('C:\\target-project')

    await agent.executeTask({
      specification: '# SPEC\n\n总目标',
      progress: '# PROGRESS\n\n历史事实',
      task: {
        metadata: { id: 'TASK-001', title: '展示地图', status: 'running' },
        document: '# TASK-001\n\n当前需求',
      },
    })

    const request = queryMock.mock.calls[0]?.[0]
    expect(request?.prompt).toContain('总目标')
    expect(request?.prompt).toContain('历史事实')
    expect(request?.prompt).toContain('当前需求')
    expect(request?.options).toMatchObject({
      cwd: 'C:\\target-project',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: false,
    })
    expect(request?.options?.systemPrompt).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
    })
    expect(request?.options).not.toHaveProperty('resume')
    expect(request?.options).not.toHaveProperty('continue')
    expect(request?.options).not.toHaveProperty('maxTurns')
    expect(request?.options).not.toHaveProperty('tools')
  })
})
