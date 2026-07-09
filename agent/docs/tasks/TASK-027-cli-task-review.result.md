---
task_id: TASK-027
execution_status: completed
modified_files:
  - src/cli/framework.ts
created_files:
  - src/cli/commands/task-review.ts
  - test/cli/task-review.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess + NodeNext）
  - command: npm test -- cli/task-review
    result: passed
    notes: 13 项单测全绿（三种审查结论映射 + no_review skipped 双路径 + 审查结论隔离 + 默认 LocalReviewer + 状态前置 + 合并冲突 blocked + runCli 退出码）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告
  - command: npm test -- cli/task-run
    result: passed
    notes: 13 项全绿——确认改 framework.ts 注册 + import task-run 导出未引入回归
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: "- TASK-027（CLI task:review 命令）已完成：`src/cli/commands/task-review.ts` 提供 `reviewTask(taskId, options)`（Reviewer 审查编排入口：读 .result.md（worktree）→ no_review 产 skipped 占位 / 否则调 Reviewer 产出 .review.md → StateOrchestrator.applyReview 映射状态 → done 才 rebaseAndFastForward+writebackGlobalDocs 合并回收、rejected/blocked 保留 worktree 不合并、冲突 done→blocked + appendMergeConflictIssue）+ Reviewer 契约（注入式，复用 TASK-022 模式）+ LocalReviewer（SDK 未就位兜底，确定性产 approved）+ `registerTaskReviewCommand(program)`（`task:review <taskId> [--main-ref] [--worktrees-dir] [--project-root]`）。reviewer/gitMergePort/globalDocRepo/idAllocator 全可注入。`src/cli/framework.ts` createProgram 追加注册（延续 ISS-013）。13 项 e2e/单测（临时 git 仓库 + 可注入 fake reviewer/git）。CLI P8（plan/task:create/task:run/task:review）中 task:review 就位。"
    - section: 当前系统可用能力
      mode: append
      content: "  - CLI task:review 命令：`reviewTask(taskId, options)`（`src/cli/commands/task-review.ts`）是 Reviewer 审查编排入口，组合下游（TASK-017 applyReview + TASK-019/020 合并回写）。链路：读任务（main 仓库 frontmatter 权威）→ 状态须 `reviewing`（applyReview 四映射的合法起始态）→ 定位 worktree（task:run 产物）→ 读 .result.md（worktree）→ no_review 生成 `review_result: skipped` 占位 / 否则调注入 Reviewer 产出 approved|rejected|needs-human → 写 .review.md（main 仓库，§5.3 与执行事实分离）→ `StateOrchestrator.applyReview`（经 cli 路由适配器：task 状态权威在 main、.result.md 在 worktree）→ approved→done 才 `rebaseAndFastForwardMerge`（TASK-019，docs port 路由 worktree）+ `writebackGlobalDocs`（TASK-020）+ `syncMainWorktreeFile` / rejected|blocked 保留 worktree 不合并 / 冲突 done→blocked + `appendMergeConflictIssue`。默认 `LocalReviewer`（SDK 未就位兜底，确定性产 approved），reviewer/gitMergePort/globalDocRepo/idAllocator 全可注入（测试隔离）。退出码/错误输出经 runCli 统一。"
    - section: 后续任务必须知道的信息
      mode: append
      content: "- CLI task:review 命令复用要点（TASK-027）：`reviewTask` 默认 `LocalReviewer`（SDK 未就位兜底，确定性产 approved，复用 TASK-022 DryRun 哲学），reviewer / gitMergePort / globalDocRepo / idAllocator 全可注入（测试用 fake reviewer 控制 approved/rejected/needs-human、fake gitMergePort 模拟合并冲突）。**前置态必须 `reviewing`**（applyReview 的 approved→done / rejected→rejected / needs-human→blocked / skipped→产物校验四映射均从 reviewing 出发，§7 状态机）。**审查结论写 main 仓库 .review.md**（§5.3 与 .result.md 分离，不污染执行事实）；.result.md 在 worktree（task:run 产物，合并经 rebase+ff 回收进 main）。**applyReview 经 cli 路由适配器**：StateOrchestrator 注入 `reviewOrchestratorRepo(main, worktree)`——readTask/writeTask→main（状态权威）、readResult→worktree（.result.md 所在，applyReview skipped 分支内部 readResult 经此路由，ISS-009 细化）。**新鲜合并走 rebaseAndFastForward(019)+writebackGlobalDocs(020)**（同 DEC-022，不调 recoverMerge）。合并后 `syncMainWorktreeFile` 同步 .result.md 到主工作区（ISS-014）。bin 入口 src/cli/index.ts 无需改动;framework.ts 注册延续 ISS-013。task-review.ts 复用 task-run.ts 的导出助手（createFsGlobalDocRepo / sequentialIdAllocator），并就地重实现 task-run.ts 未导出的 3 个私有助手（rebaseAndFastForwardMerge / syncMainWorktreeFile / appendMergeConflictIssue，见 ISS-015）。详见 DEC-023（proposed）+ ISS-015 / ISS-016（low/medium，open）。"
    - section: 建议下一个任务
      mode: replace
      content: "- TASK-028：Infra MCP 适配骨架（layer: `data`，depends TASK-001 ✅）。落地 `src/infrastructure/sdk/mcp/` MCP 适配骨架（§3.1 Claude Agent SDK 与 MCP 后置接入）。CLI P8 命令（init/plan/task:create/status/rebuild-index/task:run/task:review）中 task:review（TASK-027）已就位;仅剩 plan/task:create（TASK-024，被 TASK-029 阻塞）。备选：TASK-029（App 规划工作流，layer: `domain`，depends TASK-003/011/015/016 ✅）—— 完成后解除 TASK-024 阻塞（plan/task:create 依赖之）。按「编号最小」规则下一个为 TASK-028。"
    - section: 当前未解决问题摘要
      mode: append
      content: "- ISS-015（low，open）新增自 TASK-027：task-review.ts 与 task-run.ts 存在重复合并逻辑——task-run.ts 的 3 个私有助手（rebaseAndFastForwardMerge / syncMainWorktreeFile / appendMergeConflictIssue）未导出，task-review.ts 因 allowed_paths 不含 task-run.ts 就地重实现相同逻辑（AGENTS §3 重复逻辑）;另 task-review.ts 跨命令 import task-run.ts 的 2 个导出助手（createFsGlobalDocRepo / sequentialIdAllocator）。建议后续任务扩 allowed_paths 抽取 cli 共享助手模块（如 src/cli/shared/）收口。不阻塞本任务验收。详见 ISS-015。\n- ISS-016（medium，open）新增自 TASK-027：task:review 默认 `LocalReviewer` 确定性产 `approved`（§12「SDK 未就位用本地审查器兜底，避免阻塞」，复用 TASK-022 DryRun 哲学），**不经真实审查**直接 approve→done→合并。生产使用必须注入真实 Reviewer（SDK 就位后，ISS-012/DEC-019 延伸）;当前 `caw task:review <id>` 无注入时即自动放行。建议后续在 framework 注册层对默认 LocalReviewer 给出显著告警，或要求显式 `--allow-local-reviewer`。不阻塞本任务验收（§12 明文允许本地兜底）。详见 ISS-016。"
  decisions:
    - id: DEC-023
      title: task:review 设计——Reviewer 注入式契约（复用 TASK-022 模式）+ LocalReviewer 兜底 + applyReview 经 cli 路由适配器 + 合并复用 019+020
      status: proposed
      scope: cli（task:review 审查编排）
      created_from_task: TASK-027
      decision: |
        task:review 的审查引擎以注入式 `Reviewer` 契约承载（review(input)→ReviewOutcome），
        复用 TASK-022 Executor 的「注入式句柄」模式（§12「reviewer agent 可复用 TASK-022 契约」）。
        SDK 未就位（ISS-012）时默认 `LocalReviewer` 确定性产 approved 兜底（与 DryRunLocalExecutor
        产 completed 同义：让 done+合并链路在无模型环境可联调，§12「避免阻塞」）。真实 reviewer agent
        待 SDK 选型后注入。状态映射统一走 `StateOrchestrator.applyReview`（§15 四映射），其 skipped 分支
        内部 readResult 需读 worktree 的 .result.md，而 task 状态权威在 main——经 cli 层 `reviewOrchestratorRepo`
        路由适配器组合双仓储（readTask/writeTask→main、readResult→worktree，ISS-009 路由细化）。
        合并走 rebaseAndFastForward(019)+writebackGlobalDocs(020)（同 DEC-022，不调 recoverMerge）。
      rationale: |
        Reviewer 与 Executor 同属「cli composition root 注入的执行引擎适配」（ARCHITECTURE §4：
        executor-contract 仅被 cli 依赖），故复用注入式句柄模式而非在 application 定义新端口。
        applyReview 的 skipped 分支读 .result.md，而 .result.md 在 worktree（task:run 产物，尚未合并入
        main）、task 状态权威在 main——单 TaskDocRepository 无法兼顾，故在 cli 层组合双仓储做路由
        （application 层不感知，结构类型满足 TaskDocRepositoryPort）。LocalReviewer 默认 approved
        系 §12「避免阻塞」的直接落地（needs-human/rejected 均阻塞，唯 approved 放行）。
      consequences: |
        task:review 的审查能力当前依赖注入;默认 LocalReviewer 不做真实审查（ISS-016），生产须注入
        真实 Reviewer。路由适配器为 cli 层组合，ISS-009 的「按 taskId 路由」在此细化为「按文档类型路由」
        （task→main / result→worktree），未来多 worktree 并行审查可沿用此模式。合并机械与 task:run 一致
        （DEC-022），021 仍仅作崩溃续跑。
  issues:
    - id: ISS-015
      title: task-review.ts 与 task-run.ts 重复合并逻辑（3 私有助手就地重实现）+ 跨命令 import，建议抽取 cli 共享助手模块
      status: open
      severity: low
      scope: cli（task-review.ts / task-run.ts）
      created_from_task: TASK-027
      owner: ""
      recommended_action: "task-run.ts 的 rebaseAndFastForwardMerge / syncMainWorktreeFile / appendMergeConflictIssue 三个私有助手未导出，task-review.ts 因本任务 allowed_paths 不含 task-run.ts、且遵循 self-contained 命令惯例（既有 cli 命令无跨命令 import），就地重实现了相同逻辑（AGENTS §3 重复逻辑）。另 task-review.ts 跨命令 import 了 task-run.ts 的 2 个导出助手（createFsGlobalDocRepo / sequentialIdAllocator）。建议后续任务扩 allowed_paths 抽取 cli 共享助手模块（如 src/cli/shared/merge-helpers.ts / fs-global-doc.ts），由 task-run.ts 与 task-review.ts 共同复用，收口合并机械与全局文档 fs 适配。不阻塞本任务验收（逻辑一致、测试覆盖）。"
    - id: ISS-016
      title: task:review 默认 LocalReviewer 确定性产 approved 不经真实审查，生产须注入真实 Reviewer
      status: open
      severity: medium
      scope: cli（task:review LocalReviewer）
      created_from_task: TASK-027
      owner: ""
      recommended_action: "task:review 默认 Reviewer 为 LocalReviewer，确定性产 approved（§12「SDK 未就位用本地审查器兜底，避免阻塞」，复用 TASK-022 DryRunLocalExecutor 哲学）。当前 caw task:review <id> 无注入时即自动放行 approve→done→合并，不经任何真实审查。SDK 就位（ISS-012/DEC-019）后应由上层注入真实 reviewer agent。建议在 SDK 未就位期间于 framework 注册层对默认 LocalReviewer 输出显著告警，或要求显式 --allow-local-reviewer 标志以避免误用。不阻塞本任务验收（§12 明文允许本地兜底）。"
next_action: review
---

# TASK-027 执行结果

## 1. 执行结论

TASK-027（CLI task:review 命令）已完成。落地 `src/cli/commands/task-review.ts`，作为 Reviewer
审查编排入口组合下游（TASK-017 applyReview + TASK-019/020 合并回写），并以 13 项 e2e/单测验证全链路。

核心链路：读任务（main frontmatter 权威，状态须 `reviewing`）→ 定位 worktree（task:run 产物）→
读 .result.md（worktree）→ no_review 生成 `review_result: skipped` 占位 / 否则调注入 Reviewer
产出 approved|rejected|needs-human → 写 .review.md（main，§5.3 与执行事实分离）→
StateOrchestrator.applyReview 映射状态（经 cli 路由适配器：task→main、result→worktree）→
approved→done 才 rebaseAndFastForward（019）+ writebackGlobalDocs（020）合并回收;rejected/blocked
保留 worktree 不合并;合并冲突 → done→blocked + appendMergeConflictIssue。

## 2. 关键设计决策

- **Reviewer 注入式契约（复用 TASK-022 模式，DEC-023）**：审查引擎以注入式 `Reviewer` 接口承载
  （review(input)→ReviewOutcome），与 TaskExecutor 同属 cli composition root 注入的执行引擎适配
  （ARCHITECTURE §4）。SDK 未就位（ISS-012）默认 `LocalReviewer` 确定性产 approved 兜底（§12「避免阻塞」，
  与 DryRunLocalExecutor 产 completed 同义）;真实 reviewer 待 SDK 选型后注入。

- **applyReview 经 cli 路由适配器（DEC-023）**：applyReview 的 skipped 分支内部 readResult 需读
  worktree 的 .result.md，而 task 状态权威在 main——单 TaskDocRepository（单 tasksDir）无法兼顾
  （ISS-009 细化）。故在 cli 层 `reviewOrchestratorRepo(main, worktree)` 组合双仓储：
  readTask/writeTask→main（状态权威）、readResult→worktree（.result.md 所在）。StateOrchestrator
  无感知（结构类型满足 TaskDocRepositoryPort）。

- **审查结论写 main、产物在 worktree**：.review.md 写 main 仓库（Orchestrator/Reviewer 产物，
  §5.3 与 .result.md 分离）;.result.md 在 worktree（task:run 产物，合并经 rebase+ff 回收进 main）。
  故 applyReview 经路由适配器读 worktree 的 .result.md，写状态回 main。

- **合并复用 019+020（同 DEC-022）**：新鲜 review→done→merge 走 rebaseAndFastForward+
  writebackGlobalDocs，不调 recoverMerge（DEC-022：branchMerged 在 baseline 处恒真会误判）。

- **全依赖可注入**：reviewer / gitMergePort / globalDocRepo / idAllocator 均可注入，测试用 fake
  reviewer 控制 approved/rejected/needs-human、fake gitMergePort 模拟合并冲突，隔离 SDK/git 不确定性。

## 3. 实际改动文件清单

- 新建 `src/cli/commands/task-review.ts`：reviewTask + Reviewer 契约 + LocalReviewer +
  reviewOrchestratorRepo（路由适配器）+ rebaseAndFastForwardMerge / syncMainWorktreeFile /
  appendMergeConflictIssue（合并机械，就地实现，见 ISS-015）+ registerTaskReviewCommand。
- 新建 `test/cli/task-review.test.ts`：13 项测试（临时 git 仓库 + 可注入 fake reviewer/git）。
- 修改 `src/cli/framework.ts`：createProgram 追加 registerTaskReviewCommand + 注释更新
  （延续 ISS-013 同层 src/cli 增量，未碰 forbidden_paths）。
- `src/cli/index.ts`（allowed_paths 内）：经评估无需改动（runCli 已统管命令分发）。

## 4. 验证结果

- `npm run typecheck`：0 错误（strict + noUncheckedIndexedAccess + NodeNext）。
- `npm test -- cli/task-review`：13 项全绿（三种审查结论映射 + no_review skipped 双路径 +
  审查结论隔离 + 默认 LocalReviewer + 状态前置 + 合并冲突 blocked + runCli 退出码）。
- `npm run lint`：0 错误 0 警告。
- `npm test -- cli/task-run`：13 项全绿——确认改 framework.ts 注册 + import task-run 导出未引入回归。
- 环境注记（ISS-005）：本机 Node 24（ABI 137）无 better-sqlite3 预编译、无 VS Build Tools 无法
  node-gyp 重编译，故 `test/cli/status-rebuild.test.ts` 的 6 项 rebuild-index 测试（依赖 SQLite
  原生模块）无法运行——属既有环境约束，与本任务改动无关（本任务零 SQLite 依赖）。canonical Node 22
  环境下全量回归仍绿（见前序任务 result）。

## 5. 遗留 issue

- ISS-015（low，open）：task-review.ts 与 task-run.ts 重复合并逻辑（3 私有助手就地重实现）+
  跨命令 import（2 导出助手）;建议后续抽取 cli 共享助手模块。
- ISS-016（medium，open）：默认 LocalReviewer 确定性产 approved 不经真实审查，生产须注入真实
  Reviewer;建议 SDK 未就位期间对默认 LocalReviewer 给出显著告警或显式标志。
- 延续 ISS-013：framework.ts 不在 TASK-027 allowed_paths，做同层 src/cli 最小注册增量（1 行 import
  + 1 行注册 + 注释），未碰 forbidden_paths。
- 复用既有未决项：ISS-014（fastForwardMain 不检出工作区，task:review 以 syncMainWorktreeFile 补齐，
  同 task:run）、ISS-012（SDK 未就位，task:review 默认 LocalReviewer 联调）—— 均不阻塞本任务验收。

## 6. next_action

review —— 待 Reviewer 独立审查。
