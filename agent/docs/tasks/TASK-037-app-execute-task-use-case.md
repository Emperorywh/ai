---
id: TASK-037
title: 从 task-run 抽取单任务执行 Application 用例
status: draft
layer: domain
depends_on:
  - TASK-036
allowed_paths:
  - src/application/execution/execute-task.ts
  - src/application/execution/index.ts
  - src/application/ports.ts
  - src/application/index.ts
  - src/cli/commands/task-run.ts
  - test/application/execution/execute-task.test.ts
  - test/cli/task-run.test.ts
forbidden_paths:
  - src/cli/commands/task-review.ts
  - src/application/merge
  - src/infrastructure/sdk
  - src/infrastructure/git
  - src/core
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- execute-task task-run
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/cli/commands/task-run.ts
    - src/application/context-pack-generator.ts
    - src/application/state-orchestrator.ts
    - src/application/ports.ts
  optional_doc_excerpts: []
  source_files:
    - src/cli/commands/task-run.ts
    - src/application/context-pack-generator.ts
    - src/application/state-orchestrator.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-037-app-execute-task-use-case.result.md
---

# TASK-037 从 task-run 抽取单任务执行 Application 用例

## 1. 背景

`runTask` 当前同时承担依赖检查、Context Pack 刷新、权限边界、状态流转、worktree、Executor 调用、result 消费和部分合并逻辑。顶层 Orchestrator 不能依赖 CLI command，因此需要先形成可复用的单任务执行用例。

## 2. 当前目标

- 新增 `ExecuteTaskUseCase`，负责从可执行任务到 result 状态映射的完整单任务执行阶段。
- 经 Ports 注入文档仓储、worktree、Executor 和工作区准备能力。
- CLI `task:run` 降为参数解析和基础设施装配。
- 保持现有 reviewing/no_review/blocked/failed 行为不变。
- 为后续 Orchestrator 提供稳定、可测试的调用入口。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- src/cli/commands/task-run.ts
- src/application/context-pack-generator.ts
- src/application/state-orchestrator.ts

## 5. 修改范围

- 单任务执行 application 用例。
- task-run composition root。
- application 与 CLI 的对应测试。

## 6. 禁止修改范围

- 不修改 Reviewer、合并算法和 SDK 实现。
- 不改变 core 状态机规则。
- 不新增批量循环。

## 7. 不做什么

- 不实现系统独立验证；继续沿用当前结果校验，留给 TASK-039/040。
- 不实现自动审查、重试、运行记录或恢复。
- 不解决全局回写幂等性。

## 8. 架构约束

- 用例只依赖 core 与 application Ports。
- CLI 不得保留第二套业务判断。
- Context Pack、依赖检查和状态转移必须复用现有领域能力。
- 不以回调堆叠替代明确 Port。
- 复杂编排必须添加简体中文多行注释。

## 9. 数据流和状态流要求

`TaskDoc → 依赖结果 → Context Pack → ready→running → Worktree → Executor → ResultDoc → 状态映射`。用例返回结构化阶段结果，但本任务不负责 review 和最终合并。

## 10. 预期新增或修改文件

- 新增 `src/application/execution/execute-task.ts`。
- 新增或更新 `src/application/execution/index.ts`。
- 精简 `src/cli/commands/task-run.ts`。
- 新增 application 单元测试。

## 11. 验收标准

- fake Ports 可在无 Git、无 SDK 环境覆盖完整执行链。
- task 非 ready、依赖未完成、路径冲突均在创建 worktree 前失败。
- Executor result 由 worktree 仓储读取，任务状态由 main 仓储维护。
- reviewing 路径不合并，no_review 合法路径保持现有行为。
- CLI 原有公开选项和退出行为保持。
- `task-run.ts` 不再拥有可复用的领域编排逻辑。

## 12. 风险提示

main 文档仓储与 worktree 文档仓储必须显式区分，不能用路径判断或隐式路由。抽取时不得改变当前文件落点。

## 13. 结束时必须产出

- `docs/tasks/TASK-037-app-execute-task-use-case.result.md`
- 列出迁出 CLI 的职责和保留在 composition root 的职责
- 提出必要的全局更新建议
