import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeAgent } from '../../src/infrastructure/claude-code-agent.js'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))

const queryMock = vi.mocked(query)

/**
 * 每次 SDK 调用都返回一个新的异步消息流，避免测试之间共享已消费的生成器状态。
 * 这里只模拟适配器依赖的最小协议，测试重点是发送给 SDK 的会话配置。
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

describe('ClaudeCodeAgent 只推理会话', () => {
  it('访谈显式关闭工具且不设置单轮上限', async () => {
    mockStructuredOutput({ status: 'question', question: '地图面向哪些用户？', specification: '' })
    const agent = new ClaudeCodeAgent('C:\\target-project')

    await agent.interview('展示 AGV 地图', [])

    const options = queryMock.mock.calls[0]?.[0].options
    expect(options).toMatchObject({
      permissionMode: 'dontAsk',
      tools: [],
    })
    expect(options).not.toHaveProperty('allowedTools')
    expect(options).not.toHaveProperty('maxTurns')
  })

  it('规划复用相同的无工具结构化会话策略', async () => {
    mockStructuredOutput({
      tasks: [
        {
          title: '展示地图',
          requirement: '用户可以查看 AGV 地图。',
          acceptanceCriteria: ['地图可以正常展示。'],
        },
      ],
    })
    const agent = new ClaudeCodeAgent('C:\\target-project')

    await agent.createTaskPlan('# SPEC')

    const options = queryMock.mock.calls[0]?.[0].options
    expect(options).toMatchObject({
      permissionMode: 'dontAsk',
      tools: [],
    })
    expect(options).not.toHaveProperty('allowedTools')
    expect(options).not.toHaveProperty('maxTurns')
  })
})
