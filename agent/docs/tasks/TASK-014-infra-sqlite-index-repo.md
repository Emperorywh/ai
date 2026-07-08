---
id: TASK-014
title: Infra SQLite 索引仓储与 rebuild-index
status: draft
layer: data
depends_on:
  - TASK-011
  - TASK-012
  - TASK-013
allowed_paths:
  - src/infrastructure/sqlite/index-repo.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sqlite/index-repo.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/sqlite/index-repo
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/infrastructure/sqlite/schema.ts
    - src/infrastructure/fs/task-doc-repo.ts
    - src/infrastructure/fs/global-doc-repo.ts
workflow_outputs:
  result_file: docs/tasks/TASK-014-infra-sqlite-index-repo.result.md
---

# TASK-014 Infra SQLite 索引仓储与 rebuild-index

## 1. 背景

来自 PLAN P3。索引在状态流转/合并/决策/问题变更时同步写入（§3.2），写失败不阻断流程；并提供 `rebuild-index` 从文档全量重建，保证文档为唯一事实来源。

## 2. 当前目标

实现 `IndexRepository`：
- `upsertTask/upsertDecision/upsertIssue/upsertExecution`：写入索引（写失败仅记日志、不抛阻断）。
- `rebuildFromDocs({ taskRepo, globalRepo })`：清空后从文档全量重建。
- 查询接口：`queryTasks(filter)`、`getExecution(taskId)`。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-014-infra-sqlite-index-repo.md
- Readme.md §3.1/§3.2

## 5. 修改范围

- `src/infrastructure/sqlite/index-repo.ts`、`src/infrastructure/index.ts`、`test/infrastructure/sqlite/index-repo.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、`schema.ts`、文档仓储文件

## 7. 不做什么

- 不在状态机判定中读取索引（§3.2 禁止）。
- 不实现 CLI 命令（TASK-025 包装 rebuild）。

## 8. 架构约束

- 依赖 sqlite/schema + 文档仓储（只读）。
- 写入容错：try/catch 记录告警后继续，不向上抛阻断错误（§3.2）。
- `rebuildFromDocs` 必须可从文档完全恢复索引。

## 9. 数据流和状态流要求

文档变更 → application 层调用 upsert（同步写）→ 失败告警不阻断；任何时刻可 rebuild 全量重建。

## 10. 预期新增或修改文件

- `src/infrastructure/sqlite/index-repo.ts`、`test/infrastructure/sqlite/index-repo.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- upsert 写入后可 query；模拟写失败（如坏 db）时函数不抛、记日志。
- `rebuildFromDocs` 后索引内容 = 文档全集；`typecheck` 0 错误。

## 12. 风险提示

- 容错测试需可控地注入失败（如传入无效 db 路径），避免依赖真实故障。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-014-infra-sqlite-index-repo.result.md
- `PROGRESS.md` 更新建议：SQLite 索引就绪，P3 收尾
