---
task_id: TASK-020
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/merge/section-writeback.ts
  - test/application/merge/section-writeback.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- application/merge/section-writeback
    result: passed
    notes: "14 项测试全过（progress section 合并 6 + decisions/issues id 分配去重 5 + 综合 3）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test -- application
    result: passed
    notes: "application 全量 106 项无回归（含 rebase-ff 6 项）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-020（App 合并 section 回写与冲突）已完成：`src/application/merge/section-writeback.ts` 提供 `writebackGlobalDocs(globalRepo, orderedRequests, {idAllocator})`，按合并拓扑序串行回写三份全局文档——PROGRESS 经 `applyProgressUpdate` 做 section 级合并（同 section 多条 replace 后写者覆盖、先写者落冲突清单；append 按拓扑序叠加，落选 replace 跳过不 apply），DECISIONS/ISSUES 经注入 `IdAllocator` 分配 DEC-XXX/ISS-XXX 后按 id 去重追加（usedIds = 既有 ∪ 批次内已分配，保证不撞既有且批次内唯一），返回 `WritebackOutcome{docs, progress_conflicts, assigned_decision_ids, assigned_issue_ids}`（只产出不仲裁，冲突清单供 Orchestrator 置 blocked / 落 ISSUES）。消费 GlobalDocRepositoryPort（经 ports.ts，不直接 import infra）。14 项单测。"
    - section: "当前系统可用能力"
      mode: append
      content: "- 全局文档 section 回写：`writebackGlobalDocs(globalRepo, orderedRequests, {idAllocator})`（`src/application/merge/section-writeback.ts`）按 §3.2 把 rebaseAndFastForward（TASK-019）成功合并后的 global_update_requests 串行回写到 PROGRESS/DECISIONS/ISSUES。按合并拓扑序（输入顺序）逐条处理：progress 扁平化 + 冲突检测（同 section 多 replace 仅保留拓扑序最后一条，其余入 `ProgressWritebackConflict{section, task_id, content, superseded_by}`）→ 重读 PROGRESS → 逐条 applyProgressUpdate（append 总 apply、未落选 replace apply、落选 replace 跳过）→ 写回；decisions/issues 重读 → readDecisions/readIssues 取既有非空 id 集合 → 对每条提议项（id 空则 `idAllocator.nextDecisionId/nextIssueId(usedIds)` 分配、非空沿用）逐条 appendDecision/appendIssue（按 id 去重：命中既有则替换、否则文末追加）→ 写回。`IdAllocator` 无状态注入（接收 usedIds 返回不冲突新 id，编号策略由实现决定，单一分配点）。`WritebackRequest{task_id, updates}` 来源任务 + 其 global_update_requests，ResultFrontmatter.global_update_requests 直接可传。单次调用串行（§3.2/§12 无并发），有请求才合并+写盘、无请求保留原文不写。不直接置 blocked（冲突清单交 Orchestrator，§7）、不回写 .result.md 提议项 id（assigned ids 交 Orchestrator 经 TaskDocRepositoryPort）、不做幂等恢复（TASK-021）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/application/merge/section-writeback.ts` 建立：仅 type-only import core 的 `Decision`/`GlobalUpdateRequests`/`Issue`/`ProgressUpdateRequest`/`TaskId` + type-only import `../ports.js` 的 `GlobalDocName`/`GlobalDocRepositoryPort`，零运行时依赖、零反向依赖（不 import infrastructure/cli 实现类，ARCHITECTURE §4；不依赖 zod——校验在 infra GlobalDocRepository 与上层，本编排纯编排）。沿用「纯编排 + Result 判别联合 + 结构类型投影」模式（承接 DEC-014/016）：`writebackGlobalDocs` 把 GlobalDocRepositoryPort 的正文变换（applyProgressUpdate/appendDecision/appendIssue）与文件 I/O（readGlobalDoc/writeGlobalDoc）+ readDecisions/readIssues 串联为 section 回写用例。progress 冲突检测为纯辅助（`flattenProgress` 扁平化保留全局序号 + `detectProgressConflicts` 按 section 分组 replace、最后一条 winner、其余 loser 入清单 + 落选序号集合）；id 分配经注入 `IdAllocator`（无状态，usedIds 推断）+ `collectExistingIds` 取既有非空 id 基线。`noUncheckedIndexedAccess` 下 `arr[arr.length-1]`/`arr[i]` 显式 undefined 守卫。`src/application/index.ts` 追加 `./merge/section-writeback.js` 再导出（NodeNext 需 `.js` 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- section 回写复用要点（TASK-020）：`writebackGlobalDocs(globalRepo, orderedRequests, {idAllocator})`（`src/application/merge/section-writeback.ts`）在 rebaseAndFastForward（TASK-019）成功合并后由 Orchestrator 调用串行回写全局文档。`orderedRequests` 须由调用方排为合并拓扑序（被依赖方在前，复用 mergeOrder），`WritebackRequest{task_id, updates}` 的 updates 即 .result.md 的 global_update_requests（结构直接可传）。`IdAllocator` 接口为无状态 `{nextDecisionId(usedIds), nextIssueId(usedIds)}`——接收当前已用 id 集合返回一个不冲突新 id；典型实现为「现有同前缀最大编号 +1」（CLI wiring 层 TASK-025/026 提供，测试可注入纯函数式 fake）。progress 冲突（同 section 多 replace 后写者覆盖先写者）产 `ProgressWritebackConflict[]`，Orchestrator 据情置 blocked + 写 ISSUES（§3.2，本编排不仲裁）；assigned_decision_ids/assigned_issue_ids 记录本批次分配的 id（来源任务 → id），Orchestrator 据此回填对应任务 .result.md 提议项的空 id（经 TaskDocRepositoryPort.writeResult，归 Orchestrator 编排，不在本函数）。docs 返回完整 Record<GlobalDocName,string>：有请求才合并+写盘、无请求保留原文不写（避免空提交）。单次调用串行（§3.2/§12），不引入并发合并。TASK-021 幂等恢复在合并链路任一步崩溃后，对「分支已 ff 进 main」的任务跳过合并仅补做未完成的 section 回写（调本函数）。TASK-026 task:run 在 Executor 产出 .result.md + 审查通过 + rebaseAndFastForward 合并后调本函数回写全局文档。详见 DEC-017（proposed），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-010（low，open）新增自 TASK-020：§3.2 仅明文「多条 replace 命中同一 section 时后写者覆盖先写者」为冲突场景，未明文 append 与 replace 混合（同一 section 既 append 又 replace）时的冲突语义。本任务按字面落地：append 不参与冲突检测（多条 append 视为叠加），replace 在 apply 阶段逐条 apply 时天然覆盖此前 append 写入的内容（后写者覆盖先写者的总体精神），故「replace 在 append 之后」会覆盖 append、「append 在 replace 之后」追加到 replace 结果上，二者均不计入冲突清单。该解释是 applyProgressUpdate 逐条变换的自然结果，待 Orchestrator 确认是否需把 append/replace 混合也纳入冲突仲裁。不阻塞验收（核心 replace-replace 冲突 + append 叠加已覆盖），详见 ISS-010。"
    - section: "建议下一个任务"
      mode: replace
      content: "- TASK-021：App 合并幂等恢复（layer: `domain`）。落地 `src/application/merge/recovery.ts`，在合并链路（rebase / 回填 execution_commits / fast-forward / section 回写）任一步崩溃后按 git 状态判定恢复：`branchMerged`（TASK-018）检查 worktree 分支是否已 ff 进 main——已进入则跳过合并、仅补做未完成的全局文档 section 回写（调 TASK-020 `writebackGlobalDocs`）；未进入则 `abortOrCleanRebase` 丢弃不完整 rebase 中间态，从主分支最新基线重新走 TASK-019 `rebaseAndFastForward` 合并链路。§3.2 明文合并操作必须幂等可恢复、合并进度不写 SQLite（从 git 状态 + frontmatter status 完全重建）。前置已就绪（TASK-018 git 原语 + TASK-019 合并链路 + TASK-020 section 回写均完成）。其余已解锁任务：TASK-022（SDK 适配器）/ TASK-029（App 规划工作流 P4 收尾）/ TASK-023~027（CLI）亦可推进。"
  decisions:
    - id: ""
      title: "section-writeback 合并编排设计——progress 冲突仅 replace-replace、IdAllocator 无状态注入、串行读→合并→写、docs 完整 Record、只产出不仲裁"
      status: proposed
      scope: application/merge/section-writeback
      created_from_task: TASK-020
      decision: "TASK-020 对 §3.2 / §10 与任务 §2/§7/§8/§9/§12 与 ARCHITECTURE §4 未明文的回写编排设计作如下解释并落地：（1）progress 冲突检测仅针对同一 section 的多条 replace——§3.2 字面「多条 replace 命中同一 section 时按拓扑序后写者覆盖先写者，先写者落选」，append 不参与冲突（多条 append 视为按拓扑序叠加），故 detectProgressConflicts 按 section 分组 replace、拓扑序最后一条为 winner、其余每条生成 ProgressWritebackConflict{section, task_id, content, superseded_by} 并记入落选序号集合；apply 阶段落选 replace 跳过、append 与未落选 replace 总 apply。（2）append 与 replace 混合（同 section 既 append 又 replace）按 applyProgressUpdate 逐条变换的自然顺序处理——replace 在 append 之后则覆盖 append、append 在 replace 之后则追加到 replace 结果，二者均不计冲突（§3.2 未明文，见 ISS-010）。（3）IdAllocator 无状态注入式——接口 {nextDecisionId(usedIds), nextIssueId(usedIds)} 接收当前已用 id 集合返回一个不冲突新 id（DEC-XXX/ISS-XXX），编号策略由实现决定（典型现有最大编号+1）；writebackGlobalDocs 维护 usedIds（既有非空 id ∪ 本批次已分配）在每次分配前传入，保证不撞既有且批次内唯一，单一分配点。（4）decisions/issues 提议项 id 非空则沿用（appendDecision/appendIssue 按 id 去重：命中既有则替换标题+yaml block、否则文末追加），空则分配。（5）串行回写——单次调用内对每份文档读一次 → 逐条纯变换合并 → 写一次（§3.2 明确串行、§12 不引入并发；逐条 apply 到内存文档等价于「每条重读最新主分支」）。（6）docs 返回完整 Record<GlobalDocName,string>——有请求才合并+写盘、无请求保留读取原文不写盘（避免无变更的空提交）；docs 始终含三份（读取的或合并后的），消费方无需处理可选。（7）只产出不仲裁——返回 WritebackOutcome{docs, progress_conflicts, assigned_decision_ids, assigned_issue_ids}，不直接置 blocked（§7 仲裁归 Orchestrator）、不回写 .result.md 提议项 id（assigned ids 交 Orchestrator 经 TaskDocRepositoryPort.writeResult 回填，不在本函数）。沿用「纯编排 + 结构类型投影」模式（承接 DEC-014/016）。"
      rationale: "progress 冲突仅 replace-replace：§3.2 字面把冲突场景限定为「多条 replace 命中同一 section」，append 是「按拓扑序拼接」（叠加语义非覆盖），故 append 不入冲突清单；同 section 多 replace 才是「多个任务都想独占该 section 内容」的真冲突。落选 replace 跳过不 apply：若 apply 了会被后写者立即覆盖（apply 顺序 = 拓扑序，winner 在 loser 之后），徒增中间态；直接跳过让 winner 的 apply 成为该 section 的最终写入，干净。IdAllocator 无状态：号段生成集中在 allocator（单一分配点，§8），本编排只维护 usedIds（既有 ∪ 批次内），二者职责清晰；无状态便于测试注入 fake（不必构造有状态对象的种子），且 allocator 可被任意编号策略复用。id 非空沿用：Task Executor 理论上可预填 id（Schema 允许非空），沿用其 id 经 appendDecision 去重（命中替换）是对提议方既定 id 的尊重，不强行重分配。串行读→合并→写：§3.2 明文串行、§12 明文不引入并发合并；读一次后在内存逐条 apply（纯变换）再写一次，与「每条重读最新主分支」在无并发下等价且更高效，避免每条都触发文件 I/O。docs 完整 Record：消费方（Orchestrator / 测试）拿到三份完整文档（有变更的是合并后、无变更的是原文），类型干净（Record 非 Partial）无需可选处理；无请求不写盘避免 git 产生无 diff 的空提交（§3.2 回写应只在有变更时落盘）。只产出不仲裁：§7 明文「不直接把任务置 blocked（产出冲突清单，由编排/CLI 决策）」，本函数返回冲突清单 + assigned ids 即完成职责，置 blocked 归 TASK-017 StateOrchestrator、写 ISSUES 由 Orchestrator 据冲突清单执行（§3.2「先写者落选并由 Orchestrator 将冲突项写入 docs/ISSUES.md」）、回填 .result.md id 由 Orchestrator 据 assigned ids 经 TaskDocRepositoryPort 执行。"
      consequences: "TASK-021 幂等恢复在合并链路崩溃后，对分支已 ff 进 main 的任务跳过合并、仅补做未完成的 section 回写（调 writebackGlobalDocs）；未进入则 abortOrCleanRebase + 重走 rebaseAndFastForward。TASK-026 task:run 在合并回收后调 writebackGlobalDocs 回写全局文档，并据 progress_conflicts 置 blocked + 写 ISSUES、据 assigned ids 回填 .result.md。Orchestrator wiring：GlobalDocRepositoryPort 由 CLI（TASK-025）组合 fs + GlobalDocRepository 满足全契约（readGlobalDoc/writeGlobalDoc 读盘 + 委托正文变换，DEC-009/012），IdAllocator 由 CLI 提供（现有最大编号+1 的 sequential 实现）。若 Orchestrator 认为：(a) append 与 replace 混合应也计入冲突——改 detectProgressConflicts 把同 section 的 append+replace 组合也纳入（届时同步改 ISS-010 + 测试）；(b) IdAllocator 应有状态（内部计数器）——改接口为无参 nextXxxId + 构造时传入种子（但失去 usedIds 推断的纯度）；(c) docs 应为 Partial（只含变更文档）——改返回类型（消费方需处理可选）；(d) 无请求文档也应写盘（保持统一写）——去掉 if (length>0) 守卫直接写（但产生空提交）；(e) assigned ids 应由本函数直接回写 .result.md——需注入 TaskDocRepositoryPort（增加端口依赖，但回写 .result.md 是 Orchestrator 编排职责，不推荐）。新增 GlobalDocName 取值时 Record<GlobalDocName,string> 强制补全 docs 初始化。"
  issues:
    - id: ""
      title: "§3.2 未明文 append 与 replace 混合（同 section 既 append 又 replace）时的冲突语义，本任务按字面落地（append 不算冲突，replace 在 apply 阶段逐条变换时覆盖此前 append）"
      status: open
      severity: low
      scope: application/merge/section-writeback
      created_from_task: TASK-020
      owner: ""
      recommended_action: "Readme §3.2 line 122 仅明文「append 按拓扑序拼接，不同 section 互不影响直接合并；多条 replace 命中同一 section 时按拓扑序后写者覆盖先写者，先写者落选」，未涉及「同一 section 既 append 又 replace」的混合场景。TASK-020 按字面落地：append 不参与冲突检测（多条 append 视为叠加），replace 与 append 混合时按 applyProgressUpdate 逐条变换的自然顺序处理——拓扑序上 replace 在 append 之后则 replace 覆盖此前 append 的内容、append 在 replace 之后则 append 追加到 replace 结果上，二者均不计入冲突清单（视为「后写者覆盖先写者」总体精神的逐条 apply 自然结果）。该解释合理但规格未明文，可能与其他 Orchestrator 期望（如「同 section 的 append+replace 也应算冲突」）不符。建议（任选其一，待 Orchestrator 裁定）：(A) 接受现状并回写 Readme §3.2 澄清「混合时按逐条 apply 的自然顺序，不计冲突」；(B) 把同 section 的 append+replace 组合也纳入冲突检测（改 detectProgressConflicts）；(C) 规定混合时 replace 恒优先（先 apply 所有 replace 再 apply append）。不阻塞 TASK-020 验收（核心 replace-replace 冲突 + append 叠加 + replace 覆盖 append 已测试覆盖），详见 DEC-017。"
next_action: review
---

# TASK-020 执行结果

## 1. 执行结论

任务完成。实现了 `writebackGlobalDocs(globalRepo, orderedRequests, { idAllocator })`,按合并拓扑序串行回写三份全局文档(PROGRESS / DECISIONS / ISSUES):progress 走 section 级合并(同 section 多条 replace 后写者覆盖、先写者落冲突清单;append 按拓扑序叠加),decisions/issues 经注入的 IdAllocator 分配 DEC-XXX/ISS-XXX 后按 id 去重追加。14 项单测全绿,typecheck / lint 0 错误,application 全量 106 项无回归。

## 2. 完成内容

- 新建 `src/application/merge/section-writeback.ts`:
  - `writebackGlobalDocs(globalRepo, orderedRequests, { idAllocator }): WritebackOutcome`——串行回写编排。
  - progress:扁平化 + 冲突检测(`detectProgressConflicts`:同 section 多 replace 取拓扑序最后一条为 winner,其余入 `ProgressWritebackConflict` + 落选序号集合)→ 重读 PROGRESS → 逐条 `applyProgressUpdate`(落选 replace 跳过,append 与未落选 replace 总 apply)→ 写回。
  - decisions/issues:重读 → `readDecisions/readIssues` 取既有非空 id 集合 → 对每条提议项(id 空则 `idAllocator` 分配、非空沿用)逐条 `appendDecision/appendIssue`(按 id 去重)→ 写回。
  - 类型:`WritebackRequest` / `IdAllocator`(无状态,usedIds 推断)/ `ProgressWritebackConflict` / `AssignedId` / `WritebackOutcome`。
- `src/application/index.ts` 追加 `export * from './merge/section-writeback.js'`。
- 新建 `test/application/merge/section-writeback.test.ts`(14 项):progress section 合并 6 项(不同 section 互不干扰 / replace 单条 / 同 section 多 replace 后写者覆盖入冲突清单 / 三条 replace / replace 覆盖 append 不计冲突 / replace 后 append 叠加不计冲突)、id 分配去重 5 项、综合 3 项(空请求不写盘 / 混合互不干扰 / 仅 progress 只写 PROGRESS)。

## 3. 修改文件

- `src/application/index.ts`(追加一行 section-writeback 导出)

## 4. 新增文件

- `src/application/merge/section-writeback.ts`
- `test/application/merge/section-writeback.test.ts`
- `docs/tasks/TASK-020-app-merge-section-writeback.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-017(proposed):section-writeback 合并编排设计七要点(progress 冲突仅 replace-replace / IdAllocator 无状态注入 / 串行读→合并→写 / docs 完整 Record 无请求不写盘 / 落选 replace 跳过 apply / assigned id 交 Orchestrator 回填 .result.md / 只产出不仲裁)。详见 frontmatter `global_update_requests.decisions`。

## 7. 偏离计划

无规格偏离。`writebackGlobalDocs` 签名、行为、返回值与任务 §2 / §9 一致;依赖经 GlobalDocRepositoryPort(§8),不 import infra 实现类;复用 TASK-012 的 section 合并原语与 readDecisions/readIssues,不重复实现;串行回写不引入并发(§12)。`IdAllocator` 注入式设计与 §8「id 分配由注入的 idAllocator 完成(单一分配点)」一致。

## 8. 后续任务注意事项

- **assigned id 回填 .result.md 归 Orchestrator**:`writebackGlobalDocs` 只产出 `assigned_decision_ids/assigned_issue_ids`(来源任务 → id),不回写 .result.md 提议项的空 id。Orchestrator 据此清单经 `TaskDocRepositoryPort.writeResult` 回填对应任务 .result.md 的提议项 id(§10「id 由 Orchestrator 回写时统一分配」)。该回写不在本函数(职责单一:section 回写)。
- **progress_conflicts 仲裁归 Orchestrator**:冲突清单交 Orchestrator 据情置 blocked(经 TASK-017 StateOrchestrator)+ 写 ISSUES(§3.2「先写者落选并由 Orchestrator 将冲突项写入 docs/ISSUES.md」),本函数不仲裁(§7)。
- **IdAllocator 由 CLI wiring 提供**(TASK-025/026):典型实现为「现有同前缀最大编号 +1」的纯函数(本任务测试用此 sequentialAllocator 验证)。GlobalDocRepositoryPort 的文件 I/O(readGlobalDoc/writeGlobalDoc)由 CLI 组合 fs + GlobalDocRepository 满足全契约(DEC-009/012)。
- **TASK-021 幂等恢复**将调本函数补做崩溃时未完成的全局文档 section 回写。
- **ISS-010**:§3.2 未明文 append/replace 混合的冲突语义,本任务按字面落地(append 不计冲突,replace 逐条 apply 覆盖 append),待 Orchestrator 确认。

## 9. 未解决问题

- ISS-010(low,open):§3.2 未明文 append 与 replace 混合时的冲突语义。本任务按字面落地(详见 frontmatter issues / DEC-017)。不阻塞验收。
- 已有 ISS-005(better-sqlite3 Node 版本)/ ISS-006(级联张力)/ ISS-007(git 身份)/ ISS-008(reset 基线跨进程)/ ISS-009(docs 多 worktree 路由)均与本任务无关,本任务纯计算不依赖 SQLite、不操作 git、不触发级联,维持现状。

## 10. 验证结果

- `npm run typecheck`:0 错误(tsc --noEmit 覆盖 src + test,strict + noUncheckedIndexedAccess)。
- `npm test -- application/merge/section-writeback`:14 项全过。
- `npm run lint`:0 错误。
- `npm test -- application`:106 项全过(含 rebase-ff 6 项回归)。

本任务不依赖 SQLite 原生模块(application 层纯编排,测试用真实 GlobalDocRepository + 内存 I/O 适配器),无需 Node 22;typecheck/test 目标路径/lint 在当前 Node 下全绿。

## 11. 人工验收建议

- 重点检查 `detectProgressConflicts` 的冲突判定:仅 replace-replace 触发,append 不计(§3.2 字面);winner 为拓扑序最后一条,superseded_by 指向 winner。
- 检查 IdAllocator 无状态设计:usedIds = 既有 ∪ 批次内已分配,批次内 id 唯一且不撞既有。
- 检查「有请求才写盘、无请求保留原文不写」是否合理(避免空提交)。
- 检查 ISS-010 的 append/replace 混合语义是否符合预期。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`:progress 六条 section 更新(完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-021)、DEC-017(proposed)、ISS-010(low,open)。
