---
id: TASK-025
title: CLI status 与 rebuild-index 命令
status: draft
layer: page
depends_on:
  - TASK-014
allowed_paths:
  - src/cli/commands/status.ts
  - src/cli/commands/rebuild-index.ts
  - src/cli/index.ts
  - test/cli/status-rebuild.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/status-rebuild
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/infrastructure/sqlite/index-repo.ts
workflow_outputs:
  result_file: docs/tasks/TASK-025-cli-status-and-rebuild-index.result.md
---

# TASK-025 CLI status 与 rebuild-index 命令

## 1. 背景

来自 PLAN P8。`status` 查询任务/执行摘要（优先读 frontmatter，索引用于加速，§3.2）；`rebuild-index` 从文档全量重建 SQLite 索引（§3.2）。

## 2. 当前目标

- `status` 命令：列出任务 id/title/status/layer + 最近执行摘要；支持按 status/layer 过滤；状态判定以 frontmatter 为准，索引仅加速。
- `rebuild-index` 命令：调用 `IndexRepository.rebuildFromDocs`，输出重建统计。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-025-cli-status-and-rebuild-index.md
- Readme.md §3.1/§3.2

## 5. 修改范围

- `src/cli/commands/status.ts`、`src/cli/commands/rebuild-index.ts`、`src/cli/index.ts`、`test/cli/status-rebuild.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`

## 7. 不做什么

- 不做任务执行或状态流转。
- 不让 status 仅依赖 SQLite（§3.2：状态判定只读 frontmatter）。

## 8. 架构约束

- CLI 只编排；status 在索引缺失/过期时回退到文档读取。
- rebuild-index 是破坏性索引操作（清空重建），需在输出中提示。

## 9. 数据流和状态流要求

文档（事实来源） → status 展示 / rebuild-index 重建派生索引。

## 10. 预期新增或修改文件

- `src/cli/commands/status.ts`、`src/cli/commands/rebuild-index.ts`、`test/cli/status-rebuild.test.ts`、`src/cli/index.ts`

## 11. 验收标准

- status 在无索引时仍能从文档正确展示；rebuild 后索引=文档全集。
- 退出码正确；`typecheck` 0 错误。

## 12. 风险提示

- rebuild 清空索引期间若并发读 status 会不一致——串行执行并在命令内提示。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-025-cli-status-and-rebuild-index.result.md
- `PROGRESS.md` 更新建议：status/rebuild-index 就绪
