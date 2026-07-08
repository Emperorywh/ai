---
id: TASK-010
title: Infra frontmatter 解析器
status: draft
layer: data
depends_on:
  - TASK-001
allowed_paths:
  - src/infrastructure/fs/frontmatter-parser.ts
  - src/infrastructure/index.ts
  - test/infrastructure/fs/frontmatter-parser.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/fs/frontmatter-parser
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#9-任务文件模板
    - Readme.md#10-任务执行结果模板
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-010-infra-frontmatter-parser.result.md
---

# TASK-010 Infra frontmatter 解析器

## 1. 背景

来自 PLAN P2。文档协议 = Markdown 正文 + YAML frontmatter（§3.1）。所有文档仓储（TASK-011/012）都依赖一个稳健的 frontmatter 解析/序列化器。

## 2. 当前目标

实现 `parseDocument(raw): { frontmatter: unknown; body: string }` 与 `serializeDocument(frontmatter, body): string`：识别开头 `---\n...\n---` 围栏，YAML 解析用既有库（如 `yaml`），保留正文原样；无 frontmatter 时 body=全文。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-010-infra-frontmatter-parser.md
- Readme.md §9/§10 模板

## 5. 修改范围

- `src/infrastructure/fs/frontmatter-parser.ts`、`src/infrastructure/index.ts`、`test/infrastructure/fs/frontmatter-parser.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、其他 infra 文件

## 7. 不做什么

- 不绑定具体 Schema（Schema 校验由各文档仓储在读取后用对应 core Schema 做，本任务只做结构解析）。
- 不做文件 I/O（只处理字符串）。

## 8. 架构约束

- 不依赖 core（纯字符串工具）。如需 `---` 出现在正文中，只认首部围栏。
- 序列化结果稳定可 round-trip（parse(serialize(f,b)) 深度相等）。

## 9. 数据流和状态流要求

输入：文档原文；输出：frontmatter 对象 + 正文。是文档仓储的底层组件。

## 10. 预期新增或修改文件

- `src/infrastructure/fs/frontmatter-parser.ts`、`test/infrastructure/fs/frontmatter-parser.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准

- 含/不含 frontmatter 的文档均正确解析；round-trip 用例通过。
- 正文内含 `---` 不被误判为首部围栏。
- `typecheck` 0 错误。

## 12. 风险提示

- CRLF/LF 换行差异：Windows 环境下需兼容 `\r\n`。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-010-infra-frontmatter-parser.result.md
- `PROGRESS.md` 更新建议：frontmatter 解析器就绪
