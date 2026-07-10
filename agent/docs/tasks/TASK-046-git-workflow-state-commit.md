---
id: TASK-046
title: 实现完整 Workflow-State Commit 与成功 worktree 清理
status: draft
layer: data
depends_on:
  - TASK-045
allowed_paths:
  - src/application/execution/finalize-task.ts
  - src/application/ports.ts
  - src/infrastructure/git/worktree-adapter.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - test/application/execution/finalize-task.test.ts
  - test/infrastructure/git/worktree-adapter.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure/sdk
  - src/infrastructure/sqlite
  - src/application/orchestration/serial-task-orchestrator.ts
  - docs/SPEC_serial-task-orchestration.md
permissions:
  - delete_files
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- finalize-task worktree-adapter task-run task-review
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/execution/finalize-task.ts
    - src/application/merge/rebase-ff.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/execution/finalize-task.ts
    - src/application/merge/rebase-ff.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
workflow_outputs:
  result_file: docs/tasks/TASK-046-git-workflow-state-commit.result.md
---

# TASK-046 实现完整 Workflow-State Commit 与成功 worktree 清理

## 1. 背景

当前实现分支的 audit commit 只提交 result；任务 status、review 和全局回写可能只留在主工作区。自动连续运行需要每个任务完成后主分支历史和主工作区都处于一致、干净、可恢复状态。

## 2. 当前目标

- 扩展 Git Port/Adapter 支持 main 上独立 workflow-state commit。
- Finalize 成功后提交任务 frontmatter、review、result 回填、全局文档和 Run Journal 更新。
- workflow-state commit 使用确定性 message，并可查询是否已存在。
- 提交成功后清理已合并 worktree 和任务分支。
- blocked/rejected/failed/中断时保留 worktree。

## 3. 所属层级

`data`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- FinalizeTask、rebase-ff、WorktreeAdapter、现有 task-run/task-review

## 5. 修改范围

- Application Finalize 与 Git Port。
- GitMerge/WorktreeAdapter 原语。
- 现有单任务 CLI 的完成路径。
- Git 集成测试。

## 6. 禁止修改范围

- 不改变 core 状态机和 SDK。
- 不实现 request_id 或恢复循环。
- 不修改 Orchestrator 主循环。

## 7. 不做什么

- 不自动提交用户原有的无关改动。
- 不 stash、reset 或清理主工作区用户文件。
- 不删除非成功任务 worktree。

## 8. 架构约束

- Git 命令只在 infrastructure。
- Finalize 明确区分 implementation audit commit 与 workflow-state commit。
- 提交文件使用显式 allowlist，禁止 `git add -A` 吞入无关改动。
- main 工作区不干净且无法证明是本次工作流文件时必须拒绝。
- 提交和清理的非显而易见顺序添加简体中文多行注释。

## 9. 数据流和状态流要求

`rebase → implementation commits → result audit commit → ff main → write workflow facts → workflow-state commit → verify clean → remove worktree/branch`。任一步失败不得提前清理现场。

## 10. 预期新增或修改文件

- 扩展 Git Port 与 `worktree-adapter.ts`。
- 更新 `finalize-task.ts`。
- 更新 task-run/task-review 完成路径和测试。

## 11. 验收标准

- 完成任务的 status、review、result 和全局文档进入 main 历史。
- implementation commits 不包含 workflow audit/state 文件。
- workflow-state commit 不混入用户无关改动。
- 成功后主工作区 clean，worktree 和任务分支删除。
- blocked/rejected/failed 保留 worktree。
- 重复 cleanup 幂等。
- 已存在 workflow-state commit 可被稳定识别。

## 12. 风险提示

当前 fastForwardMain 使用 update-ref，不会自动更新已检出主工作区。必须保证 ref、index、working tree 三者最终一致，不能只 checkout 单个 result 文件延续不完整状态。

## 13. 结束时必须产出

- `docs/tasks/TASK-046-git-workflow-state-commit.result.md`
- 记录 Git 提交边界和清理策略
- 提出必要的全局更新建议
