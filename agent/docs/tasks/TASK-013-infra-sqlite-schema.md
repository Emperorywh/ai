---
id: TASK-013
title: Infra SQLite schema 与迁移
status: draft
layer: data
depends_on:
  - TASK-001
allowed_paths:
  - src/infrastructure/sqlite/schema.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sqlite/schema.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/sqlite/schema
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#31-推荐技术栈
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-013-infra-sqlite-schema.result.md
---

# TASK-013 Infra SQLite schema 与迁移

## 1. 背景

来自 PLAN P3。SQLite 是派生索引存储（§3.1/§3.2），需先落地表结构与迁移Runner，TASK-014 在此之上实现读写与 rebuild。

## 2. 当前目标

定义索引表 DDL：`tasks(id,title,status,layer,depends_on,allowed_paths,permissions)`、`decisions(id,title,status,scope)`、`issues(id,title,severity,status,owner)`、`executions(task_id,execution_status,review_result,next_action,commit_hash,commit_message,author,time)`；实现 `runMigrations(db)`（前向迁移，版本表记录）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-013-infra-sqlite-schema.md
- Readme.md §3.1/§3.2（索引内容清单）

## 5. 修改范围

- `src/infrastructure/sqlite/schema.ts`、`src/infrastructure/index.ts`、`test/infrastructure/sqlite/schema.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、其他 infra 文件

## 7. 不做什么

- 不实现读写仓库（TASK-014）。
- 不参与状态机判定（§3.2：索引不参与状态机判定）。

## 8. 架构约束

- 用 `better-sqlite3`（同步、简单）或等价库；DDL 集中在 `schema.ts`。
- `depends_on`/`allowed_paths`/`permissions` 以 JSON 文本列存储。
- 迁移幂等：版本表存在则跳过。

## 9. 数据流和状态流要求

无业务数据流；提供表结构与迁移入口供 TASK-014 使用。

## 10. 预期新增或修改文件

- `src/infrastructure/sqlite/schema.ts`、`test/infrastructure/sqlite/schema.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- 在临时 db 上 `runMigrations` 建表成功；重复调用幂等。
- 列与 §3.2「索引内容至少包括」清单逐项对齐。
- `typecheck` 0 错误。

## 12. 风险提示

- `better-sqlite3` 是原生模块，Windows 下需预编译二进制；在 TASK-001 已装好编译工具链的前提下应可用，否则在 `.result.md` 记录 issue。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-013-infra-sqlite-schema.result.md
- `PROGRESS.md` 更新建议：SQLite schema 就绪
