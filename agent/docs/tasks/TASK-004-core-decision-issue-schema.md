---
id: TASK-004
title: Core 决策与问题机器字段 Schema
status: draft
layer: type
depends_on:
  - TASK-002
allowed_paths:
  - src/core/schemas/decision-issue-schema.ts
  - src/core/index.ts
  - test/core/schemas/decision-issue-schema.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/schemas/decision-issue-schema
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#66-decisionsmd
    - Readme.md#67-issuesmd
    - Readme.md#10-任务执行结果模板
  source_files:
    - src/core/enums.ts
workflow_outputs:
  result_file: docs/tasks/TASK-004-core-decision-issue-schema.result.md
---

# TASK-004 Core 决策与问题机器字段 Schema

## 1. 背景

来自 PLAN P1。`DECISIONS.md`（§6.6）与 `ISSUES.md`（§6.7）的机器字段需稳定，以支持 Zod 校验与 SQLite 重建；其字段集与 `.result.md` 的 `global_update_requests` 提议项一致（TASK-005 复用）。

## 2. 当前目标

实现 `DecisionSchema`（`id/title/status/scope/created_from_task/decision/rationale/consequences`）与 `IssueSchema`（`id/title/status/severity/scope/created_from_task/owner/recommended_action`）。`id` 允许空字符串（Task Executor 提议时留空，由 Orchestrator 分配）。`created_from_task` 取 `Scope` 语义（任务 id 或 `SPEC`/`ARCHITECTURE`）。

## 3. 所属层级

`type`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-004-core-decision-issue-schema.md
- Readme.md §6.6/§6.7/§10 相关章节

## 5. 修改范围

- `src/core/schemas/decision-issue-schema.ts`、`src/core/index.ts`、`test/core/schemas/decision-issue-schema.test.ts`

## 6. 禁止修改范围

- `src/core/enums.ts`、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不实现全局文档读写（TASK-012）。
- 不实现 `global_update_requests` 容器（TASK-005）。

## 8. 架构约束

- 仅依赖 `core/enums.ts` + Zod。
- `id` 用 `z.string()` 允许空（分配前）；`status/scope/severity` 用枚举。
- 字段集必须与 §6.6/§6.7 列出的「至少包括」逐字对齐。

## 9. 数据流和状态流要求

这两类记录由 Task Executor 在 `.result.md` 提议（id 空）→ Orchestrator 回写时分配 id（`DEC-XXX`/`ISS-XXX`）→ 落入 SQLite 索引。

## 10. 预期新增或修改文件

- `src/core/schemas/decision-issue-schema.ts`、`test/core/schemas/decision-issue-schema.test.ts`、`src/core/index.ts`

## 11. 验收标准

- §6.6/§6.7 正例通过；缺任意必填字段被拒；`id=""` 合法。
- `created_from_task` 接受 `SPEC`/`ARCHITECTURE`/`TASK-XXX`。
- `typecheck` 0 错误。

## 12. 风险提示

- 不要把「分配 id 的规则」写进 Schema；id 分配是 application 层职责（TASK-020）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-004-core-decision-issue-schema.result.md
- `PROGRESS.md` 更新建议：决策/问题 Schema 就绪，可供 Result Schema 复用
