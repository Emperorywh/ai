---
task_id: TASK-019
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/merge/rebase-ff.ts
  - test/application/merge/rebase-ff.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess）
  - command: npm test -- application/merge/rebase-ff
    result: passed
    notes: 6 项集成单测全绿（临时 git 仓库：单任务成功 + 多任务拓扑序 + 冲突清单不破坏 main + 冲突连带 skipped + 空集合 + 回填时序）
  - command: npm run lint
    result: passed
    notes: eslint 无报错
  - command: npm test
    result: passed
    notes: 全量回归 495 项全绿（Node 22 ABI 127，含 SQLite，原 489 + 新增 6 无回归）
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: |
        - TASK-019（App 合并 rebase-ff）已完成：`src/application/merge/rebase-ff.ts` 提供 `rebaseAndFastForward(ports, tasks, {mainRef})`，按 depends_on 拓扑序（mergeOrder）逐任务串联合并链路 rebaseOnto → listConflicts 探测 →（冲突则 abortOrCleanRebase 清理 + 返回清单；无冲突则）collectPostRebaseCommits → 回填 execution_commits → commitAuditResult → fastForwardMain，冲突任务传递后继（transitiveDependents）连带 skipped（§3.2 不得先于依赖回收），6 项临时 git 仓库集成单测。消费 GitMergePort + TaskDocRepositoryPort（经 ports.ts），不直接 import infra 实现类。
    - section: 当前系统可用能力
      mode: append
      content: |
        - 合并编排（rebase + 回填 + fast-forward）：`rebaseAndFastForward(ports, tasks, {mainRef})`（`src/application/merge/rebase-ff.ts`）按 §3.2 合并策略把 git 原语与文档读写串联为 application 合并用例。按 depends_on 拓扑序（复用 TASK-016 `mergeOrder`，先合并被依赖方）逐任务执行：`rebaseOnto(taskId, mainRef)`（冲突不抛断）→ `listConflicts(taskId)` 探测冲突 → 冲突则 `abortOrCleanRebase` 清理中间态（不破坏 main）记 conflict 清单 + 该任务传递后继（复用 TASK-008 `transitiveDependents`）连带记 skipped（§3.2「任何任务不得先于其依赖任务回收」）；无冲突则 `collectPostRebaseCommits(taskId, mainRef)` 采集 post-rebase 实现 commit（必须在 audit commit 之前，§12 风险点）→ `readResult`/`writeResult` 回填 execution_commits（仅改 frontmatter，正文保留）→ `commitAuditResult(taskId, result_file)` 提交独立 audit commit → `fastForwardMain` 线性快进回收 main（无 merge commit）。返回 `RebaseFastForwardOutcome{merged, conflicts, skipped, results}`：merged 已 ff 进 main 的任务（合并序）、conflicts 冲突清单（供 Orchestrator 转 blocked + 写 ISSUES，§7 不仲裁）、skipped 因依赖冲突连带跳过的后继（不改状态，待依赖解决重跑）。`MergeTask` 最小投影（id/depends_on/workflow_outputs.result_file，TaskFrontmatter 直接可传）、`MergePorts` 注入端口聚合（git: GitMergePort / docs: TaskDocRepositoryPort）。前序任务 ff 后 main 自然前进，后续任务 rebaseOnto 到最新 main（串行合并）。不做全局文档 section 回写（TASK-020）、不做幂等恢复（TASK-021）、不做冲突仲裁（置 blocked/写 ISSUES 归 Orchestrator）。
  decisions:
    - id: ""
      title: "rebase-ff 合并编排设计——批量拓扑序合并、冲突清单 + 传递后继 skipped、回填时序（audit 前 collect）、MergePorts 端口聚合、docs 按 taskId 路由、只产出不仲裁"
      status: proposed
      scope: application/merge/rebase-ff
      created_from_task: TASK-019
      decision: "TASK-019 对 §3.2 / 任务 §2/§7/§8/§9/§12 与 ARCHITECTURE §4 未明文的合并编排设计作如下解释并落地：（1）函数签名处理一批任务（非单任务）——depends_on 含 TASK-016 暗示用 mergeOrder 排拓扑序，§2「按拓扑序逐任务」、§3.2「合并顺序由 application 层按 depends_on 拓扑序决定」均要求本函数内部排序后逐任务合并；签名 `rebaseAndFastForward(ports, tasks, {mainRef})`，tasks 为待合并任务集合。（2）合并只用拓扑序不用并行路径重叠判定，故投影 MergeTask → SchedulerTask 时 allowed_paths 填空数组（mergeOrder/topologicalOrder 不依赖 allowed_paths，仅 detectParallelizable 用）。（3）冲突探测：rebaseOnto 冲突不抛断（GitMergePort 契约），用 listConflicts 非空判定冲突（ports.ts 注释「留待 listConflicts 探测」），冲突则 abortOrCleanRebase 清理中间态（不破坏 main）+ 返回清单，不抛断（§2「失败则返回冲突清单，不抛断」）。（4）冲突任务的传递后继连带 skipped——§3.2 硬约束「任何任务不得先于其依赖任务回收到主分支」：若被依赖方冲突未 ff，依赖方 rebase 到不含被依赖方改动的 main 仍可能 ff 成功，违反拓扑约束；故用 transitiveDependents 算冲突任务的传递后继闭包，标记 pending 跳过（不改 frontmatter 状态，仅本轮跳过，§7「不做仲裁」——置 blocked/写 ISSUES 归 Orchestrator）。（5）回填时序严格按 §12 最高风险点：collectPostRebaseCommits 必须在 commitAuditResult 之前——collect 用 main..HEAD 取实现 commit，audit commit 提交后才会出现在 HEAD，此前采集确保 execution_commits 只含实现 commit 不含 audit commit（§3.2「audit commit 只作记录载体不计入 execution_commits」）；rebase 前旧 hash 一律丢弃（collect 基线用 rebase 后的 mainRef）。（6）回填仅改 frontmatter execution_commits，writeResult body 未传保留正文（DEC-008 仓储语义）。（7）MergePorts 聚合 {git: GitMergePort, docs: TaskDocRepositoryPort}，由 CLI composition root wiring（ARCHITECTURE §4）。（8）只产出 {merged, conflicts, skipped, results}，不做合并冲突仲裁决策（§7）、不做全局文档 section 回写（TASK-020）、不做幂等恢复（TASK-021）。沿用「纯编排 + Result 判别联合 + 结构类型投影」模式（承接 DEC-004/005/014）。"
      rationale: "处理一批而非单任务：depends_on 显式列 TASK-016（mergeOrder），且 §2/§3.2 明文「按拓扑序逐任务」「合并顺序由 application 层决定」，若单任务则无需 TASK-016；批量内部排序把拓扑序逻辑封装在合并用例内，调用方（Orchestrator/CLI）一次调用完成整批合并。冲突用 listConflicts 探测而非 rebaseOnto 返回值：GitMergePort.rebaseOnto 返回 void（契约「冲突不抛断」），冲突态只能经 listConflicts（diff --diff-filter=U）或 isRebaseInProgress 探测；listConflicts 同时给出冲突文件清单（§3.2「冲突清单写入 ISSUES」所需），一石二鸟。传递后继 skipped：§3.2 拓扑约束是硬约束非仲裁——不实现 skipped 会让依赖方在依赖未回收时误 ff 进 main（违反 §3.2）；「转 blocked + 写 ISSUES」才是仲裁（改状态/写全局文档，Orchestrator 职责 §7），skipped 仅本轮跳过不改状态，二者边界清晰。回填时序：§12 明示「rebase 重写 hash，回填时机错误导致审计 hash 失真」是最高风险，collect 在 audit 前 = 用 main..HEAD（audit 尚未提交）精确取实现 commit；若 audit 在前，audit commit 会混入 main..HEAD 污染 execution_commits。MergePorts 聚合而非单 adapter 参数：合并同时需要 git 原语（rebase/ff/collect/audit）与文档读写（readResult/writeResult 回填），是两个独立 Port，聚合为单一参数贴合任务签名 `rebaseAndFastForward(adapter, task, {mainRef})` 的 adapter 语义。只产出不仲裁：§7 明文「不做合并冲突的仲裁决策（只产出冲突清单，TASK-020/Orchestrator 决策置 blocked）」，本函数返回 conflicts 清单即完成职责，blocked 状态流转归 TASK-017 StateOrchestrator、写 ISSUES 归 TASK-020。"
      consequences: "TASK-020 section 回写在 rebaseAndFastForward 成功合并后串行回写全局文档（PROGRESS/DECISIONS/ISSUES），按 §3.2「合并回写时 Orchestrator 按 depends_on 拓扑序串行处理，每次回写前基于最新主分支重读全局文档」；conflicts 清单是 TASK-020/Orchestrator 转 blocked + 写 ISSUES 的输入。TASK-021 幂等恢复用 rebaseAndFastForward 的合并链路 + branchMerged（已 ff 跳过）/ abortOrCleanRebase（清不完整 rebase）实现崩溃恢复。TASK-026 task:run 经 rebaseAndFastForward 在 Executor 产出 .result.md + 审查通过后合并回收。MergePorts.docs 需按 taskId 路由到各 worktree/docs/tasks（见 ISS-009，TaskDocRepository 单 tasksDir 无法覆盖多 worktree，wiring 归 TASK-025/026）。MergeTask 投影复用：TaskFrontmatter 直接可传（结构兼容 id/depends_on/workflow_outputs）。若 Orchestrator 认为：(a) 冲突应立即停止后续所有任务（含无依赖者）——改 pending 为「遇冲突即 break」，但会漏合并独立任务；(b) skipped 应自动转 blocked——本函数加 StateOrchestrator 依赖越界（§7 仲裁归 Orchestrator），不改；(c) 应单任务签名由调用方循环——拆分 mergeOrder 职责到调用方，但失去「拓扑序封装」。回填时序若改（collect 在 audit 后）会导致 execution_commits 含 audit commit，违反 §3.2。"
  issues:
    - id: ""
      title: "合并用例 docs port 需按 taskId 路由到各 worktree/docs/tasks，TaskDocRepository 单 tasksDir 无法覆盖多 worktree，wiring 归 TASK-025/026"
      status: open
      severity: low
      scope: application/merge/rebase-ff
      created_from_task: TASK-019
      owner: ""
      recommended_action: "rebaseAndFastForward 处理一批任务时，各任务 .result.md 分布在各自 worktree 内（Executor 产出，§3.2「worktree 中只读引用全局文档，Task Executor 把更新写入 .result.md」），合并逐任务在各自 worktree 进行（rebase/commitAuditResult/ff 均操作 task/<id> worktree）。GitMergePort 天然按 taskId 经 WorktreePort/GitMergeAdapter.worktreePath(taskId) 寻址 worktree（单 GitMergeAdapter 实例覆盖所有任务）；但 TaskDocRepositoryPort 的 readResult(taskId)/writeResult(result) 经 TaskDocRepository 单一固定 tasksDir 寻址，无法区分多 worktree 的 docs/tasks。故 CLI composition root（TASK-025/026）wiring MergePorts.docs 时须组合一个按 taskId 路由的适配器（taskId → worktreesDir/<taskId>/docs/tasks 的 TaskDocRepository），而非直接注入单 tasksDir 的 TaskDocRepository。本任务测试用闭包路由夹具（worktreeDocs）模拟该 wiring 验证编排逻辑，wiring 本身归 TASK-025/026。不阻塞 TASK-019 验收（编排逻辑经 ports 接口正确，路由是组合层职责），但 TASK-025/026 落地 CLI 时须实现该路由适配器，否则多任务合并回填 execution_commits 会写错位置（主仓库 docs/tasks 而非 worktree）。关联 DEC-016（MergePorts 设计）。"
next_action: review
---

# TASK-019 执行结果

## 1. 执行结论

已完成。实现 `rebaseAndFastForward(ports, tasks, {mainRef})`，按 §3.2 把 GitMergePort 原语与 TaskDocRepositoryPort 读写串联合并主链路：depends_on 拓扑序（mergeOrder）逐任务 `rebaseOnto → listConflicts 探测 → 冲突则 abortOrCleanRebase 清理 + 返回清单（传递后继 transitiveDependents 连带 skipped）/ 无冲突则 collectPostRebaseCommits → 回填 execution_commits → commitAuditResult → fastForwardMain`。6 项临时 git 仓库集成单测覆盖单任务成功（无 merge commit + execution_commits 不含 audit + hash 一致）、多任务拓扑序串行、冲突清单不破坏 main、冲突连带 skipped、空集合、回填时序。typecheck 0 错误、lint 无报错、全量 495 项回归全绿。经 ports.ts 依赖 infra，不直接 import infra 实现类。

## 2. 完成内容

- `rebaseAndFastForward(ports, tasks, {mainRef})`：合并主链路编排（§3.2）。
- `MergeTask`：最小投影（id / depends_on / workflow_outputs.result_file），TaskFrontmatter 直接可传。
- `MergePorts`：注入端口聚合（git: GitMergePort / docs: TaskDocRepositoryPort）。
- `MergeTaskResult`：单任务结果判别联合（ok:true 合并成功 | ok:false + conflicts 冲突清单）。
- `RebaseFastForwardOutcome`：整体结果（merged / conflicts / skipped / results）。

## 3. 修改文件

- src/application/index.ts — 追加 `export * from './merge/rebase-ff.js'`

## 4. 新增文件

- src/application/merge/rebase-ff.ts
- test/application/merge/rebase-ff.test.ts

## 5. 删除文件

暂无。

## 6. 架构决策

- DEC-016（proposed）：rebase-ff 合并编排设计——批量拓扑序合并、冲突清单 + 传递后继 skipped、回填时序（audit 前 collect）、MergePorts 端口聚合、只产出不仲裁。

## 7. 偏离计划

无源码偏离。一处组合层 wiring 约束（多 worktree docs 路由）如实记 ISS-009 提议，未自行越界改 ports 契约或在 application 层硬编码 worktree 路径。

## 8. 后续任务注意事项

- TASK-020 section 回写：在 rebaseAndFastForward 成功合并后，按 §3.2 拓扑序串行回写全局文档（每次基于最新主分支重读）；conflicts 清单是转 blocked + 写 ISSUES 的输入。
- TASK-021 幂等恢复：用 branchMerged（已 ff 跳过）+ abortOrCleanRebase（清不完整 rebase）+ 本合并链路实现崩溃恢复。
- TASK-025/026 CLI wiring：MergePorts.docs 须按 taskId 路由到 worktree/docs/tasks（ISS-009），不能直接注入单 tasksDir 的 TaskDocRepository。
- application 层经 GitMergePort / TaskDocRepositoryPort 调用，不直接 import GitMergeAdapter / TaskDocRepository（ARCHITECTURE §4）。

## 9. 未解决问题

- ISS-009（low，open）：合并用例 docs port 需按 taskId 路由到各 worktree/docs/tasks，TaskDocRepository 单 tasksDir 无法覆盖多 worktree；wiring 归 TASK-025/026。
- ISS-004 / ISS-005 / ISS-006 / ISS-007 / ISS-008 延续，本任务未触发（不引用 VerificationResultSchema；全量回归 Node 22 通过；不涉及级联状态机；不调 commitAuditResult 的 git config；不调 reset）。

## 10. 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | passed | 0 错误（strict + noUncheckedIndexedAccess） |
| `npm test -- application/merge/rebase-ff` | passed | 6 项集成单测全绿（临时 git 仓库） |
| `npm run lint` | passed | eslint 无报错 |
| `npm test`（全量） | passed | 495 项全绿（Node 22 ABI 127，含 SQLite，原 489 + 新增 6 无回归） |
