---
id: TASK-008
title: Core 依赖级联与执行状态映射
status: draft
layer: domain
depends_on:
  - TASK-002
  - TASK-007
allowed_paths:
  - src/core/rules/dependency-rules.ts
  - src/core/rules/status-mapping.ts
  - src/core/index.ts
  - test/core/rules/dependency-mapping.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/rules
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#7-任务状态机
    - Readme.md#10-任务执行结果模板
  source_files:
    - src/core/enums.ts
    - src/core/state-machine.ts
workflow_outputs:
  result_file: docs/tasks/TASK-008-core-cascade-and-mapping.result.md
---

# TASK-008 Core 依赖级联与执行状态映射

## 1. 背景

来自 PLAN P1。两条核心领域规则需要纯函数实现：(1) 依赖级联（§7 传递闭包，前置进入 rejected/failed/blocked → 后继全部 blocked）；(2) `.result.md` 的 `execution_status × next_action → 目标状态` 映射（§10）。

## 2. 当前目标

- `dependency-rules.ts`：`transitiveDependents(taskId, allTasks)` 计算传递闭包；`cascadeBlock(taskId, allTasks)` 返回应被置 `blocked` 的后继集合。
- `status-mapping.ts`：`mapResultToStatus(executionStatus, nextAction, { noReview, orchestratorVerified })` 实现 §10 映射表，并对非法组合（completed+retry / blocked+review / failed+review）抛出/返回错误。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-008-core-cascade-and-mapping.md
- Readme.md §7/§10

## 5. 修改范围

- `src/core/rules/dependency-rules.ts`、`src/core/rules/status-mapping.ts`、`src/core/index.ts`、`test/core/rules/dependency-mapping.test.ts`

## 6. 禁止修改范围

- `core/enums.ts`、`core/state-machine.ts`（复用，不改）、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不做实际的状态写回（application 层 TASK-017）。
- 不实现 Reviewer 结论映射（approved→done 等属编排，由 TASK-017 组合状态机实现）。

## 8. 架构约束

- 纯函数。`status-mapping` 复用 `state-machine` 的状态枚举，但不直接调用 `validateTransition`（映射结果是「目标状态建议」，合法性可由调用方再过状态机）。
- 非法组合必须显式报错，不得静默兜底。

## 9. 数据流和状态流要求

- 级联：输入任务集合 + 某任务状态变更 → 输出需级联 blocked 的集合。
- 映射：输入 `.result.md` 摘要 → 输出目标 `TaskStatus`。

## 10. 预期新增或修改文件

- `src/core/rules/dependency-rules.ts`、`src/core/rules/status-mapping.ts`、`test/core/rules/dependency-mapping.test.ts`、`src/core/index.ts`

## 11. 验收标准

- 多层依赖的传递闭包用例正确；级联只针对 rejected/failed/blocked。
- §10 映射表每行有用例；三种非法组合均报错。
- `no_review:true` 且 Orchestrator 校验通过 → done；不通过 → blocked/failed 有用例。
- `typecheck` 0 错误。

## 12. 风险提示

- 传递闭包要处理环形依赖（防御性：检测到环应抛错而非死循环）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-008-core-cascade-and-mapping.result.md
- `PROGRESS.md` 更新建议：级联与状态映射就绪，Core 领域规则基本完成
