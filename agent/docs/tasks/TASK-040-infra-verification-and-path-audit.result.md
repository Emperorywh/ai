---
doc: result
task_id: TASK-040
execution_status: completed
modified_files:
  - src/application/execution/execute-task.ts
  - src/application/execution/ports.ts
  - src/application/execution/index.ts
  - src/infrastructure/git/worktree-adapter.ts
  - src/infrastructure/index.ts
  - src/cli/commands/task-run.ts
  - test/infrastructure/git/worktree-adapter.test.ts
  - test/cli/task-run.test.ts
created_files:
  - src/application/execution/path-audit.ts
  - src/infrastructure/process/verification-runner.ts
  - test/application/execution/path-audit.test.ts
  - test/infrastructure/process/verification-runner.test.ts
  - docs/tasks/TASK-040-infra-verification-and-path-audit.result.md
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test 全量）；新增 ProcessVerificationRunner / path-audit / WorktreeAdapter.listChangedFiles / ExecuteTaskUseCase 接入 + WorkspaceInspectionPort 类型全绿
    source: system
    exit_code: 0
    duration_ms: 4000
    output_summary: ''
  - command: npm test -- verification-runner path-audit worktree-adapter task-run execute-task verify-task
    result: passed
    notes: 6 文件子集全绿（verification-runner 11 + path-audit 约 20 + worktree-adapter 25 含 listChangedFiles 6 + task-run 29 含 TASK-040 接入 6 + execute-task 既有 + verify-task 既有）；覆盖 §11 全部验收（真实退出码/输出摘要/spawn 失败/超时/四类 Git 变更/allowed 祖先+文件+glob/forbidden 优先/模型 passed 被系统 failed 覆盖）
    source: system
    exit_code: 0
    duration_ms: 52000
    output_summary: ''
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（src + test 全量）
    source: system
    exit_code: 0
    duration_ms: 3000
    output_summary: ''
  - command: npm test
    result: passed
    notes: 全量 917 passed / 0 failed / 2 skipped（40 文件全绿）。本机切 Node 22（v22.23.1，ABI 127）后 SQLite 子集（ISS-005）一并转绿——TASK-039 时 Node 24 下 42 failed 全部消失；对比 TASK-039 830 passed → 本任务 917 passed（+87：新增 ~45 用例 + SQLite 42 转绿）
    source: system
    exit_code: 0
    duration_ms: 26000
    output_summary: ''
global_update_requests:
  progress:
    - mode: replace
      section: 当前阶段
      content: |
        **serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~040；**TASK-040（真实验证 Runner + 路径越界审计 + 接入 ExecuteTaskUseCase）已完成，TASK-041（Run Journal Schema 与运行状态 Ports）可直接开跑**。
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
        - **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
        - **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
        - **serial-task-orchestration TASK-037**：抽取 `ExecuteTaskUseCase`——已完成。
        - **serial-task-orchestration TASK-038**：抽取 `ReviewTaskUseCase` + 共享 `FinalizeTaskUseCase`，CLI 降为 composition root——已完成。
        - **serial-task-orchestration TASK-039**：系统验证领域契约（ResultVerification 四元组 + VerificationRunnerPort + VerifyTaskUseCase + 三 core 纯规则）——已完成。
        - **serial-task-orchestration TASK-040**：infrastructure 落地 `ProcessVerificationRunner`（真实子进程 + 真实退出码/耗时/输出摘要 + 超时映射 + Windows taskkill /T /F 进程树清理）+ `WorktreeAdapter.listChangedFiles`（四类 Git 变更枚举）+ 新增 `WorkspaceInspectionPort` + `auditPaths` 纯函数（allowed 祖先/文件/glob + forbidden 优先）+ 接入 `ExecuteTaskUseCase`（可选注入，向后兼容）与 task-run——已完成。
        - 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。
    - mode: replace
      section: 当前系统可用能力
      content: |
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
    - mode: replace
      section: 后续任务必须知道的信息
      content: |
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
        - **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`（[i] 索引为 string | undefined，path-audit 用 charAt 规避）；application 层模块间跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环。
        - **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查/验证/工作区检查契约从 `src/application/execution/ports.ts` 导入。
        - **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。
    - mode: replace
      section: 建议下一个任务
      content: |
        **TASK-041**（定义 Run Journal Schema 与运行状态 Ports，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进）。TASK-040 已落地真实验证门禁（ProcessVerificationRunner + 路径审计 + 接入 ExecuteTaskUseCase）；TASK-041 起定义运行级显式状态（`.caw/runs/<run-id>.json` Run Journal Schema + RunJournalPort / OrchestrationLockPort，FR-027/FR-028/FR-029），为串行 Orchestrator（TASK-044）与崩溃恢复（TASK-048）提供持久检查点与单实例锁。
  decisions:
    - id: ""
      title: ExecuteTaskUseCase 路径审计与系统验证经可选 Port 注入，未注入保持原行为
      status: accepted
      scope: application/execution
      decision: |
        `ExecuteTaskPorts` 新增 `workspaceInspector?` 与 `verificationRunner?` 两个**可选**字段，`ExecuteTaskOutcome` 对应新增 `pathAudit?` / `systemVerification?`。任一 Port 未注入（undefined）即跳过对应阶段——状态映射回退到 TASK-037 的 `isProductAcceptable`（模型自报 verification）。CLI task:run 默认不注入（保持 DryRun / 既有 CLI 测试行为）；串行 Orchestrator（TASK-044）注入真实 Port 启用真实验证门禁。路径审计前显式排除 `workflow_outputs.result_file`（§3.2 默认允许写入，不计 allowed_paths）。
      rationale: |
        任务 §2「将系统验证和路径审计接入单任务执行用例与现有 task-run」要求接入，但 `execute-task.test.ts` 不在本任务 allowed_paths（不可改），且 DryRun 在临时仓库真实跑 npm run typecheck/test 会因无 package.json 失败。可选注入是唯一兼顾「接入能力」与「向后兼容既有测试 / DryRun CLI」的方式：未注入=零行为变化，注入=真实验证门禁生效。
      consequences: |
        ExecuteTaskUseCase 既有测试（不注入）零影响；CLI task:run 既有测试（不注入）零影响；新增 task-run 接入测试（注入 fake/真实 Port）验证路径审计 + 系统验证 + AC-010 模型自报被系统覆盖。串行 Orchestrator 注入真实 WorkspaceInspectionPort（WorktreeAdapter）+ ProcessVerificationRunner 即获得无人值守真实验证门禁。result_file 排除使 DryRun（只写 .result.md）不误判越界。
      created_from_task: TASK-040
    - id: ""
      title: ProcessVerificationRunner 跨平台超时映射与 Windows 进程树清理
      status: accepted
      scope: infrastructure/process
      decision: |
        `ProcessVerificationRunner` 经 `spawn(command, { shell: true, cwd: worktreePath, env: process.env })` 执行；退出码 0→passed、非 0→failed、超时→failed+exitCode=null+outputSummary 注明超时、spawn 失败→failed+exitCode=null+启动失败摘要。超时收口在 timer 内立即 `finish(null)`（不等 close 事件），避免 shell 模式孙进程持有 stdio 致 close 迟迟不触发、promise 卡死。Windows 用 `taskkill /pid <pid> /T /F` 杀整个进程树（含孙进程），解决 child.kill 只杀 shell 致孙进程孤儿占用 cwd（temp 目录 rmSync EBUSY）；POSIX 走 SIGTERM+300ms 后 SIGKILL（进程组隔离由生产容器保障）。stdout/stderr 各累计上限 16KB（超出截断标注），合并摘要再截断到 4KB。
      rationale: |
        任务 §12「命令字符串跨平台执行和进程中断容易产生僵尸进程；必须明确 shell、cwd、环境继承、终止和输出截断语义」+ §11「spawn 失败、非零退出和中断均显式返回」+ §8「输出必须设上限」。Windows shell 模式下 child.kill 无法清理孙进程是实测问题（超时测试 rmSync EBUSY），taskkill /T /F 是 Windows 杀进程树的标准手段；POSIX 进程组彻底清理需 detached + kill(-pid)，但 detached 让子脱离父，生产容器已有隔离，本任务先用 SIGTERM+SIGKILL 尽力（ISS-025 跟踪增强）。
      consequences: |
        真实退出码 / 耗时 / 摘要正确写入 verification 记录；超时映射稳定（Windows 测试 922ms 收口，不再 5s testTimeout）；输出上限避免巨型日志进入 result.verification。POSIX 下孙进程清理的彻底性留作 ISS-025（low，生产容器保障）。
      created_from_task: TASK-040
  issues:
    - id: ""
      title: POSIX 下 ProcessVerificationRunner 超时 kill 不杀孙进程，依赖容器进程组隔离
      status: open
      severity: low
      scope: infrastructure/process
      created_from_task: TASK-040
      owner: ""
      recommended_action: |
        Windows 已用 taskkill /T /F 杀进程树（已覆盖本机测试环境）。POSIX 下当前 SIGTERM+SIGKILL 仅杀 shell 直接进程，孙进程（真实命令）可能短暂孤儿。生产串行 Orchestrator 通常在容器内运行，进程组隔离由容器保障，影响有限。若需 POSIX 原生进程树清理，可后续用 `spawn({ detached: true })` + `process.kill(-pid)`（detached 让子成独立进程组），作为独立增强任务评估。
next_action: review
---

# TASK-040 执行结果 — 实现系统验证 Runner 与工作区路径越界审计

## 1. 执行结论

**completed**。按任务 §2 / §11 全量落地真实验证 Runner + 路径越界审计 + 接入单任务执行用例与 task-run：infrastructure `ProcessVerificationRunner`（真实子进程 + 真实退出码/耗时/输出摘要 + 超时映射 + Windows 进程树清理）；`WorktreeAdapter.listChangedFiles`（四类 Git 变更枚举）；application `WorkspaceInspectionPort` + `auditPaths` 纯函数（路径段比较 + glob + forbidden 优先）；`ExecuteTaskUseCase` 经可选 Port 注入路径审计 + 系统验证（向后兼容）。typecheck / lint 全绿，全量 test 917 passed / 0 failed。

## 2. 实现概述

**Infrastructure（外部系统适配，依赖倒置 implements application Port）：**
- `process/verification-runner.ts`（新）：`ProcessVerificationRunner implements VerificationRunnerPort`。`spawn(shell:true, cwd:worktreePath, env:process.env)`；退出码 0→passed / 非 0→failed；超时 timer 内 `finish(null)` 立即收口 + `killTree`（Windows `taskkill /T /F`，POSIX `SIGTERM+SIGKILL`）；spawn 失败 'error' 事件→failed+启动失败摘要；stdout/stderr 各 16KB 截断 + 摘要 4KB 截断。settled 守卫防 close 后续重复 resolve。
- `git/worktree-adapter.ts`：`WorktreeAdapter` 新增 `listChangedFiles(worktreePath)`——`git status --porcelain=v1 --untracked-files=all -z` 解析，覆盖 tracked/staged/unstaged/untracked/删除，rename 跳旧路径，结构满足 `WorkspaceInspectionPort`。

**Application（用例 + Port + 纯函数，只依赖 core + Port）：**
- `execution/ports.ts`：新增 `WorkspaceInspectionPort`（`listChangedFiles(worktreePath): string[]`，基础设施能力 Port 无 name）。
- `execution/path-audit.ts`（新）：`auditPaths` 纯函数 + `PathAuditInput` / `PathAuditOutcome` / `PathViolation`。normalizePath（反斜杠→正斜杠、去尾斜杠）+ isAncestorOrEqual（路径段比较）+ globToRegex（`*`/`**`/`?`）；forbidden 优先；结构化违规返回。路径工具与 `core/rules/permission-rules.ts` 同源独立实现（core 不在 allowed）。
- `execution/execute-task.ts`：`ExecuteTaskPorts` 增可选 `workspaceInspector` / `verificationRunner`；`ExecuteTaskOutcome` 增 `pathAudit` / `systemVerification`；新增私有 `auditAndVerify`（阶段 A 路径审计排除 result_file → 越界 blocked+needs-human+issue；阶段 B VerifyTaskUseCase 覆盖模型自报；阶段 C 写回 worktree .result.md）；execute 末尾状态映射（越界→transition blocked；否则按系统验证/模型自报 applyResult）。
- `execution/index.ts`：导出 path-audit.js。

**CLI（composition root wiring）：**
- `cli/commands/task-run.ts`：`TaskRunOptions` / `RunTaskWithAssemblyOptions` / `TaskRunOutcome` 增可选 `workspaceInspector` / `verificationRunner` / `pathAudit` / `systemVerification`；`runTask` wiring 注入 ExecuteTaskUseCase（未传入=undefined，跳过）；`runTaskWithAssembly` 透传。CLI action 不暴露这两选项（测试 / Orchestrator 注入用）。

## 3. 文件变更清单

**新建：** `src/application/execution/path-audit.ts`、`src/infrastructure/process/verification-runner.ts`、`test/application/execution/path-audit.test.ts`、`test/infrastructure/process/verification-runner.test.ts`、本 `.result.md`。
**修改：** execute-task / execution-ports / execution-index / worktree-adapter / infrastructure-index / task-run；worktree-adapter.test（+listChangedFiles 6 用例）/ task-run.test（+TASK-040 接入 6 用例 + fake 辅助）。
**未触碰（forbidden）：** core/state-machine、application/merge、infrastructure/sdk、infrastructure/sqlite、SPEC md。core/rules/permission-rules.ts 未改（路径工具在 path-audit 独立实现）。

## 4. 破坏式变化与迁移（§13 必须记录）

无 Schema 破坏式变化。`ExecuteTaskPorts` / `ExecuteTaskOutcome` / `TaskRunOptions` / `TaskRunOutcome` 新增字段均为**可选**，既有调用方（execute-task.test、task-run 既有测试、DryRun CLI）零迁移。`WorkspaceInspectionPort` 为新增接口，WorktreeAdapter 经结构类型满足（无需显式 implements）。

## 5. 验证结果

见 frontmatter `verification`（四命令全 passed，系统记录四元组写全）。关键覆盖（§11 验收）：
- 真实退出码 + 输出摘要写入记录（verification-runner 退出码 0/非零/异常 + stdout/stderr 采集）。
- spawn 失败（cwd 不存在）→ failed+exitCode=null+启动失败摘要。
- 超时 → failed+exitCode=null+摘要注明超时 + Windows 进程树清理（rmSync 不再 EBUSY）。
- changed-files 识别四类（tracked 修改/staged/untracked/删除）+ rename 跳旧路径 + 忽略 .gitignore + 路径含空格。
- allowed 祖先目录 / 具体文件 / glob（`**`/`*`/`?`）正反例 + 路径段比较（src/foo 不匹配 src/foo-bar）+ Windows 反斜杠规范化。
- forbidden 优先（即使同时落 allowed）。
- 模型自报 passed + 系统 failed → 以系统为准（AC-010，no_review blocked）。

## 6. 架构边界遵守

- **core 零反向依赖**：未改 core；path-audit 在 application 层独立实现路径工具（core 私有不可复用）。
- **application 只依赖 Port**：ExecuteTaskUseCase 依赖 `WorkspaceInspectionPort` / `VerificationRunnerPort`（execution/ports）+ VerifyTaskUseCase + auditPaths（同层），零 infra 实现类导入。
- **infrastructure 依赖倒置**：ProcessVerificationRunner import `application/execution/ports.ts` 契约类型（implements VerificationRunnerPort）；WorktreeAdapter 经结构满足 WorkspaceInspectionPort。不构成反向依赖。
- **未越界**：forbidden_paths（state-machine/merge/sdk/sqlite/SPEC）全部未触碰。

## 7. 与任务规格的偏差

无功能偏差。两点设计裁定已记 DEC-043 / DEC-044：
- 可选注入（而非默认强制启用真实验证）：任务要「接入」，但 execute-task.test 不可改 + DryRun 临时仓库跑真实验证会失败。可选注入兼顾接入与兼容（DEC-043）。
- Windows taskkill /T /F 杀进程树：任务 §12 要求「明确终止语义」，shell 模式孙进程孤儿是实测问题，taskkill 是 Windows 标准解；POSIX 留 ISS-025（DEC-044）。

## 8. 风险与遗留

- **POSIX 进程树清理（ISS-025，low）**：POSIX 下超时 kill 仅杀 shell 直接进程，孙进程清理依赖生产容器进程组隔离。Windows 已用 taskkill /T /F 覆盖（本机测试环境）。
- **CLI 默认不启用真实验证**：task:run 默认不注入 workspaceInspector / verificationRunner（DryRun 兼容）；真实验证门禁在串行 Orchestrator（TASK-044）注入真实 Port 后生效。
- **路径工具同源重复**：path-audit 的 normalizePath/isAncestorOrEqual 与 core/rules/permission-rules.ts 私有函数同源；日后 core 导出公共路径工具可统一（独立任务，非阻塞）。

## 9. 全局更新建议

见 frontmatter `global_update_requests`：progress 5 项 replace（当前阶段 / 完成到哪个任务 / 系统能力 / 后续必知 / 建议下一任务）；decisions 2 项（DEC-043 accepted 可选注入向后兼容 + result_file 排除 / DEC-044 accepted 跨平台超时映射 + Windows taskkill 进程树）；issues 1 项（ISS-025 low POSIX 进程组清理待增强）。

## 10. 下一步建议

**next_action: review**。下一个任务 **TASK-041**（Run Journal Schema + 运行状态 Ports）：定义 `.caw/runs/<run-id>.json` Run Journal Schema（FR-027）+ 原子写入（FR-028）+ RunJournalPort / OrchestrationLockPort（FR-029），为串行 Orchestrator（TASK-044）与崩溃恢复（TASK-048）提供持久检查点与单实例锁。TASK-041 done 后按拓扑序接 TASK-042（原子 Run Journal 仓储 + 运行锁实现）。
