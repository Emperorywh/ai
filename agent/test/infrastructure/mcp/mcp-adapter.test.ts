import { describe, expect, it } from 'vitest'
import {
  createMcpAdapterFromConfig,
  McpAdapter,
  McpAdapterError,
  McpServerConfigSchema,
  McpServerEntrySchema,
  McpServerNotConfiguredError,
  McpServerNotRegisteredError,
  type McpServerConfig,
  type McpServerEntry,
  type Transport,
} from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 夹具：合法 transport 配置
 * ============================================================ */

/** stdio server 配置（含 command / args / env）。 */
const stdioConfig: McpServerConfig = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  env: { API_KEY: 'secret' },
}

/** http server 配置。 */
const httpConfig: McpServerConfig = {
  transport: 'http',
  url: 'https://docs.example.com/mcp',
}

/** sse server 配置。 */
const sseConfig: McpServerConfig = {
  transport: 'sse',
  url: 'https://sse.example.com/events',
}

/* ============================================================ *
 * type 层：McpServerConfigSchema / McpServerEntrySchema 正反例
 * ============================================================ */

describe('McpServerConfigSchema（transport 判别联合）', () => {
  it('合法 stdio 配置通过', () => {
    const parsed = McpServerConfigSchema.safeParse(stdioConfig)
    expect(parsed.success).toBe(true)
  })

  it('合法 http 配置通过', () => {
    const parsed = McpServerConfigSchema.safeParse(httpConfig)
    expect(parsed.success).toBe(true)
  })

  it('合法 sse 配置通过', () => {
    const parsed = McpServerConfigSchema.safeParse(sseConfig)
    expect(parsed.success).toBe(true)
  })

  it('stdio 缺 command 不通过', () => {
    const parsed = McpServerConfigSchema.safeParse({ transport: 'stdio' })
    expect(parsed.success).toBe(false)
  })

  it('http 缺 url 不通过', () => {
    const parsed = McpServerConfigSchema.safeParse({ transport: 'http' })
    expect(parsed.success).toBe(false)
  })

  it('http url 非法格式不通过', () => {
    const parsed = McpServerConfigSchema.safeParse({ transport: 'http', url: 'not-a-url' })
    expect(parsed.success).toBe(false)
  })

  it('未知 transport 不通过', () => {
    const parsed = McpServerConfigSchema.safeParse({ transport: 'websocket', url: 'wss://x' })
    expect(parsed.success).toBe(false)
  })

  it('stdio 缺 args/env 时取默认值 [] / {}', () => {
    const parsed = McpServerConfigSchema.safeParse({ transport: 'stdio', command: 'node' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ transport: 'stdio', command: 'node', args: [], env: {} })
    }
  })
})

describe('McpServerEntrySchema（name + config）', () => {
  it('合法 entry（name + stdio config）通过', () => {
    const entry: McpServerEntry = { name: 'browser', config: stdioConfig }
    const parsed = McpServerEntrySchema.safeParse(entry)
    expect(parsed.success).toBe(true)
  })

  it('缺 name 不通过', () => {
    const parsed = McpServerEntrySchema.safeParse({ config: httpConfig })
    expect(parsed.success).toBe(false)
  })

  it('name 空串不通过', () => {
    const parsed = McpServerEntrySchema.safeParse({ name: '', config: httpConfig })
    expect(parsed.success).toBe(false)
  })

  it('config 非法（http 无 url）不通过', () => {
    const parsed = McpServerEntrySchema.safeParse({ name: 'x', config: { transport: 'http' } })
    expect(parsed.success).toBe(false)
  })
})

/* ============================================================ *
 * domain 层：McpAdapter 注册 / 注销 / 列举
 * ============================================================ */

describe('McpAdapter.register / list', () => {
  it('注册单个 server 后 list 包含其 name + transport', () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    expect(adapter.list()).toEqual([{ name: 'browser', transport: 'stdio' }])
  })

  it('注册多个 server 后 list 按插入序返回', () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    adapter.register('docs', httpConfig)
    adapter.register('events', sseConfig)
    expect(adapter.list()).toEqual([
      { name: 'browser', transport: 'stdio' },
      { name: 'docs', transport: 'http' },
      { name: 'events', transport: 'sse' },
    ])
  })

  it('同名重复注册视为更新（覆盖 transport）', () => {
    const adapter = new McpAdapter()
    adapter.register('x', stdioConfig)
    adapter.register('x', httpConfig)
    expect(adapter.list()).toEqual([{ name: 'x', transport: 'http' }])
  })

  it('空串 / 纯空白 name 抛 McpAdapterError', () => {
    const adapter = new McpAdapter()
    expect(() => adapter.register('   ', httpConfig)).toThrow(McpAdapterError)
    expect(() => adapter.register('', httpConfig)).toThrow(McpAdapterError)
  })

  it('list 不返回完整 config（不含 env 等敏感细节）', () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    const info = adapter.list()[0]
    expect(info).toBeDefined()
    expect(Object.keys(info!)).toEqual(['name', 'transport'])
  })
})

describe('McpAdapter.unregister', () => {
  it('注销已注册 server 返回 true 且 list 不再包含', () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    expect(adapter.unregister('browser')).toBe(true)
    expect(adapter.list()).toEqual([])
  })

  it('注销未注册 server 返回 false（幂等）', () => {
    const adapter = new McpAdapter()
    expect(adapter.unregister('nope')).toBe(false)
  })
})

describe('McpAdapter 构造器 entries', () => {
  it('构造时传入 entries 全部注册', () => {
    const adapter = new McpAdapter([
      { name: 'browser', config: stdioConfig },
      { name: 'docs', config: httpConfig },
    ])
    expect(adapter.list()).toEqual([
      { name: 'browser', transport: 'stdio' },
      { name: 'docs', transport: 'http' },
    ])
  })

  it('不传 entries 构造空 adapter', () => {
    const adapter = new McpAdapter()
    expect(adapter.list()).toEqual([])
  })
})

/* ============================================================ *
 * domain 层：callTool 骨架（恒抛「未配置」错误）
 * ============================================================ */

describe('McpAdapter.callTool（骨架恒抛错）', () => {
  it('未注册 server 抛 McpServerNotRegisteredError', async () => {
    const adapter = new McpAdapter()
    await expect(adapter.callTool('ghost', 'search', { q: 'x' })).rejects.toThrow(
      McpServerNotRegisteredError,
    )
  })

  it('未注册 server 错误信息含被调名 + 已注册清单', async () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    await expect(adapter.callTool('ghost', 'search', {})).rejects.toThrow(/ghost.*browser/)
  })

  it('已注册但未实现 server 抛 McpServerNotConfiguredError', async () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    await expect(adapter.callTool('browser', 'navigate', { url: 'https://x' })).rejects.toThrow(
      McpServerNotConfiguredError,
    )
  })

  it('已注册未实现 server 错误信息含 server 名 + tool 名', async () => {
    const adapter = new McpAdapter()
    adapter.register('browser', stdioConfig)
    await expect(adapter.callTool('browser', 'navigate', {})).rejects.toThrow(/browser.*navigate/)
  })

  it('callTool 返回 Promise（async 契约，骨架恒 reject）', async () => {
    const adapter = new McpAdapter()
    const result = adapter.callTool('x', 'y', {})
    expect(result).toBeInstanceOf(Promise)
    // 骨架恒抛错：消费 rejection 避免未处理拒绝。
    await expect(result).rejects.toThrow(McpServerNotRegisteredError)
  })

  it('错误类均继承 McpAdapterError', () => {
    expect(new McpServerNotRegisteredError('x', [])).toBeInstanceOf(McpAdapterError)
    expect(new McpServerNotConfiguredError('x', 't')).toBeInstanceOf(McpAdapterError)
  })
})

/* ============================================================ *
 * data 层：配置加载 createMcpAdapterFromConfig
 * ============================================================ */

describe('createMcpAdapterFromConfig（配置加载）', () => {
  it('合法配置注册全部 server', () => {
    const adapter = createMcpAdapterFromConfig({
      mcp_servers: [
        { name: 'browser', config: stdioConfig },
        { name: 'docs', config: httpConfig },
      ],
    })
    expect(adapter.list()).toEqual([
      { name: 'browser', transport: 'stdio' },
      { name: 'docs', transport: 'http' },
    ])
  })

  it('mcp_servers 缺失视为空清单', () => {
    const adapter = createMcpAdapterFromConfig({})
    expect(adapter.list()).toEqual([])
  })

  it('mcp_servers 为 undefined 视为空清单', () => {
    const adapter = createMcpAdapterFromConfig({ mcp_servers: undefined })
    expect(adapter.list()).toEqual([])
  })

  it('entry name 空串解析失败抛 McpAdapterError', () => {
    expect(() =>
      createMcpAdapterFromConfig({ mcp_servers: [{ name: '', config: httpConfig }] }),
    ).toThrow(McpAdapterError)
  })

  it('config 非法（http 无 url）解析失败抛 McpAdapterError', () => {
    expect(() =>
      createMcpAdapterFromConfig({
        mcp_servers: [{ name: 'x', config: { transport: 'http' } }],
      }),
    ).toThrow(McpAdapterError)
  })

  it('mcp_servers 非数组解析失败抛 McpAdapterError', () => {
    expect(() => createMcpAdapterFromConfig({ mcp_servers: 'not-an-array' })).toThrow(
      McpAdapterError,
    )
  })
})

/* ============================================================ *
 * 端到端：配置加载 → 列举 → 调用（骨架抛错）
 * ============================================================ */

describe('端到端：配置加载 → register → callTool', () => {
  it('加载配置后可列举、callTool 抛骨架错误', async () => {
    const adapter = createMcpAdapterFromConfig({
      mcp_servers: [{ name: 'browser', config: stdioConfig }],
    })
    expect(adapter.list()).toEqual([{ name: 'browser', transport: 'stdio' as Transport }])
    await expect(adapter.callTool('browser', 'click', { selector: '#x' })).rejects.toThrow(
      McpServerNotConfiguredError,
    )
  })
})
