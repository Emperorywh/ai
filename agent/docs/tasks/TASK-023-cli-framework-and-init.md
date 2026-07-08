---
id: TASK-023
title: CLI 框架与 init 命令
status: draft
layer: page
depends_on:
  - TASK-001
allowed_paths:
  - src/cli/framework.ts
  - src/cli/commands/init.ts
  - src/cli/index.ts
  - test/cli/init.test.ts
  - package.json
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/init
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#6-文档体系
    - Readme.md#61-agentsmd
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-023-cli-framework-and-init.result.md
---

# TASK-023 CLI 框架与 init 命令

## 1. 背景

来自 PLAN P8。CLI 是第一阶段主入口（§3.1）。先落地命令框架（commander/clipanion 等）与 `init` 命令——为目标项目生成文档协议骨架。

## 2. 当前目标

- `framework.ts`：CLI 入口、命令注册、退出码约定、错误输出格式。
- `init` 命令：在目标目录生成 `AGENTS.md / SPEC.md / ARCHITECTURE.md / PLAN.md / PROGRESS.md / DECISIONS.md / ISSUES.md / TESTING.md` 与 `TASKS/` 目录（§6 文档体系）。模板内嵌，幂等（已存在不覆盖）。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-023-cli-framework-and-init.md
- Readme.md §6/§6.1

## 5. 修改范围

- `src/cli/framework.ts`、`src/cli/commands/init.ts`、`src/cli/index.ts`、`test/cli/init.test.ts`
- `package.json`（仅限注册 CLI `bin` 入口与命令名，不改 `scripts`/`dependencies` 等其它字段）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`（init 只写模板文件，不依赖领域逻辑）

## 7. 不做什么

- 不实现 plan/task:create/task:run/task:review/status/rebuild-index（后续 CLI 任务）。
- 不强制注入 SPEC/ARCHITECTURE 内容（只生成空骨架模板，内容由用户/Orchestrator 填）。

## 8. 架构约束

- CLI 只作交互入口，不拥有核心状态机（§3.1）。
- init 生成的 `AGENTS.md` 模板含 §6.1 列出的通用约束项。
- 命令退出码：0 成功，非 0 失败（细分码在 framework 约定）。

## 9. 数据流和状态流要求

输入：目标目录路径；输出：生成的文档骨架文件集。

## 10. 预期新增或修改文件

- `src/cli/framework.ts`、`src/cli/commands/init.ts`、`test/cli/init.test.ts`、`src/cli/index.ts`
- `package.json`（追加 `bin` 字段）

## 11. 验收标准

- 在临时目录跑 `init` 后，§6 列出的全部文档与 `TASKS/` 存在；重复执行不覆盖既有文件。
- 退出码正确；`typecheck` 0 错误。

## 12. 风险提示

- 模板内容不要与本项目自身的 `AGENTS.md` 混淆——init 生成的是「目标项目」的骨架。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-023-cli-framework-and-init.result.md
- `PROGRESS.md` 更新建议：CLI 框架与 init 就绪
