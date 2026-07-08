---
id: TASK-017
title: App 状态流转编排器
status: draft
layer: domain
depends_on:
  - TASK-007
  - TASK-008
  - TASK-011
  - TASK-015
allowed_paths:
  - src/application/state-orchestrator.ts
  - src/application/index.ts
  - test/application/state-orchestrator.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/state-orchestrator
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#7-任务状态机
    - Readme.md#10-任务执行结果模板
    - Readme.md#15-reviewer-审查清单
  source_files:
    - src/core/state-machine.ts
    - src/core/rules/dependency-rules.ts
    - src/core/rules/status-mapping.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-017-app-state-orchestrator.result.md
---

# TASK-017 App 状态流转编排器

## 1. 背景

来自 PLAN P4。状态机的实际流转由 application 层编排（§5.1）：读 frontmatter → 校验转移合法性 → 写回；并组合依赖级联与 `.result.md`/`.review.md` 映射。

## 2. 当前目标

实现 `StateOrchestrator`（注入文档仓储）：
- `transition(taskId, to, context)`：校验 `validateTransition` → 写 frontmatter `status`。
- `applyResult(taskId, result, { orchestratorVerified })`：用 `mapResultToStatus` 得目标状态并 transition；含 no_review 分支。
- `applyReview(taskId, review)`：approved→done、rejected→rejected、needs-human→blocked、skipped→走 no_review 校验。
- `cascadeIfBlocked(taskId, allTasks)`：前置失败时级联后继 blocked。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-017-app-state-orchestrator.md
- Readme.md §7/§10/§15

## 5. 修改范围

- `src/application/state-orchestrator.ts`、`src/application/index.ts`、`test/application/state-orchestrator.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`

## 7. 不做什么

- 不做合并回写（TASK-019/020）。
- 不做 SQLite 写入（索引同步由 TASK-014 的 IndexRepository 在编排外部 hook，或由 CLI 层组合；本任务专注文档状态）。

## 8. 架构约束

- 依赖 core 状态机 + 规则；对文档仓储的依赖经 `application/ports.ts` 的 `TaskDocRepositoryPort`（TASK-015 建立），不直接 import infra 实现类，不直接依赖 SQLite。
- 所有状态变更必须先过 `validateTransition`，非法转移抛错不静默。
- 编排器不自行修改全局文档（PROGRESS/DECISIONS/ISSUES），那是合并回写职责。

## 9. 数据流和状态流要求

`.result.md`/`.review.md` → 编排器 → 任务 frontmatter `status`；前置失败 → 级联后继 blocked。

## 10. 预期新增或修改文件

- `src/application/state-orchestrator.ts`、`test/application/state-orchestrator.test.ts`、`src/application/index.ts`

## 11. 验收标准

- §7/§10/§15 的关键路径都有用例（含 no_review 通过/不通过、级联）。
- 非法转移抛错；`typecheck` 0 错误。

## 12. 风险提示

- no_review 任务 Orchestrator 校验「产物齐全」的判定（.result.md 完整 + 验证结果 + 全局更新建议）需明确清单，避免与 Reviewer 职责混淆。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-017-app-state-orchestrator.result.md
- `PROGRESS.md` 更新建议：状态编排就绪，后续由 TASK-029 完成 P4 规划用例收尾
