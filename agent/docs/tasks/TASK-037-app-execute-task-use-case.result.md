---
doc: result
task_id: TASK-037
execution_status: completed
modified_files:
  - src/application/index.ts
  - src/cli/commands/task-run.ts
created_files:
  - src/application/execution/execute-task.ts
  - src/application/execution/index.ts
  - test/application/execution/execute-task.test.ts
deleted_files: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test 全量）；ExecuteTaskUseCase 经具体模块导入 StateOrchestrator/computeContextPack 消除循环依赖后全绿
  - command: npm test -- execute-task task-run
    result: passed
    notes: 新增 execute-task 用例测试 10 passed（fake Ports 内存覆盖完整执行链，无 Git/SDK）+ task-run CLI 测试 23 passed（抽取后公开行为与合并行为零回归）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（迁出后清理了 buildPermissionBoundary/isProductAcceptable 等已删函数与未用 import）
  - command: npx vitest run test/cli/task-review.test.ts
    result: passed
    notes: task-review 13 passed（forbidden 路径未触碰；确认 application/index 改 execution 导出后无连带破坏）
  - command: npm test
    result: failed
    notes: 全量 777 passed / 42 failed / 2 skipped；42 failed 全在 3 个 SQLite 测试文件（status-rebuild / index-repo / schema），ISS-005 既有环境问题（better-sqlite3 需 Node 22 ABI 127，本机 Node 24），与本任务无关（SQLite 在本任务未触碰）。对比 TASK-036 的 767 passed → 本任务 777 passed（+10 新增用例测试），failed 42 不变、无回归
global_update_requests:
  progress:
    - mode: replace
      section: 当前阶段
      content: |
        **serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-037（从 task-run 抽取单任务执行用例 ExecuteTaskUseCase）已完成，TASK-038（抽取审查与共享完成用例）可直接开跑**。
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
        - **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
        - **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
        - **serial-task-orchestration TASK-037**：从 `cli/commands/task-run.ts` 抽取 `ExecuteTaskUseCase` 到 `src/application/execution/execute-task.ts`（依赖检查 / Context Pack 刷新 / 权限边界 / ready→running / worktree / R7 / Executor / 读 result / applyResult 状态映射全部迁入用例；CLI 降为 composition root 装配 + done 路径合并回收；合并留 CLI 待 TASK-038）——已完成。
        - 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。
    - mode: replace
      section: 当前系统可用能力
      content: |
        - **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` 公开选项与退出行为不变（TASK-037 抽取为零行为变更，23 项 CLI 测试全绿）；执行阶段领域编排自 TASK-037 起委托 `ExecuteTaskUseCase`。
        - **分层**：`cli → application → core ← infrastructure`，且 infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
        - **执行/审查契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` + 输入输出 + §18 启动提示 + `ExecutorError`（TASK-036）。
        - **单任务执行用例**：`src/application/execution/execute-task.ts` 导出 `ExecuteTaskUseCase` + `ExecuteTaskPorts` / `ExecuteTaskInput` / `ExecuteTaskOutcome`（TASK-037）。用例只依赖 core + Ports（TaskDocRepositoryPort / WorktreePort / TaskExecutorPort + openWorktreeRepo / prepareWorktree 注入），经 composition root wiring 注入；为串行 Orchestrator（TASK-044）提供稳定、可测试的单任务执行入口。
        - **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
        - **测试**：`npm run typecheck && npm run lint` 全绿；`npm test` 全量 777 passed / 42 failed（全在 SQLite 子集，ISS-005 Node 版本约束）/ 2 skipped。
    - mode: replace
      section: 后续任务必须知道的信息
      content: |
        - **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
        - **执行用例复用（TASK-037/DEC-039）**：单任务执行编排收敛在 `ExecuteTaskUseCase`（`src/application/execution/execute-task.ts`）。TASK-038（审查与共享完成用例）/ TASK-044（串行 Orchestrator）应直接复用：经 `ExecuteTaskPorts` 注入依赖、调 `useCase.execute({ taskId, mainRef, testingCommands })`，消费 `ExecuteTaskOutcome`（finalStatus / worktreePath / task / result）。用例**不负责 review 与最终合并**——合并回收当前仍由 CLI composition root 承接，TASK-038 应把「合并包装 + 冲突登记 + 主工作区同步 + 全局回写」抽取为共享 Finalize 用例（SPEC §20.4），CLI 与 Orchestrator 共用。
        - **main / worktree 仓储显式区分（任务 §12）**：ExecuteTaskUseCase 经 `taskRepo`（main，状态权威）维护 status，经 `openWorktreeRepo(wtPath)` 读 Executor 产出的 .result.md（尚未合并入 main），不用路径判断隐式路由。
        - **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
        - **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`；application 层模块间的跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环（execute-task.ts → state-orchestrator.js / context-pack-generator.js）。
        - **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查契约从 `src/application/execution/ports.ts` 导入（TASK-036 起）。
        - **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。
    - mode: replace
      section: 建议下一个任务
      content: |
        **TASK-038**（抽取单任务审查与共享完成用例，`depends_on: [TASK-037]`，TASK-037 已 done 可直接开跑）。应把 task:review 的审查编排抽成 `ReviewTaskUseCase`，并把 TASK-037 留在 CLI 的「合并回收」（rebase-ff + section 回写 + 主工作区同步 + 冲突登记 ISSUES）抽取为共享 `FinalizeTaskUseCase`，供 task:run / task:review / 串行 Orchestrator 复用（SPEC §20.4「复用与重构」）。其后 TASK-039（core 系统验证契约）按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进。
  decisions:
    - id: ''
      title: 抽取 ExecuteTaskUseCase 单任务执行用例；review 与最终合并暂留 CLI composition root（待 TASK-038 共享 Finalize）
      status: accepted
      scope: architecture
      created_from_task: TASK-037
      decision: |
        把 `cli/commands/task-run.ts` 中可复用的单任务执行领域编排（依赖前置检查、Context Pack 刷新与回写、权限边界组装、ready→running、worktree 创建、R7 工作区准备、§18 启动提示 + Executor 调用、读 .result.md、applyResult 状态映射）抽取到 `src/application/execution/execute-task.ts` 的 `ExecuteTaskUseCase`。
        用例只依赖 core 领域原语 + application Ports：`taskRepo`（main 仓储，状态权威）、`worktree`（WorktreePort）、`executor`（TaskExecutorPort）、`openWorktreeRepo`（在 worktree 路径打开仓储读 result）、`prepareWorktree`（R7 工作区准备）。main 仓储与 worktree 仓储在 Ports 层显式区分（任务 §12 风险点），状态流转写 main、产物从 worktree 读。用例内部组合 `StateOrchestrator` / `computeContextPack` / `refreshSourceFiles` / `resolvePathScope` / `computeVerificationAllowlist`，全部复用现有领域能力。
        CLI `task:run` 降为 composition root：装配 `ExecuteTaskPorts`（infrastructure 实现 wiring）、解析 testingCommands、承接 done 路径的合并回收（rebase-ff + 全局回写 + 主工作区同步 + 冲突→blocked+ISSUES）与 provider/observability 组装。
        **review 与最终合并不在本任务用例范围**（任务 §2 / §9 明确「不负责 review 和最终合并」）：合并回收当前仍由 CLI composition root 承接，待 TASK-038 抽取为共享 Finalize 用例（SPEC §20.4），使 task:run / task:review / 串行 Orchestrator 三处共用同一合并实现，不复制第三套。
      rationale: |
        串行 Orchestrator（application 层，TASK-044）不能依赖 CLI command，必须先有 application 层的可复用执行入口。抽取前 runTask 同时承担「执行阶段编排」+「合并回收」+「composition root 装配」三类职责（任务 §1），顶层 Orchestrator 若直接复用会引入 application→cli 反向依赖或把循环堆在 CLI。
        按 SPEC §9 数据流「TaskDoc → 依赖 → Context Pack → ready→running → Worktree → Executor → ResultDoc → 状态映射」切分执行阶段为单一用例，返回结构化 `ExecuteTaskOutcome`（finalStatus / worktreePath / 刷新后的 task / 读到的 result），使后续合并阶段（CLI 或 TASK-038 Finalize）能基于结构化结果继续，无需重新读取或二次推导。
        合并回收暂留 CLI 而非本任务一并抽取，是因为任务 §2/§7 明确本任务不负责 review 与最终合并，且 SPEC §20.4 把「合并包装 / 冲突登记 / 主工作区同步 / 全局回写」归为 TASK-038 的共享 Finalize 范围（需同时供 task:review 复用）。本任务只切执行阶段，不越界到审查/合并，保持单任务单目标。
        经 Ports 注入而非直接 new infra：满足「用例零 infra import」+「fake Ports 可在无 Git/无 SDK 环境覆盖完整执行链」（任务 §11）；openWorktreeRepo 作为用例局部注入函数（非正式 Port），避免在 application/ports.ts 为「在路径打开仓储」过度抽象。
      consequences: |
        正面：执行阶段领域编排单一来源（ExecuteTaskUseCase），CLI 不再持有可复用的依赖检查/Context Pack/权限/状态映射逻辑（任务 §11 验收）；串行 Orchestrator（TASK-044）可直接复用；用例经 fake Ports 纯内存可测，不依赖 git/SDK/fs 序列化。
        约束：合并回收（含冲突→blocked）仍散在 CLI composition root，TASK-038 必须把它与 task:review 的合并路径抽取为共享 Finalize，否则 Orchestrator 会缺合并能力或被迫复制第三套实现（SPEC §20.4 已约束）。
        约束：ExecuteTaskOutcome 携带 task（刷新后投影）+ result + worktreePath，是 CLI/TASK-038 Finalize 的输入契约，TASK-038 抽取 Finalize 时应直接消费此结构，不宜再改其字段语义。
  issues: []
next_action: review
---

# TASK-037 执行结果 —— 从 task-run 抽取单任务执行 Application 用例

## 1. 执行结论

**completed**。新增 `ExecuteTaskUseCase`（`src/application/execution/execute-task.ts`），把 `task:run` 中可复用的单任务执行领域编排全部迁入用例；CLI 降为 composition root（装配 Ports + 解析参数 + 承接 done 路径合并回收 + provider/observability）。零行为变更（task:run 23 项 CLI 测试 + task-review 13 项测试全绿）。

## 2. 迁出 CLI 的职责（进入 ExecuteTaskUseCase）

以下领域能力从 `task-run.ts` 迁入用例，CLI 不再持有：

- **状态前置**：任务必须 `ready` 才能运行，否则抛错。
- **依赖前置检查**：`readAllTasks` + `checkDependenciesDone`（全部 `depends_on` 须 `done`）。
- **Context Pack 刷新与回写**：`readDependencyResults`（容错「依赖 done 但无 result」）+ `refreshSourceFiles` + 回写 main 仓储 + `computeContextPack`。
- **权限边界组装**：`buildPermissionBoundary`（`resolvePathScope` 路径重叠 deny 优先 + `computeVerificationAllowlist` layer 裁剪）——路径重叠在 worktree 创建前拒绝。
- **状态流转**：`ready → running`（经 `StateOrchestrator`）+ `applyResult` 状态映射（含 `isProductAcceptable` 决定 no_review 免审任务的 done/blocked）。
- **worktree 创建**：经 `WorktreePort.create`。
- **R7 工作区准备**：经注入的 `prepareWorktree`。
- **Executor 调用**：组装 `ExecuteInput`（worktree_path / result_file / context_pack / permission_boundary / startup_prompt）+ 调 `executor.execute`。
- **读 result**：经 `openWorktreeRepo(wtPath).readResult`（worktree 仓储，§12 与 main 显式区分）。
- 辅助：`taskFileFromResult`、`isDocMissing`。

## 3. 保留在 CLI composition root 的职责

- **装配**：实例化 `TaskDocRepository` / `WorktreeAdapter` / `DryRunLocalExecutor` / `GitMergeAdapter` / `GlobalDocRepository`，wiring 注入 `ExecuteTaskPorts`；`openWorktreeRepo` 闭包绑定 worktree docs/tasks 路径；`prepareWorktree` 闭包绑定 projectRoot 适配 `restoreNodeModules(wt, main, perms)` 三参签名。
- **参数解析**：projectRoot / mainRef / worktreesDir；`parseTestingCommands`（读 docs/TESTING.md）。
- **合并回收（done 路径）**：`rebaseAndFastForwardMerge` + `writebackGlobalDocs` + `syncMainWorktreeFile`；冲突 → `done→blocked` + `appendMergeConflictIssue`。**待 TASK-038 抽取为共享 Finalize 用例**（SPEC §20.4）。
- **provider/observability 组装**：`assembleExecutor`（profile→env→invocation→executor）+ §7 可观测性 + `runTaskWithAssembly`。
- **commander 注册**：`registerTaskRunCommand` + `printOutcome` + 退出码（统一由 framework 处理）。
- **基础设施辅助**：`restoreNodeModules`（真实 spawnSync npm / junction）、`createFsGlobalDocRepo`、`sequentialIdAllocator`、`parseTestingCommands` 及其窄化辅助。

## 4. 用例设计（Ports / Input / Outcome）

- **`ExecuteTaskPorts`**：`taskRepo: TaskDocRepositoryPort`（main，状态权威）/ `worktree: WorktreePort` / `executor: TaskExecutorPort` / `openWorktreeRepo: (wtPath) => TaskDocRepositoryPort`（读 worktree 内 result）/ `prepareWorktree: (wtPath, permissions) => void`（R7）。
- **`ExecuteTaskInput`**：`taskId` / `mainRef` / `testingCommands`（每次执行可能不同的调用参数）。
- **`ExecuteTaskOutcome`**：`taskId` / `finalStatus`（reviewing|done|blocked|failed）/ `executor` / `worktreePath` / `task`（刷新 context_pack 后投影）/ `result`（worktree 仓储读到的 ResultFrontmatter）。task + result + worktreePath 是合并阶段的输入契约。
- 用例构造注入 Ports，内部 `new StateOrchestrator(taskRepo)` 复用状态编排；不持有跨调用状态副本。

## 5. 模块导出

- 新增 `src/application/execution/index.ts`：`export * from './ports.js'` + `export * from './execute-task.js'`。
- `src/application/index.ts`：`export * from './execution/ports.js'` 改为 `export * from './execution/index.js'`（ports 仍经 application 导出，新增 execute-task 导出，无重复）。
- `execute-task.ts` 直接从 `../state-orchestrator.js` 与 `../context-pack-generator.js` 导入（不经 `../index.js`），消除 `application/index ↔ execution` 循环依赖。

## 6. 验证结果

- `npm run typecheck`：0 错误。
- `npm test -- execute-task task-run`：execute-task 10 passed + task-run 23 passed = 33 全绿。
- `npm run lint`：0 错误 0 警告。
- `npx vitest run test/cli/task-review.test.ts`：13 passed（forbidden 路径未触碰，确认无连带破坏）。
- `npm test` 全量：777 passed / 42 failed / 2 skipped；42 failed 全在 SQLite 子集（ISS-005，本机 Node 24），对比 TASK-036 的 767 passed → 777 passed（+10 新增），failed 不变、无回归。

## 7. 新增测试

`test/application/execution/execute-task.test.ts`（10 tests，纯内存 fake Ports，无 Git/SDK/fs 序列化）：

- reviewing 路径（普通任务 completed+review → reviewing，worktree 创建 + result 读自 worktree 仓储）。
- ExecuteInput 正确组装（worktree_path / result_file / context_pack / permission_boundary / startup_prompt）。
- no_review + verification 全过 → done；含 failed → blocked。
- 前置失败均在 worktree 创建前：非 ready / 依赖未完成 / 路径重叠（断言 `worktree.createCalls` 为空）。
- Context Pack 刷新（依赖全 done → 用产物替换预填，回写 main + 注入 Executor）。
- `prepareWorktree` 用 task.permissions 被调用（worktree 创建后、Executor 执行前）。
- main / worktree 仓储显式区分（Executor 产物只进 worktree 仓储，main 无 result）。

复用 state-orchestrator 测试的 `InMemoryRepo implements TaskDocRepositoryPort` 模式；`FakeWorktree implements WorktreePort` 记录 create 调用；fake executor 闭包共享 worktreeRepo 模拟「Executor 写 → worktree 仓储读」。

## 8. 架构边界遵守

- application 不 import infrastructure / CLI（execute-task.ts 只 import core + application/ports + application/state-orchestrator + application/context-pack-generator + execution/ports）。
- 用例零 infra 实现 import，全部经 Ports（`TaskDocRepositoryPort` / `WorktreePort` / `TaskExecutorPort`）。
- main / worktree 仓储经两个独立 Port 句柄显式区分（任务 §12）。
- 未触碰 forbidden_paths（task-review / merge / sdk / git / core / SPEC）。
- 依赖方向 `cli → application ← infrastructure` 不变；未引入新依赖。

## 9. 提议的全局更新

- **DEC-039（accepted）**：抽取 ExecuteTaskUseCase 单任务执行用例；review 与最终合并暂留 CLI composition root（待 TASK-038 共享 Finalize）。
- **无 issue 提议**：抽取干净，验收全通过，无阻塞问题。（合并回收暂留 CLI 是任务范围内的有意切分，非技术债；TASK-038 将抽取 Finalize，已在 DEC-039 consequences + PROGRESS「后续任务必须知道的信息」明确约束。）

## 10. 风险与注意

- `ExecuteTaskOutcome` 的 `task` / `result` / `worktreePath` 是 CLI 合并阶段（及 TASK-038 Finalize）的输入契约；TASK-038 抽取 Finalize 时应直接消费，不宜改动字段语义。
- `prepareWorktree` 签名只暴露 `(wtPath, permissions)`，主仓库路径等装配期常量由 CLI wiring 时闭包绑定——Orchestrator 接入时同样需在 composition root 绑定（TASK-049）。
- 全量测试 42 failed 为 ISS-005（better-sqlite3 需 Node 22），与本任务无关；Node 22 环境下应为全绿。

## 11. 下一步

`next_action: review`。建议下一个任务 **TASK-038**（抽取审查与共享完成用例）：把 task:review 审查编排抽成 `ReviewTaskUseCase`，并把本任务留在 CLI 的合并回收（rebase-ff + section 回写 + 主工作区同步 + 冲突登记）抽取为共享 `FinalizeTaskUseCase`，供 task:run / task:review / Orchestrator 复用。
