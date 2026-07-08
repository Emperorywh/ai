---
id: TASK-011
title: Infra 任务/结果/审查文档仓储
status: draft
layer: data
depends_on:
  - TASK-003
  - TASK-005
  - TASK-006
  - TASK-010
allowed_paths:
  - src/infrastructure/fs/task-doc-repo.ts
  - src/infrastructure/index.ts
  - test/infrastructure/fs/task-doc-repo.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/fs/task-doc-repo
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#6-文档体系
    - Readme.md#9-任务文件模板
    - Readme.md#10-任务执行结果模板
    - Readme.md#15-reviewer-审查清单
  source_files:
    - src/core/schemas/task-schema.ts
    - src/core/schemas/result-schema.ts
    - src/core/schemas/review-schema.ts
    - src/infrastructure/fs/frontmatter-parser.ts
workflow_outputs:
  result_file: docs/tasks/TASK-011-infra-task-doc-repo.result.md
---

# TASK-011 Infra 任务/结果/审查文档仓储

## 1. 背景

来自 PLAN P2。任务文件、`.result.md`、`.review.md` 的读写需要统一仓储，读取即用 core Schema 校验，写入即序列化 frontmatter + 正文。

## 2. 当前目标

实现 `TaskDocRepository`（基于文件系统路径）：`readTask(id)`、`writeTask(task)`、`readResult(id)`、`writeResult(result)`、`readReview(id)`、`writeReview(review)`、`listTasks()`。读取后用 `TaskFrontmatterSchema`/`ResultFrontmatterSchema`/`ReviewFrontmatterSchema` 校验；写入时分离 frontmatter 与正文。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-011-infra-task-doc-repo.md
- Readme.md §6/§9/§10/§15

## 5. 修改范围

- `src/infrastructure/fs/task-doc-repo.ts`、`src/infrastructure/index.ts`、`test/infrastructure/fs/task-doc-repo.test.ts`

## 6. 禁止修改范围

- `src/core`（依赖不改）、`src/application`、`src/cli`、`frontmatter-parser.ts`、全局文档仓储（TASK-012）

## 7. 不做什么

- 不实现全局文档（PROGRESS/DECISIONS/ISSUES）仓储（TASK-012）。
- 不做状态流转（application 层）。

## 8. 架构约束

- 依赖 core Schema + frontmatter-parser；不反向定义业务规则。
- 写入保留正文（task 文件的 13 节正文、result/review 的正文），只更新 frontmatter 时做「frontmatter 替换 + 正文保留」。
- 文件命名遵循 §6：`TASKS/TASK-XXX-xxx.md`、`TASK-XXX-xxx.result.md`、`TASK-XXX-xxx.review.md`。

## 9. 数据流和状态流要求

`readTask` 产出 `TaskFrontmatter`（状态机/调度的输入）；`writeResult`/`writeReview` 是 Executor/Reviewer 的产物落盘。

## 10. 预期新增或修改文件

- `src/infrastructure/fs/task-doc-repo.ts`、`test/infrastructure/fs/task-doc-repo.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- 写入后读回 round-trip 通过；非法 frontmatter 读取时抛错。
- `listTasks()` 只返回 `TASK-*.md`（排除 `.result.md`/`.review.md`）。
- 临时目录集成测试通过；`typecheck` 0 错误。

## 12. 风险提示

- 仅更新 frontmatter 时务必保留正文，避免抹掉人工维护的任务正文。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-011-infra-task-doc-repo.result.md
- `PROGRESS.md` 更新建议：任务文档仓储就绪
