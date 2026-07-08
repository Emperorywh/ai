---
id: TASK-003
title: Core 任务 frontmatter Schema
status: draft
layer: type
depends_on:
  - TASK-002
allowed_paths:
  - src/core/schemas/task-schema.ts
  - src/core/index.ts
  - test/core/schemas/task-schema.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/schemas/task-schema
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#8-context-pack-上下文包
    - Readme.md#9-任务文件模板
    - Readme.md#16-权限模型
  source_files:
    - src/core/enums.ts
workflow_outputs:
  result_file: docs/tasks/TASK-003-core-task-schema.result.md
---

# TASK-003 Core 任务 frontmatter Schema

## 1. 背景

来自 PLAN P1。任务文件 frontmatter（`Readme.md` §9 模板）是任务协议的核心机器字段，需要 Zod Schema 作为单一来源，供文档仓储读写校验与 SQLite 索引使用。

## 2. 当前目标

实现 `TaskFrontmatterSchema`：`id`、`title`、`status`、`layer`、`depends_on[]`、`allowed_paths[]`、`forbidden_paths[]`、`permissions[]`、`no_review`、`restart_on_retry`、`verification[]`、`context_pack{required_docs,optional_doc_excerpts,source_files}`、`workflow_outputs{result_file}`。配套 `ContextPackSchema`。

## 3. 所属层级

`type`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-003-core-task-schema.md
- Readme.md §8/§9/§16 相关章节

## 5. 修改范围

- `src/core/schemas/task-schema.ts`、`src/core/index.ts`、`test/core/schemas/task-schema.test.ts`

## 6. 禁止修改范围

- `src/core/enums.ts`（已由 TASK-002 定型）、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不实现 frontmatter 解析（TASK-010）、不实现文档仓储（TASK-011）。
- 不定义 Result/Review/Decision/Issue Schema。

## 8. 架构约束

- 仅依赖 `src/core/enums.ts` 与 Zod。
- `id` 用正则 `^TASK-\d{3,}$`；`status` 初值虽由任务定，但 Schema 允许全部合法 `TaskStatus`（draft 由 PLAN 保证）。
- `context_pack` 三子字段均为数组，允许空数组。

## 9. 数据流和状态流要求

该 Schema 是任务文件读取后的校验入口；状态机（TASK-007）消费其 `status` 字段。

## 10. 预期新增或修改文件

- `src/core/schemas/task-schema.ts`、`test/core/schemas/task-schema.test.ts`、`src/core/index.ts`

## 11. 验收标准

- 以 `Readme.md` §9 模板为正例通过；缺必填字段、类型错误、非法枚举被拒绝。
- `context_pack` 结构与 §8 一致；`workflow_outputs.result_file` 必填。
- `typecheck` 0 错误。

## 12. 风险提示

- `verification` 在模板里是字符串数组，后续 `.result.md` 里是对象数组（§10），二者不要混用——本任务只定义任务级字符串数组形态。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-003-core-task-schema.result.md
- `PROGRESS.md` 更新建议：任务 Schema 就绪
