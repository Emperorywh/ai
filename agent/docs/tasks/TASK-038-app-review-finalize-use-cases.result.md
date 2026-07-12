---
doc: result
task_id: TASK-038
execution_status: completed
modified_files:
  - src/application/execution/index.ts
  - src/application/index.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
created_files:
  - src/application/execution/review-task.ts
  - src/application/execution/finalize-task.ts
  - test/application/execution/review-task.test.ts
  - test/application/execution/finalize-task.test.ts
deleted_files: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test 全量）；两新用例经具体模块导入 rebase-ff/section-writeback/state-orchestrator 消除循环依赖后全绿
  - command: npm test -- review-task finalize-task task-run task-review
    result: passed
    notes: 新增 review-task 9 + finalize-task 6 = 15 passed（fake Ports 内存覆盖完整审查 / 合并链，无 Git/SDK）+ task-run 23 passed + task-review 13 passed（抽取后公开行为 / 合并行为 / 冲突登记零回归）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告（迁出后清理了两 CLI 的 rebaseAndFastForwardMerge / appendMergeConflictIssue / reviewOrchestratorRepo / buildReviewFrontmatter 等已删函数与未用 import：spawnSync / TaskFrontmatter / ReviewFrontmatter / StateOrchestrator / rebaseAndFastForward / writebackGlobalDocs / MergePorts / MergeTask / WritebackRequest / TaskDocRepositoryPort）
  - command: npm test -- execute-task
    result: passed
    notes: execute-task 10 passed（execution/index.ts 改导出后无连带破坏）
  - command: npm test
    result: failed
    notes: 全量 792 passed / 42 failed / 2 skipped；42 failed 全在 3 个 SQLite 测试文件（status-rebuild / index-repo / schema），ISS-005 既有环境问题（better-sqlite3 需 Node 22 ABI 127，本机 Node 24），与本任务无关（SQLite 在本任务未触碰）。对比 TASK-037 的 777 passed → 本任务 792 passed（+15 新增用例测试），failed 42 不变、无回归
global_update_requests:
  progress:
    - mode: replace
      section: 当前阶段
      content: |
        **serial-task-orchestration（串行任务编排）**——基于 `docs/SPEC_serial-task-orchestration.md`。目标：将 `TaskExecutor` / `Reviewer` 契约收敛到 application ports，并建立串行编排用例。已立项 TASK-036~039；**TASK-038（抽取单任务审查 ReviewTaskUseCase 与共享完成 FinalizeTaskUseCase）已完成，TASK-039（core 系统验证契约）可直接开跑**。
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - **v0.1.0（TASK-001~029）**：四层架构（core / application / infrastructure / cli）全部就位，CLI 七命令齐备——已完成。
        - **v0.2.0 Claude Agent SDK 接入（TASK-030~035）**：双侧真实 SDK 调用闭环 + 多 provider + CI 真实 API 契约——已完成。
        - **serial-task-orchestration TASK-036**：Executor/Reviewer 契约收敛到 `src/application/execution/ports.ts`（单一来源）——已完成。
        - **serial-task-orchestration TASK-037**：从 `cli/commands/task-run.ts` 抽取 `ExecuteTaskUseCase` 到 `src/application/execution/execute-task.ts`——已完成。
        - **serial-task-orchestration TASK-038**：抽取 `ReviewTaskUseCase`（审查 + 写 .review.md + applyReview 状态映射）与 `FinalizeTaskUseCase`（合并 + 全局回写 + 冲突 done→blocked + 落 ISSUES）到 `src/application/execution/`；消除 task-run / task-review 两处重复的合并包装 / 冲突登记 / 主工作区同步 / 全局回写（SPEC §20.4）；CLI 降为 composition root（装配 Ports + 串联 execute/review → finalize）——已完成。
        - 详见各 `.result.md` 与 `DECISIONS.md`；归档快照见 `docs/PROGRESS_archive.md`。
    - mode: replace
      section: 当前系统可用能力
      content: |
        - **CLI**：`caw init / plan / task:create / status / rebuild-index / task:run / task:review`。`task:run` / `task:review` 公开选项与退出行为不变（TASK-038 抽取为零行为变更，23 + 13 项 CLI 测试全绿）；执行阶段编排自 TASK-037 委托 `ExecuteTaskUseCase`，审查阶段自 TASK-038 委托 `ReviewTaskUseCase`，done 路径合并回收自 TASK-038 委托共享 `FinalizeTaskUseCase`。
        - **分层**：`cli → application → core ← infrastructure`，且 infrastructure SDK adapter 经依赖倒置 import `application/execution/ports.ts` 契约类型（TASK-036/DEC-038）。详见 `docs/ARCHITECTURE.md` §3/§4 与 `AGENTS.md`。
        - **执行/审查契约单一来源**：`src/application/execution/ports.ts` 导出 `TaskExecutorPort` / `TaskReviewerPort` + 输入输出 + §18 启动提示 + `ExecutorError`（TASK-036）。
        - **单任务执行用例**：`src/application/execution/execute-task.ts` 导出 `ExecuteTaskUseCase` + `ExecuteTaskPorts` / `ExecuteTaskInput` / `ExecuteTaskOutcome`（TASK-037）。
        - **单任务审查用例**：`src/application/execution/review-task.ts` 导出 `ReviewTaskUseCase` + `ReviewTaskPorts` / `ReviewTaskInput` / `ReviewTaskOutcome`（TASK-038）。用例只依赖 core + Ports（TaskDocRepositoryPort / TaskReviewerPort + openWorktreeRepo 注入），main / worktree 仓储经路由适配器显式区分（applyReview 的 skipped 分支读 .result.md 路由到 worktree）。
        - **共享完成用例**：`src/application/execution/finalize-task.ts` 导出 `FinalizeTaskUseCase` + `FinalizeTaskPorts` / `FinalizeTaskInput` / `FinalizeTaskOutcome`（TASK-038）。统一 done 路径的 rebase+ff（TASK-019）+ 全局回写（TASK-020）+ 主工作区同步 + 冲突 done→blocked + 落 ISSUES；task:run 的 no_review 完成路径与 task:review 的 approved 路径复用同一 finalizer，供串行 Orchestrator（TASK-044）直接调用。
        - **多 provider**：`.caw/config.json` 预置 `anthropic` + `glm` profile，token 只走环境变量。
        - **测试**：`npm run typecheck && npm run lint` 全绿；`npm test` 全量 792 passed / 42 failed（全在 SQLite 子集，ISS-005 Node 版本约束）/ 2 skipped。
    - mode: replace
      section: 后续任务必须知道的信息
      content: |
        - **分层硬约束**：`cli → application → core ← infrastructure`；`core` 零反向依赖；`application` 只经 `src/application/ports.ts` + `src/application/execution/ports.ts` 依赖 infra（port 抽象），不得直接 import infra 实现类；**infrastructure SDK adapter 可 import `application/execution/ports.ts` 契约类型（依赖倒置，TASK-036/DEC-038）**。
        - **三用例复用（TASK-037/038/DEC-039/DEC-040）**：单任务执行 / 审查 / 共享完成编排分别收敛在 `ExecuteTaskUseCase` / `ReviewTaskUseCase` / `FinalizeTaskUseCase`（`src/application/execution/`）。串行 Orchestrator（TASK-044）应直接复用：经各自 Ports 注入依赖，串联 execute → (done & no_review) finalize / execute → review → (done) finalize，消费结构化 Outcome（含 task / result / worktreePath）。Review 与 Finalize 是两个职责独立的用例（§8），由调用方串联，不在 Review 内部调 Finalize。
        - **main / worktree 仓储显式区分（任务 §12）**：三用例均经 `taskRepo`（main，状态权威）维护 status / 写 .review.md，经 `openWorktreeRepo(wtPath)` 读 Executor 产出的 .result.md（尚未合并入 main）；FinalizeTaskUseCase 的合并 rebaseAndFastForward docs port 路由到 worktree 仓储。不用路径判断隐式路由。
        - **合并回收单一入口（TASK-038/DEC-040/SPEC §20.4）**：合并包装 / 冲突登记 / 主工作区同步 / 全局回写只在 `FinalizeTaskUseCase` 一处实现；`syncMainWorktreeFile`（git checkout 主工作区结果文件）作为注入回调由 CLI 闭包绑定 projectRoot + mainRef 后注入，application 用例不感知 git I/O。
        - **依赖红线**：`package.json` 基础依赖已声明；后续任务默认不得新增依赖。`npm install` 须带 `--legacy-peer-deps`（ISS-019）。
        - **工程约定**：ESM（`"type": "module"`），导入带 `.js` 后缀；`tsconfig` 已开 `strict` + `noUncheckedIndexedAccess`；application 层模块间的跨模块依赖直接从具体模块导入，避免经 `application/index.js` 形成循环（review-task.ts / finalize-task.ts → state-orchestrator.js / merge/rebase-ff.js / merge/section-writeback.js）。
        - **Schema 单一来源**：领域 Schema 与枚举从 `src/core` 导出复用；执行/审查契约从 `src/application/execution/ports.ts` 导入（TASK-036 起）。
        - **状态权威**：任务 `status` 以 frontmatter 为准，SQLite 只是派生索引。
    - mode: replace
      section: 建议下一个任务
      content: |
        **TASK-039**（core 系统验证契约，按 `docs/SPEC_serial-task-orchestration.md` 拓扑推进）。TASK-036~038 已把 Executor/Reviewer 契约与执行 / 审查 / 完成用例收敛到 application 层；TASK-039 起按 SPEC §20.2/§20.3 推进 core 系统验证契约（VerificationRunnerPort 等），为串行 Orchestrator（TASK-044）的系统验证阶段提供稳定入口。串行 Orchestrator 实现时可经三用例（Execute/Review/Finalize）注入 Ports 串联完整单任务闭环。
  decisions:
    - id: ''
      title: 抽取 ReviewTaskUseCase + FinalizeTaskUseCase；消除两 CLI 重复合并逻辑（SPEC §20.4）
      status: accepted
      scope: architecture
      created_from_task: TASK-038
      decision: |
        把 `cli/commands/task-review.ts` 中可复用的审查编排（读 .result.md → 产出审查结论 → 写 .review.md → applyReview 状态映射）抽取到 `src/application/execution/review-task.ts` 的 `ReviewTaskUseCase`；把 task-run / task-review 两处重复的 done 路径合并回收（rebase+ff + 全局回写 + 主工作区同步 + 冲突 done→blocked + 落 ISSUES）抽取到 `src/application/execution/finalize-task.ts` 的 `FinalizeTaskUseCase`。
        ReviewTaskUseCase 只依赖 core + Ports（taskRepo main 状态权威 / reviewer / openWorktreeRepo 读 worktree result）；applyReview 的 skipped 分支读 .result.md 经内部路由适配器（task 操作→main、result 操作→worktree）路由，main / worktree 仓储显式区分（任务 §12）。
        FinalizeTaskUseCase 只依赖 core + application merge 原语（rebase-ff / section-writeback）+ Ports（taskRepo / gitMerge / globalDocRepo / idAllocator / openWorktreeRepo / syncMainFile）；合并 rebaseAndFastForward 的 docs port 路由到 worktree 仓储（.result.md 尚未合并入 main）。`syncMainFile` 为注入回调（CLI 闭包绑定 git checkout），与 execute-task 的 prepareWorktree 同构，使 application 用例不感知 git I/O。
        CLI task:run / task:review 降为 composition root：装配三用例 Ports、串联 execute → (done) finalize / review → (done) finalize；reviewing / rejected / blocked 不合并。合并冲突 issue 的 recommended_action 改为命令中立（`重跑该任务（caw task:run / task:review <id>）`），因 finalizer 三处共用、不绑定具体命令。
        Review 与 Finalize 是两个职责独立的用例（任务 §8）：不在 Review 内部调 Finalize，由 CLI / Orchestrator 在 done 路径串联，使 Orchestrator 能在 review 后据 outcome 决策是否合并。
      rationale: |
        SPEC §20.4「复用与重构」明确要求：实现 Orchestrator 前必须先抽取 task:run / task:review 重复的合并包装 / 冲突登记 / 主工作区同步 / 全局回写 / provider 组装，不得复制第三套实现。抽取前两 CLI 各自维护一套 `rebaseAndFastForwardMerge` + `appendMergeConflictIssue` + `syncMainWorktreeFile`（机械相同但分散），串行 Orchestrator 若再复用会引入 application→cli 反向依赖或复制第三套。
        按 §9 数据流「reviewing → Reviewer → ReviewDoc → done/rejected/blocked；仅 done 进入 Finalize」切分为两个独立用例：ReviewTaskUseCase 产出结构化 `ReviewTaskOutcome`（finalStatus / reviewResult / task / result / worktreePath），FinalizeTaskUseCase 消费其 task / result / worktreePath 继续合并，无需重新读取或二次推导。
        Review 与 Finalize 拆为两个用例而非合一，是因为任务 §8 明确「Review 和 Finalize 是两个职责独立的用例」「合并冲突只能返回结构化结果，application 不替用户解决冲突」——审查与合并是不同阶段，Orchestrator 需在 review 后据结论（done / rejected / blocked）决策是否进合并，合一会强迫 rejected / blocked 也过合并分支。
        经 Ports 注入而非直接 new infra：满足「用例零 infra import」+「fake Ports 可在无 Git / 无 SDK 环境覆盖完整审查 / 合并链」（任务 §11）；openWorktreeRepo / syncMainFile 作为用例局部注入回调（非正式 Port），避免在 application/ports.ts 为「在路径打开仓储」「git checkout 单文件」过度抽象。
      consequences: |
        正面：done 路径合并回收单一来源（FinalizeTaskUseCase），CLI 不再持有可复用的合并 / 冲突登记 / 全局回写逻辑（任务 §11 验收：两 CLI 不再各自定义 rebaseAndFastForwardMerge）；task:run no_review 完成路径与 task:review approved 路径复用同一 finalizer；串行 Orchestrator（TASK-044）可直接复用三用例；用例经 fake Ports 纯内存可测，不依赖 git / SDK / fs 序列化。
        约束：合并冲突 issue 的 recommended_action 文案统一为命令中立（不再区分 task:run / task:review），冲突测试只断言 taskId / 合并冲突 / 冲突文件清单，不断言命令名，故无测试回归；若后续需命令特异化提示，应由调用方在 finalizer 之外补充而非回到分叉实现。
        约束：ReviewTaskOutcome / FinalizeTaskOutcome 的 task / result / worktreePath 是串联契约，TASK-044 Orchestrator 接入时应直接消费，不宜改动字段语义。
  issues: []
next_action: review
---

# TASK-038 执行结果 —— 抽取单任务审查与共享完成 Application 用例

## 1. 执行结论

**completed**。新增 `ReviewTaskUseCase`（审查 + 写 .review.md + applyReview 状态映射）与 `FinalizeTaskUseCase`（合并 + 全局回写 + 主工作区同步 + 冲突 done→blocked + 落 ISSUES）；消除 task-run / task-review 两处重复的合并包装 / 冲突登记 / 主工作区同步 / 全局回写（SPEC §20.4）。CLI 降为 composition root（装配 Ports + 串联用例）。零行为变更（task:run 23 + task:review 13 项 CLI 测试全绿）。

## 2. 迁出 CLI 的职责（进入 ReviewTaskUseCase / FinalizeTaskUseCase）

以下领域能力从 CLI 迁入用例，CLI 不再持有：

**ReviewTaskUseCase（自 task-review.ts 迁入）**：
- **状态前置**：任务必须 `reviewing` 才能审查。
- **读 .result.md**：经 `openWorktreeRepo(wtPath).readResult`（worktree 仓储，§12 显式区分）。
- **产出审查结论**：no_review → Orchestrator 生成 skipped 占位；否则调 `reviewer.review`。
- **写 .review.md**：经 `taskRepo.writeReview`（main 仓储，审查结论与执行事实分离，§5.3）。
- **applyReview 状态映射**：经路由适配器（task 操作→main、result 操作→worktree），skipped 分支读 .result.md 路由到 worktree。
- 辅助：`reviewOrchestratorRepo`（双仓储路由适配器）、`buildReviewFrontmatter`（补全 task_id/reviewer/reviewed_at）。

**FinalizeTaskUseCase（自两 CLI 迁入，消除重复）**：
- **合并包装**：`rebaseAndFastForward`（TASK-019）——docs port 路由到 worktree 仓储。
- **全局回写**：`writebackGlobalDocs`（TASK-020）——串行回写 global_update_requests。
- **主工作区同步**：`syncMainFile` 注入回调（git checkout 结果文件）。
- **冲突返回**：`appendMergeConflictIssue`（done→blocked + 落 ISSUES，命令中立文案）。
- 辅助：`collectExistingIds`（id 分配去重基线）。

## 3. 保留在 CLI composition root 的职责

**task-run.ts**：
- **装配**：实例化 `TaskDocRepository` / `WorktreeAdapter` / `DryRunLocalExecutor` / `GitMergeAdapter` / `GlobalDocRepository`，wiring 注入 `ExecuteTaskPorts` + `FinalizeTaskPorts`；`openWorktreeRepo` 闭包绑定 worktree docs 路径；`syncMainFile` 闭包绑定 projectRoot + mainRef。
- **串联用例**：execute → (done) → finalize；reviewing / 冲突 / 失败不在此分支合并。
- **参数解析**：projectRoot / mainRef / worktreesDir；`parseTestingCommands`。
- **provider/observability 组装**：`assembleExecutor` + §7 可观测性 + `runTaskWithAssembly`。
- **commander 注册** + `printOutcome` + 退出码。
- **基础设施辅助**：`restoreNodeModules`、`createFsGlobalDocRepo`、`sequentialIdAllocator`、`syncMainWorktreeFile`（导出供 task-review 复用）、`parseTestingCommands`。

**task-review.ts**：
- **装配**：实例化 `TaskDocRepository` / `LocalReviewer` / `GitMergeAdapter` / `GlobalDocRepository`，wiring 注入 `ReviewTaskPorts` + `FinalizeTaskPorts`。
- **串联用例**：review → (done) → finalize；rejected / blocked 保留 worktree 不合并。
- **provider/observability 组装**：`assembleReviewer` + §7 可观测性 + `reviewTaskWithAssembly`。
- **LocalReviewer**（SDK 未就位兜底，§12）。
- **commander 注册** + `printOutcome` + 退出码。

## 4. 用例设计（Ports / Input / Outcome）

**ReviewTaskPorts**：`taskRepo: TaskDocRepositoryPort`（main）/ `reviewer: TaskReviewerPort` / `openWorktreeRepo: (wtPath) => TaskDocRepositoryPort`（读 worktree result）。

**ReviewTaskInput**：`taskId` / `worktreePath`。

**ReviewTaskOutcome**：`taskId` / `finalStatus`（done/rejected/blocked）/ `reviewResult`（approved/rejected/needs-human/skipped）/ `reviewer` / `worktreePath` / `task`（合并阶段 MergeTask 投影来源）/ `result`（worktree 仓储读到的 ResultFrontmatter）。task + result + worktreePath 是 finalize 阶段的输入契约。

**FinalizeTaskPorts**：`taskRepo: TaskDocRepositoryPort`（main，冲突 done→blocked）/ `gitMerge: GitMergePort` / `globalDocRepo: GlobalDocRepositoryPort` / `idAllocator: IdAllocator` / `openWorktreeRepo: (wtPath) => TaskDocRepositoryPort`（合并读 result）/ `syncMainFile: (resultFileRel) => void`（合并后同步主工作区，infrastructure 回调）。

**FinalizeTaskInput**：`taskId` / `mainRef` / `worktreePath` / `task` / `result`。

**FinalizeTaskOutcome**：`taskId` / `merged` / `conflicts`。

两用例构造注入 Ports，内部 `new StateOrchestrator(...)` / 复用 merge 原语；不持有跨调用状态副本。

## 5. 模块导出

- `src/application/execution/index.ts`：新增 `export * from './review-task.js'` + `export * from './finalize-task.js'`（ports / execute-task / review-task / finalize-task 统一 re-export）。
- `src/application/index.ts`：注释更新为「TASK-036/037/038」三用例说明（导出语句不变，经 execution/index 统一 re-export）。
- review-task.ts / finalize-task.ts 直接从具体 application 模块导入（`../state-orchestrator.js` / `../merge/rebase-ff.js` / `../merge/section-writeback.js`），不经 `../index.js`，消除循环依赖。

## 6. 验证结果

- `npm run typecheck`：0 错误。
- `npm test -- review-task finalize-task task-run task-review`：review-task 9 + finalize-task 6 + task-run 23 + task-review 13 = 51 全绿。
- `npm run lint`：0 错误 0 警告。
- `npm test -- execute-task`：10 passed（execution/index 改导出后无连带破坏）。
- `npm test` 全量：792 passed / 42 failed / 2 skipped；42 failed 全在 SQLite 子集（ISS-005，本机 Node 24），对比 TASK-037 的 777 passed → 792 passed（+15 新增），failed 不变、无回归。

## 7. 新增测试

`test/application/execution/review-task.test.ts`（9 tests，纯内存 fake Ports）：
- 三种审查结论映射（approved→done / rejected→rejected / needs-human→blocked）。
- no_review skipped 路径（产物校验通过→done；含 failed→blocked），断言 no_review 不调 Reviewer。
- main / worktree 仓储显式区分（result 读自 worktree、main 无 result）。
- reviewer.review 收到正确 ReviewInput（result / worktree_path / result_file）。
- 状态前置（非 reviewing 拒绝）；outcome 携带 task / result / worktreePath 可链式喂 FinalizeTaskUseCase。

`test/application/execution/finalize-task.test.ts`（6 tests，纯内存 fake Ports）：
- 合并成功（merged=true + 全局回写 progress + syncMainFile 调用）；docs port 路由到 worktree 仓储。
- 合并冲突（merged=false + done→blocked + 落 ISSUES 命令中立文案；no_review 任务冲突转移上下文）。
- 可被 Orchestrator 直接调用（单次 finalize 调用完成合并回收）；合并回写含 decisions/issues 提议项（idAllocator 分配 DEC/ISS）。

复用 execute-task 测试的 `InMemoryRepo implements TaskDocRepositoryPort` 模式；finalize 测试另加 `InMemoryGlobalRepo`（捕获 progress/decisions/issues 回写）+ `fakeGitMerge`（listConflicts 控制 merged/conflict）。

## 8. 架构边界遵守

- application 不 import infrastructure / CLI（review-task.ts / finalize-task.ts 只 import core + application/ports + application/execution/ports + application/state-orchestrator + application/merge/*）。
- 两用例零 infra 实现 import，全部经 Ports（TaskDocRepositoryPort / TaskReviewerPort / GitMergePort / GlobalDocRepositoryPort）+ 注入回调（openWorktreeRepo / syncMainFile）。
- main / worktree 仓储经独立 Port 句柄显式区分（任务 §12）。
- 未触碰 forbidden_paths（core / sdk / sqlite / SPEC 均未改）。
- 依赖方向 `cli → application ← infrastructure` 不变；未引入新依赖。

## 9. 提议的全局更新

- **DEC-040（accepted）**：抽取 ReviewTaskUseCase + FinalizeTaskUseCase；消除两 CLI 重复合并逻辑（SPEC §20.4）。
- **无 issue 提议**：抽取干净，验收全通过，无阻塞问题。（冲突 issue 文案改命令中立是 finalizer 单一入口的必然结果，非行为回归；测试不断言命令名。）

## 10. 消除的重复逻辑（任务 §13 产出要求）

抽取前两 CLI 各自维护一套（机械相同但分散）：
- `rebaseAndFastForwardMerge`（task-run.ts + task-review.ts 各一份）→ **合并进 FinalizeTaskUseCase.finalize**。
- `appendMergeConflictIssue`（两份，文案差 `task:run` / `task:review`）→ **合并进 FinalizeTaskUseCase（命令中立）**。
- `syncMainWorktreeFile`（两份）→ **保留 task-run.ts 一份并导出，task-review.ts import 复用**；作为 FinalizeTaskUseCase 的 syncMainFile 注入回调。
- 合并回收流程块（rebase + writeback + sync + 冲突→blocked+ISSUES，两处）→ **FinalizeTaskUseCase 单一入口**。
- `collectExistingIds`（两份）→ finalize-task.ts 一份（镜像 section-writeback 私有版）。
- `reviewOrchestratorRepo` + `buildReviewFrontmatter`（task-review.ts）→ **ReviewTaskUseCase 内部**。

抽取后：task-run / task-review 不再各自定义 rebaseAndFastForwardMerge（grep 验证）；合并 / 冲突登记 / 全局回写只有一个业务入口（FinalizeTaskUseCase）。

## 11. 风险与注意

- `ReviewTaskOutcome` / `FinalizeTaskOutcome` 的 task / result / worktreePath 是 CLI / Orchestrator 串联的输入契约；TASK-044 Orchestrator 接入时应直接消费，不宜改动字段语义。
- 合并冲突 issue 的 recommended_action 统一为命令中立文案（`重跑该任务（caw task:run / task:review <id>）`）；冲突相关测试（task-run TASK-330 / task-review TASK-451）只断言 taskId / 合并冲突 / 冲突文件清单，不断言命令名，故无回归。
- `openWorktreeRepo` / `syncMainFile` 为用例局部注入回调（非正式 Port），Orchestrator 接入时同样需在 composition root 绑定（TASK-049）。
- 全量测试 42 failed 为 ISS-005（better-sqlite3 需 Node 22），与本任务无关；Node 22 环境下应为全绿。

## 12. 下一步

`next_action: review`。建议下一个任务 **TASK-039**（core 系统验证契约）：按 SPEC §20.2/§20.3 拓扑推进 core 系统验证契约（VerificationRunnerPort 等），为串行 Orchestrator（TASK-044）的系统验证阶段提供稳定入口。TASK-036~038 已把执行 / 审查 / 契约与执行 / 审查 / 完成用例收敛到 application 层，Orchestrator 可经三用例注入 Ports 串联完整单任务闭环。
