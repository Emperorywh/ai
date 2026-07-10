---
id: TASK-041
title: 定义 Run Journal Schema 与运行状态 Ports
status: draft
layer: type
depends_on:
  - TASK-040
allowed_paths:
  - src/core/enums.ts
  - src/core/schemas/run-schema.ts
  - src/core/index.ts
  - src/application/orchestration/ports.ts
  - src/application/index.ts
  - test/core/schemas/run-schema.test.ts
  - test/application/orchestration/ports.test.ts
forbidden_paths:
  - src/cli
  - src/infrastructure
  - src/application/merge
  - src/core/state-machine.ts
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- run-schema orchestration/ports
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/core/enums.ts
    - src/core/schemas/task-schema.ts
    - src/core/schemas/result-schema.ts
    - src/application/ports.ts
  optional_doc_excerpts: []
  source_files:
    - src/core/enums.ts
    - src/core/schemas/task-schema.ts
    - src/core/schemas/result-schema.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-041-core-run-journal-schema.result.md
---

# TASK-041 定义 Run Journal Schema 与运行状态 Ports

## 1. 背景

串行运行需要显式记录任务范围快照、当前任务、Attempt、成本和暂停原因。若没有稳定 Schema 与 Port，恢复逻辑会依赖 CLI 内存或临时 JSON 形状，形成隐式状态。

## 2. 当前目标

- 定义 RunStatus、RunRecord、TaskAttemptSummary、PauseReason 等 Schema。
- 固定 run id、时间戳、任务顺序、批准标志、重试预算和成本字段。
- 定义 `RunJournalPort` 与 `OrchestrationLockPort`。
- 明确 Run Journal 是检查点而非任务状态事实来源。
- 提供从 Schema 推导的 TypeScript 类型和聚合导出。

## 3. 所属层级

`type`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- core enums/task/result schemas
- application ports

## 5. 修改范围

- Core run 领域原语和 Schema。
- Application orchestration Ports。
- Schema/契约测试。

## 6. 禁止修改范围

- 不做文件 I/O、锁文件或 CLI。
- 不修改任务状态机。
- 不实现任务选择和运行循环。

## 7. 不做什么

- 不把 SQLite 定义为运行事实来源。
- 不保存 SDK token、完整环境变量或完整模型消息。
- 不设计兼容旧运行记录的迁移逻辑。

## 8. 架构约束

- Zod Schema 是运行记录结构的唯一来源。
- Core 不依赖 application/infrastructure/cli。
- Port 不暴露 fs 错误、文件路径拼接或 PID 探测实现。
- PauseReason 必须是可判别结构，不使用自由文本代替类别。
- 复杂字段语义添加简体中文多行注释。

## 9. 数据流和状态流要求

Run 状态仅允许 `created → running → paused/completed/failed/cancelled`，paused 可恢复到 running。任务 status 仍由任务 frontmatter 持有，RunRecord 只保存快照和摘要。

## 10. 预期新增或修改文件

- 新增 `src/core/schemas/run-schema.ts`。
- 新增 `src/application/orchestration/ports.ts`。
- 更新聚合导出与测试。

## 11. 验收标准

- 合法 RunRecord round-trip 通过。
- 缺 run id、重复 task_order、负 Attempt、负成本、非法时间戳均拒绝。
- active/current task 必须属于范围快照。
- paused 必须携带 pause reason；completed 不得保留 current task。
- Port 方法覆盖 create/read/update/find-active 和锁 acquire/release/inspect。
- Core 零反向依赖。

## 12. 风险提示

不要把所有恢复步骤塞成大量布尔字段。记录应保存稳定事实和步骤 receipt，具体恢复动作由后续 Reconciler 推导。

## 13. 结束时必须产出

- `docs/tasks/TASK-041-core-run-journal-schema.result.md`
- 记录新增 Schema、状态约束和 Port 决策
- 提出必要的全局更新建议
