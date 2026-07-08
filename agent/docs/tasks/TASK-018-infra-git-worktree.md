---
id: TASK-018
title: Infra Git worktree 适配器
status: draft
layer: data
depends_on:
  - TASK-001
allowed_paths:
  - src/infrastructure/git/worktree-adapter.ts
  - src/infrastructure/index.ts
  - test/infrastructure/git/worktree-adapter.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/git/worktree-adapter
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-018-infra-git-worktree.result.md
---

# TASK-018 Infra Git worktree 适配器

## 1. 背景

来自 PLAN P5。每个 running 任务用独立 worktree + 分支 `task/TASK-XXX`（§3.2），infrastructure 层负责自动创建与回收，对上层透明。

## 2. 当前目标

实现 `WorktreeAdapter`（封装 git CLI）：
- `create(mainRef, taskId)`：基于主分支基线创建 worktree + 分支 `task/TASK-XXX`，返回 worktree 路径。
- `reset(taskId)`：`restart_on_retry` 时从干净状态重置（按主分支基线重建）。
- `retain(taskId)` / `remove(taskId)`：按 §3.2 的分支保留策略（rejected/failed/cancelled 不自动清理）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-018-infra-git-worktree.md
- Readme.md §3.2

## 5. 修改范围

- `src/infrastructure/git/worktree-adapter.ts`、`src/infrastructure/index.ts`、`test/infrastructure/git/worktree-adapter.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、其他 infra 文件

## 7. 不做什么

- 不做合并（rebase/ff 由 application 层 TASK-019 编排，调用 git 命令）。
- 不做合并冲突仲裁。

## 8. 架构约束

- 通过子进程调用系统 `git`；不引入重型 git 库。
- 串行复用：串行模式下 worktree 顺序复用、清理成本低（§3.2）。
- 对上层透明：返回路径，不暴露 git 细节。

## 9. 数据流和状态流要求

任务 ready→running 时 create；rejected/blocked 续跑时按 `restart_on_retry` 决定 reset 或保留；终态按策略 retain/remove。

## 10. 预期新增或修改文件

- `src/infrastructure/git/worktree-adapter.ts`、`test/infrastructure/git/worktree-adapter.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- 在临时 git 仓库集成测试：create 产出有效 worktree+分支；reset 回到基线；retain 不删除。
- `typecheck` 0 错误。

## 12. 风险提示

- Windows 下 git 路径与 worktree 路径分隔符；子进程错误需捕获并转为领域错误。
- worktree 不自动复制 `node_modules`：本适配器只负责 worktree/分支本身；`node_modules` 的复用（串行模式复用主工作区）或在独立 worktree 内重新安装，由 CLI 层（TASK-026 `task:run`）在 `create` 后按 `install_dependencies` 能力处理，不属于本任务。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-018-infra-git-worktree.result.md
- `PROGRESS.md` 更新建议：worktree 适配器就绪
