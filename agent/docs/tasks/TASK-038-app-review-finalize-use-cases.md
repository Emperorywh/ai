---
id: TASK-038
title: 抽取单任务审查与共享完成用例
status: draft
layer: domain
depends_on:
  - TASK-037
allowed_paths:
  - src/application/execution/review-task.ts
  - src/application/execution/finalize-task.ts
  - src/application/execution/index.ts
  - src/application/ports.ts
  - src/application/index.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - test/application/execution/review-task.test.ts
  - test/application/execution/finalize-task.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure/sdk
  - src/infrastructure/sqlite
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- review-task finalize-task task-run task-review
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/application/state-orchestrator.ts
    - src/application/merge/rebase-ff.ts
    - src/application/merge/section-writeback.ts
  optional_doc_excerpts: []
  source_files:
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/application/state-orchestrator.ts
    - src/application/merge/rebase-ff.ts
    - src/application/merge/section-writeback.ts
workflow_outputs:
  result_file: docs/tasks/TASK-038-app-review-finalize-use-cases.result.md
---

# TASK-038 抽取单任务审查与共享完成用例

## 1. 背景

`task:run` 和 `task:review` 重复实现合并包装、冲突登记、结果同步和全局回写。自动连续运行若再复制这些逻辑，将形成第三套不一致实现。

## 2. 当前目标

- 新增 `ReviewTaskUseCase`，封装 result 审查、review 写入和状态映射。
- 新增 `FinalizeTaskUseCase`，统一 done 后的合并、回写和冲突返回。
- 让 `task:run` 的 no_review 完成路径与 `task:review` 的 approved 路径复用同一 finalizer。
- 删除 CLI 中重复的合并与冲突处理逻辑。
- 保持现有单任务行为和输出语义。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- src/cli/commands/task-run.ts
- src/cli/commands/task-review.ts
- application merge 与 state orchestrator 源码

## 5. 修改范围

- Application review/finalize 用例。
- 相关 Ports 和聚合导出。
- 两个 CLI command 的重复逻辑清理。
- application/CLI 测试。

## 6. 禁止修改范围

- 不修改 core 状态机和 Schema。
- 不修改 Claude SDK 会话实现。
- 不实现新的 Git 原语或恢复策略。

## 7. 不做什么

- 不实现 workflow-state commit 和 worktree 自动清理，留给 TASK-046。
- 不实现 request_id 幂等回写，留给 TASK-047。
- 不实现串行 Orchestrator。

## 8. 架构约束

- Review 和 Finalize 是两个职责独立的用例。
- 合并冲突只能返回结构化结果，application 不替用户解决冲突。
- CLI 只负责展示和把基础设施实例注入用例。
- main/worktree 仓储路由必须通过显式 Port 组合。
- 新增复杂逻辑需简体中文多行注释。

## 9. 数据流和状态流要求

`reviewing → Reviewer → ReviewDoc → done/rejected/blocked`；仅 `done` 进入 `Finalize → rebase/audit/ff → global writeback`。冲突返回后由上层将 `done → blocked`。

## 10. 预期新增或修改文件

- 新增 `review-task.ts`、`finalize-task.ts`。
- 精简 task-run/task-review。
- 新增 application 测试覆盖三种 review 结论和合并冲突。

## 11. 验收标准

- task-run 与 task-review 不再各自定义 rebaseAndFastForwardMerge。
- 冲突 issue 构造和全局回写只有一个业务入口。
- approved、rejected、needs-human、no_review skipped 结果保持正确。
- Finalizer 可被后续 SerialTaskOrchestrator 直接调用。
- 所有现有相关测试通过，无行为回归。

## 12. 风险提示

当前审查文档写在 main、result 位于 worktree。抽取时必须保持事实位置明确，避免 Reviewer 或状态编排读错仓储。

## 13. 结束时必须产出

- `docs/tasks/TASK-038-app-review-finalize-use-cases.result.md`
- 说明消除的重复逻辑及新用例边界
- 提出必要的全局更新建议
