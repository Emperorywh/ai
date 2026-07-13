---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态（Readme §6.5）。v0.1.0（TASK-001~029）+ v0.2.0 Claude Agent SDK 接入（TASK-030~035）的完整历史快照已归档至 `docs/PROGRESS_archive.md`；逐任务权威记录在各 `docs/tasks/TASK-XXX.result.md` 与 `docs/DECISIONS.md`。

## 当前阶段

**serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~040；**TASK-040（真实验证 Runner + 路径越界审计 + 接入 ExecuteTaskUseCase）已完成，TASK-041（Run Journal Schema 与运行状态 Ports）可直接开跑**。

> 上一阶段 v0.2.0 Claude Agent SDK 接入（`PLAN_claude-sdk-integration`，TASK-030~035）已全部完成——双侧（执行 + 审查）真实 SDK 调用闭环、多 provider（anthropic + glm）接入、CI 真实 API 契约子集（受 secret 控制）。详见归档。

## 当前完成到哪个任务

- **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
- **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
- **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
- **serial-task-orchestration TASK-037**：抽取 `ExecuteTaskUseCase`——已完成。
- **serial-task-orchestration TASK-038**：抽取 `ReviewTaskUseCase` + 共享 `FinalizeTaskUseCase`，CLI 降为 composition root——已完成。
- **serial-task-orchestration TASK-039**：系统验证领域契约（ResultVerification 四元组 + VerificationRunnerPort + VerifyTaskUseCase + 三 core 纯规则）——已完成。
- **serial-task-orchestration TASK-040**：infrastructure 落地 `ProcessVerificationRunner`（真实子进程 + 真实退出码/耗时/输出摘要 + 超时映射 + Windows taskkill /T /F 进程树清理）+ `WorktreeAdapter.listChangedFiles`（四类 Git 变更枚举）+ 新增 `WorkspaceInspectionPort` + `auditPaths` 纯函数（allowed 祖先/文件/glob + forbidden 优先）+ 接入 `ExecuteTaskUseCase`（可选注入，向后兼容）与 task-run——已完成。
- 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。

## 当前系统可用能力

- **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。task:run / task:review 公开选项与退出行为不变；TASK-040 起 task:run 可选注入 workspaceInspector / verificationRunner 启用路径审计 + 系统验证（默认不注入，保持 DryRun 兼容；真实验证门禁由 Orchestrator 接入）。
- **分层**：`cli → application → core ← infrastructure`，infrastructure SDK adapter / ProcessVerificationRunner 经依赖倒置 import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038、TASK-040）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
- **执行/审查/验证契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` / `VerificationRunnerPort` / **`WorkspaceInspectionPort`**（TASK-040 新增）+ 输入输出 + §18 启动提示 + `ExecutorError`。
- **单任务执行 / 审查 / 完成 / 系统验证用例**：`ExecuteTaskUseCase`（TASK-037，TASK-040 增路径审计 + 系统验证阶段）/ `ReviewTaskUseCase` / `FinalizeTaskUseCase`（TASK-038）/ `VerifyTaskUseCase`（TASK-039）。
- **路径越界审计纯函数**：`src/application/execution/path-audit.ts` 导出 `auditPaths` + `PathAuditInput` / `PathAuditOutcome` / `PathViolation`（TASK-040）。输入实际变更清单 + allowed/forbidden，按路径段比较 + glob 匹配，forbidden 优先，结构化违规返回。
- **真实验证 Runner**：`src/infrastructure/process/verification-runner.ts` 导出 `ProcessVerificationRunner`（TASK-040）。子进程执行采集真实退出码/耗时/stdout+stderr 摘要（各 16KB 上限 + 摘要 4KB 上限）；超时映射 failed+exitCode=null+摘要注明超时；spawn 失败映射 failed+启动失败摘要；Windows 超时用 taskkill /T /F 杀进程树（清孙进程，避免 cwd 被孤儿占用）。
- **工作区变更枚举**：`WorktreeAdapter.listChangedFiles(worktreePath)`（TASK-040）。`git status --porcelain -z --untracked-files=all` 解析，覆盖 tracked 修改/staged/untracked/删除，去 rename 旧路径，忽略 .gitignore。
- **core 系统验证纯规则**：`overlaySystemVerification` / `isVerificationGatePassed` / `validateAllowlistPermissions`（TASK-039）。
- **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
- **测试**：`npm run typecheck && npm run lint` 全绿；`npm test` 全量 917 passed / 0 failed / 2 skipped（Node 22 下 SQLite 子集一并转绿）。

## 后续任务必须知道的信息

- **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure 实现（SDK adapter / ProcessVerificationRunner）可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038 + TASK-040）**。
- **五能力 Port（TASK-036/039/040）**：执行 / 审查 / 系统验证 / 工作区检查 契约收敛在 `application/execution/ports.ts`（TaskExecutorPort / TaskReviewerPort / VerificationRunnerPort / WorkspaceInspectionPort）。串行 Orchestrator（TASK-044）经四用例（Execute/Verify/Review/Finalize）+ WorkspaceInspectionPort 注入，串联 execute → verify → (done & no_review) finalize / execute → verify → review → (done) finalize。
- **ExecuteTaskUseCase 路径审计 + 系统验证接入（TASK-040/DEC-043）**：`ExecuteTaskPorts` 新增**可选** `workspaceInspector` / `verificationRunner`——未注入（undefined）跳过对应阶段，保持 TASK-037 行为（向后兼容 execute-task.test 与 DryRun CLI）。注入后 Executor 返回先做路径审计（枚举变更，排除 result_file 默认允许）→ 越界 blocked+needs-human；再调 VerifyTaskUseCase 覆盖模型自报；状态映射：越界→blocked、no_review+验证失败→blocked、普通任务验证失败→reviewing 交 Reviewer。串行 Orchestrator 注入真实 Port 后真实验证门禁生效。
- **路径审计 result_file 排除（DEC-043）**：`workflow_outputs.result_file` 为默认允许写入（§3.2，不计 allowed_paths），路径审计前显式排除，避免 DryRun / Executor 写 .result.md 被误判越界。
- **路径工具同源独立实现（TASK-040）**：`auditPaths` 的 normalizePath / isAncestorOrEqual 与 `core/rules/permission-rules.ts` 同名私有函数同源（按路径段比较），但 core 不在本任务 allowed，故在 `application/execution/path-audit.ts` 独立实现；日后 core 导出公共路径工具可统一（独立任务）。
- **ResultVerification 系统验证四元组（TASK-039/DEC-041）**：source / exit_code / duration_ms / output_summary 为 optional；系统验证路径（VerifyTaskUseCase / ProcessVerificationRunner）显式写全四元组。ProcessVerificationRunner 经 VerifyTaskUseCase 映射时统一标 source='system'。
- **完成门禁（TASK-039/DEC-042/FR-012）**：`isVerificationGatePassed` 只认 allowlist 命令的系统记录 result === 'passed'；模型自报 passed 不算数（AC-010，TASK-040 task-run 接入测试覆盖）。
- **VerificationRunner 跨平台进程语义（TASK-040/DEC-044）**：`spawn(command, { shell: true, cwd: worktreePath, env: process.env })`；超时映射 failed+exitCode=null+摘要注明超时；**Windows 超时用 `taskkill /pid /T /F` 杀进程树**（shell 模式孙进程持有 stdio + cwd，直接 child.kill 只杀 shell 致孤儿占用 cwd）；POSIX 走 SIGTERM+SIGKILL（进程组隔离由生产容器保障，ISS-025）。输出上限：stdout/stderr 各 16KB + 摘要 4KB。
- **main / worktree 仓储显式区分（任务 §12）**：四用例均经 `taskRepo`（main，状态权威）维护 status，经 `openWorktreeRepo(wtPath)` 读 Executor 产出的 .result.md（尚未合并入 main）。
- **合并回收单一入口（TASK-038/DEC-040/SPEC §20.4）**：合并包装 / 冲突登记 / 主工作区同步 / 全局回写只在 `FinalizeTaskUseCase` 一处实现。
- **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
- **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`（`[i]` 索引为 string | undefined，path-audit 用 charAt 规避）；application 层模块间跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环。
- **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查/验证/工作区检查契约从 `src/application/execution/ports.ts` 导入。
- **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。

## 当前未解决问题摘要

> 权威清单与处置建议见 `docs/ISSUES.md`。当前 **19 项 open**：ISS-004 / 005 / 006 / 007 / 008 / 010 / 011 / 012 / 014 / 015 / 016 / 017 / 019 / 020 / 021 / 022 / 023 / 024 / 025（ISS-001/002/003/009/013/018 已 resolved）。要点：

- **ISS-005**（low）：`better-sqlite3@11.10.0` 需 Node 22（ABI 127）运行，本机更高版本 Node 无预编译——固定 Node 22（TASK-040 本机切 Node 22 后 SQLite 子集 42 failed 全部转绿，全量 917 passed / 0 failed）。
- **ISS-025**（low，TASK-040 新增）：POSIX 下 ProcessVerificationRunner 超时 kill 仅杀 shell 直接进程，孙进程清理依赖生产容器进程组隔离（Windows 已用 taskkill /T /F 覆盖，DEC-044）。
- **ISS-012 / ISS-016 / ISS-024**（medium）：SDK 真实 API 契约（执行 + 审查）首次跑通待 CI 配置 `ANTHROPIC_API_KEY` / `ZHIPU_API_KEY` secret 后验证（本地无 key，`describe.skipIf` 跳过）。
- **ISS-019**（medium）：zod peer 冲突（SDK 要 zod ^4，项目 zod ^3），须 `--legacy-peer-deps` 安装；zod 4 升级为独立破坏性任务。
- **ISS-006**（medium）：依赖级联张力——状态机表无 `ready/draft→blocked` 边，`cascadeIfBlocked` 对未启动后继返回 `skipped`，待裁定。
- 其余 low（ISS-004/007/008/010/011/014/015/017/020/021/022/023）多为环境约束 / 后续增强 / 文档张力，非阻塞，详见 `docs/ISSUES.md`。

## 建议下一个任务

**TASK-041**（Run Journal Schema 与运行状态 Ports，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进）。TASK-040 已落地真实验证门禁（ProcessVerificationRunner + 路径审计 + 接入 ExecuteTaskUseCase）；TASK-041 起定义运行级显式状态（`.caw/runs/<run-id>.json` Run Journal Schema + RunJournalPort / OrchestrationLockPort，FR-027/FR-028/FR-029），为串行 Orchestrator（TASK-044）与崩溃恢复（TASK-048）提供持久检查点与单实例锁。
