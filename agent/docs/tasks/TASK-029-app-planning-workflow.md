---
id: TASK-029
title: App 规划文档生成与任务拆分用例
status: draft
layer: domain
depends_on:
  - TASK-003
  - TASK-011
  - TASK-015
  - TASK-016
allowed_paths:
  - src/application/planning-workflow.ts
  - src/application/index.ts
  - test/application/planning-workflow.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/planning-workflow
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#6-文档体系
    - Readme.md#8-context-pack-上下文包
    - Readme.md#9-任务文件模板
    - Readme.md#11-执行流程
  source_files:
    - src/core/schemas/task-schema.ts
    - src/application/context-pack-generator.ts
    - src/application/scheduler.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-029-app-planning-workflow.result.md
---

# TASK-029 App 规划文档生成与任务拆分用例

## 1. 背景

来自 PLAN P4。SPEC 要求 Orchestrator 负责生成 `docs/PLAN.md` 与 `docs/tasks/`，但该能力属于 application 层用例，不能由 CLI 命令直接承载，否则会形成跨层耦合。

## 2. 当前目标

实现 `PlanningWorkflow`：
- `validatePlanningInputs(input)`：校验 `docs/SPEC.md` + `docs/ARCHITECTURE.md` 是否存在且已审查；自举项目可接受 PLAN 中声明的 `source_spec`。
- `createPlanDraft(input)`：基于显式输入生成阶段级 PLAN 草案模型，不把智能拆分逻辑写入 CLI。
- `createTaskDrafts(input)`：生成 `TaskFrontmatter` 集合，初始 `status: draft`，并调用 `computeContextPack` 生成初始 `context_pack`。
- `validateTaskGraph(tasks)`：复用调度器检测依赖环和 allowed_paths 并行冲突。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-029-app-planning-workflow.md
- Readme.md §6/§8/§9/§11

## 5. 修改范围

- `src/application/planning-workflow.ts`、`src/application/index.ts`、`test/application/planning-workflow.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`

## 7. 不做什么

- 不调用模型，不实现多轮需求访谈。
- 不写文件；文件落盘由 CLI 组合文档仓储完成。
- 不修改 `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/PLAN.md` 或任务文件。

## 8. 架构约束

- application 层只产出计划与任务的领域模型；CLI 负责入参解析与落盘，infra 负责文件系统。
- 自举 `source_spec` 是显式输入，不得在用例内部硬编码 `Readme.md`。
- 任务拆分必须先生成 `draft`，不得直接生成 `ready`。

## 9. 数据流和状态流要求

SPEC/ARCHITECTURE 或 source_spec + 显式任务拆分输入 → PlanningWorkflow → PLAN 草案模型 + TaskFrontmatter 草案集合。

## 10. 预期新增或修改文件

- `src/application/planning-workflow.ts`、`test/application/planning-workflow.test.ts`、`src/application/index.ts`

## 11. 验收标准

- 缺少 SPEC/ARCHITECTURE 且未声明 source_spec 时拒绝生成。
- 自举 source_spec 输入可通过，但必须返回需要人工/Reviewer 确认的标记。
- 生成的任务均为 `draft`，通过 `TaskFrontmatterSchema`，且无依赖环。
- `typecheck` 0 错误。

## 12. 风险提示

- 不要把“智能拆分”膨胀成本任务内；本任务只提供可测试的用例边界与模型生成，后续可另立 agent 驱动的规划任务。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-029-app-planning-workflow.result.md
- `PROGRESS.md` 更新建议：规划文档生成与任务拆分 application 用例就绪，P4 收尾
