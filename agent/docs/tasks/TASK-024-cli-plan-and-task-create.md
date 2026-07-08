---
id: TASK-024
title: CLI plan 与 task:create 命令
status: draft
layer: page
depends_on:
  - TASK-011
  - TASK-015
  - TASK-016
allowed_paths:
  - src/cli/commands/plan.ts
  - src/cli/commands/task-create.ts
  - src/cli/index.ts
  - test/cli/plan.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/plan
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#64-planmd
    - Readme.md#8-context-pack-上下文包
    - Readme.md#9-任务文件模板
  source_files:
    - src/application/context-pack-generator.ts
    - src/application/scheduler.ts
    - src/infrastructure/fs/task-doc-repo.ts
workflow_outputs:
  result_file: docs/tasks/TASK-024-cli-plan-and-task-create.result.md
---

# TASK-024 CLI plan 与 task:create 命令

## 1. 背景

来自 PLAN P8。`plan` 负责生成 `PLAN.md` + 拆分 `TASKS/` 并为每个任务写入初始 `context_pack`（`source_files` 按依赖 `allowed_paths` 预填，§8/§11）；`task:create` 负责增量创建单个任务文件。

## 2. 当前目标

- `plan` 命令：读取 SPEC/ARCHITECTURE → 调用 application 层生成 PLAN + 任务集合 → 经文档仓储落盘 → 对每个任务用 `computeContextPack`（依赖未执行，预填 `source_files`）写入 frontmatter。
- `task:create` 命令：按入参（id/title/layer/depends_on/allowed_paths/...）生成单个任务文件，初始 `status: draft`，写入预填 context_pack。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-024-cli-plan-and-task-create.md
- Readme.md §6.4/§8/§9/§11

## 5. 修改范围

- `src/cli/commands/plan.ts`、`src/cli/commands/task-create.ts`、`src/cli/index.ts`、`test/cli/plan.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`（只编排，不改下游）

## 7. 不做什么

- 不实现 task:run/task:review/status/rebuild-index。
- 不做任务实际执行。
- `plan` 的「SPEC/ARCHITECTURE → 任务」的智能拆分逻辑若复杂，仅做骨架编排（调用 application 层占位），深度拆分算法不在本任务膨胀——保持 ≤4 文件。

## 8. 架构约束

- CLI 只编排 application + infra，不重复领域规则。
- 生成的任务初始 `status` 必须为 `draft`（与 PLAN 要求一致）。
- context_pack 预填遵循 §8（依赖未执行按 `allowed_paths` 预填 `source_files`）。

## 9. 数据流和状态流要求

SPEC/ARCHITECTURE → plan → PLAN.md + TASKS/*.md（含预填 context_pack，status=draft）。

## 10. 预期新增或修改文件

- `src/cli/commands/plan.ts`、`src/cli/commands/task-create.ts`、`test/cli/plan.test.ts`、`src/cli/index.ts`

## 11. 验收标准

- `plan` 产出的任务文件过 `TaskFrontmatterSchema`、status=draft、context_pack 含预填 source_files。
- `task:create` 单任务文件合法；`typecheck` 0 错误。

## 12. 风险提示

- 若「智能拆分」需多轮交互，应拆为独立后续任务，本任务只做可一次闭环的骨架。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-024-cli-plan-and-task-create.result.md
- `PROGRESS.md` 更新建议：plan/task:create 就绪
