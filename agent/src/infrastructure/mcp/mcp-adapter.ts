/**
 * MCP（Model Context Protocol）适配器骨架（infrastructure/mcp/mcp-adapter.ts）。
 *
 * 本文件为 MCP 工具扩展提供「注册机制 + 统一调用代理」的骨架：
 *   - McpAdapter 维护 server 注册表（register / unregister / list）。
 *   - callTool 是统一的工具调用代理接口；**具体 server 连接 / 工具调用未实现**，
 *     一律抛 McpServerNotConfiguredError（任务 §2 / §7：不伪造调用、显式报错）。
 *   - createMcpAdapterFromConfig 从项目配置（raw 对象）解析 server 清单并构造 adapter。
 *
 * 分层定位（ARCHITECTURE.md §3 / 任务 §8）：本文件属 infrastructure，只做外部系统适配的
 * 骨架与注册机制，**不承载核心工作流领域逻辑**（§3.1：MCP 不承载核心逻辑）。零反向依赖——
 * 不 import core / application / cli（MCP 配置 schema 属 infra 关注点，就近用 zod 定义，
 * 不污染 core）；不引入任何 npm 依赖（仅用既有 zod）。
 *
 * 设计约束（任务 §7 / §8 / §12）：
 *   - 避免过度设计：具体 server（浏览器 / 设计工具 / 项目管理系统等）接入留待真实需求，
 *     骨架保持最小（§12）；配置结构定义到「足以注册 + 校验」，不绑定具体文件路径
 *     （init 生成的项目骨架尚无 MCP 配置文件，与 init 的衔接留待后续任务）。
 *   - 不伪造：callTool 不假装调用成功，注册但未实现的 server 一律抛「未配置」错误。
 *   - Zod schema 为单一来源：McpServerConfigSchema / McpServerEntrySchema 与
 *     z.infer 派生类型同源导出，杜绝类型与校验规则漂移。
 *
 * 权威来源：根目录 Readme.md §3.1（MCP 工具扩展职责边界：接入外部工具能力，
 * 不承载核心工作流领域逻辑）。
 */
import { z } from 'zod'

/* ============================================================ *
 * transport 配置（stdio / http / sse，判别联合）
 * ============================================================ */

/**
 * MCP server 的传输方式（Readme.md §3.1 MCP 接入外部工具能力的传输形态）。
 *
 * 三种 MCP 常见 transport：stdio（本地子进程）、http（流式 HTTP）、sse（SSE 长连接）。
 * 作为 McpServerConfigSchema 判别联合的 discriminator 值，亦导出供 list() / 展示复用。
 */
const TransportSchema = z.enum(['stdio', 'http', 'sse'])
export type Transport = z.infer<typeof TransportSchema>

/** stdio transport 配置（本地子进程：command + args + env）。 */
const StdioTransportConfigSchema = z.object({
  transport: z.literal('stdio'),
  /** 启动 server 子进程的命令（如 npx / node）。 */
  command: z.string().min(1),
  /** 传给子进程的命令行参数。 */
  args: z.array(z.string()).default([]),
  /** 子进程环境变量（如鉴权 token）。 */
  env: z.record(z.string(), z.string()).default({}),
})

/** http transport 配置（流式 HTTP：url）。 */
const HttpTransportConfigSchema = z.object({
  transport: z.literal('http'),
  /** server 的 HTTP 端点。 */
  url: z.string().url(),
})

/** sse transport 配置（SSE 长连接：url）。 */
const SseTransportConfigSchema = z.object({
  transport: z.literal('sse'),
  /** server 的 SSE 端点。 */
  url: z.string().url(),
})

/**
 * MCP server 配置（判别联合，按 transport 区分连接参数）。
 *
 * 单一来源：McpServerConfig 类型由本 schema 派生（z.infer）。注册时 config 不含 name
 * （name 是 McpAdapter 注册表的 key，由 register(name, config) 单独传入）。
 */
const McpServerConfigSchema = z.discriminatedUnion('transport', [
  StdioTransportConfigSchema,
  HttpTransportConfigSchema,
  SseTransportConfigSchema,
])
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export { McpServerConfigSchema }

/* ============================================================ *
 * 项目配置条目（name + config）与配置清单
 * ============================================================ */

/**
 * 项目配置中的单个 MCP server 条目：注册名 + transport 配置。
 *
 * 对应配置文件（YAML / JSON）形如：
 *   mcp_servers:
 *     - name: browser
 *       config:
 *         transport: stdio
 *         command: npx
 *         args: ["-y", "@modelcontextprotocol/server-puppeteer"]
 *     - name: docs
 *       config:
 *         transport: http
 *         url: https://docs.example.com/mcp
 */
const McpServerEntrySchema = z.object({
  /** 注册名（McpAdapter 注册表的 key，须非空）。 */
  name: z.string().min(1),
  /** transport 配置（不含 name）。 */
  config: McpServerConfigSchema,
})
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>
export { McpServerEntrySchema }

/**
 * 项目级 MCP 配置根结构：mcp_servers 清单。
 *
 * createMcpAdapterFromConfig 据此校验 raw 配置；mcp_servers 缺失视为空清单（默认 []）。
 */
const McpServersConfigSchema = z.object({
  mcp_servers: z.array(McpServerEntrySchema).default([]),
})
export type McpServersConfig = z.infer<typeof McpServersConfigSchema>
export { McpServersConfigSchema }

/* ============================================================ *
 * 工具调用参数 / 结果（最小抽象）
 * ============================================================ */

/**
 * MCP 工具调用参数（JSON 可序列化的键值对）。
 *
 * MCP 协议的工具入参为 JSON 对象；骨架阶段以宽松 record 接收，真实 server 接入时
 * 按各工具自身的 input schema 收紧（具体 schema 由 server 在握手期声明，本骨架不预设）。
 */
export type McpToolArgs = Readonly<Record<string, unknown>>

/**
 * MCP 内容块（最小占位）。
 *
 * MCP server 返回的内容块种类因协议版本而异（text / image / audio / resource 等），
 * 本骨架以 `type` 为种类标记、其余字段透传为 unknown；真实 server 接入时按协议收紧块类型。
 */
export interface McpContentBlock {
  /** 块种类（text / image / resource / ...）。 */
  readonly type: string
  /** 其余字段因种类而异，骨架阶段透传。 */
  readonly [key: string]: unknown
}

/**
 * MCP 工具调用结果（最小抽象，任务 §2「统一的工具调用代理接口」）。
 *
 * 骨架阶段不产出（callTool 一律抛 McpServerNotConfiguredError）；真实 server 接入时
 * 由具体 transport 实现填充 content / isError。字段对齐 MCP 协议「工具结果 =
 * content 块数组 + isError 标记」（isError 区分工具级错误与调用本身的异常）。
 */
export interface McpToolResult {
  /** MCP server 返回的内容块数组。 */
  readonly content: readonly McpContentBlock[]
  /** 是否为工具级错误（区别于调用本身的异常）。 */
  readonly isError: boolean
}

/* ============================================================ *
 * 错误类型（base + 子类，复用 ExecutorError 模式）
 * ============================================================ */

/**
 * MCP 适配器错误基类。
 *
 * 不可恢复的适配器失败（配置解析失败、server 未注册 / 未实现连接等）以此抛出，不静默。
 * 具体子类 McpServerNotRegisteredError / McpServerNotConfiguredError 见下。
 */
export class McpAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpAdapterError'
  }
}

/**
 * 调用的 server 不在注册表中（任务 §11「调用未配置 server 抛明确错误」）。
 *
 * message 含被调用的 server 名 + 当前已注册清单，便于调用方快速定位。
 */
export class McpServerNotRegisteredError extends McpAdapterError {
  constructor(server: string, registered: readonly string[]) {
    const list = registered.length > 0 ? registered.join(', ') : '（空）'
    super(`MCP server "${server}" 未注册（不在 McpAdapter 注册表中）。已注册 server：${list}`)
    this.name = 'McpServerNotRegisteredError'
  }
}

/**
 * server 已注册但具体连接 / 工具调用未实现（任务 §2 / §7「具体 server 实现留空并抛『未配置』错误」）。
 *
 * 骨架阶段所有 callTool（对已注册 server）均抛此错——不伪造调用结果。真实 server 接入后
 * 由具体 transport 实现替换此行为（任务 §12：具体 server 接入留待真实需求）。
 */
export class McpServerNotConfiguredError extends McpAdapterError {
  constructor(server: string, tool: string) {
    super(
      `MCP server "${server}" 已注册但未实现连接，无法调用工具 "${tool}"。` +
        '具体 server 接入留待真实需求（任务 §7 / §12），当前为骨架，不伪造工具调用。',
    )
    this.name = 'McpServerNotConfiguredError'
  }
}

/* ============================================================ *
 * McpAdapter —— 注册表 + 统一调用代理（骨架）
 * ============================================================ */

/** list() 返回的单个 server 摘要（name + transport，不含连接敏感细节如 env）。 */
export interface McpServerInfo {
  /** 注册名。 */
  readonly name: string
  /** 传输方式（stdio / http / sse）。 */
  readonly transport: Transport
}

/**
 * MCP 适配器骨架（Readme.md §3.1 / 任务 §2）。
 *
 * 维护 server 注册表并提供统一的工具调用代理。骨架阶段：
 *   - register / unregister / list 立即可用（纯内存注册表，无 I/O、无连接）。
 *   - callTool 对未注册 server 抛 McpServerNotRegisteredError；
 *     对已注册 server 抛 McpServerNotConfiguredError（连接未实现，不伪造）。
 *
 * 重复注册（同名）视为更新配置（覆盖），便于配置重载场景；unregister 返回是否曾存在。
 */
export class McpAdapter {
  /** 注册表：name → transport 配置（Map 保插入序，list 据此产出确定性顺序）。 */
  private readonly servers = new Map<string, McpServerConfig>()

  /**
   * @param entries 可选的初始 server 清单（经 McpServerEntrySchema 校验后的条目，
   *   逐条 register；构造即注册便于 createMcpAdapterFromConfig 复用）。
   */
  constructor(entries?: ReadonlyArray<McpServerEntry>) {
    if (entries !== undefined) {
      for (const entry of entries) {
        this.register(entry.name, entry.config)
      }
    }
  }

  /**
   * 注册（或更新）一个 MCP server。
   *
   * @param name 注册名（注册表 key，须非空串）。
   * @param config transport 配置（不含 name）。
   * @throws McpAdapterError name 为空串 / 纯空白。
   */
  register(name: string, config: McpServerConfig): void {
    if (name.trim() === '') {
      throw new McpAdapterError('MCP server 注册名不能为空串 / 纯空白。')
    }
    // 同名覆盖：配置重载时更新 transport 配置，不抛错（幂等更新语义）。
    this.servers.set(name, config)
  }

  /**
   * 注销一个 MCP server。
   *
   * @returns 是否曾注册（Map.delete 语义：曾存在返回 true、否则 false），幂等。
   */
  unregister(name: string): boolean {
    return this.servers.delete(name)
  }

  /**
   * 列出已注册 server 的摘要（name + transport，插入序）。
   *
   * 不返回完整 config（含 env 等连接敏感细节），仅供展示 / 发现。
   */
  list(): readonly McpServerInfo[] {
    return [...this.servers.entries()].map(([name, config]) => ({
      name,
      transport: config.transport,
    }))
  }

  /**
   * 统一的工具调用代理（任务 §2）。
   *
   * 骨架阶段**不实现具体连接**：未注册 server 抛 McpServerNotRegisteredError；
   * 已注册 server 抛 McpServerNotConfiguredError（连接未实现，不伪造调用结果）。
   * 真实 server 接入后由具体 transport 实现替换为「连接 → 调用 tool → 返回 McpToolResult」。
   *
   * 声明为 async 以匹配真实 MCP 调用（网络 / IPC 为异步）的契约形态。
   *
   * @param server 注册名。
   * @param tool server 暴露的工具名。
   * @param _args 工具入参（JSON 键值对）；骨架阶段恒抛错未使用，前缀 `_` 标注
   *   （真实 server 接入后消费为调用参数，届时去掉前缀）。
   */
  async callTool(server: string, tool: string, _args: McpToolArgs): Promise<McpToolResult> {
    const config = this.servers.get(server)
    if (config === undefined) {
      throw new McpServerNotRegisteredError(server, [...this.servers.keys()])
    }
    // 已注册但具体连接未实现：抛「未配置」错误，不伪造 McpToolResult（任务 §7）。
    // _args 在此骨架中未使用（真实实现将传给 server），前缀 `_` 抑制 no-unused-vars。
    throw new McpServerNotConfiguredError(server, tool)
  }
}

/* ============================================================ *
 * 配置加载：从项目配置（raw 对象）解析 server 清单并构造 adapter
 * ============================================================ */

/**
 * 从项目配置（raw 对象）解析 MCP server 清单并构造 McpAdapter（任务 §2「配置加载」）。
 *
 * 用 McpServersConfigSchema 校验 raw：mcp_servers 缺失视为空清单（默认 []）、
 * 每条 entry 的 name 非空 + config 合法 transport 配置。校验失败抛 McpAdapterError
 * （含 Zod 错误信息），不静默吞错。
 *
 * 本函数只做「解析 + 构造」，不读取文件——具体配置文件路径 / 格式（与 init 生成的项目
 * 配置衔接）留待后续任务（§8 / §12：避免过度设计，init 尚无 MCP 配置文件）。
 *
 * @param raw 项目配置原始对象（如 YAML.parse 后的结构）。
 * @returns 已注册清单中所有 server 的 McpAdapter。
 * @throws McpAdapterError raw 不符合 McpServersConfigSchema。
 */
export function createMcpAdapterFromConfig(raw: unknown): McpAdapter {
  const parsed = McpServersConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new McpAdapterError(`MCP 配置解析失败：${parsed.error.message}`)
  }
  return new McpAdapter(parsed.data.mcp_servers)
}
