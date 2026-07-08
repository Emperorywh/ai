---
id: TASK-012
title: Infra 全局文档仓储与 section 合并
status: draft
layer: data
depends_on:
  - TASK-004
  - TASK-010
allowed_paths:
  - src/infrastructure/fs/global-doc-repo.ts
  - src/infrastructure/index.ts
  - test/infrastructure/fs/global-doc-repo.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/fs/global-doc-repo
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#65-progressmd
    - Readme.md#66-decisionsmd
    - Readme.md#67-issuesmd
    - Readme.md#32-并行执行与-worktree-合并策略
  source_files:
    - src/core/schemas/decision-issue-schema.ts
    - src/infrastructure/fs/frontmatter-parser.ts
workflow_outputs:
  result_file: docs/tasks/TASK-012-infra-global-doc-repo.result.md
---

# TASK-012 Infra 全局文档仓储与 section 合并

## 1. 背景

来自 PLAN P2。`PROGRESS.md`（§6.5）、`DECISIONS.md`（§6.6）、`ISSUES.md`（§6.7）是全局状态文档，合并回写时需要 section 级机器判定合并（§3.2）：progress 按 `mode`(replace/append) + `section` 合并；decisions/issues 按 `id` 去重追加。

## 2. 当前目标

实现 `GlobalDocRepository`：
- `applyProgressUpdate(doc, { section, mode, content })`：定位 section（按标题），`replace` 整段替换、`append` 末尾拼接。
- `appendDecision(doc, decision)` / `appendIssue(doc, issue)`：按 `id` 去重追加（YAML 列表或 fenced block）。
- `readDecisions`/`readIssues`：解析为机器字段数组。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-012-infra-global-doc-repo.md
- Readme.md §6.5/§6.6/§6.7/§3.2

## 5. 修改范围

- `src/infrastructure/fs/global-doc-repo.ts`、`src/infrastructure/index.ts`、`test/infrastructure/fs/global-doc-repo.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、`frontmatter-parser.ts`、`task-doc-repo.ts`

## 7. 不做什么

- 不做冲突仲裁（多条 replace 命中同 section 的后写者覆盖 + 落 ISSUES，由 application 层 TASK-020 编排）。
- 不分配 decision/issue 的 `id`（application 层 TASK-020）。

## 8. 架构约束

- 依赖 core Decision/Issue Schema（校验追加项）+ frontmatter-parser。
- section 定位基于 Markdown 标题层级（`##`/`###`），需健壮处理缺失 section（按 append 视为新建）。
- decisions/issues 用统一 YAML 列表表达以满足「机器字段」要求（§6.6/§6.7）。

## 9. 数据流和状态流要求

输入：全局文档现状 + 一条 update；输出：合并后文档。是合并回写（TASK-020）的底层操作。

## 10. 预期新增或修改文件

- `src/infrastructure/fs/global-doc-repo.ts`、`test/infrastructure/fs/global-doc-repo.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- replace/append 对存在/不存在 section 的行为符合 §3.2。
- decisions/issues 按 id 去重；同 id 再追加=更新。
- round-trip：read(apply(x)) 含 x；`typecheck` 0 错误。

## 12. 风险提示

- section 标题匹配要规范（trim、大小写、层级），避免误合并相邻 section。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-012-infra-global-doc-repo.result.md
- `PROGRESS.md` 更新建议：全局文档仓储与 section 合并就绪，P2 收尾
