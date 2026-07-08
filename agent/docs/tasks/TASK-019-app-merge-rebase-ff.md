---
id: TASK-019
title: App 合并：rebase + 回填 + fast-forward
status: draft
layer: domain
depends_on:
  - TASK-011
  - TASK-015
  - TASK-016
  - TASK-018
allowed_paths:
  - src/application/merge/rebase-ff.ts
  - src/application/index.ts
  - test/application/merge/rebase-ff.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/merge/rebase-ff
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/application/scheduler.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-019-app-merge-rebase-ff.result.md
---

# TASK-019 App 合并：rebase + 回填 + fast-forward

## 1. 背景

来自 PLAN P6。合并回收主分支的核心步骤（§3.2）：按拓扑序 → 先 rebase 到最新主分支 → rebase 后采集 post-rebase 的实现 commit → 回填 `.result.md` 的 `execution_commits` → 提交独立 workflow audit commit → fast-forward 合并，避免 merge commit。

## 2. 当前目标

实现 `rebaseAndFastForward(adapter, task, { mainRef })`：
- 按拓扑序逐任务：rebase worktree 分支到最新 main。
- rebase 成功后回填 `.result.md` 的 `execution_commits`（post-rebase 实现 commit hash，不包含 audit commit）。
- 回填后通过 `GitMergePort.commitAuditResult` 提交独立 audit commit，作为 `.result.md` 审计字段载体。
- 以 fast-forward 回收 main；失败（冲突）则返回冲突清单，不抛断。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-019-app-merge-rebase-ff.md
- Readme.md §3.2

## 5. 修改范围

- `src/application/merge/rebase-ff.ts`、`src/application/index.ts`、`test/application/merge/rebase-ff.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`、全局文档 section 回写（TASK-020）

## 7. 不做什么

- 不做全局文档 section 回写（TASK-020）。
- 不做合并冲突的仲裁决策（只产出冲突清单，TASK-020/Orchestrator 决策置 blocked）。
- 不做幂等恢复（TASK-021）。

## 8. 架构约束

- 对 worktree、git merge 原语与文档仓储的依赖经 `application/ports.ts` 的 `WorktreePort`/`GitMergePort`/`TaskDocRepositoryPort`（TASK-015 建立），不直接 import infra 实现类。
- 审计元信息必须在 rebase 之后、ff 之前回填，确保 hash 与主分支历史一致（§3.2）。
- rebase 前旧 hash 一律丢弃，不作审计依据。
- 不产生 merge commit。

## 9. 数据流和状态流要求

worktree 分支 → rebase → 采集实现 commit → 回填 execution_commits → 提交 audit commit → ff 回收 main → 产出（成功 | 冲突清单）。

## 10. 预期新增或修改文件

- `src/application/merge/rebase-ff.ts`、`test/application/merge/rebase-ff.test.ts`、`src/application/index.ts`

## 11. 验收标准

- 临时 git 仓库集成测试：rebase + audit commit + ff 后 main 历史无 merge commit；execution_commits hash 与 main 中的实现 commit 一致，且不包含 audit commit。
- 冲突场景返回清单且不破坏 main；`typecheck` 0 错误。

## 12. 风险提示

- rebase 重写 hash，回填时机错误会导致审计 hash 失真——这是本任务最高风险点，需重点测试。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-019-app-merge-rebase-ff.result.md
- `PROGRESS.md` 更新建议：rebase+ff 合并就绪
