---
task_id: TASK-021
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/merge/recovery.ts
  - test/application/merge/recovery.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- application/merge/recovery
    result: passed
    notes: "5 项测试全过（ff 后崩溃 skip+补回写 / rebase 中途崩溃丢弃中间态+重 rebase / 合并未完成重 rebase 成功+补回写 / 二次恢复幂等不重复合并 / taskId 不一致抛错）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test
    result: passed
    notes: "全量 514 项无回归（原 509 + recovery 5）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-021（App 合并幂等恢复）已完成：`src/application/merge/recovery.ts` 提供 `recoverMerge(taskId, {ports, task, mainRef, writebackRequest, idAllocator})`，在合并链路（rebase / 回填 execution_commits / fast-forward / 全局文档回写）任一步崩溃后按 git 状态判定恢复——`GitMergePort.branchMerged`（等价 git branch --merged）检查 worktree 分支是否已 ff 进 main：已进入则幂等跳过合并（不 rebase / 不 ff，二次恢复不重复合并）；未进入则 `abortOrCleanRebase` 丢弃上次不完整的 rebase 中间态（幂等：有则 abort、无则 no-op），从 main 最新基线重新走 TASK-019 `rebaseAndFastForward` 合并链路。合并完成（skipped-merged / redone-merged）时补做 TASK-020 `writebackGlobalDocs` 全局文档 section 回写；冲突（redone-conflict）不回写，冲突清单随 `MergeRecoveryOutcome.mergeResult` 返回交 Orchestrator 仲裁。返回 `{taskId, action, mergeResult, writeback}`。消费 GitMergePort + TaskDocRepositoryPort + GlobalDocRepositoryPort（经 ports.ts，不直接 import infra）。5 项临时 git 仓库集成单测。合并进度不写 SQLite（从 git 状态 + frontmatter status 完全重建，§3.2）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- 合并幂等恢复：`recoverMerge(taskId, options)`（`src/application/merge/recovery.ts`）按 §3.2 把合并链路崩溃后的恢复收敛为「以 branchMerged 为唯一分叉点」的单任务用例。`branchMerged==true` → skipped-merged（跳过合并，幂等）；`branchMerged==false` → 先 `abortOrCleanRebase`（清理任何遗留 rebase 中间态，幂等 no-op）再 `rebaseAndFastForward([task])` 重合并（redone-merged 成功 / redone-conflict 冲突）。合并完成时调 `writebackGlobalDocs([writebackRequest])` 补做该任务全局文档回写（§3.2「仅补做未完成的全局文档回写」）；冲突不回写。`RecoveryPorts extends MergePorts`（git + docs）增加 `globalRepo: GlobalDocRepositoryPort`。`MergeRecoveryAction` 三态（skipped-merged / redone-merged / redone-conflict），`MergeRecoveryOutcome.writeback` 在冲突时为 null。taskId 与 task.id 一致性防御校验（不一致抛错）。不做合并进度 SQLite 写入（§3.2）、不改状态机（任务 §7）、不仲裁冲突（置 blocked / 写 ISSUES 归 Orchestrator，§7）、不改 rebase-ff/section-writeback（复用，任务 §6）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/application/merge/recovery.ts` 建立：仅 type-only import core 的 `TaskId` + 值 import 同层 `./rebase-ff.js`（rebaseAndFastForward / MergePorts / MergeTask / MergeTaskResult）+ 值 import 同层 `./section-writeback.js`（writebackGlobalDocs / IdAllocator / WritebackOutcome / WritebackRequest）+ type-only import `../ports.js` 的 `GlobalDocRepositoryPort`，零反向依赖（不 import infrastructure/cli 实现类，ARCHITECTURE §4；不依赖 SQLite——恢复判定只依赖 git 状态 + frontmatter，§3.2）。沿用「纯编排 + 判别联合 + 结构类型投影」模式（承接 DEC-014/016/017）：`recoverMerge` 把 GitMergePort 的状态判定原语（branchMerged / abortOrCleanRebase）与 TASK-019 合并链路（rebaseAndFastForward）、TASK-020 section 回写（writebackGlobalDocs）串联为幂等恢复用例。`RecoveryPorts extends MergePorts` 复用合并端口聚合 + globalRepo，结构类型兼容（CLI wiring 注入 GitMergeAdapter + 按 taskId 路由 docs 适配器 ISS-009 + 全局文档 I/O 适配器 DEC-012）。以 `branchMerged==false` 为唯一恢复分叉点——未合并时一律先 abortOrCleanRebase 再重合并，避免本编排重复实现脆弱的 rebase 目录探测（§12 难点，探测归 GitMergePort.abortOrCleanRebase 内部 TASK-018），也规避「探测到中间态才 abort、否则直接 rebase」会在 rebase 进行中二次 rebase 报错的陷阱。`noUncheckedIndexedAccess` 下 `outcome.results.find` 返回值用 undefined 守卫 + 抛错。`src/application/index.ts` 追加 `./merge/recovery.js` 再导出（NodeNext 需 `.js` 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- 合并幂等恢复复用要点（TASK-021）：`recoverMerge(taskId, {ports, task, mainRef, writebackRequest, idAllocator})`（`src/application/merge/recovery.ts`）在合并链路（TASK-019 rebase-ff + TASK-020 section 回写）任一步崩溃后由 Orchestrator 调用，按 §3.2 以 git 状态判定恢复。`RecoveryPorts` = MergePorts（git: GitMergePort / docs: TaskDocRepositoryPort）+ `globalRepo: GlobalDocRepositoryPort`，CLI composition root（TASK-025/026）wiring 注入（docs 按 taskId 路由 ISS-009、globalRepo 组合 fs + GlobalDocRepository DEC-012）。恢复分叉点唯一为 `branchMerged(taskId, mainRef)`：true → skipped-merged（跳过合并，幂等）；false → abortOrCleanRebase（幂等清理）+ rebaseAndFastForward([task]) 重合并。`MergeTask` 投影（id/depends_on/result_file，TaskFrontmatter 直接可传）供重合并；`writebackRequest`（该任务 .result.md 的 global_update_requests 包成 WritebackRequest）+ `idAllocator`（同 TASK-020）供合并完成时补回写。返回 `MergeRecoveryOutcome{taskId, action, mergeResult, writeback}`：action 三态、mergeResult.ok 区分合并成败（冲突时含 unmerged 清单）、writeback 合并完成时为 WritebackOutcome / 冲突时 null。TASK-026 task:run 在合并阶段若崩溃，重入时对每个未确认合并的任务调 recoverMerge 恢复。「补做回写」语义：合并完成时一律重新执行 writebackGlobalDocs（恢复无法判定回写是否已部分完成，§3.2 合并进度不写 SQLite）——decisions/issues 按 id 去重（幂等）、progress replace 后写者覆盖（幂等）；progress append 在重复恢复时可能重复追加（ISS-011），由 Orchestrator 控制恢复调用次数（一次崩溃一次恢复）。不做合并进度 SQLite 写入、不改状态机、不仲裁冲突（冲突清单交 Orchestrator 置 blocked + 写 ISSUES）。详见 DEC-018（proposed），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-011（low，open）新增自 TASK-021：「补做回写」无法判定全局文档回写是否已部分完成——§3.2 明文合并进度不写 SQLite，恢复只能从 git 状态（branchMerged）重建合并进度，但回写进度无对应判据。故 recoverMerge 合并完成时一律重新执行 writebackGlobalDocs：decisions/issues 按 id 去重（幂等）、progress replace 后写者覆盖（幂等），但 progress append 在同一崩溃被多次恢复时会重复追加。不阻塞验收（合并的幂等保证由 branchMerged 守住，回写重做在单次恢复内正确；append 重复仅发生在异常的重复恢复调用），建议 Orchestrator 保证「一次崩溃一次恢复」、或未来引入回写完成标记。详见 ISS-011。"
    - section: "建议下一个任务"
      mode: replace
      content: "- TASK-022：Infra Claude SDK 适配器（layer: `data`）。落地 `src/infrastructure/sdk/claude-sdk-adapter.ts` + `executor-contract.ts`，封装 Claude Agent SDK 调用为 Task Executor 执行入口（注入 context_pack、产出 .result.md），经 `executor-contract.ts` 定义 Executor 与 Orchestrator 的契约（仅被 cli task:run/task:review 依赖、不经 application，ARCHITECTURE §4）。前置已就绪（TASK-009 验证 allowlist + 权限解析、TASK-015 context pack 生成器 + ports）。是编号最小、前置完成的未完成任务，可优先推进。合并三联画（TASK-019 rebase-ff / TASK-020 section 回写 / TASK-021 幂等恢复）已全部完成，application 合并用例齐备。其余已解锁任务：TASK-029（App 规划工作流 P4 收尾）/ TASK-023~027（CLI）亦可推进。"
  decisions:
    - id: ""
      title: "recovery 合并幂等恢复编排设计——branchMerged 唯一分叉点、未合并先 abort 再重合并、合并完成补回写、冲突不回写、RecoveryPorts extends MergePorts、taskId 一致性校验"
      status: proposed
      scope: application/merge/recovery
      created_from_task: TASK-021
      decision: "TASK-021 对 §3.2 合并幂等段落与任务 §2/§7/§8/§9/§11/§12 与 ARCHITECTURE §4 未明文的恢复编排设计作如下解释并落地：（1）以 `branchMerged(taskId, mainRef)` 为唯一恢复分叉点——§3.2 明文「用 git branch --merged 检查 worktree 分支是否已进入主分支：已进入则跳过合并、未进入则丢弃中间态重新 rebase」，故恢复的真判定是「分支是否已进 main」（合并完成的 git 事实），而非「是否存在 rebase 中间态」。branchMerged==true → skipped-merged（幂等跳过，不 rebase/不 ff）；branchMerged==false → 进入重合并分支。（2）未合并时一律先 abortOrCleanRebase 再 rebaseAndFastForward——§12 难点是「识别不完整 rebase 中间态需可靠判据」；本编排不自行探测 rebase 目录（探测归 GitMergePort.abortOrCleanRebase 内部 TASK-018 isRebaseInProgress），而是「未合并即视作合并未完成，先 abort（幂等：有中间态则 abort、无则 no-op）再重合并」。这避免两个陷阱：(a) 若「探测到中间态才 abort、否则直接 rebase」，则在 rebase 进行中二次 rebase git 会直接报错；(b) 若依赖脆弱的 rebase 目录字符串探测则与 infra 重复实现。一律 abort + 重合并把「中间态」判定完全下沉到幂等的 abortOrCleanRebase，本编排只关心 branchMerged 事实。（3）合并完成（skipped-merged / redone-merged，mergeResult.ok==true）时补做 writebackGlobalDocs——§3.2「已进入则跳过合并、仅补做未完成的全局文档回写」；恢复无法判定回写是否已部分完成（合并进度不写 SQLite），故一律重新执行回写（decisions/issues 按 id 去重幂等、progress replace 后写者覆盖幂等；append 重复见 ISS-011）。冲突（redone-conflict）不回写——合并未完成不应落全局文档，冲突清单随 mergeResult 返回交 Orchestrator 仲裁置 blocked + 写 ISSUES（§3.2/§7）。（4）单任务恢复——recoverMerge 接受单个 taskId + MergeTask 投影，重合并调 rebaseAndFastForward([task])（单元素），不批量恢复（ Orchestrator 按任务逐个调，§3.2 串行）；taskId 与 task.id 一致性防御校验（不一致抛错不静默，AGENTS §4）。（5）RecoveryPorts extends MergePorts——复用 TASK-019 合并端口聚合（git + docs）增加 globalRepo（TASK-020 回写所需），结构类型兼容（CLI wiring 注入三个适配器），避免重新声明 git/docs。（6）MergeRecoveryAction 三态 + writeback 可空——outcome 用判别联合语义（mergeResult.ok 区分红蓝结局），writeback 在冲突时为 null，消费方据 action/mergeResult/writeback 决策后续（Orchestrator 据冲突转 blocked + 写 ISSUES、据 writeback.assigned ids 回填 .result.md）。沿用「纯编排 + 判别联合 + 结构类型投影」模式（承接 DEC-014/016/017）。"
      rationale: "branchMerged 唯一分叉点：§3.2 把恢复判定明文为「git branch --merged 检查是否进入主分支」，分支是否进 main 是合并完成的唯一 git 事实来源（合并进度不写 SQLite，§3.2）；以它为分叉点使恢复完全可从 git 状态重建，不依赖任何外部进度文件或内存状态。未合并先 abort 再重合并：§12 难点的可靠解——与其在本编排重复实现 rebase 中间态探测（脆弱、与 infra 重复），不如把「未合并」统一视作「合并未完成，先幂等清理再重来」；abortOrCleanRebase 已幂等（TASK-018：有 rebase 进行则 abort、无则 no-op 不抛），故「一律先 abort」对无中间态场景零成本，对有中间态场景正确清理，且规避「rebase 进行中二次 rebase 报错」陷阱。合并完成补回写：§3.2 字面「仅补做未完成的全局文档回写」；由于回写进度无判据（不写 SQLite），「补做」只能解释为「重新执行」（writebackGlobalDocs 对 decisions/issues/replace 幂等），这是「合并进度可从 git 状态完全重建」原则在回写侧的自然延伸——回写本身可重做。冲突不回写：合并未完成时落全局文档会污染主分支（§3.2 全局状态只在主分支维护），且冲突需 Orchestrator 仲裁（置 blocked/写 ISSUES）后才能决定该任务命运，不应在恢复内擅自回写。单任务恢复：合并链路是 per-task 的（§3.2 串行、TASK-019 逐任务），崩溃恢复也应 per-task（Orchestrator 逐个调），不引入批量恢复的状态复杂度；taskId 一致性校验防止调用方误传不匹配的 task 投影导致 git 操作错位（防御性，AGENTS §4 不静默）。RecoveryPorts extends MergePorts：DRY——合并端口已在 TASK-019 定义，恢复在其上仅加 globalRepo，extends 复用而非重声明，且 CLI wiring 三个适配器一次性注入。outcome 判别联合：与 rebase-ff（MergeTaskResult）/ section-writeback（WritebackOutcome）/ state-orchestrator（CascadeOutcome）同构，消费方据 action + mergeResult.ok + writeback 三维度决策，类型安全且不静默。"
      consequences: "TASK-026 task:run 在合并阶段崩溃重入时，对每个未确认合并的任务调 recoverMerge 恢复（Orchestrator 编排，逐任务串行）；据 redone-conflict 的 mergeResult.conflicts 经 TASK-017 StateOrchestrator 置 blocked + TASK-020 写 ISSUES；据 writeback.assigned_decision_ids/assigned_issue_ids 经 TaskDocRepositoryPort.writeResult 回填 .result.md 提议项 id（同 TASK-020 回写流程）。Orchestrator wiring（TASK-025/026）：RecoveryPorts 三端口同 TASK-019/020 wiring（GitMergeAdapter + 按 taskId 路由 docs 适配器 ISS-009 + globalRepo 组合 fs + GlobalDocRepository DEC-012），IdAllocator 同 TASK-020（现有最大编号+1）。若 Orchestrator 认为：(a) append 重复追加不可接受——需引入回写完成标记（如 frontmatter 字段或单独进度文件，但 §3.2 明文合并进度不写 SQLite，可能需回写专用标记，见 ISS-011）；(b) 应批量恢复多任务——改 recoverMerge 接受 tasks[]（但失去 per-task 的清晰恢复边界，且 Orchestrator 已串行调度，不推荐）；(c) 冲突也应回写——需定义冲突任务的 global_update_requests 落盘策略（但合并未完成不应落全局状态，不推荐）；(d) branchMerged 之外应额外探测 rebase 中间态做更细粒度恢复——需在本编排引入 rebase 目录判定（与 infra isRebaseInProgress 重复，违背单一来源，不推荐）。新增 MergeRecoveryAction 取值时 switch/条件分支需同步（当前用 if/else +三元，TS 不强制穷尽但建议保持）。"
  issues:
    - id: ""
      title: "「补做回写」无法判定全局文档回写是否已部分完成——progress append 在同一崩溃被多次恢复时会重复追加（合并进度不写 SQLite 的必然结果）"
      status: open
      severity: low
      scope: application/merge/recovery
      created_from_task: TASK-021
      owner: ""
      recommended_action: "Readme §3.2 line 125 明文合并操作幂等可恢复、合并进度不写 SQLite（可从 git 状态加 frontmatter status 完全重建），并把恢复分两路：「已进入则跳过合并、仅补做未完成的全局文档回写；未进入则丢弃中间态重新 rebase」。但「仅补做未完成」隐含一个判定：回写是否已（部分）完成。由于合并进度（含回写进度）不写 SQLite，恢复只能从 git 状态（branchMerged）重建「合并」进度，无法重建「回写」进度——branchMerged==true 仅说明合并已完成，不说明回写是否已落盘。故 TASK-021 recoverMerge 合并完成时一律重新执行 writebackGlobalDocs：对 decisions/issues（按 id 去重）与 progress replace（后写者覆盖）幂等，但 progress append（按拓扑序拼接）在同一崩溃被多次恢复调用时会重复追加同一 content。不阻塞验收（合并的幂等保证由 branchMerged 守住，单次恢复内回写正确；append 重复仅在异常的「同一崩溃多次 recoverMerge」时发生）。建议（任选其一，待 Orchestrator 裁定）：(A) 接受现状 + 规定 Orchestrator「一次崩溃一次恢复」（推荐，最简，契合 §3.2 不写进度）；(B) 引入回写完成标记（如 .result.md frontmatter 增 writeback_applied 字段，但与 §3.2「合并进度不写 SQLite」精神需权衡——frontmatter 非 SQLite，可接受）；(C) writebackGlobalDocs 对 append 也做幂等化（如按 content 去重，但 append 语义本就是叠加，去重会破坏合法的重复 append）。详见 DEC-018。"
next_action: review
---

# TASK-021 执行结果

## 1. 执行结论

任务完成。实现了 `recoverMerge(taskId, { ports, task, mainRef, writebackRequest, idAllocator })`,在合并链路(rebase / 回填 execution_commits / fast-forward / 全局文档回写)任一步崩溃后按 git 状态判定恢复:以 `branchMerged` 为唯一分叉点——已进 main 则幂等跳过合并,未进则先 `abortOrCleanRebase` 清理中间态再重走 `rebaseAndFastForward`;合并完成时补做 `writebackGlobalDocs` 回写,冲突不回写。5 项临时 git 仓库集成单测全绿(含 §12 要求的真实 rebase 中间态构造),typecheck / lint 0 错误,全量 514 项无回归。

## 2. 完成内容

- 新建 `src/application/merge/recovery.ts`:
  - `recoverMerge(taskId, options): MergeRecoveryOutcome`——幂等恢复编排。
  - `branchMerged(taskId, mainRef)` 判定 → true: skipped-merged(跳过合并);false: `abortOrCleanRebase`(幂等清理)+ `rebaseAndFastForward([task])` 重合并(redone-merged / redone-conflict)。
  - 合并完成(`mergeResult.ok`)时调 `writebackGlobalDocs([writebackRequest])` 补回写;冲突时 `writeback = null`。
  - 类型:`RecoveryPorts`(extends MergePorts + globalRepo)、`MergeRecoveryAction`(三态)、`MergeRecoveryOutcome`。
  - taskId 与 task.id 一致性防御校验(不一致抛错)。
- `src/application/index.ts` 追加 `export * from './merge/recovery.js'`。
- 新建 `test/application/merge/recovery.test.ts`(5 项,临时 git 仓库):
  1. ff 后崩溃(分支已进 main):幂等跳过合并 + 补回写,不 rebase / 不 ff。
  2. rebase 中途崩溃(冲突留真实中间态):丢弃中间态 + 重 rebase,冲突清单返回不抛断,中间态已清理,不回写。
  3. 合并未完成(分支未进 main、无中间态):丢弃(no-op)+ 重 rebase 成功 + 补回写,execution_commits 正确回填。
  4. 二次恢复幂等:redone 后再恢复命中已进 main,rebaseOnto 调用数不增加(不重复合并)。
  5. taskId 与 task.id 不一致抛错。

## 3. 修改文件

- `src/application/index.ts`(追加一行 recovery 导出)

## 4. 新增文件

- `src/application/merge/recovery.ts`
- `test/application/merge/recovery.test.ts`
- `docs/tasks/TASK-021-app-merge-recovery.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-018(proposed):recovery 合并幂等恢复编排设计六要点(branchMerged 唯一分叉点 / 未合并先 abort 再重合并规避中间态探测陷阱 / 合并完成补回写 / 冲突不回写 / 单任务恢复 + taskId 一致性校验 / RecoveryPorts extends MergePorts / outcome 判别联合)。详见 frontmatter `global_update_requests.decisions`。

## 7. 偏离计划

无规格偏离。`recoverMerge` 行为与任务 §2 / §9 一致:已进入→跳过合并+补回写,未进入→丢弃中间态+重 rebase;恢复判定只依赖 git 状态(branchMerged)+ 复用 TASK-019/020(任务 §8);不把合并进度写 SQLite、不改状态机(任务 §7);不改 rebase-ff.ts / section-writeback.ts(任务 §6 复用)。§11 验收三项(ff 后崩溃 / rebase 中途崩溃 / 二次恢复幂等)均有对应测试覆盖。§12 难点(不完整 rebase 中间态判据)以「branchMerged==false 即一律先 abortOrCleanRebase 再重合并」化解——把中间态探测下沉到幂等的 abortOrCleanRebase(TASK-018),本编排不重复实现。

签名 `recoverMerge(taskId, { ports, task, mainRef, writebackRequest, idAllocator })` 是任务 §2 草图 `recoverMerge(taskId, { adapter, repos })` 的具体化:`ports` 聚合 git + docs + globalRepo(adapter + repos),task / mainRef / writebackRequest / idAllocator 为重合并 + 补回写所需的额外入参。taskId 作为首参(草图保留)与 task 投影并存,二者一致性校验。

## 8. 后续任务注意事项

- **冲突仲裁归 Orchestrator**:redone-conflict 时 recoverMerge 不回写、不置 blocked,冲突清单随 `mergeResult.conflicts` 返回。Orchestrator 据此经 TASK-017 StateOrchestrator 置 blocked + TASK-020 写 ISSUES(§3.2/§7)。
- **assigned id 回填 .result.md 归 Orchestrator**:补回写的 `writeback.assigned_decision_ids/assigned_issue_ids`(来源任务 → id)由 Orchestrator 经 TaskDocRepositoryPort.writeResult 回填对应 .result.md(同 TASK-020 流程)。
- **一次崩溃一次恢复**:ISS-011——恢复无法判定回写是否部分完成,合并完成时一律重做 writebackGlobalDocs;progress append 在异常的重复恢复时会重复追加。Orchestrator 应保证每个崩溃任务只调一次 recoverMerge。
- **TASK-026 task:run 合并阶段崩溃重入**时,对每个未确认合并的任务逐个调 recoverMerge(串行,§3.2)。
- **RecoveryPorts wiring**(TASK-025/026):GitMergeAdapter + 按 taskId 路由 docs 适配器(ISS-009)+ globalRepo 组合 fs + GlobalDocRepository(DEC-012),IdAllocator 同 TASK-020。

## 9. 未解决问题

- ISS-011(low,open):「补做回写」无法判定回写是否部分完成,progress append 在重复恢复时可能重复追加(详见 frontmatter issues / DEC-018)。不阻塞验收。
- 已有 ISS-005(better-sqlite3 Node 版本)/ ISS-006(级联张力)/ ISS-007(git 身份)/ ISS-008(reset 基线跨进程)/ ISS-009(docs 多 worktree 路由)/ ISS-010(append/replace 混合冲突语义)均与本任务无直接触发:本任务纯编排经 ports 消费 git/docs/globalRepo,不依赖 SQLite、不改状态机、不触发级联;ISS-009(docs 路由)在 RecoveryPorts.docs 上延续(测试用 worktreeDocs 路由夹具验证),维持现状。

## 10. 验证结果

- `npm run typecheck`:0 错误(tsc --noEmit 覆盖 src + test,strict + noUncheckedIndexedAccess)。
- `npm test -- application/merge/recovery`:5 项全过。
- `npm run lint`:0 错误。
- `npm test`:全量 514 项全过(原 509 + recovery 5,无回归)。

本任务测试用真实 git 仓库(临时目录)构造真实 rebase 中间态(§12 要求),不依赖 SQLite 原生模块(recovery 纯编排经 ports 消费 git/docs/globalRepo);typecheck/test/lint 在当前 Node(已为 v22)下全绿。

## 11. 人工验收建议

- 重点检查恢复分叉点:以 `branchMerged==false` 为唯一判据,未合并时一律先 `abortOrCleanRebase` 再重合并——不自行探测 rebase 目录(§12 难点的可靠解)。
- 检查「ff 后崩溃」测试:恢复跳过合并(rebaseOnto / fastForwardMain 未调用、main HEAD 不变)+ 补回写(PROGRESS 写盘)。
- 检查「rebase 中途崩溃」测试:构造真实 rebase 中间态(existsSync rebase-merge == true),恢复后中间态清理干净、冲突清单返回、main 未破坏、不回写。
- 检查「二次恢复幂等」测试:redone 后二次恢复 rebaseOnto 调用数不增加(分支已进 main → skip)。
- 检查 ISS-011 的「补做回写一律重做」语义是否符合预期(append 重复风险)。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`:progress 六条 section 更新(完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-022)、DEC-018(proposed)、ISS-011(low,open)。
