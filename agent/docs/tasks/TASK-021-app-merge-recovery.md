---
id: TASK-021
title: App 合并：幂等恢复
status: draft
layer: domain
depends_on:
  - TASK-015
  - TASK-018
  - TASK-019
  - TASK-020
allowed_paths:
  - src/application/merge/recovery.ts
  - src/application/index.ts
  - test/application/merge/recovery.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/merge/recovery
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/application/merge/rebase-ff.ts
    - src/application/merge/section-writeback.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-021-app-merge-recovery.result.md
---

# TASK-021 App 合并：幂等恢复

## 1. 背景

来自 PLAN P6。合并必须幂等可恢复（§3.2）：rebase/回填/ff/回写之间任一步崩溃，恢复逻辑按 git 状态判定重建进度，合并进度不写 SQLite。

## 2. 当前目标

实现 `recoverMerge(taskId, { adapter, repos })`：
- 通过 `GitMergePort.branchMerged`（底层等价 `git branch --merged`）检查 worktree 分支是否已进入 main。
- 已进入 → 跳过合并，仅补做未完成的全局文档回写。
- 未进入 → 丢弃上次不完整的 rebase 中间态，从 main 最新基线重新 rebase。
- 返回恢复后的「待续步骤」清单，使整个合并可从任意崩溃点继续。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-021-app-merge-recovery.md
- Readme.md §3.2（合并幂等段落）

## 5. 修改范围

- `src/application/merge/recovery.ts`、`src/application/index.ts`、`test/application/merge/recovery.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`、`rebase-ff.ts`、`section-writeback.ts`（复用不改）

## 7. 不做什么

- 不把合并进度写 SQLite（§3.2 明确不写）。
- 不修改状态机判定逻辑。

## 8. 架构约束

- 对 worktree 与 git merge 原语的操作经 `application/ports.ts` 的 `WorktreePort`/`GitMergePort`（TASK-015 建立），不直接 import infra 实现类；恢复判定只依赖 git 状态 + frontmatter `status`，可完全重建（§3.2）。
- 不依赖外部「合并进度文件」。

## 9. 数据流和状态流要求

输入：崩溃后的仓库状态；输出：恢复动作（skip合并+补回写 | 丢弃中间态+重 rebase）。

## 10. 预期新增或修改文件

- `src/application/merge/recovery.ts`、`test/application/merge/recovery.test.ts`、`src/application/index.ts`

## 11. 验收标准

- 模拟「ff 后崩溃」→ 恢复跳过合并、补回写。
- 模拟「rebase 中途崩溃」→ 恢复丢弃中间态、重 rebase。
- 二次恢复幂等（不重复合并）；`typecheck` 0 错误。

## 12. 风险提示

- 识别「不完整的 rebase 中间态」需可靠的 git 状态判据，是本任务难点；测试需构造真实中间态。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-021-app-merge-recovery.result.md
- `PROGRESS.md` 更新建议：合并幂等恢复就绪，P6 收尾
