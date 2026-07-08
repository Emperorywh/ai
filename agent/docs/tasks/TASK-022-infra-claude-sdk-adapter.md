---
id: TASK-022
title: Infra Claude Agent SDK 适配器
status: draft
layer: data
depends_on:
  - TASK-009
  - TASK-015
allowed_paths:
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/executor-contract.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/sdk
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
    - Readme.md#16-权限模型
    - Readme.md#18-新上下文启动提示模板
  source_files:
    - src/core/rules/permission-rules.ts
    - src/core/rules/verification-rules.ts
    - src/application/context-pack-generator.ts
workflow_outputs:
  result_file: docs/tasks/TASK-022-infra-claude-sdk-adapter.result.md
---

# TASK-022 Infra Claude Agent SDK 适配器

## 1. 背景

来自 PLAN P7。Claude Agent SDK 是执行引擎适配层（§3.1），但**具体 SDK API 未确认（SPEC 风险 R1）**。本任务先确认 SDK 版本与接口，再以接口隔离方式实现，core/application 不得依赖具体 SDK。

## 2. 当前目标

- 先确认：选定 Claude Agent SDK 版本、子 agent 派发方式、Context Pack 注入方式、权限/hooks 注入点（结论写入 `.result.md` 与 DECISIONS）。
- 定义 `TaskExecutor` 契约接口（`executor-contract.ts`）：输入 Context Pack + 权限边界 + 启动提示模板（§18），输出 `.result.md` 路径与执行状态。
- 实现 `ClaudeSdkExecutor`（实现该契约）+ `DryRunLocalExecutor`（SDK 未就位时的兜底，本地不调用模型，产出占位 result 供前置阶段联调）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-022-infra-claude-sdk-adapter.md
- Readme.md §3.1/§16/§18

## 5. 修改范围

- `src/infrastructure/sdk/claude-sdk-adapter.ts`、`src/infrastructure/sdk/executor-contract.ts`、`src/infrastructure/index.ts`、`test/infrastructure/sdk/claude-sdk-adapter.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、其他 infra 文件

## 7. 不做什么

- 不在 core/application 引用具体 SDK 类型（只依赖 `executor-contract`）。
- 不承载工作流领域逻辑（§3.1：SDK 不承载核心逻辑）。
- 若 SDK API 无法在本次确认，落 ISSUES 并以 DryRun 交付，不得伪造 SDK 调用。

## 8. 架构约束

- 契约接口放 infrastructure（被 application 依赖时通过接口，不反向）。
- 权限注入使用 TASK-009 的解析结果（路径作用域 + 命令授权）。
- 启动提示套用 §18 模板，注入 Context Pack 清单文件。

## 9. 数据流和状态流要求

Context Pack + 权限 → Executor → 在 worktree 内执行 → 产出 `.result.md`（execution_status/modified_files/global_update_requests/next_action）。

## 10. 预期新增或修改文件

- `src/infrastructure/sdk/executor-contract.ts`、`src/infrastructure/sdk/claude-sdk-adapter.ts`、`test/infrastructure/sdk/claude-sdk-adapter.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- `executor-contract` 接口稳定；DryRunExecutor 可产出合法 `.result.md`（过 ResultFrontmatterSchema）。
- 若确认了 SDK：`ClaudeSdkExecutor` 可在隔离环境跑通最小任务；否则在 ISSUES 记录未决项。
- `typecheck` 0 错误。

## 12. 风险提示

- SDK API 未确认是本计划最高风险（R1）；本任务允许以「确认 + 接口 + DryRun」收尾，不强行实现不确定的集成。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-022-infra-claude-sdk-adapter.result.md
- `DECISIONS.md` 更新建议：SDK 选型与注入方式决策
- `ISSUES.md` 更新建议：SDK 未决项（若有）
