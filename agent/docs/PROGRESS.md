---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态（Readme §6.5）。v0.1.0（TASK-001~029）+ v0.2.0 Claude Agent SDK 接入（TASK-030~035）的完整历史快照已归档至 `docs/PROGRESS_archive.md`；逐任务权威记录在各 `docs/tasks/TASK-XXX.result.md` 与 `docs/DECISIONS.md`。

## 当前阶段

**serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-039（core 系统验证记录 + VerificationRunnerPort + VerifyTaskUseCase）已完成，TASK-040（真实验证 Runner 与路径越界审计）可直接开跑**。

> 上一阶段 v0.2.0 Claude Agent SDK 接入（`PLAN_claude-sdk-integration`，TASK-030~035）已全部完成——双侧（执行 + 审查）真实 SDK 调用闭环、多 provider（anthropic + glm）接入、CI 真实 API 契约子集（受 secret 控制）。详见归档。

## 当前完成到哪个任务

- **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
- **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
- **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
- **serial-task-orchestration TASK-037**：从 `cli/commands/task-run.ts` 抽取 `ExecuteTaskUseCase` 到 `src/application/execution/execute-task.ts`——已完成。
- **serial-task-orchestration TASK-038**：抽取 `ReviewTaskUseCase`（审查 + 写 .review.md + applyReview 状态映射）与 `FinalizeTaskUseCase`（合并 + 全局回写 + 冲突 done→blocked + 落 ISSUES）到 `src/application/execution/`；消除 task-run / task-review 两处重复的合并包装 / 冲突登记 / 主工作区同步 / 全局回写（SPEC §20.4）；CLI 降为 composition root（装配 Ports + 串联 execute/review → finalize）——已完成。
- **serial-task-orchestration TASK-039**：扩展 `ResultVerification`（source / exit_code / duration_ms / output_summary 系统验证四元组）+ 新增 `overlaySystemVerification` / `isVerificationGatePassed` / `validateAllowlistPermissions` core 纯规则 + 新增 `VerificationRunnerPort` + `VerifyTaskUseCase`（allowlist → 权限校验 → 串行 Runner → 系统覆盖模型 → 严格门禁）；SDK 适配器给模型自报记录标 source='model'，待系统 Runner（TASK-040）覆盖为 source='system'——已完成。
- 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。

## 当前系统可用能力

- **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` / `task:review` 公开选项与退出行为不变（TASK-038 抽取为零行为变更，23 + 13 项 CLI 测试全绿）；执行阶段编排自 TASK-037 委托 `ExecuteTaskUseCase`，审查阶段自 TASK-038 委托 `ReviewTaskUseCase`，done 路径合并回收自 TASK-038 委托共享 `FinalizeTaskUseCase`。
- **分层**：`cli → application → core ← infrastructure`，且 infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
- **执行/审查/验证契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` / `VerificationRunnerPort` + 输入输出 + §18 启动提示 + `ExecutorError`（TASK-036 / TASK-039）。
- **单任务执行用例**：`src/application/execution/execute-task.ts` 导出 `ExecuteTaskUseCase` + `ExecuteTaskPorts` / `ExecuteTaskInput` / `ExecuteTaskOutcome`（TASK-037）。
- **单任务审查用例**：`src/application/execution/review-task.ts` 导出 `ReviewTaskUseCase` + `ReviewTaskPorts` / `ReviewTaskInput` / `ReviewTaskOutcome`（TASK-038）。用例只依赖 core + Ports（TaskDocRepositoryPort / TaskReviewerPort + openWorktreeRepo 注入），main / worktree 仓储经路由适配器显式区分（applyReview 的 skipped 分支读 .result.md 路由到 worktree）。
- **共享完成用例**：`src/application/execution/finalize-task.ts` 导出 `FinalizeTaskUseCase` + `FinalizeTaskPorts` / `FinalizeTaskInput` / `FinalizeTaskOutcome`（TASK-038）。统一 done 路径的 rebase+ff（TASK-019）+ 全局回写（TASK-020）+ 主工作区同步 + 冲突 done→blocked + 落 ISSUES；task:run 的 no_review 完成路径与 task:review 的 approved 路径复用同一 finalizer，供串行 Orchestrator（TASK-044）直接调用。
- **单任务系统验证用例**：`src/application/execution/verify-task.ts` 导出 `VerifyTaskUseCase` + `VerifyTaskPorts` / `VerifyTaskInput` / `VerifyTaskOutcome`（TASK-039）。计算 allowlist（复用 computeVerificationAllowlist）→ 批量校验 requires_permissions（缺失直接 blocked + needs-human，Runner 不调）→ 严格串行调 `VerificationRunnerPort`（allowlist 顺序）→ `overlaySystemVerification`（系统记录覆盖模型自报）→ `isVerificationGatePassed`（allowlist 命令系统记录必须全 passed）。供串行 Orchestrator（TASK-044）在 Executor 完成后调用。
- **core 系统验证纯规则**：`overlaySystemVerification`（FR-011.5 同名系统记录覆盖模型自报）/ `isVerificationGatePassed`（FR-012 完成门禁，不再把 skipped 当通过）/ `validateAllowlistPermissions`（FR-011.3 批量权限校验，结构化 denied）（TASK-039）。
- **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
- **测试**：`npm run typecheck && npm run lint` 全绿；`npm test` 全量 830 passed / 42 failed（全在 SQLite 子集，ISS-005 Node 版本约束）/ 2 skipped。

## 后续任务必须知道的信息

- **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
- **三用例复用（TASK-037/038/DEC-039/DEC-040）**：单任务执行 / 审查 / 共享完成编排分别收敛在 `ExecuteTaskUseCase` / `ReviewTaskUseCase` / `FinalizeTaskUseCase`（`src/application/execution/`）。串行 Orchestrator（TASK-044）应直接复用：经各自 Ports 注入依赖，串联 execute → (done & no_review) finalize / execute → review → (done) finalize，消费结构化 Outcome（含 task / result / worktreePath）。Review 与 Finalize 是两个职责独立的用例（§8），由调用方串联，不在 Review 内部调 Finalize。
- **四用例复用（TASK-037/038/039）**：单任务执行 / 审查 / 完成 / 系统验证编排分别收敛在 `ExecuteTaskUseCase` / `ReviewTaskUseCase` / `FinalizeTaskUseCase` / `VerifyTaskUseCase`（`src/application/execution/`）。串行 Orchestrator（TASK-044）应直接复用：经各自 Ports 注入依赖，串联 execute → verify → (done & no_review) finalize / execute → verify → review → (done) finalize，消费结构化 Outcome。VerifyTaskUseCase 不经 taskRepo（接收 modelVerification 作为输入参数），与 execute/review/finalize 经 taskRepo 的模式显式区分。
- **ResultVerification 系统验证四元组（TASK-039/DEC-041）**：`ResultVerification` 新增 source / exit_code / duration_ms / output_summary 为 optional——兼容模型自报（模型无法知道真实退出码）与历史测试夹具（大量不在各任务可改范围）；**系统验证路径（VerifyTaskUseCase / SDK 真实执行）必须显式写全四元组**，不靠 optional 兜底。模型自报记录 source='model'，系统记录 source='system'，overlay 后系统记录覆盖同命令模型记录（FR-011.5）。
- **完成门禁（TASK-039/DEC-042/FR-012）**：`isVerificationGatePassed` 只认 allowlist 命令的系统记录 result === 'passed'；任意 failed / skipped / 未执行 → blocked。no_review 任务至此不进入 done（必须全部必需验证的系统记录 passed）。模型自报的 passed 不算数（门禁只看系统记录）。
- **VerificationRunnerPort（TASK-039）**：application 只经此 Port 依赖验证执行能力，不感知子进程 / shell；真实实现（超时映射为 failed + exitCode=null + outputSummary 注明超时）由 TASK-040 在 infrastructure 落地。
- **main / worktree 仓储显式区分（任务 §12）**：三用例均经 `taskRepo`（main，状态权威）维护 status / 写 .review.md，经 `openWorktreeRepo(wtPath)` 读 Executor 产出的 .result.md（尚未合并入 main）；FinalizeTaskUseCase 的合并 rebaseAndFastForward docs port 路由到 worktree 仓储。不用路径判断隐式路由。
- **合并回收单一入口（TASK-038/DEC-040/SPEC §20.4）**：合并包装 / 冲突登记 / 主工作区同步 / 全局回写只在 `FinalizeTaskUseCase` 一处实现；`syncMainWorktreeFile`（git checkout 主工作区结果文件）作为注入回调由 CLI 闭包绑定 projectRoot + mainRef 后注入，application 用例不感知 git I/O。
- **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
- **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`；application 层模块间的跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环（review-task.ts / finalize-task.ts → state-orchestrator.js / merge/rebase-ff.js / merge/section-writeback.js）。
- **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查契约从 `src/application/execution/ports.ts` 导入（TASK-036 起）。
- **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。

## 当前未解决问题摘要

> 权威清单与处置建议见 `docs/ISSUES.md`。当前 **18 项 open**：ISS-004 / 005 / 006 / 007 / 008 / 010 / 011 / 012 / 014 / 015 / 016 / 017 / 019 / 020 / 021 / 022 / 023 / 024（ISS-001/002/003/009/013/018 已 resolved）。要点：

- **ISS-005**（low）：`better-sqlite3@11.10.0` 需 Node 22（ABI 127）运行，本机更高版本 Node 无预编译——固定 Node 22。
- **ISS-012 / ISS-016 / ISS-024**（medium）：SDK 真实 API 契约（执行 + 审查）首次跑通待 CI 配置 `ANTHROPIC_API_KEY` / `ZHIPU_API_KEY` secret 后验证（本地无 key，`describe.skipIf` 跳过）。
- **ISS-019**（medium）：zod peer 冲突（SDK 要 zod ^4，项目 zod ^3），须 `--legacy-peer-deps` 安装；zod 4 升级为独立破坏性任务。
- **ISS-006**（medium）：依赖级联张力——状态机表无 `ready/draft→blocked` 边，`cascadeIfBlocked` 对未启动后继返回 `skipped`，待裁定。
- 其余 low（ISS-004/007/008/010/011/014/015/017/020/021/022/023）多为环境约束 / 后续增强 / 文档张力，非阻塞，详见 `docs/ISSUES.md`。

## 建议下一个任务

**TASK-040**（真实验证 Runner 与路径越界审计，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进）。TASK-039 已落地系统验证领域契约（ResultVerification 四元组 + VerificationRunnerPort + VerifyTaskUseCase + 三 core 纯规则）；TASK-040 起在 infrastructure 实现 VerificationRunnerPort 的真实子进程执行（采集真实退出码 / 耗时 / 输出摘要 + 超时映射）与 Git diff 路径越界审计（FR-039 / AC-011，allowed/forbidden 硬校验），为串行 Orchestrator（TASK-044）提供真实验证门禁与路径边界硬校验。串行 Orchestrator 实现时经四用例（Execute/Verify/Review/Finalize）注入 Ports 串联完整单任务闭环。
