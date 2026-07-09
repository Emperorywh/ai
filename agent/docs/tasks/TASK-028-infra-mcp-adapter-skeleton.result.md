---
task_id: TASK-028
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/mcp/mcp-adapter.ts
  - test/infrastructure/mcp/mcp-adapter.test.ts
deleted_files: []
execution_commits: []
next_action: review
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess + NodeNext）
  - command: npm test -- infrastructure/mcp
    result: passed
    notes: 34 项单测全绿（type 层 schema 正反例 11 + domain 层 register/unregister/list/callTool 骨架 18 + data 层配置加载 6 + 端到端 1；含 discriminatedUnion transport 判别 / 骨架恒抛 McpServerNot(Registered|Configured)Error / 配置默认值 / 错误类继承）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（callTool 的 _args 骨架未用，前缀 `_` 标注符合 no-unused-vars `/^_/u`）
  - command: npm test
    result: skipped
    notes: 全量回归 619 项中 42 失败全在 SQLite 文件（sqlite/schema 15 + sqlite/index-repo 21 + cli/status-rebuild 6），根因 better-sqlite3 原生模块在 Node v24.3.0（ABI 137）下无预编译二进制（ISS-005 既有环境约束，要求 Node 22 ABI 127），与本任务零相关（MCP 适配器不依赖 SQLite）；本任务相关测试（infrastructure/mcp 34 项）全绿。
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: "- TASK-028（Infra MCP 适配器骨架）已完成：`src/infrastructure/mcp/mcp-adapter.ts` 提供 `McpAdapter`（注册表：`register(name, config)` / `unregister(name)` / `list()`，Map 保插入序、同名覆盖更新）+ 统一调用代理 `callTool(server, tool, args)`（骨架阶段恒抛错——未注册抛 `McpServerNotRegisteredError`、已注册未实现抛 `McpServerNotConfiguredError`，不伪造 McpToolResult）+ `createMcpAdapterFromConfig(raw)`（配置加载：`McpServersConfigSchema` 校验 raw → 构造 adapter，mcp_servers 缺失视为空清单）+ Zod schema（`McpServerConfigSchema` transport 判别联合 stdio/http/sse + `McpServerEntrySchema` name+config + `McpServersConfigSchema`）与 `z.infer` 派生类型同源导出。零反向依赖（不 import core/application/cli，MCP 配置 schema 就近用 zod 定义不污染 core）、零 npm 新增（仅既有 zod）。infrastructure 适配器层补齐 MCP 适配器骨架，P9 收尾。34 项单测。"
    - section: 当前系统可用能力
      mode: append
      content: "  - MCP 适配器骨架：`McpAdapter`（`src/infrastructure/mcp/mcp-adapter.ts`）提供外部工具扩展的注册机制 + 统一调用代理骨架。注册表 API：`register(name, config)`（config 为 transport 判别联合，不含 name；同名覆盖更新配置，便于重载）/ `unregister(name)`（返回是否曾注册，幂等）/ `list()`（返回 `{name, transport}` 摘要数组，插入序，不含 env 等连接敏感细节）。`callTool(server, tool, args)` 统一调用代理——**骨架阶段不实现具体连接**：未注册 server 抛 `McpServerNotRegisteredError`（含已注册清单）、已注册 server 抛 `McpServerNotConfiguredError`（连接未实现，不伪造），声明为 async 匹配真实 MCP 调用契约。`createMcpAdapterFromConfig(raw)` 配置加载——`McpServersConfigSchema`（`{ mcp_servers: [{name, config}] }`，缺失默认 []）校验 raw 对象，失败抛 `McpAdapterError`（含 Zod 错误信息），不读文件（与 init 衔接留待后续）。错误类：`McpAdapterError`（base）+ `McpServerNotRegisteredError` / `McpServerNotConfiguredError`（子类，复用 ExecutorError 模式）。Zod schema 与 `z.infer` 类型同源：`McpServerConfigSchema`（stdio=http=sse 三 transport，stdlib stdio 含 command/args/env 默认、http/sse 含 url）、`Transport` 枚举（'stdio'|'http'|'sse'）。infra 实现类无需 `implements`，CLI composition root 待后续接入时 wiring。具体 MCP server 接入（浏览器/设计/项目管理等）按需另立任务（§12 避免过度设计，SPEC 无 server 清单 R5）。"
    - section: 当前架构状态
      mode: append
      content: "- `src/infrastructure/mcp/mcp-adapter.ts` 建立：仅依赖既有 `zod`，零反向依赖（不 import core/application/cli，ARCHITECTURE §3 infrastructure→core 为允许方向但本任务 MCP 配置 schema 属 infra 关注点就近定义不污染 core；不依赖具体 MCP server SDK——SPEC 无 server 清单 R5）。沿用「Zod schema 单一来源 + `z.infer` 派生类型」模式：`McpServerConfigSchema` 用 `z.discriminatedUnion('transport', [...])` 表达 stdio（command 必填 + args/env 默认 [] / {}）/ http（url）/ sse（url）三种 transport，类型安全、TS 收窄正确；`McpServerEntrySchema`（name 非空 + config）与 `McpServersConfigSchema`（mcp_servers 数组默认 []）供配置加载。沿用「类 + Result 错误」模式（复用 TASK-022 ExecutorError 基类+子类范式）：`McpAdapterError`（base extends Error）+ `McpServerNotRegisteredError` / `McpServerNotConfiguredError`（extends McpAdapterError），callTool 骨架恒抛错不伪造。`McpAdapter.servers` 为 `Map<string, McpServerConfig>`（保插入序、同名覆盖），`register` 空串/纯空白 name 抛 McpAdapterError。`callTool` 参数 `args` 骨架未用前缀 `_args`（no-unused-vars `/^_/u`，真实实现消费时去前缀）。`noUncheckedIndexedAccess` 下 Map.get 返回值用 undefined 守卫。`src/infrastructure/index.ts` 追加 `./mcp/mcp-adapter.js` 再导出（NodeNext 需 `.js` 后缀）。"
    - section: 后续任务必须知道的信息
      mode: append
      content: "- MCP 适配器骨架复用要点（TASK-028）：`McpAdapter`（`src/infrastructure/mcp/mcp-adapter.ts`）是外部工具扩展的注册 + 调用骨架。注册：`register(name, config)`（config = `McpServerConfig` transport 判别联合，**不含 name**；name 是注册表 key 单独传；同名覆盖更新不抛错）。配置加载：`createMcpAdapterFromConfig(raw)` 用 `McpServersConfigSchema`（`{ mcp_servers: McpServerEntry[] }`，缺失默认 []）校验 raw 对象后构造 adapter，**只解析不读文件**——具体配置文件路径 / 格式（与 init 生成的项目配置衔接）留待后续任务（init 尚无 MCP 配置文件，§12 避免过度设计）。`callTool(server, tool, args)` **骨架恒抛错**：未注册→`McpServerNotRegisteredError`、已注册→`McpServerNotConfiguredError`（连接未实现）；真实 server 接入时由具体 transport 实现替换为「连接 → 调用 tool → 返回 `McpToolResult`」，届时 `_args` 去前缀。错误体系：`McpAdapterError`（base）+ 两子类，复用 TASK-022 ExecutorError 模式。零 core 依赖（MCP 配置 schema 就近用 zod 定义）。具体 MCP server（浏览器/设计/项目管理等）接入按需另立任务（SPEC 无 server 清单 R5，§7 不承载核心工作流领域逻辑）。详见 DEC-024（proposed）+ ISS-017（low，open）。"
    - section: 建议下一个任务
      mode: replace
      content: "- TASK-029：App 规划工作流（layer: `domain`，depends TASK-003/011/015/016 ✅）—— 提供 SPEC/ARCHITECTURE → PLAN + 任务集合的 application 规划用例，完成后解除 TASK-024 阻塞（plan/task:create 依赖之）。TASK-024（cli-plan-and-task-create，被 TASK-029 阻塞）与 TASK-029 是仅剩两个未完成任务；按「编号最小 + depends 全完成」规则，TASK-028 完成后下一个可执行的是 TASK-029（编号 024 的 depends_on 含 029 未完成故被阻塞）。MCP 适配骨架（TASK-028）已交付，P9 收尾。"
    - section: 当前未解决问题摘要
      mode: append
      content: "- ISS-017（low，open）新增自 TASK-028：MCP 配置文件格式与 init 衔接未落地——init（TASK-023）生成的项目骨架（AGENTS.md + docs/{...}.md + docs/tasks/）尚无 MCP 配置文件，`createMcpAdapterFromConfig(raw)` 只接受已解析的 raw 对象、不读文件 / 不绑定路径。具体配置文件格式（如项目根 `.caw/mcp.json` 或 AGENTS/docs 内声明）+ CLI wiring（读配置 → 构造 adapter → 注入 Executor）待后续任务（SPEC 无 server 清单 R5）。不阻塞本任务验收（§8 明文「与 init 衔接」、§12「避免过度设计」，骨架只交付结构 + 注册机制）。详见 ISS-017。\n- ISS-005（low，open）范围确认：本机当前 Node v24.3.0（ABI 137）下 better-sqlite3@11.10.0 原生模块同样无预编译二进制（原 ISS-005 记 Node 25 ABI 141，现观测 Node 24 ABI 137 亦命中），全量回归 42 项 SQLite 测试失败（sqlite/schema + sqlite/index-repo + cli/status-rebuild）系此既有环境约束；本任务（MCP 适配器）不依赖 SQLite，相关测试全绿。建议固定 Node 22（ABI 127）运行 SQLite 相关任务。"
  decisions:
    - id: ""
      title: MCP 适配器骨架设计——transport 判别联合 + 零 core 依赖 + 骨架恒抛错 + 配置加载接受 raw
      status: proposed
      scope: TASK-028
      created_from_task: TASK-028
      decision: "MCP 适配器骨架采用以下设计：（1）`McpServerConfigSchema` 用 `z.discriminatedUnion('transport', stdio/http/sse)` 表达 transport 判别联合（stdio 含 command 必填 + args/env 默认，http/sse 含 url），类型安全且 TS 可正确收窄；（2）`register(name, config)` 把注册名与 transport 配置分离（name 是注册表 key、config 不含 name），配置条目 `McpServerEntry = {name, config}` 嵌套结构避免 flat intersection 与判别联合的解析歧义；（3）骨架阶段 `callTool` 恒抛错（未注册→McpServerNotRegisteredError、已注册→McpServerNotConfiguredError），声明为 async 匹配真实 MCP 调用契约，不伪造 McpToolResult；（4）错误体系 McpAdapterError（base）+ 两子类，复用 TASK-022 ExecutorError 模式；（5）`createMcpAdapterFromConfig(raw)` 只做「Zod 校验 + 构造」、不读文件 / 不绑定路径（init 尚无 MCP 配置文件，§12 避免过度设计）；（6）MCP 配置 schema 就近用 zod 定义在 infrastructure/mcp，不污染 core（§3.1 MCP 属 infra 关注点，且 forbidden core），实现零 core 依赖。"
      rationale: "判别联合是表达「不同 transport 有不同连接参数」的正确抽象（避免 flat 可选字段无法区分 stdio 的 command 与 http 的 url），且本仓库 Core Schema 一贯追求精度；name 与 config 分离让注册表 key 与 server 配置解耦，便于别名 / 重载；骨架恒抛错遵循 §7「具体 server 实现留空并抛『未配置』错误」且不伪造（呼应 TASK-022 DryRun 哲学）；配置加载只接受 raw 对象而非文件，避免为不存在的配置文件格式过度设计（init 未生成，R5 无 server 清单）。零 core 依赖是 forbidden_paths 的自然结果且最干净。"
      consequences: "骨架可直接用于「注册 + 列举 + 调用代理」联调；真实 server 接入时需：实现具体 transport 连接（替换 callTool 抛错为真实调用）、`_args` 去前缀、定义配置文件格式与 CLI wiring（读配置→createMcpAdapterFromConfig→注入）。具体 MCP server 清单未定（R5），后续按需另立任务。详见 ISS-017。"
  issues:
    - id: ""
      title: MCP 配置文件格式与 init 衔接未落地，createMcpAdapterFromConfig 只接受 raw 对象
      status: open
      severity: low
      scope: TASK-028
      created_from_task: TASK-028
      owner: Orchestrator
      recommended_action: "后续任务定义 MCP 配置文件格式（如项目根 .caw/mcp.json 或在 AGENTS/docs 内声明 server 清单）+ CLI wiring（读配置 → createMcpAdapterFromConfig → 构造 McpAdapter → 注入 Executor / 具体调用方）。本骨架只交付结构与注册机制，不阻塞当前验收（§8 / §12）。SPEC 无 server 清单（R5），具体 server 接入按需另立任务。"
---

# TASK-028 Infra MCP 适配器骨架 执行结果

## 1. 执行结论

已完成。落地 MCP 适配器骨架（`src/infrastructure/mcp/mcp-adapter.ts`）：

- **注册表 API**：`McpAdapter` 类，`register(name, config)` / `unregister(name)` / `list()`，`Map<string, McpServerConfig>` 保插入序、同名覆盖更新（便于配置重载）。
- **统一调用代理**：`callTool(server, tool, args)` 骨架阶段恒抛错——未注册 server 抛 `McpServerNotRegisteredError`、已注册 server 抛 `McpServerNotConfiguredError`（连接未实现，不伪造 `McpToolResult`，§7）。声明为 async 匹配真实 MCP 调用契约。
- **配置加载**：`createMcpAdapterFromConfig(raw)` 用 `McpServersConfigSchema`（`{ mcp_servers: McpServerEntry[] }`，缺失默认 `[]`）校验 raw 对象 → 构造 adapter，失败抛 `McpAdapterError`（含 Zod 错误信息）。只解析不读文件（与 init 衔接留待后续，§12 避免过度设计）。
- **Zod schema 单一来源**：`McpServerConfigSchema`（`z.discriminatedUnion('transport', stdio/http/sse)`）+ `McpServerEntrySchema` + `McpServersConfigSchema`，与 `z.infer` 派生类型同源导出。`Transport` 枚举导出供 `list()` 复用。
- **错误体系**：`McpAdapterError`（base）+ `McpServerNotRegisteredError` / `McpServerNotConfiguredError`（子类），复用 TASK-022 ExecutorError 模式。

**零反向依赖**：不 import core/application/cli（MCP 配置 schema 属 infra 关注点就近用 zod 定义，forbidden core 守住）。**零 npm 新增**：仅依赖既有 `zod`。

## 2. 实际改动文件清单

- 新建 `src/infrastructure/mcp/mcp-adapter.ts`（骨架 + 注册机制 + 配置加载 + Zod schema + 错误类）
- 新建 `test/infrastructure/mcp/mcp-adapter.test.ts`（34 项单测）
- 修改 `src/infrastructure/index.ts`（追加 `export * from './mcp/mcp-adapter.js'`，1 行 + 注释）

## 3. 验证结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | ✅ passed | 0 错误（strict + noUncheckedIndexedAccess + NodeNext） |
| `npm test -- infrastructure/mcp` | ✅ passed | 34 项单测全绿（type 正反例 11 + domain 骨架 18 + data 配置加载 6 + e2e 1） |
| `npm run lint` | ✅ passed | eslint 0 错误 0 警告 |
| `npm test`（全量回归） | ⚠️ skipped | 42 失败全在 SQLite 文件，既有 ISS-005 环境约束（Node 24 ABI 137 无 better-sqlite3 预编译），与本任务零相关 |

全量回归 42 项失败分布：`sqlite/schema`（15）+ `sqlite/index-repo`（21）+ `cli/status-rebuild`（6），全部根因 `better_sqlite3.node` 原生模块加载失败（`node-v137-win32-x64` binding not found）。MCP 适配器不依赖 SQLite，相关 34 项测试全绿。其余非 SQLite 测试全绿（577 passed）。

## 4. global_update_requests

- **progress**：6 条（当前完成到哪个任务 append + 当前系统可用能力 append + 当前架构状态 append + 后续任务必须知道的信息 append + 建议下一个任务 replace + 当前未解决问题摘要 append）
- **decisions**：1 条（DEC-024，proposed）
- **issues**：1 条（ISS-017，low/open）+ ISS-005 范围确认说明（追加于未解决问题摘要，不新建条目）

## 5. 遗留 issue 与 next_action

- **ISS-017（low，open）**：MCP 配置文件格式与 init 衔接未落地，`createMcpAdapterFromConfig` 只接受 raw 对象、不读文件。具体配置文件格式 + CLI wiring 待后续任务（SPEC 无 server 清单 R5）。不阻塞验收。
- **ISS-005 范围确认**：Node v24.3.0（ABI 137）亦命中（原记 Node 25 ABI 141），全量 SQLite 回归失败系既有环境约束，建议固定 Node 22 运行。
- **next_action: review**——骨架已过 typecheck / 自身测试 / lint，提请 Reviewer 审查。
