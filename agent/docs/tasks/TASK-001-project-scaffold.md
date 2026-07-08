---
id: TASK-001
title: 项目脚手架与基础约束
status: draft
layer: type
depends_on: []
allowed_paths:
  - package.json
  - tsconfig.json
  - vitest.config.ts
  - .gitignore
  - .eslintrc.cjs
  - AGENTS.md
  - docs/ARCHITECTURE.md
  - docs/PROGRESS.md
  - docs/TESTING.md
  - src/core
  - src/application
  - src/infrastructure
  - src/cli
  - test
forbidden_paths:
  - Readme.md
  - docs/PLAN_coding-agent-workflow.md
permissions:
  - install_dependencies
  - network_access
no_review: true
restart_on_retry: false
verification:
  - npm install
  - npm run typecheck
  - npm test
  - npm run lint
context_pack:
  required_docs:
    - AGENTS.md
    - Readme.md
    - docs/PROGRESS.md
  optional_doc_excerpts: []
  source_files: []
workflow_outputs:
  result_file: docs/tasks/TASK-001-project-scaffold.result.md
---

# TASK-001 项目脚手架与基础约束

## 1. 背景

来自 `PLAN_coding-agent-workflow.md` 的 P0 阶段。本工作流系统是绿地项目，当前仅有一份 `Readme.md`。需要先落地工程骨架、分层目录与基础约束文档，后续所有任务在此结构上展开。

## 2. 当前目标

初始化 TypeScript + Node.js CLI 工程：建立 `core/application/infrastructure/cli` 四层目录骨架、配置构建/测试/lint 工具链、落地 `AGENTS.md`（本仓库自身编码约束）、生成薄 `ARCHITECTURE.md`（指向 `Readme.md` 为权威 spec+arch，并写入目录结构、分层依赖方向与 `application/ports` 约定）、初始 `PROGRESS.md`，以及薄 `TESTING.md`（声明 `typecheck/test/lint` 命令及其适用 `layer`）。

## 3. 所属层级

`type`（基础设施类型层，本任务为工程脚手架，不涉及业务逻辑）。

## 4. 必读文件

- AGENTS.md（本任务生成）
- Readme.md（权威 spec+arch）
- docs/PROGRESS.md（本任务生成）
- docs/tasks/TASK-001-project-scaffold.md

## 5. 修改范围

- `package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`、`.eslintrc.cjs`
- `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/PROGRESS.md`、`docs/TESTING.md`
- 创建 `src/{core,application,infrastructure,cli}/index.ts` 占位与 `test/` 目录

## 6. 禁止修改范围

- `Readme.md`（权威来源，不改）
- `docs/PLAN_coding-agent-workflow.md`、`docs/tasks/**`（计划与任务文件）

## 7. 不做什么

- 不实现任何业务 schema、状态机或 CLI 命令逻辑（仅占位 `index.ts` 导出空桶）。
- 不接入 Claude Agent SDK / SQLite / Git 适配器。
- 不重写 SPEC，`ARCHITECTURE.md` 只做薄封装并指向 `Readme.md`。

## 8. 架构约束

- 严格建立四层目录；`core/index.ts` 不得 import `application/infrastructure/cli`。
- `AGENTS.md` 写入：简体中文回复、复杂逻辑加中文注释、不引入临时 patch、不写巨型函数、不跨层调用、不主动格式化无关代码、不自动启动浏览器测试。
- `tsconfig` 启用 `strict`、`noUncheckedIndexedAccess`。
- `package.json` scripts 至少含 `typecheck`/`test`/`lint`/`build`。
- `vitest.config.ts` 启用 `passWithNoTests: true`，保证脚手架阶段空套件 `npm test` 退出码 0（与 §11 验收一致）。
- `ARCHITECTURE.md` 必须写入 `application/ports` 分层约定：application 通过 `src/application/ports.ts` 中的窄接口（`TaskDocRepositoryPort`/`GlobalDocRepositoryPort`/`WorktreePort`）依赖 infrastructure；infrastructure 提供具体类，由 CLI 层 wiring 注入（TS 结构类型兼容，infra 无需显式 `implements`）；application 不得直接 import infra 实现类。
- `TESTING.md` 声明项目级验证命令（`npm run typecheck`/`npm test`/`npm run lint`）并按 §6.8/§16 标注各自适用的 `layer`（未标注表示全 layer 生效）。

## 9. 数据流和状态流要求

本任务无运行时数据流。`PROGRESS.md` 初始内容：项目刚完成 P0 脚手架，可用能力=无（仅骨架），后续任务须知=分层依赖方向见 `ARCHITECTURE.md`。

## 10. 预期新增或修改文件

- `package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`、`.eslintrc.cjs`
- `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/PROGRESS.md`、`docs/TESTING.md`
- `src/core/index.ts`、`src/application/index.ts`、`src/infrastructure/index.ts`、`src/cli/index.ts`
- `test/.gitkeep`

## 11. 验收标准

- `npm install` 成功；`npm run typecheck` 0 错误；`npm test`（空套件，依赖 `passWithNoTests`）退出码 0；`npm run lint` 通过。
- 四层目录与 `index.ts` 存在；`core/index.ts` 不反向 import。
- `AGENTS.md`/`ARCHITECTURE.md`/`PROGRESS.md`/`TESTING.md` 存在；`ARCHITECTURE.md` 显式声明「`Readme.md` 为权威 spec+arch」并写入 `application/ports` 分层约定；`TESTING.md` 含 `typecheck/test/lint` 命令声明。

## 12. 风险提示

- Windows 路径与换行：`.gitignore` 需兼容跨平台；脚本用跨平台写法。
- 避免在脚手架阶段引入过度工具链（暂不配 prettier，避免噪声）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-001-project-scaffold.result.md
- `.result.md` 中写入 `PROGRESS.md` 更新建议（P0 完成、可用能力骨架）
- `.result.md` 中写入 `DECISIONS.md` 更新建议（如：以 `Readme.md` 为合并 spec+arch 的权威来源）
