---
id: TASK-002
title: Core 领域原语与枚举
status: draft
layer: type
depends_on:
  - TASK-001
allowed_paths:
  - src/core/enums.ts
  - src/core/index.ts
  - test/core/enums.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/enums
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#7-任务状态机
    - Readme.md#9-任务文件模板
    - Readme.md#10-任务执行结果模板
    - Readme.md#16-权限模型
  source_files:
    - src/core/index.ts
workflow_outputs:
  result_file: docs/tasks/TASK-002-core-enums.result.md
---

# TASK-002 Core 领域原语与枚举

## 1. 背景

来自 PLAN P1。Core 层为一切基础，首先定义被所有 Schema 与规则共享的领域原语（枚举与字面量联合类型），供 TASK-003…009 复用。

## 2. 当前目标

在 `src/core/enums.ts` 定义全部领域枚举：`Layer`、`Permission`、`TaskStatus`、`ExecutionStatus`、`NextAction`、`ReviewResult`、`ProgressMode`、`DecisionStatus`、`IssueStatus`、`IssueSeverity`、`Scope`（含 `SPEC`/`ARCHITECTURE` 与任务 id 同为合法值的说明）。配套 Zod 校验与单测。

## 3. 所属层级

`type`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md
- docs/tasks/TASK-002-core-enums.md
- Readme.md §7/§9/§10/§16 相关章节（见 context_pack）

## 5. 修改范围

- `src/core/enums.ts`（核心）、`src/core/index.ts`（再导出）、`test/core/enums.test.ts`

## 6. 禁止修改范围

- 其他 core 文件、application/infrastructure/cli 全层

## 7. 不做什么

- 不定义任何复合 Schema（Task/Result/Review 等）。
- 不实现状态机或规则逻辑。

## 8. 架构约束

- `enums.ts` 只依赖 Zod，不依赖任何其他层。
- 每个枚举同时导出 TS 联合类型与 Zod schema（`z.enum`）。
- `Scope` 注释明确：合法值 = `SPEC` | `ARCHITECTURE` | 任意 `TASK-XXX`，由上层 Schema 用 `z.union`/`z.string().regex` 校验。

## 9. 数据流和状态流要求

无运行时数据流；这些枚举是后续状态机与 Schema 的输入约束。

## 10. 预期新增或修改文件

- `src/core/enums.ts`、`test/core/enums.test.ts`、`src/core/index.ts`

## 11. 验收标准

- 每个枚举值与 `Readme.md` 文本逐一对应（状态机 9 态、权限 9 项、layer 7 值、execution_status 3 值、next_action 4 值、review_result 4 值、mode 2 值）。
- 单测覆盖合法值通过、非法值被 Zod 拒绝。
- `typecheck` 0 错误。

## 12. 风险提示

- `Scope` 把「阶段标识」与「任务 id」混为一类，注意用正则区分 `TASK-\d+` 与 `SPEC`/`ARCHITECTURE`，避免误判。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-002-core-enums.result.md
- `PROGRESS.md` 更新建议：core 枚举就绪，后续 schema 可基于此构建
