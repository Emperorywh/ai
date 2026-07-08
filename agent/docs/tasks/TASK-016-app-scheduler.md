---
id: TASK-016
title: App 拓扑排序与并行检测
status: draft
layer: domain
depends_on:
  - TASK-003
allowed_paths:
  - src/application/scheduler.ts
  - src/application/index.ts
  - test/application/scheduler.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/scheduler
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#32-并行执行与-worktree-合并策略
    - Readme.md#11-执行流程
  source_files:
    - src/core/schemas/task-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-016-app-scheduler.result.md
---

# TASK-016 App 拓扑排序与并行检测

## 1. 背景

来自 PLAN P4。合并与执行调度都依赖 `depends_on` 拓扑序（§3.2：先合并被依赖方）；并行执行需检测「互无依赖且 `allowed_paths` 不重叠」（§3.2）。

## 2. 当前目标

实现：
- `topologicalOrder(tasks): TaskId[]`（被依赖方在前；检测环并抛错）。
- `detectParallelizable(tasks): TaskId[][]`（按拓扑层分组，组内互无依赖且路径不重叠的可并行）。
- `mergeOrder(tasks): TaskId[]`（合并回收的拓扑序）。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-016-app-scheduler.md
- Readme.md §3.2/§11

## 5. 修改范围

- `src/application/scheduler.ts`、`src/application/index.ts`、`test/application/scheduler.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`

## 7. 不做什么

- 不实际调度执行（CLI task:run TASK-026 编排）。
- 不判定路径重叠的细粒度（用 glob/prefix 相交判定即可）。

## 8. 架构约束

- 纯函数，依赖 core Task 类型。
- 路径重叠判定：前缀包含或 glob 相交视为重叠（保守策略，倾向不并行）。

## 9. 数据流和状态流要求

输入：任务集合；输出：执行/合并的顺序与可并行分组。

## 10. 预期新增或修改文件

- `src/application/scheduler.ts`、`test/application/scheduler.test.ts`、`src/application/index.ts`

## 11. 验收标准

- 拓扑序合法（任一任务在其依赖之后）；环形依赖抛错。
- 路径重叠的「可并行」候选被剔除；`typecheck` 0 错误。

## 12. 风险提示

- 保守的重叠判定可能低估并行度，但安全优先（与 SPEC 默认串行一致）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-016-app-scheduler.result.md
- `PROGRESS.md` 更新建议：调度器就绪
