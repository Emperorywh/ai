---
task_id: TASK-007
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/state-machine.ts
  - test/core/state-machine.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/state-machine
    result: passed
    notes: "vitest run core/state-machine，1 文件 21 用例全部通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-007（Core 任务状态机）已完成：src/core/state-machine.ts 以「转移表 + 纯函数」编码 Readme §7 全部 9 态流转，导出 TASK_TRANSITIONS / canTransition / validateTransition（+ TransitionContext / TransitionResult），21 项单测（含 9x9 完整矩阵审计）。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）齐备。状态机以纯函数提供「结构合法性 + 上下文前置条件」判定（canTransition / validateTransition），可被 TASK-008 状态映射、TASK-017 状态编排复用；不做鉴权、不读写 frontmatter / SQLite。工具链 npm run typecheck / npm test（181 项）/ npm run lint 全绿。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/state-machine.ts 仅依赖同层 enums 的 TaskStatus 类型（零运行时依赖、零反向依赖），不引入 zod（输入由上层 Zod 解析后以 TaskStatus 传入）。沿用「数据结构 + 纯函数」模式：TASK_TRANSITIONS 表以 Record<from, readonly TaskStatus[]> 表达 §7 全部 22 条合法边，便于单测做完整矩阵审计与人工核对。src/core/index.ts 继续 export * 聚合新增模块（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "状态机判定分两层：canTransition(from,to) 只查 §7 流转表是否「有边」（结构合法性，无上下文）；validateTransition(from,to,context) 在有边基础上叠加上下文前置条件——running->done 需 context.no_review、failed->ready|cancelled 与 done->blocked 需 context.confirmed。TransitionContext.{no_review,confirmed} 由 application 层（TASK-017）从 frontmatter / 鉴权结果构造后传入：no_review 取任务 frontmatter，confirmed 表「是否经 Orchestrator 或人工确认」（不区分「是谁确认」，鉴权属 application 层，状态机只消费布尔）。状态机对非法状态值不静默——表外转移返回 ok:false+reason，自流转与 cancelled 终态一律拒绝。TASK-008 状态映射（ExecutionStatus/NextAction/ReviewResult -> TaskStatus 转移）应复用本模块 validateTransition 作为最终合法性闸门，勿另起转移表。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts，不阻塞。TASK-007 无边界冲突——enums.ts 的 TaskStatus 直接 import 复用，状态机未触及 enums.ts、未新增依赖。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-008：Core 依赖级联与状态映射（layer: domain，depends_on: TASK-002/TASK-007）。实现 §7 依赖级联（传递闭包）与 ExecutionStatus/NextAction/ReviewResult -> TaskStatus 的映射，复用本任务 validateTransition 作为状态流转合法性闸门，沿用「数据结构 + 纯函数」模式。"
  decisions:
    - id: ""
      title: "状态机采用「转移表 + 纯函数 + Result 判别联合」模式"
      status: proposed
      scope: "core/state-machine"
      decision: "任务状态流转以 Record<TaskStatus, readonly TaskStatus[]> 转移表（TASK_TRANSITIONS）编码 §7 全部合法边，canTransition 仅查表，validateTransition 在查表基础上叠加上下文前置条件（no_review / confirmed），返回 {ok:true|false, from, to, reason} 判别联合。状态机不做鉴权、不读写 I/O。"
      rationale: "转移表以数据结构而非散落 if/switch 表达，便于单测做 9x9 完整矩阵审计与人工逐条核对 §7；canTransition/validateTransition 分离让「结构合法性」与「上下文合法性」各司其职；Result 判别联合以 ok 收窄类型，合法/非法都携带 from/to 便于上层日志审计。confirmed 仅是布尔事实、不区分「是谁确认」，恰好落在「结构前置条件」与「鉴权」的分界线上，符合任务 §12「状态机不做谁有权触发的细粒度鉴权」。"
      consequences: "TASK-008 状态映射须复用 validateTransition 作为最终合法性闸门，不得另起转移表，否则两套表会漂移；TASK-017 状态编排负责从 frontmatter / 鉴权结果构造 TransitionContext 后调用 validateTransition；新增 §7 转移边时同步改 TASK_TRANSITIONS 与 LEGAL_EDGES 测试。"
      created_from_task: TASK-007
  issues: []
next_action: review
---

# TASK-007 执行结果

## 1. 执行结论

任务完成。在 `src/core/state-machine.ts` 以「转移表（`TASK_TRANSITIONS`）+ 纯函数」编码 Readme.md §7 的全部 9 态流转（22 条合法边），导出 `canTransition`（结构合法性）、`validateTransition`（叠加上下文前置条件）及 `TransitionContext` / `TransitionResult` 类型；`src/core/index.ts` 经 `./state-machine.js` 再导出；`test/core/state-machine.test.ts` 21 项用例覆盖 9x9 完整矩阵审计、no_review 门控、confirmed 门控、cancelled 终态、done 重开、续跑语义。typecheck / test / lint 三项验证全绿。

## 2. 完成内容

- 编码 §7 流转表 `TASK_TRANSITIONS`：draft→[ready,cancelled]、ready→[running,draft,cancelled]、running→[reviewing,blocked,failed,cancelled,done]、reviewing→[done,rejected,blocked,cancelled]、rejected→[ready,cancelled]、blocked→[ready,failed,cancelled]、failed→[ready,cancelled]、done→[blocked]、cancelled→[]。
- `canTransition(from,to)`：纯查表，回答「边是否存在」，不携带上下文。
- `validateTransition(from,to,context)`：查表通过后再判上下文前置条件——running→done 需 `no_review`、failed→ready|cancelled 与 done→blocked 需 `confirmed`；返回 `TransitionResult` 判别联合（ok:true/false + from/to + reason）。
- `TransitionContext`：`{ no_review, confirmed }`，由 application 层从 frontmatter / 鉴权结果构造。
- 单测 21 项：9x9 矩阵全审计（合法边逐一 true、其余全 false）、自流转全非法、cancelled 终态全拒绝、TASK_TRANSITIONS 与独立硬编码 LEGAL_EDGES 交叉校验防漂移、no_review/confirmed 四组 context 组合、续跑语义、结果形态与 reason 非空。

## 3. 修改文件

- `src/core/index.ts` —— 追加 `export * from './state-machine.js'` 及 TASK-007 注释，其余不变。

## 4. 新增文件

- `src/core/state-machine.ts` —— 状态机转移表与判定函数。
- `test/core/state-machine.test.ts` —— 状态机单测（21 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：状态机采用「转移表 + 纯函数 + Result 判别联合」模式，canTransition/validateTransition 分离结构合法性与上下文合法性。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的两个函数与 §7 流转表全部落地；§11 验收的「每条合法/非法转移有用例」「running→done 受 no_review 约束」「禁止跳过 reviewing 直达 done（除 no_review）」均以独立硬编码 LEGAL_EDGES 交叉验证。

## 8. 后续任务注意事项

- `TransitionContext.confirmed` 是「是否经 Orchestrator 或人工确认」的布尔事实，不区分「是谁确认」——鉴权（具体 agent / 角色 / 用户是否允许）是 application 层职责，状态机只消费布尔（任务 §12）。
- `running→done` 即便 no_review:true，仍需 Orchestrator 校验 `.result.md` / 验证结果 / 全局文档更新建议齐全（§7），这属 application 层编排（TASK-017），状态机只校验 no_review 标志。
- TASK-008 状态映射应复用 `validateTransition` 作为最终合法性闸门，不得另起转移表。
- TASK-017 负责从 frontmatter 读 `no_review`、按鉴权结果置 `confirmed`，构造 `TransitionContext` 后调用 `validateTransition`。

## 9. 未解决问题

无新 issue。本任务边界清晰：`enums.ts` 的 `TaskStatus` 直接 import 复用（不触及 enums.ts，在其 allowed 之外但仅读用）；未新增依赖；`done→blocked`、`cancelled` 终态、`failed→*` 等 §12 风险点均有显式用例。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/state-machine` | passed | vitest 1 文件 21 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 6 文件 181 用例全通过（含新增 21 项） |

## 11. 人工验收建议

- 复核 `TASK_TRANSITIONS` 9 个状态的合法边与 Readme §7 流转规则逐条一致（重点 running 的 5 条边含 done、done 仅 blocked、cancelled 为空数组）。
- 复核上下文前置条件落点：running→done→no_review、failed→ready|cancelled→confirmed、done→blocked→confirmed；其余合法边不依赖任何标记位。
- 确认「状态机不做鉴权、只消费 confirmed 布尔」的设计是否符合 §12（application 层负责把鉴权结论折叠进 confirmed）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：状态机表+纯函数+Result 模式）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
