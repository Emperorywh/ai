---
id: TASK-007
title: Core 任务状态机
status: draft
layer: domain
depends_on:
  - TASK-002
allowed_paths:
  - src/core/state-machine.ts
  - src/core/index.ts
  - test/core/state-machine.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/state-machine
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#7-任务状态机
  source_files:
    - src/core/enums.ts
workflow_outputs:
  result_file: docs/tasks/TASK-007-core-state-machine.result.md
---

# TASK-007 Core 任务状态机

## 1. 背景

来自 PLAN P1。任务状态流转规则（§7）是工作流的核心领域规则，需作为纯函数实现于 core 层，供 application 层编排调用，且状态机只读 frontmatter，不依赖 SQLite。

## 2. 当前目标

实现 `canTransition(from, to): boolean` 与 `validateTransition(from, to, context): Result`，完整编码 §7 的状态流转表（含 `running -> done` 仅当 `no_review`、`done -> blocked` 重开、终态 `cancelled` 等）。`context` 携带 `no_review` 标志与「是否 Orchestrator/人工确认」标志。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-007-core-state-machine.md
- Readme.md §7

## 5. 修改范围

- `src/core/state-machine.ts`、`src/core/index.ts`、`test/core/state-machine.test.ts`

## 6. 禁止修改范围

- `core/enums.ts`、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不实现依赖级联（TASK-008）。
- 不实现状态流转的 I/O（写 frontmatter 由 application 层 TASK-017 做）。

## 8. 架构约束

- 纯函数，无副作用，无 I/O，不依赖 SQLite。
- 转移表以数据结构表达（`Record<from, TaskStatus[]>`），便于测试与审计。
- `running -> done` 必须检查 `context.no_review === true`，否则视为非法。

## 9. 数据流和状态流要求

输入：`from`、`to`、`context`；输出：合法/非法 + 原因。状态机的状态来源是 frontmatter `status`（由上层读取后传入）。

## 10. 预期新增或修改文件

- `src/core/state-machine.ts`、`test/core/state-machine.test.ts`、`src/core/index.ts`

## 11. 验收标准

- §7 流转表的每条合法/非法转移都有用例覆盖。
- `running -> done` 在 `no_review:false` 下非法、`true` 下合法。
- 禁止跳过 reviewing 直接 done（除 no_review）有用例。
- `typecheck` 0 错误。

## 12. 风险提示

- `done -> blocked`（重开）与 `cancelled` 终态容易遗漏，需显式用例。
- 状态机不做「谁有权触发」的细粒度鉴权（那是 application/权限层），只做结构合法性。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-007-core-state-machine.result.md
- `PROGRESS.md` 更新建议：状态机就绪
