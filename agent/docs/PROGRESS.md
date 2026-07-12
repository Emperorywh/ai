---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态（Readme §6.5）。v0.1.0（TASK-001~029）+ v0.2.0 Claude Agent SDK 接入（TASK-030~035）的完整历史快照已归档至 `docs/PROGRESS_archive.md`；逐任务权威记录在各 `docs/tasks/TASK-XXX.result.md` 与 `docs/DECISIONS.md`。

## 当前阶段

**serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-036（`depends_on: []`）可直接开跑**。

> 上一阶段 v0.2.0 Claude Agent SDK 接入（`PLAN_claude-sdk-integration`，TASK-030~035）已全部完成——双侧（执行 + 审查）真实 SDK 调用闭环、多 provider（anthropic + glm）接入、CI 真实 API 契约子集（受 secret 控制）。详见归档。

## 当前完成到哪个任务

- **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令（init / plan / task:create / status / rebuild-index / task:run / task:review）齐备——已完成。
- **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：sdk-client 会话工厂 / Provider Profile 多 provider / ClaudeSdkInvocationImpl 执行侧 / ClaudeSdkReviewer 审查侧 / task:run + task:review 接线 + §7 可观测性 + CI 真实 API 契约——已完成。
- 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。

## 当前系统可用能力

- **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` 与 `task:review` 默认 `auto` 读 `.caw/config.json` profile 走真实 Claude Agent SDK；`--executor dry-run` / `--reviewer local` 显式回退。
- **分层**：`cli → application → core ← infrastructure`；application 经 `src/application/ports.ts` 窄接口依赖 infra。详见 `docs/ARCHITECTURE.md` 与 `AGENTS.md`。
- **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量（`ANTHROPIC_API_KEY` / `ZHIPU_API_KEY`）。
- **测试**：`npm run typecheck && npm test && npm run lint` 全绿（Node 22，`better-sqlite3` 原生模块约束见 ISS-005）。

## 后续任务必须知道的信息

- **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` 依赖 infra，不得直接 import infra 实现类。
- **依赖红线**：`package.json` 基础依赖已声明（zod / yaml / better-sqlite3 / commander / @anthropic-ai/claude-agent-sdk 等）；后续任务默认**不得新增依赖**，确需新增→在 `.result.md` 提议扩权，不自行改 `package.json`。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
- **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`，`tsc --noEmit` 覆盖 `src` + `test`。
- **Schema 单一来源**：领域 Schema 与枚举一律从 `src/core` 导入复用（`z.infer` 派生类型同源），不重复声明；任务 frontmatter / `.result.md` / `.review.md` 结构分别复用 `TaskFrontmatterSchema` / `ResultFrontmatterSchema` / `ReviewFrontmatterSchema`。
- **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引（`rebuild-index` 可重建）；状态机只读 frontmatter，不读 SQLite。
- **SDK 接入既成**：`ClaudeSdkInvocationImpl`（执行）/ `ClaudeSdkReviewer`（审查）真实实现就位，经 `sdk-client` 调自主 query；provider env 由 `cli/config/provider-profile.ts` 组装；字段名以安装版 `@anthropic-ai/claude-agent-sdk@0.3.206` `.d.ts` 为准（R-API，详见归档「架构状态」+ `SPEC_claude-sdk-integration.md` §12）。

## 当前未解决问题摘要

> 权威清单与处置建议见 `docs/ISSUES.md`。当前 **18 项 open**：ISS-004 / 005 / 006 / 007 / 008 / 010 / 011 / 012 / 014 / 015 / 016 / 017 / 019 / 020 / 021 / 022 / 023 / 024（ISS-001/002/003/009/013/018 已 resolved）。要点：

- **ISS-005**（low）：`better-sqlite3@11.10.0` 需 Node 22（ABI 127）运行，本机更高版本 Node 无预编译——固定 Node 22。
- **ISS-012 / ISS-016 / ISS-024**（medium）：SDK 真实 API 契约（执行 + 审查）首次跑通待 CI 配置 `ANTHROPIC_API_KEY` / `ZHIPU_API_KEY` secret 后验证（本地无 key，`describe.skipIf` 跳过）。
- **ISS-019**（medium）：zod peer 冲突（SDK 要 zod ^4，项目 zod ^3），须 `--legacy-peer-deps` 安装；zod 4 升级为独立破坏性任务。
- **ISS-006**（medium）：依赖级联张力——状态机表无 `ready/draft→blocked` 边，`cascadeIfBlocked` 对未启动后继返回 `skipped`，待裁定。
- 其余 low（ISS-004/007/008/010/011/014/015/017/020/021/022/023）多为环境约束 / 后续增强 / 文档张力，非阻塞，详见 `docs/ISSUES.md`。

## 建议下一个任务

**TASK-036**（将 Executor 与 Reviewer 契约收敛到 Application Ports，layer `domain`，`depends_on: []`，可直接开跑）。其后 TASK-037（app execute-task 用例）/ TASK-038（app review-finalize 用例）/ TASK-039（core 系统验证契约）已立项，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进。
