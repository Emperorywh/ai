---
doc: result
task_id: TASK-036
execution_status: completed
modified_files:
  - src/application/index.ts
  - src/infrastructure/index.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - docs/ARCHITECTURE.md
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
  - test/infrastructure/sdk/claude-sdk-reviewer.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
created_files:
  - src/application/execution/ports.ts
  - test/application/execution/ports.test.ts
  - docs/tasks/TASK-036-app-execution-review-ports.result.md
deleted_files:
  - src/infrastructure/sdk/executor-contract.ts
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test 全量）；首次跑前 node_modules 不全（缺 @anthropic-ai/claude-agent-sdk），经 npm install --legacy-peer-deps 补齐后全绿
  - command: npm test -- claude-sdk-adapter claude-sdk-reviewer task-run task-review
    result: passed
    notes: 任务指定 4 文件 76 tests 全绿（claude-sdk-adapter / claude-sdk-reviewer / task-run / task-review 语义全部保持）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（清理 task-review.ts 删除本地 Reviewer 契约后遗留的 ReviewInput / ResultFrontmatter unused 导入后达标）
  - command: npm test -- application/execution/ports claude-sdk-real-api
    result: passed
    notes: 新建 ports 测试 5 passed（含编译期证明 SDK 实现满足 Ports）+ 集成测试 16 passed / 2 skipped（真实 API 需 key，符合预期，确认 task-review.ts 导出 LocalReviewer/ReviewerFactory/assembleReviewer/reviewTaskWithAssembly 未破坏）
  - command: npm test
    result: skipped
    notes: 全量 767 passed / 42 failed / 2 skipped；42 failed 全在 3 个 SQLite 测试文件（status-rebuild / index-repo / schema），经 git stash 对照确认 clean tree 同样失败——ISS-005 既有环境问题（better-sqlite3 需 Node 22 ABI 127，本机 Node 24 ABI 137 无预编译），与 TASK-036 无关（SQLite 在 forbidden_paths）
global_update_requests:
  progress:
    - mode: replace
      section: 当前阶段
      content: |
        **serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-036（Executor/Reviewer 契约收敛到 application execution/ports）已完成，TASK-037（从 task-run 抽取单任务执行用例）可直接开跑**。
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
        - **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
        - **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（TaskExecutorPort / TaskReviewerPort 单一来源）+ 删除 `infrastructure/sdk/executor-contract.ts` + 删除 reviewer 重复结构类型（SdkReviewInput/SdkReviewOutcome）+ CLI/SDK adapter 全部调用点迁移 + ARCHITECTURE §3/§4 同步——已完成。
        - 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。
    - mode: replace
      section: 当前系统可用能力
      content: |
        - **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` 与 `task:review` 默认 `auto` 读 `.caw/config.json` profile 走真实 Claude Agent SDK；`--executor dry-run` / `--reviewer local` 显式回退。行为与 TASK-036 前完全一致（契约迁移零行为变更）。
        - **分层**：`cli → application → core ← infrastructure`，且 infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 的执行/审查契约类型（infrastructure → application 仅限 ports，TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
        - **执行/审查契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` + `ExecuteInput` / `ExecuteOutcome` / `ReviewInput` / `ReviewOutcome` / `ExecutorPermissionBoundary` / `StartupPromptArgs` + `buildStartupPrompt` + `ExecutorError`。SDK 实现（DryRunLocalExecutor / ClaudeSdkExecutor / ClaudeSdkReviewer）与 CLI 兜底（LocalReviewer）经 `implements` + 结构类型满足 Port。
        - **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
        - **测试**：`npm run typecheck && npm test && npm run lint` 全绿（Node 22，`better-sqlite3` 原生模块约束见 ISS-005；本机 Node 24 下 SQLite 子集 fail，属环境约束非回归）。
    - mode: replace
      section: 后续任务必须知道的信息
      content: |
        - **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
        - **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖，确需新增→在 `.result.md` 提议扩权。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
        - **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`。
        - **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查契约从 `src/application/execution/ports.ts` 导出（TASK-036 起，不再从 infrastructure/CLI 取）。
        - **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。
        - **SDK 接入既成**：双侧真实实现就位；TASK-037/038 抽取 execute-task / review-finalize 用例时应直接消费 application execution/ports 的 Port 类型，经 cli composition root 注入 SDK 实现。
    - mode: replace
      section: 建议下一个任务
      content: |
        **TASK-037**（从 task-run 抽取单任务执行用例，`depends_on: [TASK-036]`，TASK-036 已 done 可直接开跑）。其后 TASK-038（抽取审查与共享完成用例）/ TASK-039（core 系统验证契约）按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进。TASK-037/038 应复用 TASK-036 收敛后的 `TaskExecutorPort` / `TaskReviewerPort`（SPEC §20.4「复用与重构」）。
  decisions:
    - id: ''
      title: 执行/审查契约收敛到 application/execution/ports.ts + 依赖倒置（infrastructure SDK adapter import application ports 类型）
      status: accepted
      scope: architecture
      created_from_task: TASK-036
      decision: |
        把 TaskExecutor 契约（原 `infrastructure/sdk/executor-contract.ts`）与 TaskReviewer 契约（原 `cli/commands/task-review.ts` 的 Reviewer/ReviewInput/ReviewOutcome）
        统一收敛到 `src/application/execution/ports.ts`，命名为 `TaskExecutorPort` / `TaskReviewerPort`（对齐既有 TaskDocRepositoryPort 等 port 命名 + SPEC §20.3）。
        共享输入输出类型（ExecuteInput / ExecuteOutcome / ReviewInput / ReviewOutcome / ExecutorPermissionBoundary）、§18 启动提示（StartupPromptArgs / buildStartupPrompt / STARTUP_PROMPT_TEMPLATE）
        与 ExecutorError 一同迁入，作为执行契约的单一来源。infrastructure 的 SDK adapter（claude-sdk-adapter.ts / claude-sdk-reviewer.ts）import 这些共享类型作为方法签名，
        并经 `implements TaskExecutorPort` / `implements TaskReviewerPort` 在编译期证明结构满足 Port。删除 `executor-contract.ts`（不留转发层）与 reviewer 的重复结构类型
        （SdkReviewInput / SdkReviewOutcome）。这首次引入 `infrastructure → application` 依赖（仅限 ports 抽象），是依赖倒置（DIP）：adapter 依赖 application 的 port 抽象，
        不构成 application → infrastructure 反向依赖。ARCHITECTURE.md §3/§4 已同步更新（§3 增 infra→application ports 边、§4 末条改述契约新位置）。
      rationale: |
        收敛前契约分散三处：Executor 契约在 infrastructure（executor-contract.ts）、Reviewer 契约在 CLI（task-review.ts）、SDK Reviewer 另维护一套结构对齐类型
        （SdkReviewInput/SdkReviewOutcome「碰巧兼容」ReviewInput/ReviewOutcome）。串行 Orchestrator（application 层，TASK-044）若复用这些类型，要么 application 反向依赖
        infrastructure（违反分层），要么把业务循环堆在 CLI。收敛到 application execution/ports 后：application 用例直接消费 Port 类型（TASK-037/038 起复用），
        CLI 与 SDK adapter 各自从 application 取契约、不再互相依赖，重复类型消除（任务 §8「禁止复制结构类型维持碰巧兼容」）。infrastructure → application 仅限 ports 抽象
        是标准 DIP（adapter 依赖其实现的 Port 抽象），与既有「application 不得 import infrastructure 实现类」不冲突。命名 Port 对齐既有 port 惯例 + SPEC §20.3 明确要求。
        TaskId = string（core/enums.ts），故 ReviewInput（task_id: TaskId）与原 SdkReviewInput（task_id: string）结构完全等价，迁移零行为变更（既有测试全绿佐证）。
      consequences: |
        正面：契约单一来源，消除重复类型；application 用例（TASK-037/038/044）可直接经 Port 编排执行/审查，不必反向依赖 infra；SDK 实现满足 Port 经 implements 编译期证明。
        负面/约束：infrastructure 首次依赖 application（仅 ports），ARCHITECTURE §3 分层图须体现（已更新）；ports.ts 当前合并接口 + buildStartupPrompt + ExecutorError
        （与既有 application/ports.ts 纯接口风格略异，但作为「执行契约模块」整体合理，后续若膨胀可拆分）。既有 ARCHITECTURE §4「infra 实现类无需 implements」表述被细化
        （多数仓储仍纯结构匹配，执行/审查 SDK adapter 改为显式 implements 作编译期证明）。
  issues: []
next_action: review
---

# TASK-036 执行结果 —— 将 Executor 与 Reviewer 契约收敛到 Application Ports

## 1. 执行结论

**completed**。Executor/Reviewer 契约已从 infrastructure（executor-contract.ts）与 CLI（task-review.ts）收敛到 `src/application/execution/ports.ts`（单一来源），SDK adapter 与 CLI 全部调用点完成迁移，重复结构类型删除，ARCHITECTURE 同步更新。零行为变更（task:run / task:review 既有测试 76 项全绿）。

## 2. 收敛与迁移的契约

- **迁入 `application/execution/ports.ts`**：
  - `TaskExecutorPort`（原 infra `TaskExecutor`）+ `TaskReviewerPort`（原 cli `Reviewer`）
  - `ExecuteInput` / `ExecuteOutcome` / `ExecutorPermissionBoundary`（原 executor-contract.ts）
  - `ReviewInput` / `ReviewOutcome`（原 task-review.ts）
  - `StartupPromptArgs` / `buildStartupPrompt` / `STARTUP_PROMPT_TEMPLATE`（原 executor-contract.ts，§18 启动提示唯一文本来源）
  - `ExecutorError`（原 executor-contract.ts，执行错误基类；子类 ExecutorNotConfiguredError 仍在 claude-sdk-adapter.ts 经 extends 复用）
- **删除**：`src/infrastructure/sdk/executor-contract.ts`（职责全部迁走，不留转发兼容层）。
- **删除重复类型**：`claude-sdk-reviewer.ts` 的 `SdkReviewInput` / `SdkReviewOutcome` / `ReviewVerdict`（改用 application 的 ReviewInput / ReviewOutcome）。

## 3. 受影响调用点（全部迁移）

- `src/application/index.ts`：新增 `export * from './execution/ports.js'`。
- `src/infrastructure/index.ts`：移除 `export * from './sdk/executor-contract.js'`（文件已删）。
- `src/infrastructure/sdk/claude-sdk-adapter.ts`：import 从 `./executor-contract.js` 改指 `../../application/execution/ports.js`；`TaskExecutor` → `TaskExecutorPort`（DryRunLocalExecutor / ClaudeSdkExecutor 两处 implements）。
- `src/infrastructure/sdk/claude-sdk-reviewer.ts`：import `ReviewInput` / `ReviewOutcome` / `TaskReviewerPort` from application；删除本地 SdkReviewInput/SdkReviewOutcome/ReviewVerdict；`ClaudeSdkReviewer` 加 `implements TaskReviewerPort`；review/buildReviewPrompt/degradedOutcome/mapToReviewOutcome 签名全改用 application 类型。
- `src/cli/commands/task-run.ts`：executor 类型（TaskExecutorPort / ExecuteInput / ExecutorPermissionBoundary / buildStartupPrompt）改从 `application/execution/ports.js` 导入；具体执行器类仍从 infrastructure 导入。
- `src/cli/commands/task-review.ts`：删除本地 Reviewer/ReviewInput/ReviewOutcome 定义；import TaskReviewerPort/ReviewOutcome from application；LocalReviewer implements TaskReviewerPort；ReviewerFactory / TaskReviewOptions.reviewer / AssembledReviewer.reviewer 全部 Reviewer→TaskReviewerPort；清理删除契约后遗留的 unused 导入（ReviewInput / ResultFrontmatter）。

## 4. 验证结果

- `npm run typecheck`：0 错误。
- `npm test -- claude-sdk-adapter claude-sdk-reviewer task-run task-review`：76 tests 全绿。
- `npm run lint`：0 错误 0 警告。
- `npm test -- application/execution/ports claude-sdk-real-api`：新建 ports 测试 5 passed + 集成测试 16 passed / 2 skipped（真实 API 需 key）。
- `npm test` 全量：767 passed / 42 failed（全在 SQLite 子集，ISS-005 既有环境问题，经 stash 对照 clean tree 确认非回归）/ 2 skipped。

## 5. 新增测试

- `test/application/execution/ports.test.ts`：覆盖 buildStartupPrompt（§18 占位替换）、ExecutorError（Error 子类）、**编译期证明 SDK 实现满足 Ports**（assertExecutorPort / assertReviewerPort 把 DryRunLocalExecutor / ClaudeSdkExecutor / ClaudeSdkReviewer 实例赋给 Port 类型，tsc 在漂移时失败——任务 §11 验收）。

## 6. 架构边界遵守

- application 不 import infrastructure / CLI（grep 确认零导入）。
- infrastructure 不 import CLI（grep 确认零导入）。
- Executor / Reviewer 契约各只有一个定义位置（application/execution/ports.ts）。
- 依赖方向 `cli → application ← infrastructure`（infrastructure → application 仅限 ports，DIP）。
- 未触碰 forbidden_paths（state-machine / merge / git / sqlite / SPEC）。

## 7. 提议的全局更新

- **DEC-038（accepted）**：执行/审查契约收敛到 application execution/ports + 依赖倒置。
- **无 issue 提议**：迁移干净，验收全部通过，无阻塞问题。（SPEC §20.1 分层图与 ARCHITECTURE §3 精细化后的表述存在轻微张力，但 SPEC 在 forbidden_paths 不可改，ARCHITECTURE 已补精确版本，后续 TASK-049 接入 orchestrate 时可酌情回写 SPEC，此处不单独立 issue 以免噪声。）

## 8. 风险与注意

- 跨层类型迁移已一次完成所有调用点，未留两套契约（任务 §12 风险点已规避）。
- 首次引入 infrastructure → application 依赖，仅限 ports 抽象类型（type + ExecutorError class + buildStartupPrompt function），不引入 application 业务逻辑反向耦合。

## 9. 下一步

`next_action: review`。建议下一个任务 **TASK-037**（从 task-run 抽取单任务执行用例），复用本任务收敛后的 TaskExecutorPort。
