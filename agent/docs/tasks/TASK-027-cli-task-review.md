---
id: TASK-027
title: CLI task:review 命令
status: draft
layer: page
depends_on:
  - TASK-011
  - TASK-017
allowed_paths:
  - src/cli/commands/task-review.ts
  - src/cli/index.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/task-review
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#15-reviewer-审查清单
  source_files:
    - src/application/state-orchestrator.ts
    - src/infrastructure/fs/task-doc-repo.ts
workflow_outputs:
  result_file: docs/tasks/TASK-027-cli-task-review.result.md
---

# TASK-027 CLI task:review 命令

## 1. 背景

来自 PLAN P8。`task:review` 编排 Reviewer 审查（§5.3/§15）：读取 `.result.md` 与改动 → 产出 `.review.md`（approved/rejected/needs-human-confirmation；no_review 时产出 skipped）→ 由 `applyReview` 映射任务状态。

## 2. 当前目标

实现 `task:review <taskId>`：
- `no_review: true` → 生成 `review_result: skipped` 的 `.review.md`，由 Orchestrator 校验产物齐全后流转。
- 否则 → 调用 Reviewer（可复用 Executor 契约派 reviewer agent，或本地审查器）产出 `.review.md` → `applyReview` 映射状态。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-027-cli-task-review.md
- Readme.md §5.3/§15

## 5. 修改范围

- `src/cli/commands/task-review.ts`、`src/cli/index.ts`、`test/cli/task-review.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`

## 7. 不做什么

- 不在 CLI 内硬编码审查清单规则（清单见 §15，由 reviewer agent/审查器执行）。
- 不把审查结论写进 `.result.md`（§5.3：结论与执行事实分离）。

## 8. 架构约束

- 审查结论只写 `.review.md`；状态映射走 `StateOrchestrator.applyReview`。
- `no_review` 的 skipped 仍需 Orchestrator 校验产物齐全才能 done（§7/§15）。

## 9. 数据流和状态流要求

`.result.md` + 改动 → review → `.review.md` → applyReview → done/rejected/blocked。

## 10. 预期新增或修改文件

- `src/cli/commands/task-review.ts`、`test/cli/task-review.test.ts`、`src/cli/index.ts`

## 11. 验收标准

- 三种审查结论正确映射状态；no_review 产出 skipped 并校验产物。
- 审查结论不污染 `.result.md`；`typecheck` 0 错误。

## 12. 风险提示

- reviewer agent 的具体实现可复用 TASK-022 契约；若未就位用本地审查器兜底，避免阻塞。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-027-cli-task-review.result.md
- `PROGRESS.md` 更新建议：task:review 就绪，CLI P8 收尾
