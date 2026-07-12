---
doc: result
task_id: TASK-039
execution_status: completed
modified_files:
  - src/core/schemas/result-schema.ts
  - src/core/rules/verification-rules.ts
  - src/core/rules/permission-rules.ts
  - src/application/execution/ports.ts
  - src/application/execution/index.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - test/core/schemas/result-schema.test.ts
  - test/core/rules/verification-permission.test.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
created_files:
  - src/application/execution/verify-task.ts
  - test/application/execution/verify-task.test.ts
  - docs/tasks/TASK-039-core-system-verification-contract.result.md
deleted_files: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test 全量）；ResultVerification 四元组 optional 使历史夹具零迁移通过，新代码类型全绿
    source: model
    exit_code: null
    duration_ms: 0
    output_summary: ''
  - command: npm test -- result-schema verification-permission verify-task state-orchestrator
    result: passed
    notes: 4 文件 158 passed（verify-task 新增 13 + verification-permission 新增 16 + result-schema 新增 9 + state-orchestrator 33 既有）；覆盖 §11 全部验收（fake Runner passed/failed/skipped/退出码/超时、权限缺失不调 Runner、串行顺序、系统覆盖模型、门禁不再把 skipped 当通过）
    source: model
    exit_code: null
    duration_ms: 0
    output_summary: ''
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（src + test 全量）
    source: model
    exit_code: null
    duration_ms: 0
    output_summary: ''
  - command: npm test
    result: failed
    notes: 全量 830 passed / 42 failed / 2 skipped；42 failed 全在 3 个 SQLite 测试文件（status-rebuild / index-repo / schema），ISS-005 既有环境问题（better-sqlite3 需 Node 22 ABI 127，本机 Node 24），与本任务无关（SQLite / git / mcp / cli commands 均在 forbidden_paths 未触碰）。对比 TASK-038 的 792 passed → 本任务 830 passed（+38 新增用例测试），failed 42 不变、无回归
    source: model
    exit_code: null
    duration_ms: 0
    output_summary: ''
global_update_requests:
  progress:
    - mode: replace
      section: 当前阶段
      content: |
        **serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-039（core 系统验证记录 + VerificationRunnerPort + VerifyTaskUseCase）已完成，TASK-040（真实验证 Runner 与路径越界审计）可直接开跑**。
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
        - **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
        - **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
        - **serial-task-orchestration TASK-037**：抽取 `ExecuteTaskUseCase`——已完成。
        - **serial-task-orchestration TASK-038**：抽取 `ReviewTaskUseCase` + 共享 `FinalizeTaskUseCase`，CLI 降为 composition root——已完成。
        - **serial-task-orchestration TASK-039**：扩展 `ResultVerification`（source / exit_code / duration_ms / output_summary 系统验证四元组）+ 新增 `overlaySystemVerification` / `isVerificationGatePassed` / `validateAllowlistPermissions` core 纯规则 + 新增 `VerificationRunnerPort` + `VerifyTaskUseCase`（allowlist → 权限校验 → 串行 Runner → 系统覆盖模型 → 严格门禁）；SDK 适配器给模型自报记录标 source='model'，待系统 Runner（TASK-040）覆盖为 source='system'——已完成。
        - 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。
    - mode: replace
      section: 当前系统可用能力
      content: |
        - **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` / `task:review` 公开选项与退出行为不变（TASK-039 未接入 CLI，系统验证用例为后续 Orchestrator 预留）。
        - **分层**：`cli → application → core ← infrastructure`，infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
        - **执行/审查/验证契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` / `VerificationRunnerPort` + 输入输出 + §18 启动提示 + `ExecutorError`（TASK-036 / TASK-039）。
        - **单任务执行 / 审查 / 完成用例**：`ExecuteTaskUseCase` / `ReviewTaskUseCase` / `FinalizeTaskUseCase`（TASK-037 / TASK-038）。
        - **单任务系统验证用例**：`src/application/execution/verify-task.ts` 导出 `VerifyTaskUseCase` + `VerifyTaskPorts` / `VerifyTaskInput` / `VerifyTaskOutcome`（TASK-039）。计算 allowlist（复用 computeVerificationAllowlist）→ 批量校验 requires_permissions（缺失直接 blocked + needs-human，Runner 不调）→ 严格串行调 VerificationRunnerPort（allowlist 顺序）→ overlaySystemVerification（系统记录覆盖模型自报）→ isVerificationGatePassed（allowlist 命令系统记录必须全 passed）。供串行 Orchestrator（TASK-044）在 Executor 完成后调用。
        - **core 系统验证纯规则**：`overlaySystemVerification`（FR-011.5 同名系统记录覆盖模型自报）/ `isVerificationGatePassed`（FR-012 完成门禁，不再把 skipped 当通过）/ `validateAllowlistPermissions`（FR-011.3 批量权限校验，结构化 denied）。
        - **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
        - **测试**：`npm run typecheck && npm run lint` 全绿；`npm test` 全量 830 passed / 42 failed（全在 SQLite 子集，ISS-005 Node 版本约束）/ 2 skipped。
    - mode: replace
      section: 后续任务必须知道的信息
      content: |
        - **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
        - **四用例复用（TASK-037/038/039）**：单任务执行 / 审查 / 完成 / 系统验证编排分别收敛在 `ExecuteTaskUseCase` / `ReviewTaskUseCase` / `FinalizeTaskUseCase` / `VerifyTaskUseCase`（`src/application/execution/`）。串行 Orchestrator（TASK-044）应直接复用：经各自 Ports 注入依赖，串联 execute → verify → (done & no_review) finalize / execute → verify → review → (done) finalize，消费结构化 Outcome。
        - **ResultVerification 系统验证四元组（TASK-039/DEC-041）**：source / exit_code / duration_ms / output_summary 为 optional——兼容模型自报（模型无法知道真实退出码）与历史测试夹具（大量不在各任务可改范围）；**系统验证路径（VerifyTaskUseCase / SDK 真实执行）必须显式写全四元组**，不靠 optional 兜底。模型自报记录 source='model'，系统记录 source='system'，overlay 后系统记录覆盖同命令模型记录（FR-011.5）。
        - **完成门禁（TASK-039/DEC-042/FR-012）**：`isVerificationGatePassed` 只认 allowlist 命令的系统记录 result === 'passed'；任意 failed / skipped / 未执行 → blocked。no_review 任务至此不进入 done（必须全部必需验证 passed）。模型自报的 passed 不算数（门禁只看系统记录）。
        - **VerificationRunnerPort（TASK-039）**：application 只经此 Port 依赖验证执行能力，不感知子进程 / shell；真实实现（超时映射为 failed + exitCode=null + outputSummary 注明超时）由 TASK-040 在 infrastructure 落地。
        - **main / worktree 仓储显式区分（任务 §12）**：四用例均经 `taskRepo`（main，状态权威）维护 status，经 `openWorktreeRepo(wtPath)` 读 Executor 产出的 .result.md（尚未合并入 main）。不用路径判断隐式路由。
        - **合并回收单一入口（TASK-038/DEC-040/SPEC §20.4）**：合并包装 / 冲突登记 / 主工作区同步 / 全局回写只在 `FinalizeTaskUseCase` 一处实现。
        - **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
        - **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`；application 层模块间的跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环。
        - **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查/验证契约从 `src/application/execution/ports.ts` 导入。
        - **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。
    - mode: replace
      section: 建议下一个任务
      content: |
        **TASK-040**（真实验证 Runner 与路径越界审计，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进）。TASK-039 已落地系统验证领域契约（ResultVerification 四元组 + VerificationRunnerPort + VerifyTaskUseCase + 三 core 纯规则）；TASK-040 起 在 infrastructure 实现 VerificationRunnerPort 的真实子进程执行（采集真实退出码 / 耗时 / 输出摘要 + 超时映射）与 Git diff 路径越界审计（FR-039 / AC-011），为串行 Orchestrator（TASK-044）提供真实验证门禁与路径边界硬校验。串行 Orchestrator 实现时经四用例（Execute/Verify/Review/Finalize）注入 Ports 串联完整单任务闭环。
  decisions:
    - id: ""
      title: ResultVerification 系统验证四元组采用 optional 兼容模型自报与历史夹具
      status: proposed
      scope: core/schemas
      decision: |
        `ResultVerification` 新增 source / exit_code / duration_ms / output_summary 四元组为 optional（z.infer 上字段可选）。系统验证路径（VerifyTaskUseCase / SDK 真实执行）显式写全四元组，并由专项测试覆盖；optional 仅服务于模型自报（模型无法知道真实退出码）与历史测试夹具（大量 { command, result, notes } 字面量不在各任务可改范围）。
      rationale: |
        任务 §12 字面反对「宽泛 optional 隐藏缺失字段」，但本任务 allowed_paths 仅列 8 个测试文件，而 execute-task.test.ts / review-task.test.ts / finalize-task.test.ts / claude-sdk-reviewer.test.ts / status-rebuild.test.ts / task-doc-repo.test.ts / index-repo.test.ts 等均构造 { command, result, notes } 字面量且不在本任务可改范围。若四元组在 z.infer 上必填（default / nullable 均使 output 类型必有），这些不可改测试文件会编译失败、typecheck 红线。optional 是 allowed_paths 约束下的唯一兼容方式。
      consequences: |
        旧三字段字面量仍合法（模型产出 JSON 与历史夹具零迁移）；系统验证记录的完整性由 VerifyTaskUseCase 构造时显式写全 + verify-task.test.ts / result-schema.test.ts 专项覆盖保证，不依赖 optional 兜底。模型自报记录经 normalizeModelVerification（invocation-impl）统一标 source='model'，系统记录标 source='system'，overlay 后同名系统记录覆盖模型记录。后续若历史夹具全部迁移完毕，可考虑收紧为必填（独立任务）。
      created_from_task: TASK-039
    - id: ""
      title: 完成门禁只认 allowlist 命令的系统记录 result===passed
      status: accepted
      scope: core/rules
      decision: |
        `isVerificationGatePassed`（core/rules/verification-rules.ts）的完成门禁：allowlist 每条命令在系统记录中必须 result === 'passed'；任意 failed / skipped / 未执行（无系统记录）均返回 ok:false。门禁只看系统记录（source='system'），模型自报的 passed 不参与门禁。
      rationale: |
        FR-012「任一必需验证失败时不得合并」+ §11 验收「未执行命令不能伪装 passed」「no_review 接受规则不再把任意 skipped 当作通过」。旧 isProductAcceptable（execute-task / state-orchestrator）把 skipped 当通过（verification.every(v => v.result !== 'failed')），不足以支撑无人值守门禁；新门禁保守地只接受 passed，skipped 的合法/非法区分留给后续精细化（当前 skipped 在权限缺失/超时映射路径出现，本就应 blocked）。
      consequences: |
        VerifyTaskUseCase 门禁不通过即 blocked + needs-human + 提议 ISSUES 项；no_review 任务必须有全部必需验证系统记录 passed 才进 done。旧 isProductAcceptable 保持不变（处理模型自报的 CLI 旧路径），新门禁由系统验证用例承担，串行 Orchestrator 接入后生效。
      created_from_task: TASK-039
  issues: []
next_action: review
---

# TASK-039 执行结果 — 定义系统验证记录与验证 Application 用例

## 1. 执行结论

**completed**。已按任务 §2 / §11 全量落地 core 系统验证领域契约：扩展 `ResultVerification` 表达来源 / 真实退出码 / 耗时 / 输出摘要；新增 `VerificationRunnerPort`（application 窄接口，不含 shell / 子进程细节）；新增 `VerifyTaskUseCase`（计算 allowlist → 校验 requires_permissions → 顺序调 Runner → 系统覆盖模型 → 严格门禁）；规定系统记录覆盖同命令模型自报；明确 no_review 门禁只认系统记录 passed。typecheck / lint 全绿，任务子集 158 passed，全量无回归。

## 2. 实现概述

**Core（领域规则 + Schema，零反向依赖）：**
- `result-schema.ts`：新增 `VerificationSourceSchema`（model / system）；`ResultVerificationSchema` 扩展 source / exit_code（int|null）/ duration_ms（int>=0）/ output_summary 四元组（optional，DEC-041）。
- `verification-rules.ts`：新增 `overlaySystemVerification(modelRecords, systemRecords)`（FR-011.5 同名系统记录覆盖模型自报，未覆盖的模型记录保留供审计）+ `isVerificationGatePassed(allowlist, systemRecords)`（FR-012 完成门禁，allowlist 命令系统记录必须全 passed，DEC-042）。type-only 引 `ResultVerification`，不引入运行时 zod。
- `permission-rules.ts`：新增 `validateAllowlistPermissions(allowlist, taskPermissions)`（FR-011.3 批量校验，返回结构化 denied 清单）+ `DeniedCommand` / `AllowlistPermissionResult` 类型。

**Application（用例 + Port，只依赖 core + Port）：**
- `ports.ts`：新增 `VerificationRunnerPort` + `VerificationRunnerInput` / `VerificationRunnerResult`（FR-011.4 真实退出码 / 耗时 / 输出摘要；超时由实现映射为 failed + exitCode=null）。只定义契约，不提供子进程实现（§7）。
- `verify-task.ts`（新）：`VerifyTaskUseCase.verify(input)` —— computeVerificationAllowlist → validateAllowlistPermissions（缺失直接 blocked + needs-human，Runner 不调，§11）→ 严格串行 await runner.run（allowlist 顺序）→ overlaySystemVerification → isVerificationGatePassed。产出结构化 `VerifyTaskOutcome`（status / nextAction / verification / deniedCommands / proposedIssues / failureReason）。blocked 时提议 ISSUES 项（id 留空）。
- `execution/index.ts`：导出 verify-task.js。

**Infrastructure（SDK 报告映射适配，依赖倒置 import ports 契约类型）：**
- `claude-sdk-adapter.ts`：DryRunLocalExecutor 的占位 verification 显式写全四元组（source='model' + 空值）。
- `claude-sdk-invocation-impl.ts`：degradedReport 降级记录写全四元组（source='model'）；`normalizeModelVerification` 把模型自报记录统一标 source='model' + 补默认空值（模型不得自报 source='system' 伪造系统验证）；JSON 产出契约指令说明系统验证字段由系统补全。

## 3. 文件变更清单

**新建：** `src/application/execution/verify-task.ts`、`test/application/execution/verify-task.test.ts`、本 `.result.md`。
**修改：** core 的 result-schema / verification-rules / permission-rules；application 的 ports / execution-index；infrastructure 的 claude-sdk-adapter / claude-sdk-invocation-impl；测试 result-schema / verification-permission / claude-sdk-adapter。
**未触碰（forbidden）：** src/infrastructure/git、sqlite、mcp；src/cli/commands；SPEC md。execute-task / review-task / finalize-task / state-orchestrator 仅读 `v.result`，类型变更兼容（optional），未改其逻辑。

## 4. 破坏式变化与迁移（§13 必须记录）

**ResultVerification 结构扩展（破坏式 Schema 变化）：** 新增四个 optional 字段。迁移策略——
- **模型产出 JSON（claude-sdk-invocation-impl SdkResultJsonSchema）**：复用 ResultVerificationSchema，新字段 optional 使模型只产 command/result/notes 即可通过；normalizeModelVerification 补全 source='model' + 空值。
- **历史测试夹具**：`{ command, result, notes }` 三字段字面量因 optional 零迁移通过（typecheck 全绿验证）。包括不在本任务 allowed_paths 的 execute-task.test / review-task.test / finalize-task.test / claude-sdk-reviewer.test / status-rebuild.test / task-doc-repo.test / index-repo.test / claude-sdk-real-api.test 等。
- **本任务显式迁移到新结构的夹具**：result-schema.test（新增四元组 schema 行为）、verification-permission.test（overlay/gate/allowlist-permission 新增用例）、claude-sdk-adapter.test（DryRun toEqual 含四元组）、verify-task.test（系统记录完整四元组）。
- **SDK 适配器构造点**：DryRunLocalExecutor / degradedReport / normalizeModelVerification 全部显式写全四元组（不靠 optional 兜底，§12 系统路径完整）。

未使用 `as unknown` 或 default 隐藏缺失字段（§12）——四元组在 z.infer 上为可选（`field?: T`），系统验证路径显式写全 + 测试覆盖。

## 5. 验证结果

见 frontmatter `verification`。任务 `verification` 声明三命令（typecheck / 子集 test / lint）全部 passed；全量 test 的 42 failed 全在 SQLite 子集（ISS-005，pre-existing，本任务 forbidden 未触碰 SQLite）。

## 6. 架构边界遵守

- **core 零反向依赖**：verification-rules.ts / permission-rules.ts 仅 type-only 引 core 同层（enums + schemas），不引入运行时 zod，不依赖 application/infrastructure。
- **application 只依赖 Port**：verify-task.ts 依赖 core 规则 + `VerificationRunnerPort`，零 infrastructure 实现类导入。
- **infrastructure 依赖倒置**：SDK adapter import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038 既有模式），不构成反向依赖。
- **未越界**：forbidden_paths（git/sqlite/mcp/cli commands/SPEC）全部未触碰。

## 7. 与任务规格的偏差

无功能偏差。唯一张力是 §12「不能宽泛 optional」——本任务用 optional 四元组调和（DEC-041），原因：allowed_paths 仅 8 个测试文件，大量构造 ResultVerification 字面量的测试不在可改范围，必填会致 typecheck 红线。系统路径完整性由显式构造 + 专项测试保证，optional 仅兼容模型产出与历史夹具。

## 8. 风险与遗留

- **skipped 合法性未精细化**：门禁保守地把所有 skipped 当不通过（DEC-042）。FR-012「skipped 只在命令声明明确不适用时才合法」的精细化区分（合法 skipped 放行 vs 规避失败的 skipped 拒绝）留给后续任务；当前 skipped 仅在权限缺失 / 超时映射路径出现，本就应 blocked。
- **VerifyTaskUseCase 未接入 CLI / Orchestrator**：本任务只定义用例与契约（§7 不实现串行循环），CLI 路径仍走旧 isProductAcceptable；系统验证门禁在 TASK-044 Orchestrator 接入后生效。
- **真实 Runner 未实现**：VerificationRunnerPort 只定义契约，真实子进程执行（含超时映射）由 TASK-040 落地。

## 9. 全局更新建议

见 frontmatter `global_update_requests`：progress 5 项 replace（当前阶段 / 完成到哪个任务 / 系统能力 / 后续必知 / 建议下一任务）；decisions 2 项（DEC-041 proposed optional 兼容权衡 / DEC-042 accepted 门禁只认系统记录 passed）；issues 无新增。

## 10. 下一步建议

**next_action: review**。下一个任务 **TASK-040**（真实验证 Runner + 路径越界审计）：在 infrastructure 实现 VerificationRunnerPort 真实子进程执行（采集真实退出码 / 耗时 / 输出摘要 + 超时映射 failed），并实现 Git diff 路径越界审计（FR-039 / AC-011，allowed/forbidden 硬校验）。TASK-040 done 后按拓扑序接 TASK-041（Run Journal Schema）。
