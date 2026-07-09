---
task_id: TASK-026
execution_status: completed
modified_files:
  - src/cli/framework.ts
created_files:
  - src/cli/commands/task-run.ts
  - test/cli/task-run.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess + NodeNext）
  - command: npm test -- cli/task-run
    result: passed
    notes: 13 项单测全绿（DryRun reviewing/done e2e + 依赖检查 + 状态/权限前置 + 合并冲突 blocked + parseTestingCommands + runCli 退出码）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告
  - command: npm test
    result: passed
    notes: 全量 572 项通过（含本任务 13 项，既有 559 项无回归）
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: "- TASK-026（CLI task:run 命令）已完成：`src/cli/commands/task-run.ts` 提供 `runTask(taskId, options)`（执行编排集成入口：依赖前置检查 → refreshSourceFiles 刷新并回写 context_pack → resolvePathScope 拒绝重叠启动 + computeVerificationAllowlist 组装权限边界 → ready→running → WorktreeAdapter.create → R7 restoreNodeModules → buildStartupPrompt → Executor 执行 → 读 .result.md（worktree）→ StateOrchestrator.applyResult 流转；reviewing 不合并、done（no_review 校验通过）才 rebaseAndFastForward+writebackGlobalDocs 合并回收、合并冲突 done→blocked + appendMergeConflictIssue）+ `registerTaskRunCommand(program)`（`task:run <taskId> [--main-ref] [--worktrees-dir] [--project-root]`）。默认 DryRunLocalExecutor，executor/gitMergePort/globalDocRepo/idAllocator/nodeModulesRestorer/testingCommands 全可注入（测试隔离 git/SDK）。`src/cli/framework.ts` createProgram 追加注册（同层 src/cli 必要增量，延续 ISS-013）。13 项 e2e/单测（临时 git 仓库 + DryRun + 可注入 fake git/executor）。"
    - section: 当前系统可用能力
      mode: append
      content: "  - CLI task:run 命令：`runTask(taskId, options)`（`src/cli/commands/task-run.ts`）是执行编排集成入口，组合 7 个下游（TASK-015/017/018/019/020/021/022）。链路：读任务（main 仓库 frontmatter 权威）→ 状态须 ready → `checkDependenciesDone`（全部 depends_on 须 done，否则拒绝）→ `refreshSourceFiles`+`computeContextPack` 刷新并回写 context_pack → `buildPermissionBoundary`（resolvePathScope 重叠拒绝启动 + computeVerificationAllowlist layer 裁剪并集）→ `StateOrchestrator.transition` ready→running → `WorktreeAdapter.create`（独立 worktree + 分支 task/TASK-XXX）→ `restoreNodeModules`（R7：install_dependencies 则 npm install，否则 junction/symlink 复用主工作区）→ `buildStartupPrompt` + `executor.execute`（worktree 内写 .result.md）→ 读 result（worktree）→ `StateOrchestrator.applyResult`（orchestratorVerified=产物无 failed）→ reviewing 不合并 / done 才 `rebaseAndFastForwardMerge`（TASK-019，docs port 路由 worktree）+ `writebackGlobalDocs`（TASK-020）+ `syncMainWorktreeFile` / 冲突则 done→blocked + `appendMergeConflictIssue`。CLI composition root 直接 wiring infra（TaskDocRepository/WorktreeAdapter/GitMergeAdapter/GlobalDocRepository 经 createFsGlobalDocRepo 适配）。退出码/错误输出经 runCli 统一。"
    - section: 后续任务必须知道的信息
      mode: append
      content: "- CLI task:run 命令复用要点（TASK-026）：`runTask` 默认 `DryRunLocalExecutor`，executor / gitMergePort / globalDocRepo / idAllocator / nodeModulesRestorer / testingCommands 全可注入（测试用 fake executor 模拟产物未通过、fake gitMergePort 模拟合并冲突）。状态权威在 **main 仓库** frontmatter（TaskDocRepository 读写 ready→running→reviewing/done）；执行产物（.result.md）在 **worktree**（Executor 写、合并经 rebase+ff 回收进 main）—— 故 applyResult 接收 result 作参数（从 worktree 读后传入），StateOrchestrator 仍用 main 仓库做 task 状态流转。合并 docs port 按 taskId 路由到 worktree 的 docs/tasks（ISS-009 在本命令落地：`new TaskDocRepository(join(wtPath,'docs','tasks'))`）。**新鲜合并走 rebaseAndFastForward(019)+writebackGlobalDocs(020)**；recoverMerge(021) **不能**作新鲜合并入口（见 DEC-022：其 branchMerged 在 baseline 处恒真会误判已合并而跳过未提交产物的合并）。合并后 `syncMainWorktreeFile` 用 `git checkout <mainRef> -- <result_file>` 把已进 main 历史的产物同步到主工作区（fastForwardMain 用 update-ref 不检出工作区，见 ISS-014）。R7 node_modules：声明 install_dependencies 则 worktree 内 npm install，否则 junction/symlink 复用主工作区 node_modules（无 copy 回退）。bin 入口 src/cli/index.ts 无需改动（runCli 统管）；framework.ts 注册延续 ISS-013。详见 DEC-022（proposed）+ ISS-014（low，open）。"
    - section: 建议下一个任务
      mode: replace
      content: "- TASK-027：CLI task:review 命令（layer: `page`，depends_on TASK-011/017/019/020/021 均 ✅）。落地 `src/cli/commands/task-review.ts`，按 §15 把 .review.md（approved/rejected/needs-human）映射为任务状态 + 对应合并 / blocked 处理（复用 TASK-017 applyReview + TASK-019/020 合并回写）。CLI 框架（TASK-023）+ status/rebuild-index（TASK-025）+ task:run（TASK-026）就位。注意 allowed_paths 应含 `src/cli/framework.ts`（ISS-013）。其余已解锁任务：TASK-028（MCP 适配骨架，depends TASK-001 ✅）/ TASK-029（App 规划工作流，depends TASK-003/011/015/016 ✅，解锁后解除 TASK-024 阻塞）。"
    - section: 当前未解决问题摘要
      mode: append
      content: "- ISS-014（low，open）新增自 TASK-026：`GitMergeAdapter.fastForwardMain`（TASK-018）用 `git update-ref` 移动 ref、不检出工作区文件，合并产物（.result.md）进入 main 历史但主工作区缺该文件，`caw status` 读工作区会误判「未执行」。task:run 以 `syncMainWorktreeFile`（`git checkout <mainRef> -- <result_file>`，仅检出结果文件、不动任务 status 工作区写回）针对性补齐。建议 TASK-018 的 fastForwardMain 或后续任务考虑统一的工作区同步策略（如 ff 后 checkout 受影响路径）。详见 ISS-014。"
  decisions:
    - id: DEC-022
      title: task:run 新鲜合并走 rebaseAndFastForward+writebackGlobalDocs，recoverMerge 留作崩溃续跑
      status: proposed
      scope: cli（task:run 合并编排）
      created_from_task: TASK-026
      decision: |
        task:run 的「done 免审合并」走 rebaseAndFastForward（TASK-019）+ writebackGlobalDocs（TASK-020）；
        recoverMerge（TASK-021）不作为新鲜合并入口，仅作为「合并链路崩溃后续跑 task:run 时」的恢复机制
        （由上层按 git 状态触发）。合并冲突（019 返回 conflicts）由 task:run 直接置 done→blocked
        （Orchestrator confirmed）+ appendMergeConflictIssue，不经 021。
      rationale: |
        recoverMerge 以 GitMergePort.branchMerged（git merge-base --is-ancestor branch main）为唯一恢复分叉点。
        对 DryRun（及任何「产出未提交 .result.md」的执行器）的新鲜执行：worktree 分支从 main 基线创建、
        Executor 仅写出未提交产物、分支 HEAD == main 基线 → branchMerged 恒为真（commit 是自身的祖先），
        recoverMerge 会判「已合并」而 skipped-merged 跳过合并、仅补回写，导致未提交产物永不进入 main。
        rebaseAndFastForward 经 commitAuditResult（git add + commit）把未提交产物落盘后再 fast-forward，
        是新鲜合并的正确路径。021 的 branchMerged 语义假设「合并已被尝试过」，与新鲜执行的前置状态不兼容。
      consequences: |
        task:run 单次成功执行不调用 recoverMerge；崩溃续跑（重入 task:run 时任务可能已 running + 部分合并）
        需上层状态检测 + 021 假设对齐，本任务未实现（单次 e2e 不触发），留作后续。task:review（TASK-027）
        的合并可复用同一 019+020 路径。021 在「合并已部分完成（如已 commitAuditResult 但未 ff）」的崩溃
        续跑下仍可能因 branchMerged 假设而重复审计提交——续跑幂等性需进一步设计（本任务范围外）。
  issues:
    - id: ISS-014
      title: fastForwardMain 用 update-ref 不检出工作区，task:run 需手动同步主工作区结果文件
      status: open
      severity: low
      scope: cli（task:run）/ infrastructure（git worktree-adapter fastForwardMain）
      created_from_task: TASK-026
      owner: ""
      recommended_action: "GitMergeAdapter.fastForwardMain（TASK-018）以 git update-ref 移动 refs/heads/main，不更新主仓库工作区文件。合并后 .result.md 已在 main 历史但主工作区缺失，caw status（读工作区）会误判任务「未执行」。task:run 已以 syncMainWorktreeFile（git checkout <mainRef> -- <result_file>，针对性检出、不动任务 status 工作区写回）补齐。建议后续在 fastForwardMain 或专门步骤统一处理工作区同步（ff 后 checkout 受影响路径），或在 status 命令层从 git 历史回退读取结果。"
next_action: review
---

# TASK-026 执行结果

## 1. 执行结论

TASK-026（CLI task:run 命令）已完成。落地 `src/cli/commands/task-run.ts`，作为执行编排集成入口
组合 7 个下游（TASK-015/017/018/019/020/021/022），并以 13 项 e2e/单测验证全链路。

核心链路：读任务（main frontmatter 权威）→ 状态须 ready → 依赖全部 done 检查 →
refreshSourceFiles 刷新并回写 context_pack → resolvePathScope 拒绝路径重叠启动 +
computeVerificationAllowlist 组装权限边界 → StateOrchestrator.transition ready→running →
WorktreeAdapter.create（独立 worktree + 分支 task/TASK-XXX）→ R7 restoreNodeModules →
buildStartupPrompt + Executor 在 worktree 执行产出 .result.md → 读 result（worktree）→
StateOrchestrator.applyResult 流转。reviewing 不合并（提示 task:review）；done（no_review 校验通过）
才 rebaseAndFastForward（019）+ writebackGlobalDocs（020）合并回收；合并冲突 → done→blocked +
appendMergeConflictIssue。

## 2. 关键设计决策

- **状态权威在 main、产物在 worktree**：任务 status 流转写回 main 仓库 frontmatter（§3.2 全局状态由
  Orchestrator 维护）；Executor 产物（.result.md）落在 worktree。故 applyResult 接收 result 作参数
  （从 worktree 读后传入），StateOrchestrator 用 main 仓库做 task 状态流转；合并 docs port 按 taskId
  路由到 worktree 的 docs/tasks（ISS-009 在本命令 wiring 落地）。

- **新鲜合并走 019+020，021 留作崩溃续跑**（DEC-022）：recoverMerge 以 branchMerged 为分叉点，对
  DryRun 这类「产出未提交 .result.md」的新鲜执行，baseline 处 branchMerged 恒真会误判已合并而跳过，
  导致未提交产物永不进 main。rebaseAndFastForward 经 commitAuditResult 把未提交产物落盘后 ff，是
  新鲜合并的正确路径。

- **全依赖可注入**：executor / gitMergePort / globalDocRepo / idAllocator / nodeModulesRestorer /
  testingCommands 均可注入，测试用 fake executor 模拟「产物未通过」、fake gitMergePort 模拟合并冲突，
  隔离 git/SDK 不确定性（任务 §12 集成风险集中点）。

## 3. 实际改动文件清单

- 新建 `src/cli/commands/task-run.ts`：runTask + registerTaskRunCommand + 辅助（rebaseAndFastForwardMerge /
  buildPermissionBoundary / restoreNodeModules / createFsGlobalDocRepo / appendMergeConflictIssue /
  syncMainWorktreeFile / parseTestingCommands / sequentialIdAllocator 等）。
- 新建 `test/cli/task-run.test.ts`：13 项测试（临时 git 仓库 + DryRun e2e + 可注入 fake）。
- 修改 `src/cli/framework.ts`：createProgram 追加 registerTaskRunCommand（延续 ISS-013 同层 src/cli 增量）。
- `src/cli/index.ts`（allowed_paths 内）：经评估无需改动（runCli 已统管命令分发）。

## 4. 验证结果

- `npm run typecheck`：0 错误（strict + noUncheckedIndexedAccess + NodeNext）。
- `npm test -- cli/task-run`：13 项全绿。
- `npm run lint`：0 错误 0 警告。
- `npm test`：全量 572 项通过（既有 559 + 本任务 13，无回归）。

## 5. 遗留 issue

- ISS-014（low，open）：fastForwardMain 用 update-ref 不检出工作区，task:run 以 syncMainWorktreeFile 补齐；
  建议后续统一工作区同步策略。
- 延续 ISS-013：framework.ts 不在 TASK-026 allowed_paths，做同层 src/cli 最小注册增量（1 行 import +
  1 行注册），未碰 forbidden_paths。
- 复用既有未决项：ISS-008（reset 基线跨进程持久化，task:run 单进程 create→execute 链路不触发）、
  ISS-012（SDK 未就位，task:run 默认 DryRun 联调）—— 均不阻塞本任务验收。

## 6. next_action

review —— 待 Reviewer 独立审查。
