---
id: TASK-026
title: CLI task:run 命令
status: draft
layer: page
depends_on:
  - TASK-015
  - TASK-017
  - TASK-018
  - TASK-019
  - TASK-020
  - TASK-021
  - TASK-022
allowed_paths:
  - src/cli/commands/task-run.ts
  - src/cli/index.ts
  - test/cli/task-run.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/task-run
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#11-执行流程
    - Readme.md#32-并行执行与-worktree-合并策略
    - Readme.md#17-失败恢复机制
  source_files:
    - src/application/context-pack-generator.ts
    - src/application/state-orchestrator.ts
    - src/application/merge/rebase-ff.ts
    - src/application/merge/section-writeback.ts
    - src/application/merge/recovery.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/infrastructure/sdk/executor-contract.ts
workflow_outputs:
  result_file: docs/tasks/TASK-026-cli-task-run.result.md
---

# TASK-026 CLI task:run 命令

## 1. 背景

来自 PLAN P8。`task:run` 是执行编排的集成入口（§11/§3.2）：ready→running（建 worktree、刷新 context_pack 并回写、注入权限、启动 Executor）→ 读 `.result.md` → 状态流转（reviewing 或 no_review 校验）→ 合并回收（rebase+ff+回写，含恢复）。

## 2. 当前目标

实现 `task:run <taskId>`：按依赖检查前置 done → 刷新 context_pack 并回写 frontmatter → create worktree → 选 Executor（SDK 或 DryRun）→ 执行 → 读 result → `applyResult` 流转 → 触发合并（调 TASK-019/020/021）→ 失败走恢复与 ISSUES 登记。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-026-cli-task-run.md
- Readme.md §11/§3.2/§17

## 5. 修改范围

- `src/cli/commands/task-run.ts`、`src/cli/index.ts`、`test/cli/task-run.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`（纯编排）

## 7. 不做什么

- 不在本任务实现新的领域规则（全部复用下游）。
- 不并行调度多任务（默认串行，§3.2）。
- 不自动启动浏览器测试（§14/§16）。

## 8. 架构约束

- CLI 只编排 application + infra，不持有状态机。
- 依赖未完成的前置任务 → 拒绝运行并提示。
- 合并冲突/失败：置 blocked、落 ISSUES，不静默。

## 9. 数据流和状态流要求

ready → running（worktree+context_pack+权限+Executor）→ result → reviewing/done/blocked/failed → 合并回收 → 全局文档回写。

## 10. 预期新增或修改文件

- `src/cli/commands/task-run.ts`、`test/cli/task-run.test.ts`、`src/cli/index.ts`

## 11. 验收标准

- 用 DryRunExecutor 在临时仓库端到端跑通：ready→running→done（no_review）或 reviewing。
- 前置未完成时拒绝；合并冲突置 blocked；`typecheck` 0 错误。

## 12. 风险提示

- 本任务依赖最广（7 个下游），是集成风险集中点；测试用 DryRun 隔离 SDK 不确定性。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-026-cli-task-run.result.md
- `PROGRESS.md` 更新建议：task:run 端到端打通
