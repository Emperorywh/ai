---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态（Readme §6.5）。v0.1.0（TASK-001~029）+ v0.2.0 Claude Agent SDK 接入（TASK-030~035）的完整历史快照已归档至 `docs/PROGRESS_archive.md`；逐任务权威记录在各 `docs/tasks/TASK-XXX.result.md` 与 `docs/DECISIONS.md`。

## 当前阶段

**serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-036（Executor/Reviewer 契约收敛到 application execution/ports）已完成，TASK-037（从 task-run 抽取单任务执行用例）可直接开跑**。

> 上一阶段 v0.2.0 Claude Agent SDK 接入（`PLAN_claude-sdk-integration`，TASK-030~035）已全部完成——双侧（执行 + 审查）真实 SDK 调用闭环、多 provider（anthropic + glm）接入、CI 真实 API 契约子集（受 secret 控制）。详见归档。

## 当前完成到哪个任务

- **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令（init / plan / task:create / status / rebuild-index / task:run / task:review）齐备——已完成。
- **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：sdk-client 会话工厂 / Provider Profile 多 provider / ClaudeSdkInvocationImpl 执行侧 / ClaudeSdkReviewer 审查侧 / task:run + task:review 接线 + §7 可观测性 + CI 真实 API 契约——已完成。
- **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（TaskExecutorPort / TaskReviewerPort 单一来源）+ 删除 `infrastructure/sdk/executor-contract.ts` + 删除 reviewer 重复结构类型（SdkReviewInput/SdkReviewOutcome）+ CLI/SDK adapter 全部调用点迁移 + ARCHITECTURE §3/§4 同步——已完成。
- 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。

## 当前系统可用能力

- **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` 与 `task:review` 默认 `auto` 读 `.caw/config.json` profile 走真实 Claude Agent SDK；`--executor dry-run` / `--reviewer local` 显式回退。行为与 TASK-036 前完全一致（契约迁移零行为变更）。
- **分层**：`cli → application → core ← infrastructure`，且 infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 的执行/审查契约类型（infrastructure → application 仅限 ports，TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
- **执行/审查契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` + `ExecuteInput` / `ExecuteOutcome` / `ReviewInput` / `ReviewOutcome` / `ExecutorPermissionBoundary` / `StartupPromptArgs` + `buildStartupPrompt` + `ExecutorError`。SDK 实现（DryRunLocalExecutor / ClaudeSdkExecutor / ClaudeSdkReviewer）与 CLI 兜底（LocalReviewer）经 `implements` + 结构类型满足 Port。
- **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量（`ANTHROPIC_API_KEY` / `ZHIPU_API_KEY`）。
- **测试**：`npm run typecheck && npm test && npm run lint` 全绿（Node 22，`better-sqlite3` 原生模块约束见 ISS-005；本机 Node 24 下 SQLite 子集 fail，属环境约束非回归）。

## 后续任务必须知道的信息

- **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
- **依赖红线**：`package.json` 基础依赖已声明（zod / yaml / better-sqlite3 / commander / @anthropic-ai/claude-agent-sdk 等）；后续任务默认**不得新增依赖**，确需新增→在 `.result.md` 提议扩权，不自行改 `package.json`。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
- **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`，`tsc --noEmit` 覆盖 `src` + `test`。
- **Schema 单一来源**：领域 Schema 与枚举一律从 `src/core` 导入复用（`z.infer` 派生类型同源），不重复声明；任务 frontmatter / `.result.md` / `.review.md` 结构分别复用 `TaskFrontmatterSchema` / `ResultFrontmatterSchema` / `ReviewFrontmatterSchema`；**执行/审查契约从 `src/application/execution/ports.ts` 导入（TASK-036 起，不再从 infrastructure/CLI 取）**。
- **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引（`rebuild-index` 可重建）；状态机只读 frontmatter，不读 SQLite。
- **SDK 接入既成**：`ClaudeSdkInvocationImpl`（执行）/ `ClaudeSdkReviewer`（审查）真实实现就位，经 `sdk-client` 调自主 query；provider env 由 `cli/config/provider-profile.ts` 组装；字段名以安装版 `@anthropic-ai/claude-agent-sdk@0.3.206` `.d.ts` 为准（R-API，详见归档「架构状态」+ `SPEC_claude-sdk-integration.md` §12）。TASK-037/038 抽取 execute-task / review-finalize 用例时应直接消费 application execution/ports 的 Port 类型，经 cli composition root 注入 SDK 实现。

## 当前未解决问题摘要

> 权威清单与处置建议见 `docs/ISSUES.md`。当前 **18 项 open**：ISS-004 / 005 / 006 / 007 / 008 / 010 / 011 / 012 / 014 / 015 / 016 / 017 / 019 / 020 / 021 / 022 / 023 / 024（ISS-001/002/003/009/013/018 已 resolved）。要点：

- **ISS-005**（low）：`better-sqlite3@11.10.0` 需 Node 22（ABI 127）运行，本机更高版本 Node 无预编译——固定 Node 22。
- **ISS-012 / ISS-016 / ISS-024**（medium）：SDK 真实 API 契约（执行 + 审查）首次跑通待 CI 配置 `ANTHROPIC_API_KEY` / `ZHIPU_API_KEY` secret 后验证（本地无 key，`describe.skipIf` 跳过）。
- **ISS-019**（medium）：zod peer 冲突（SDK 要 zod ^4，项目 zod ^3），须 `--legacy-peer-deps` 安装；zod 4 升级为独立破坏性任务。
- **ISS-006**（medium）：依赖级联张力——状态机表无 `ready/draft→blocked` 边，`cascadeIfBlocked` 对未启动后继返回 `skipped`，待裁定。
- 其余 low（ISS-004/007/008/010/011/014/015/017/020/021/022/023）多为环境约束 / 后续增强 / 文档张力，非阻塞，详见 `docs/ISSUES.md`。

## 建议下一个任务

**TASK-037**（从 task-run 抽取单任务执行用例，`depends_on: [TASK-036]`，TASK-036 已 done 可直接开跑）。其后 TASK-038（抽取审查与共享完成用例）/ TASK-039（core 系统验证契约）已立项，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进。TASK-037/038 应复用 TASK-036 收敛后的 `TaskExecutorPort` / `TaskReviewerPort`（SPEC §20.4「复用与重构」）。
