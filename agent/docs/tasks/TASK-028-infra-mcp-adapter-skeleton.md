---
id: TASK-028
title: Infra MCP 适配器骨架
status: draft
layer: data
depends_on:
  - TASK-001
allowed_paths:
  - src/infrastructure/mcp/mcp-adapter.ts
  - src/infrastructure/index.ts
  - test/infrastructure/mcp/mcp-adapter.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/mcp
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-028-infra-mcp-adapter-skeleton.result.md
---

# TASK-028 Infra MCP 适配器骨架

## 1. 背景

来自 PLAN P9。MCP 用于接入外部工具能力（§3.1），但**无具体 server 清单（SPEC 范围未确认，R5）**。本任务只产出适配器骨架与注册机制，不承载核心工作流逻辑，也不实现具体 MCP server 业务。

## 2. 当前目标

实现 `McpAdapter` 骨架：
- 注册/注销 MCP server 的接口（`register(name, config)` / `unregister(name)` / `list()`）。
- 统一的工具调用代理接口（`callTool(server, tool, args)`），具体 server 实现留空并抛「未配置」错误。
- 配置加载（从项目配置读取 server 清单）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-028-infra-mcp-adapter-skeleton.md
- Readme.md §3.1（MCP 职责边界）

## 5. 修改范围

- `src/infrastructure/mcp/mcp-adapter.ts`、`src/infrastructure/index.ts`、`test/infrastructure/mcp/mcp-adapter.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、其他 infra 文件

## 7. 不做什么

- 不实现任何具体 MCP server（浏览器/设计工具/项目管理等）——按需另立任务。
- 不承载工作流领域逻辑（§3.1：MCP 不承载核心逻辑）。

## 8. 架构约束

- 仅骨架 + 注册机制；依赖配置文件格式（与 init 生成的项目配置衔接）。
- 不反向依赖 application/core。

## 9. 数据流和状态流要求

配置 → 注册的 server 清单 → 工具调用代理（具体 server 未实现时显式报错）。

## 10. 预期新增或修改文件

- `src/infrastructure/mcp/mcp-adapter.ts`、`test/infrastructure/mcp/mcp-adapter.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- 注册/注销/列举接口可用；调用未配置 server 抛明确错误。
- `typecheck` 0 错误。

## 12. 风险提示

- 避免过度设计：具体 server 接入留待真实需求，骨架保持最小。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-028-infra-mcp-adapter-skeleton.result.md
- `PROGRESS.md` 更新建议：MCP 骨架就绪，P9 收尾；具体 server 接入按需另立任务
