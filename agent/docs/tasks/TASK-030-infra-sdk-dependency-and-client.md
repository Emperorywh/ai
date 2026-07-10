---
id: TASK-030
title: 扩权新增 Claude Agent SDK 依赖 + sdk-client 会话工厂
status: draft
layer: data
depends_on:
  - TASK-022
allowed_paths:
  - package.json
  - src/infrastructure/sdk/sdk-client.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sdk/sdk-client.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/executor-contract.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm install
  - npm run typecheck
  - npm test -- infrastructure/sdk/sdk-client
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
    - docs/PLAN_coding-agent-workflow.md#0-spec-待确认事项与风险
  source_files:
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/executor-contract.ts
workflow_outputs:
  result_file: docs/tasks/TASK-030-infra-sdk-dependency-and-client.result.md
---

# TASK-030 扩权新增 Claude Agent SDK 依赖 + sdk-client 会话工厂

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0。TASK-022 产出 `ClaudeSdkInvocation` 接口骨架（`DryRunLocalExecutor` 兜底 + `ClaudeSdkExecutor` 注入式编排），**无真实 SDK 调用**。本任务是 SPEC 落地的第一步：扩权装真实 SDK + 建可复用 query 会话工厂，是 TASK-032/033 的基础。**扩权违反 TASK-001 依赖红线**，本任务即扩权立项（PLAN §0-2 / R-DEP）。

## 2. 当前目标

- **扩权**：`package.json` 新增 `@anthropic-ai/claude-agent-sdk`（锁版号），`npm install`；`DECISIONS.md` 记扩权决策。
- **`sdk-client.ts`**：封装 `query()` 装配（字段按 SPEC §12 校准：`cwd`/`model`/`env`/`permissionMode:'bypassPermissions'`/`systemPrompt`/`settingSources`/`includePartialMessages:true`/`abortController`/`stderr`；**不传** `canUseTool`/`resume`/`continue`/`forkSession`/`maxTurns`）+ 流式消费（for-await `SDKMessage`，分派 `system-init`/`assistant`/`user`/`stream_event`/`result`）+ abort（`abortController.abort()` → 捕获 `AbortError`）+ cost/usage 采集（result 的 `subtype`/`total_cost_usd`/`usage`/`num_turns`/`duration_ms`）。
- sdk-client **不承载任务领域逻辑**（JSON 提取/重试/降级在 TASK-032）——它只做「装 options → 跑 query → 回流式与终止信息」。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§12/§7/§9）、docs/tasks/TASK-030-infra-sdk-dependency-and-client.md
- Readme.md §3.1

## 5. 修改范围

- `package.json`（扩权新增依赖）、`src/infrastructure/sdk/sdk-client.ts`（新）、`src/infrastructure/index.ts`（追加导出）、`test/infrastructure/sdk/sdk-client.test.ts`（新）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、`src/infrastructure/sdk/claude-sdk-adapter.ts`（契约不改）、`src/infrastructure/sdk/executor-contract.ts`

## 7. 不做什么

- 不实现 `ClaudeSdkInvocation` 的真实类（TASK-032）。
- 不做 Provider Profile / env 组装（TASK-031）——sdk-client **接收**已组装好的 env/options，不读配置。
- 不承载 JSON 提取/重试降级（TASK-032）。
- 不改 `TaskExecutor`/`ClaudeSdkInvocation` 契约。
- 不实际调真实 API（真实 API 在 TASK-035 CI；本任务用 fake query 流单测）。

## 8. 架构约束

- sdk-client 是纯 infra，依赖 SDK 包 + core 类型（type-only）；**不反向依赖 application/cli**。
- sdk-client 暴露给 invocation（032）和 reviewer（033）复用，避免重复装配 query/流式/cost 逻辑。
- `env` / `model` / `systemPrompt.append` 由调用方（032/033 经 031）组装后传入，sdk-client 只透传到 `options`。

## 9. 数据流和状态流要求

调用方传入（`prompt`/`cwd`/`env`/`systemPrompt`/`abortController` + 流式/日志回调）→ sdk-client 装 `options` → `query()` → for-await 流式回调（assistant/user/stream_event 驱动 §7 输出）+ 采集 result 终止信息 → 返回 `{ result, cost, usage }`。

## 10. 预期新增或修改文件

- `src/infrastructure/sdk/sdk-client.ts`、`test/infrastructure/sdk/sdk-client.test.ts`、`package.json`、`src/infrastructure/index.ts`

## 11. 验收标准

- `package.json` 锁定 `@anthropic-ai/claude-agent-sdk` 版号，`npm install` 成功，包入 `node_modules`。
- sdk-client 单测：注入返回各种 `SDKMessage` 序列的 fake query，断言 `total_cost_usd`/`usage`/`num_turns`/`duration_ms`/`subtype` 正确采集、`abortController.abort()` 触发并抛 `AbortError`、字段名与 §12 一致。
- `typecheck` 0 错误。

## 12. 风险提示

- R-DEP：扩权违反 TASK-001 红线——本任务就是扩权立项，须在 `.result.md`/`DECISIONS.md` 明记。
- R-API：字段名以 §12 校准为准，实现仍核对安装版 `.d.ts`，差异回写 SPEC §12。
- SDK 可能有 native 依赖（R-NODE）——确认后若需特定 Node 版本记 `ISSUES.md`。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-030-infra-sdk-dependency-and-client.result.md
- `DECISIONS.md` 更新建议：扩权新增 SDK 依赖 + sdk-client 会话工厂设计
- `ISSUES.md` 更新建议：SDK native 依赖 / Node 版本要求（若有）
