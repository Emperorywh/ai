---
task_id: TASK-008
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/rules/dependency-rules.ts
  - src/core/rules/status-mapping.ts
  - test/core/rules/dependency-mapping.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/rules
    result: passed
    notes: "vitest run core/rules，1 文件 51 用例全部通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 7 文件 232 用例全通过（含新增 51 项，原 181 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-008（Core 依赖级联与状态映射）已完成：src/core/rules/dependency-rules.ts 提供 transitiveDependents（传递闭包）/ cascadeBlock（§7 级联）/ detectDependencyCycle（环检测），src/core/rules/status-mapping.ts 提供 mapResultToStatus（§10 映射表），51 项单测（含 12 组合 3×4 全覆盖矩阵 + 三色标记环检测）。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008）齐备。状态机提供流转合法性判定（canTransition / validateTransition）；依赖级联 / 状态映射以纯函数提供：transitiveDependents（传递闭包）、cascadeBlock（rejected/failed/blocked 触发级联）、mapResultToStatus（§10 execution_status × next_action → 目标状态，非法组合显式报错）；均不做鉴权、不读写 frontmatter / SQLite。工具链 npm run typecheck / npm test（232 项）/ npm run lint 全绿。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/rules/ 目录建立：dependency-rules.ts 与 status-mapping.ts 均仅依赖同层 enums 的类型（零运行时依赖、零反向依赖），不引入 zod（输入由上层以已校验的对象 / 枚举值传入）。沿用「数据结构 + 纯函数 + Result 判别联合」模式（承接 DEC-004）：mapResultToStatus 返回 StatusMappingResult 判别联合（与 validateTransition 的 TransitionResult 同构），非法组合返回 ok:false+reason 而非抛异常；switch(executionStatus) 配 never 穷尽性检查，保证 ExecutionStatus 新增值时编译期暴露。dependency-rules 定义最小投影接口 CascadeTask{id,depends_on,status}（结构类型，兼容 TaskFrontmatter），环检测用 DFS 三色标记返回闭合环路径。src/core/index.ts 继续 export * 聚合 rules/ 两个模块（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "领域规则复用要点：mapResultToStatus(executionStatus, nextAction, {noReview, orchestratorVerified}) 实现 §10 全表，12 组合（3×4）全覆盖——3 非法（completed+retry / blocked+review / failed+review）返回 ok:false，9 合法映射到 reviewing / done / blocked / failed / cancelled；completed+review 在 no_review:true 时三分（校验通过 → done、未通过 → blocked，§7）。StatusMappingContext.{noReview,orchestratorVerified} 由 application 层（TASK-017）从 frontmatter / 产物校验结果构造：orchestratorVerified 表「Orchestrator 是否校验 .result.md 完整性 / 验证结果 / 全局更新建议通过」。依赖级联：transitiveDependents 算传递闭包（反向邻接 BFS、visited 去重 O(V+E)）、cascadeBlock 仅当任务处于 rejected/failed/blocked 返回后继闭包（否则空数组）、detectDependencyCycle 全图环检测（环是非法 DAG，返回闭合环路径）；transitiveDependents / cascadeBlock 入口先 assertAcyclic，遇环抛错不死循环（§12）。TASK-017 状态编排应：对 mapResultToStatus 的 ok:true 目标状态再过 validateTransition 判最终合法性（如 done 需 no_review 边、blocked 后继若已 done 需 confirmed），对 ok:false 转人工不静默；cascadeBlock 产出的后继集合逐个过状态机判定能否流转到 blocked。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务状态映射不涉及 verification.result 字段，未触发提升，ISS-004 维持现状不阻塞。TASK-008 无边界冲突：enums.ts 的 TaskStatus / ExecutionStatus / NextAction 直接 import 复用（仅类型读用，未触及 enums.ts），state-machine.ts 未改（仅风格参照），未新增依赖。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-009：Core 验证 allowlist 与权限解析（layer: domain，depends_on: TASK-002 已完成）。实现 §16 权限模型解析（permissions 数组 → 能力位）与 verification allowlist 校验，沿用「数据结构 + 纯函数」模式，落地 src/core/rules/verification-rules.ts 与 permission-rules.ts。Core domain 层规则实现自此继续。"
  decisions:
    - id: ""
      title: "领域规则层沿用「纯函数 + Result 判别联合」，状态映射非法组合返回 ok:false 而非抛异常"
      status: proposed
      scope: "core/rules"
      decision: "mapResultToStatus 返回 StatusMappingResult 判别联合（ok:true 携带 status + 可选 note / ok:false 携带 reason + 输入回显），三种非法组合（completed+retry / blocked+review / failed+review）返回 ok:false 而非抛异常；completed+review 在 no_review:true 时三分（orchestratorVerified 通过 → done、未通过 → blocked）；cascadeBlock 仅产出「应 blocked」后继集合，不判定后继能否合法流转到 blocked（交上层状态机）。switch(executionStatus) 配 never 穷尽性检查。"
      rationale: "与 DEC-004 validateTransition 的 TransitionResult 同构，Orchestrator 收集非法组合后统一转人工而非中断编排；非法组合是 frontmatter 数据错误（§10，Zod 阶段不硬拒、由本函数运行期判定），判别联合比抛异常更便于上层优雅处理。completed+review+noReview+!verified→blocked 是 §7「校验不通过改走 blocked/failed，按 next_action 决定」在 next_action=review 语境下的保守落地（failed 应由 execution_status=failed 触发，产物自认为完成的保守等人工）。级联 / 映射只产目标建议，最终合法性归 TASK-017 经状态机二次闸门，避免 rules 层与 state-machine 职责重叠。"
      consequences: "TASK-017 须对 mapResultToStatus 的 ok:false 记录 issue 并转人工（不得静默），对 ok:true 目标状态再过 validateTransition；新增 §10 映射分支或 ExecutionStatus / NextAction 枚举值时，never 穷尽性检查强制编译期补全 switch；若未来 §10 明确 completed+review+noReview+!verified 应映射 failed，改 mapResultToStatus 该分支即可（届时同步改测试）。"
      created_from_task: TASK-008
  issues: []
next_action: review
---

# TASK-008 执行结果

## 1. 执行结论

任务完成。在 `src/core/rules/dependency-rules.ts` 落地 §7 依赖级联（传递闭包 + 级联 + 环检测），在 `src/core/rules/status-mapping.ts` 落地 §10 `execution_status × next_action → 目标状态` 映射（12 组合全覆盖、非法组合显式报错）；`src/core/index.ts` 经 `./rules/*.js` 再导出；`test/core/rules/dependency-mapping.test.ts` 51 项用例覆盖多层传递闭包、多路径汇聚去重、自环 / 两节点 / 三节点环检测、三种触发态级联、非触发态不级联、§10 映射表每行、12 组合全覆盖矩阵。typecheck / test / lint 三项验证全绿。

## 2. 完成内容

- `dependency-rules.ts`：
  - `transitiveDependents(taskId, allTasks)` —— 反向邻接 BFS 计算传递闭包，visited 去重 O(V+E)，返回 BFS 发现顺序（稳定）；taskId 不在集合抛错。
  - `cascadeBlock(taskId, allTasks)` —— §7 级联：仅当任务处于 `rejected` / `failed` / `blocked` 返回后继闭包，其余状态返回空数组。
  - `detectDependencyCycle(allTasks)` —— DFS 三色标记全图环检测，返回闭合环路径（如 `[A,B,C,A]`），无环返回 null；集合外依赖不视为环。
  - `CascadeTask` 最小投影接口（`{ id, depends_on, status }`，结构类型，兼容 TaskFrontmatter）。
  - `assertAcyclic` 内部守卫：`transitiveDependents` / `cascadeBlock` 入口先检测环，遇环抛错不死循环（§12）。
- `status-mapping.ts`：
  - `mapResultToStatus(executionStatus, nextAction, { noReview, orchestratorVerified })` —— §10 映射表全实现：第一层报 3 种非法组合（ok:false+reason），第二层 cancel→cancelled，第三层 switch(executionStatus) 分派 completed/blocked/failed；completed+review 在 no_review 下三分（校验通过→done、未通过→blocked）。
  - `StatusMappingResult` 判别联合（ok:true 携带 status + 可选 note / ok:false 携带 reason + 输入回显），与 `validateTransition` 的 `TransitionResult` 同构。
  - `StatusMappingContext`（`{ noReview, orchestratorVerified }`）由 application 层构造。
  - `switch` 配 `never` 穷尽性检查：ExecutionStatus 新增值时编译期报错，强制补全映射。
- 单测 51 项：传递闭包（多层 / 多路径去重 / 叶子空 / 不含自身 / 集合外依赖 / 未知抛错）、环检测（DAG / 空集 / 自环 / 两节点 / 三节点 / 子图环 / transitiveDependents 遇环抛错）、级联（三种触发态 / 六种非触发态 / 中间节点不向上扩散 / 未知抛错）、映射（§10 每行 / no_review 三分 / cancel 任意态 / 3 非法组合 / 12 组合全覆盖矩阵）。

## 3. 修改文件

- `src/core/index.ts` —— 追加 `export * from './rules/dependency-rules.js'`、`export * from './rules/status-mapping.js'` 及 TASK-008 注释，其余不变。

## 4. 新增文件

- `src/core/rules/dependency-rules.ts` —— 依赖级联（传递闭包 + 级联 + 环检测）。
- `src/core/rules/status-mapping.ts` —— §10 执行状态映射。
- `test/core/rules/dependency-mapping.test.ts` —— 依赖级联与状态映射单测（51 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：领域规则层沿用「纯函数 + Result 判别联合」模式，mapResultToStatus 非法组合返回 ok:false 而非抛异常（与 DEC-004 validateTransition 同构）；completed+review+noReview+!verified→blocked 的保守落地；级联 / 映射只产目标建议、最终合法性交上层状态机。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 `transitiveDependents` / `cascadeBlock` / `mapResultToStatus` 全部落地；§11 验收的「多层传递闭包」「级联只针对 rejected/failed/blocked」「§10 每行有用例」「三种非法组合报错」「no_review+校验通过→done、不通过→blocked/failed」均有用例；§12 环形依赖风险点以 detectDependencyCycle + assertAcyclic 显式处理。

一处需 Orchestrator 留意的设计推断：§7 原文「校验不通过改走 blocked 或 failed，由 Orchestrator 按 next_action 决定」未明确 `completed+review+noReview+!verified` 这一具体组合的归属（review 非 needs-human）。本实现取 blocked（保守，等人工），理由见 DEC-005 rationale；若 §10 后续明确该组合应映射 failed，改 mapResultToStatus 单分支即可。此为合理推断而非规格偏离，不另开 issue。

## 8. 后续任务注意事项

- `mapResultToStatus` 的 ok:true 只产出「目标状态建议」，TASK-017 须再过 `validateTransition` 判最终合法性（如 `done` 需 no_review 边放行、blocked 后继若已 `done` 需 confirmed 才能 reopen）。
- `mapResultToStatus` 的 ok:false 是 frontmatter 数据错误（Task Executor 提交了非法组合），TASK-017 须记录 issue 并转人工，不得静默取默认值。
- `StatusMappingContext.orchestratorVerified` 仅在 `completed+review+no_review` 时影响结果；其余映射不读此字段，TASK-017 构造时对非 no_review 任务可置任意值。
- `cascadeBlock` 不判定后继当前能否流转到 blocked（如后继已 done），合法性由 TASK-017 对每个后继过状态机判定。
- `CascadeTask` 是结构类型，TASK-011 / TASK-017 可直接传 `TaskFrontmatter`（已含 id / depends_on / status 三字段），无需装配。

## 9. 未解决问题

无新 issue。本任务边界清晰：enums.ts（TaskStatus / ExecutionStatus / NextAction）与 state-machine.ts 均仅读用 / 风格参照，未触及；未新增依赖；§12 环形依赖风险点有 detectDependencyCycle 显式检测与 assertAcyclic 守卫，并用 5 类环用例（自环 / 两节点 / 三节点 / 子图环 / 集合外依赖不误报）覆盖。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不涉及本任务——状态映射不消费 verification.result，ISS-004 维持 open、不阻塞。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/rules` | passed | vitest 1 文件 51 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 7 文件 232 用例全通过（含新增 51 项） |

## 11. 人工验收建议

- 复核 `mapResultToStatus` 的 12 组合映射与 Readme §10 映射表逐行一致（重点 completed+review 三分、cancel 任意态→cancelled、blocked/failed 的 retry/needs-human 稳态）。
- 复核三种非法组合（completed+retry / blocked+review / failed+review）均返回 ok:false+reason，且 reason 含「非法组合」字样。
- 复核 §7 依赖级联：cascadeBlock 仅对 rejected/failed/blocked 触发，done/ready/running/draft/reviewing/cancelled 返回空；传递闭包多层与多路径汇聚去重正确。
- 确认 `completed+review+noReview+!verified→blocked` 的保守推断是否符合 §7 意图（见 §7 偏离计划说明与 DEC-005）。
- 确认环检测对自环、两节点、三节点、子图环均能检出且返回闭合环路径；集合外依赖不误报。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：领域规则层纯函数 + Result 判别联合模式，承接 DEC-004）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
