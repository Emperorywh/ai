---
id: TASK-006
title: Core 审查结论 Schema（.review.md）
status: draft
layer: type
depends_on:
  - TASK-002
allowed_paths:
  - src/core/schemas/review-schema.ts
  - src/core/index.ts
  - test/core/schemas/review-schema.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/schemas/review-schema
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#15-reviewer-审查清单
  source_files:
    - src/core/enums.ts
workflow_outputs:
  result_file: docs/tasks/TASK-006-core-review-schema.result.md
---

# TASK-006 Core 审查结论 Schema（.review.md）

## 1. 背景

来自 PLAN P1。`.review.md`（§15 模板）由 Reviewer/Orchestrator 写入，审查结论与执行事实分离。需 Zod Schema 锁定。

## 2. 当前目标

实现 `ReviewFrontmatterSchema`：`task_id`、`review_result`（approved/rejected/needs-human-confirmation/skipped）、`reviewer`、`reviewed_at`（ISO8601）、`required_changes[]`、`findings[]`。

## 3. 所属层级

`type`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-006-core-review-schema.md
- Readme.md §15

## 5. 修改范围

- `src/core/schemas/review-schema.ts`、`src/core/index.ts`、`test/core/schemas/review-schema.test.ts`

## 6. 禁止修改范围

- `core/enums.ts`、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不实现「审查结论 → 任务状态」映射（属 TASK-008 状态映射的评审分支，由 TASK-017 编排实现）。
- 不实现 `.review.md` 读写（TASK-011）。

## 8. 架构约束

- 仅依赖 `core/enums.ts` + Zod。
- `reviewed_at` 用 `z.string().datetime()`（或 ISO 正则）。
- `review_result=skipped` 用于 `no_review: true` 时 Orchestrator 生成的占位审查。

## 9. 数据流和状态流要求

`.review.md` 由 Reviewer（或 Orchestrator 在 no_review 时）写 → Orchestrator 据 `review_result` 映射任务状态。

## 10. 预期新增或修改文件

- `src/core/schemas/review-schema.ts`、`test/core/schemas/review-schema.test.ts`、`src/core/index.ts`

## 11. 验收标准

- §15 正例通过；非法 `review_result` 被拒；`reviewed_at` 非法日期被拒。
- `typecheck` 0 错误。

## 12. 风险提示

- `required_changes` 在 approved/skipped 时应为空——作为软约束在测试中提示，不强制 Schema 拒绝（保留弹性）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-006-core-review-schema.result.md
- `PROGRESS.md` 更新建议：Review Schema 就绪，Core Schema 全部完成
