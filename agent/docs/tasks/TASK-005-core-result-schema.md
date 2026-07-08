---
id: TASK-005
title: Core 执行结果 Schema（.result.md）
status: draft
layer: type
depends_on:
  - TASK-002
  - TASK-004
allowed_paths:
  - src/core/schemas/result-schema.ts
  - src/core/index.ts
  - test/core/schemas/result-schema.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/schemas/result-schema
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#10-任务执行结果模板
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/core/enums.ts
    - src/core/schemas/decision-issue-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-005-core-result-schema.result.md
---

# TASK-005 Core 执行结果 Schema（.result.md）

## 1. 背景

来自 PLAN P1。`.result.md` frontmatter（§10）是 Task Executor 的执行事实来源，也是 Orchestrator 流转状态、合并回写的输入。需 Zod Schema 锁定结构。

## 2. 当前目标

实现 `ResultFrontmatterSchema`：`task_id`、`execution_status`、`modified_files[]`、`created_files[]`、`deleted_files[]`、`execution_commits[]`、`verification[]{command,result,notes}`、`global_update_requests{progress[],decisions[],issues[]}`、`next_action`。其中 `progress` 项 = `{section, mode, content}`；`decisions/issues` 项复用 TASK-004 字段集（`id` 允许空）。

## 3. 所属层级

`type`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-005-core-result-schema.md
- Readme.md §10/§3.2 相关章节

## 5. 修改范围

- `src/core/schemas/result-schema.ts`、`src/core/index.ts`、`test/core/schemas/result-schema.test.ts`

## 6. 禁止修改范围

- `core/enums.ts`、`decision-issue-schema.ts`（复用，不改）、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不实现 `execution_status × next_action → status` 映射（TASK-008）。
- 不实现 `.result.md` 读写（TASK-011）。

## 8. 架构约束

- 依赖 `core/enums.ts` + `decision-issue-schema.ts` + Zod。
- `execution_commits` 默认 `[]`（由 Orchestrator 回填）。
- `verification[].result` ∈ passed/failed/skipped。

## 9. 数据流和状态流要求

`.result.md` 由 Executor 写 → Orchestrator 读 → 映射状态（TASK-008）→ 合并时回填 `execution_commits`（TASK-019）→ section 回写全局文档（TASK-020）。

## 10. 预期新增或修改文件

- `src/core/schemas/result-schema.ts`、`test/core/schemas/result-schema.test.ts`、`src/core/index.ts`

## 11. 验收标准

- §10 正例通过；`global_update_requests` 三子项结构与 §10 最小结构一致。
- `progress` 项缺 `mode` 被拒；`mode` 非 replace/append 被拒。
- 非法 `execution_status`/`next_action` 组合不在此校验（属 TASK-008），本任务只校验单字段枚举。
- `typecheck` 0 错误。

## 12. 风险提示

- `execution_status × next_action` 的**非法组合**（§10）不在 Schema 层硬拒（Schema 只校验枚举值），由 TASK-008 的映射函数在运行期判定，避免重复约束。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-005-core-result-schema.result.md
- `PROGRESS.md` 更新建议：Result Schema 就绪
