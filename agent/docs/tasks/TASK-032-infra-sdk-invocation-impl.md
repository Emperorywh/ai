---
id: TASK-032
title: ClaudeSdkInvocation 真实实现
status: draft
layer: data
depends_on:
  - TASK-022
  - TASK-030
  - TASK-031
allowed_paths:
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/executor-contract.ts
  - src/infrastructure/sdk/sdk-client.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/sdk/claude-sdk-invocation-impl
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - docs/SPEC_claude-sdk-integration.md#4-执行模型taskrun-侧
    - docs/SPEC_claude-sdk-integration.md#8-容错技术故障分类处理agents-3-显式化
  source_files:
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/sdk-client.ts
    - src/core/schemas/result-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-032-infra-sdk-invocation-impl.result.md
---

# TASK-032 ClaudeSdkInvocation 真实实现

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0，SPEC §4。`ClaudeSdkInvocation` 接口（TASK-022）当前无真实实现。本任务实现真实类：内部用 sdk-client（030）跑自主 query，把模型末尾产出的 JSON 提取 + safeParse + 重试降级 + 容错分类，返回 `SdkRunReport`。`ClaudeSdkExecutor` 编排逻辑（`claude-sdk-adapter.ts:248`）**不变**。

## 2. 当前目标

- **`claude-sdk-invocation-impl.ts`**：实现 `ClaudeSdkInvocation.run(SdkRunInput) → SdkRunReport`。
- **自主执行**（§4.1/F1）：经 sdk-client 一次 query，模型自驱到完成。
- **JSON 提取 + safeParse**（§4.2/F2）：从模型末尾 ```result-frontmatter 块提取 JSON，`ResultFrontmatterSchema.safeParse`（Executor 可产子集，`execution_commits` 留空）。
- **重试降级**（§4.3）：parse 失败把 error 反馈追加重试 N=2 次；耗尽降级 `failed`+`needs-human`，verification 标 skipped，issues 记 parse 错。
- **容错分类**（§8）：鉴权错立即 `failed`；网络/429/5xx 指数退避重试耗尽降级；safety 拒绝 `needs-human`；中断（§9）保留 worktree 产降级 result。
- **中断**（§9）：`abortController.abort()` 捕获 `AbortError`，产降级 result（blocked/failed）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§4/§8/§9/§12/§15）、docs/tasks/TASK-032-infra-sdk-invocation-impl.md
- `src/infrastructure/sdk/claude-sdk-adapter.ts`、`src/infrastructure/sdk/sdk-client.ts`、`src/core/schemas/result-schema.ts`

## 5. 修改范围

- `src/infrastructure/sdk/claude-sdk-invocation-impl.ts`（新）、`src/infrastructure/index.ts`（追加导出）、`test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts`（新）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、`src/infrastructure/sdk/claude-sdk-adapter.ts`（契约不改）、`executor-contract.ts`、`sdk-client.ts`

## 7. 不做什么

- 不改 `ClaudeSdkInvocation` 接口 / `SdkRunInput` / `SdkRunReport` / `ClaudeSdkExecutor` 编排（SPEC §3）。
- 不做权限拦截（F3 不挂 `canUseTool`）；`permission_boundary` 仅经 `systemPrompt.append` 注入。
- 不设 `maxTurns` 硬上限（F4）。
- 不做 Reviewer（TASK-033）、不做 CLI 接线（TASK-034）。
- 不实际调真实 API（fake sdk-client 注入单测；真实 API 在 TASK-035）。

## 8. 架构约束

- **provider 配置经构造函数注入**（env/model/systemPrompt 基底，来自 TASK-031），`SdkRunInput` 契约不改（PLAN §0-5）；CLI（034）在 composition root 装配实例。
- 实现 `ClaudeSdkInvocation` 接口，被 `ClaudeSdkExecutor` 经注入消费。
- query options：`cwd`=`worktreePath`、`env`=构造注入的 provider env、`systemPrompt.append`=`startupPrompt`+边界声明+§4.2 JSON 产出指令、`permissionMode='bypassPermissions'`。

## 9. 数据流和状态流要求

构造（providerEnv/model/sdkClient）+ `run(SdkRunInput)` → 装 query options → sdk-client query → 模型自驱 → 末尾 JSON 提取/safeParse/重试降级/容错分类 → `SdkRunReport` → `ClaudeSdkExecutor` 落 `.result.md`（编排不变）。

## 10. 预期新增或修改文件

- `src/infrastructure/sdk/claude-sdk-invocation-impl.ts`、`test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准（SPEC §14-6，fake 单测全覆盖）

- 正常产出：模型产合法 JSON → `SdkRunReport` 字段正确。
- JSON parse 失败重试 N 次（带 error 反馈）。
- 重试耗尽降级 `failed`+`needs-human`（verification skipped，issues 记 parse 错）。
- 鉴权错（SDK 抛鉴权类）→ 立即 `failed`，不重试。
- 网络错/429/5xx → 指数退避重试耗尽降级。
- SIGINT `abort` → 捕获 `AbortError`，产降级 result（blocked/failed），保留 worktree。
- 零真实 API；`typecheck` 0 错误。

## 12. 风险提示

- R-JSON：模型谎报 verification/modified_files——重试+降级兜底，谎报风险用户接受（F2 权衡）。
- provider 配置经构造注入 vs `SdkRunInput` 不改——确保 CLI 装配正确（TASK-034 验证）。
- SDK 中断后抛 `AbortError` 还是返回 result——两种兼容（§9）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-032-infra-sdk-invocation-impl.result.md
- `DECISIONS.md` 更新建议：invocation 实现设计（构造注入 provider + JSON 提取规则 + 重试降级策略）
- `ISSUES.md` 更新建议：SDK 中断行为若与预期不符
