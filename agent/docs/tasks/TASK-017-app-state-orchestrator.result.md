---
task_id: TASK-017
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/state-orchestrator.ts
  - test/application/state-orchestrator.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess）
  - command: npm test -- application/state-orchestrator
    result: passed
    notes: 33 项单测全绿
  - command: npm run lint
    result: passed
    notes: eslint 无报错
  - command: npm test
    result: passed
    notes: 全量回归 470 项全绿（Node 22 ABI 127，含 SQLite）
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: replace
      content: |
        - TASK-017（App 状态流转编排器）已完成：`src/application/state-orchestrator.ts` 提供 `StateOrchestrator`（注入 `TaskDocRepositoryPort`）四方法——`transition`（显式转移，校验 `validateTransition` 后写回 status）/ `applyResult`（按 §10 把 `.result.md` 的 `execution_status × next_action` 经 `mapResultToStatus` 映射并转移，含 no_review 免审三分）/ `applyReview`（按 §15 把 `review_result` 映射，skipped 走 no_review 产物校验分支委托 `applyResult`）/ `cascadeIfBlocked`（按 §7 依赖级联把后继逐个过状态机，能流转者 blocked、不能者显式 skipped 返回），33 项单测（含 §7/§10/§15 关键路径 + no_review 通过/不通过 + 级联 + 非法组合/非法转移抛错）。application 层首个完整用例就绪。
    - section: 当前系统可用能力
      mode: replace
      content: |
        - 状态流转编排：`StateOrchestrator(repo)`（`src/application/state-orchestrator.ts`）经 `TaskDocRepositoryPort` 读写任务 frontmatter，组合 core 状态机 + 状态映射 + 依赖级联驱动 `ready→running→reviewing→done/rejected/blocked` 全链路。`transition(taskId, to, context)` 校验 `validateTransition` 后写回（非法抛错）；`applyResult(taskId, result, {orchestratorVerified})` 经 `mapResultToStatus` 得目标状态并转移（no_review+completed+review 三分：校验通过→done / 未通过→blocked），非法组合（DEC-005）抛错转人工；`applyReview(taskId, review)` 按 §15 映射（approved→done / rejected→rejected / needs-human→blocked / skipped→读 `.result.md` 校验产物后委托 applyResult）；`cascadeIfBlocked(taskId, allTasks)` 返回 `{blocked, skipped}`——后继能合法流转到 blocked（running/reviewing）者写回、不能者（ready/draft/已终态，见 ISS-006）显式 skipped 附原因。`CascadeOutcome` 让调用方据 skipped 转人工，不静默丢失。所有变更先过 `validateTransition`，`writeTask({...task, status})` 仅替换 status 保留其余 frontmatter。不做合并回写（TASK-019/020）、不做全局文档修改（TASK-020）、不做 SQLite 写入（CLI 层组合）、不做鉴权（confirmed 由调用方构造）。
  decisions:
    - id: ""
      title: "StateOrchestrator 设计——四方法职责切分、applyResult/applyReview 共享私有转移、cascadeIfBlocked 逐个过状态机+不能则 skipped、产物校验清单、confirmed 取 false"
      status: proposed
      scope: application/state-orchestrator
      created_from_task: TASK-017
      decision: "TASK-017 对 §5.1/§7/§10/§15 与 ARCHITECTURE §4 未明文的编排设计作如下解释并落地：（1）四方法职责——transition 是显式入口（context 全由调用方构造，含 confirmed）；applyResult 按 §10 映射并转移；applyReview 按 §15 映射；cascadeIfBlocked 按 §7 级联。（2）applyResult/applyReview 共享私有 applyResultForTask+applyTransition——transition 读 task 后调 applyTransition，applyResult 读 task 后调 applyResultForTask，applyReview 读 task 后按 review_result 分派（skipped 读 result 后调 applyResultForTask），避免重复读取。（3）applyResult 对 mapResultToStatus 的 ok:false（§10 非法组合）抛错转人工——DEC-005 consequences 明示「TASK-017 须对 ok:false 记 issue 并转人工（不得静默）」，单方法层面抛错是最明确的「不静默」，上层 catch 记 issue。（4）applyReview 的 skipped 分支委托 applyResult 复用 no_review 三分逻辑——读 .result.md → isResultAcceptable 校验产物 → applyResultForTask(task, result, verified)，避免重复实现 completed+review+no_review 的 done/blocked 分支（DEC-005）。（5）cascadeIfBlocked 逐个过 validateTransition，能流转者 writeTask blocked、不能者记 skipped 返回 CascadeOutcome——不抛错中断（级联是批量推进，单个后继无法流转不应阻断其余）、不静默跳过（skipped 显式返回让调用方知情转人工）。（6）产物校验清单 isResultAcceptable——.result.md 可读（readResult 不抛错即 Schema 通过）+ verification 无 result==='failed'（passed/skipped 放行）+ global_update_requests 三子项结构（ResultFrontmatterSchema 强制），内容非空不强制；对应 §7/§15「Orchestrator 校验 .result.md、验证结果和全局更新建议齐全」。（7）confirmed 在 applyResult/applyReview/cascadeIfBlocked 内部取 false——这三类从 running/reviewing 出发的合法转移均不依赖 confirmed（failed→* 与 done→blocked 的 confirmed 闸门由 transition 显式入口承载）；任何非法 from 都被 validateTransition 拦截抛错。"
      rationale: "四方法切分对齐任务 §2 的四个用例，各自语义独立。共享私有方法遵循 AGENTS §3「不复制粘贴重复逻辑」——applyTransition（校验+写回）被 transition/applyResult/applyReview 复用，applyResultForTask（映射+转移）被 applyResult/applyReview-skipped 复用。ok:false 抛错：DEC-005 把「记录 issue 并转人工」的职责放在 TASK-017，单方法抛错让上层 Orchestrator 在 catch 中记 issue + 标 blocked/needs-human，比返回判别联合更直接（本类不是批量收集器）。skipped 委托 applyResult：§15 明示 skipped 时「Orchestrator 仍必须检查 .result.md、验证结果和全局更新建议是否齐全，才能置 done；不通过则走 blocked/failed」——这正是 mapResultToStatus 在 completed+review+noReview 的三分（DEC-005），复用避免两套产物校验逻辑漂移。cascadeIfBlocked 不抛错：级联针对一前置的全部后继，若某后继（如已 done）无法流转就抛错会阻断对其余后继的级联，且「无法级联」是状态机约束的如实反映而非异常；返回 CascadeOutcome 让调用方显式处理 skipped（AGENTS §3 不静默＝显式可追踪，非＝抛错）。产物清单对应 §7/§15 明文三项；verification 无 failed 是「验证结果齐全」的最小判定（Executor 自报 passed/skipped 均可接受，failed 表示任务未真正通过验证）。confirmed=false 安全：mapResultToStatus 从 running 出发的合法目标（reviewing/done/blocked/failed/cancelled）经 validateTransition 时，仅 running→done 需 no_review（由 task.no_review 满足），confirmed 不参与；非法 from（如对已 done 任务 applyResult）被 validateTransition 拦截抛错，confirmed 取值不影响安全性。"
      consequences: "TASK-019/020 合并回写不在此类（状态编排与合并解耦）；TASK-029 规划用例经本类驱动任务流转；CLI（TASK-026 task:run）在 Executor 返回后调 applyResult/applyReview、前置失败时调 cascadeIfBlocked。ISS-006：级联对 ready/draft 后继返回 skipped（状态机表无对应边），与 Readme §7 级联文字张力，待 Orchestrator 裁定。若 Orchestrator 认为：(a) applyResult 对 ok:false 应返回结果而非抛错（便于批量编排收集多任务问题）——改 applyResultForTask 返回判别联合（届时同步改 DEC-014 + 测试）；(b) cascadeIfBlocked 对 skipped 应抛错而非返回——改 skipped 分支为 throw（但中断批量级联）；(c) isResultAcceptable 应校验 global_update_requests 非空——改校验逻辑（但任务可能确实无更新，会误判）；(d) 级联应强制 blocked 绕过状态机——需先扩状态机表补 ready/draft→blocked 边（改 core，见 ISS-006）。新增 ReviewResult / TaskStatus 取值时 switch 穷尽性检查（applyReview default never）强制补全。"
  issues:
    - id: ""
      title: "依赖级联张力：状态机表无 ready/draft→blocked 边，与 Readme §7 级联文字「后继自动进入 blocked」矛盾，cascadeIfBlocked 对未启动后继返回 skipped"
      status: open
      severity: medium
      scope: application/state-orchestrator + core/state-machine
      created_from_task: TASK-017
      owner: ""
      recommended_action: "Readme §7 文字「当 TASK-A 处于 rejected/failed/blocked 时，所有直接或间接 depends_on 到 TASK-A 的后继任务自动进入 blocked」，但同节状态流转规则代码块 ready→[running|draft|cancelled]、draft→[ready|cancelled] 均无 →blocked 边（TASK-007 忠实落地了流转代码块）。后果：级联最常见的场景——前置失败、后继处于 ready（等待执行）——cascadeIfBlocked 经 validateTransition(ready, blocked) 得 ok:false，后继只能进 skipped 无法 blocked，级联对未启动后继实际无效。TASK-017 的 core/state-machine.ts 处于 forbidden_paths 无法改表，故如实实现（running/reviewing→blocked 成功，ready/draft/已终态→skipped 显式返回 CascadeOutcome），不静默。建议（任选其一，待 Orchestrator 裁定）：(A) 在状态机表补 ready→blocked / draft→blocked 边（开新任务改 core/state-machine.ts + TASK_TRANSITIONS + state-machine 测试的 9×9 矩阵，并回写 Readme §7 流转代码块）——最贴合级联语义；(B) 级联改用「强制 blocked」语义绕过状态机（在 cascadeIfBlocked 内对级联场景直接 writeTask blocked，但违反任务 §8「所有状态变更必须先过 validateTransition」）；(C) 接受级联只对运行中（running/reviewing）后继有效，ready 后继保持 ready 等前置恢复（与 §7 文字偏差，需回写 Readme 级联描述澄清）。当前不阻塞 TASK-017 验收（级联核心路径 running/reviewing→blocked 已覆盖、skipped 显式返回可追踪），但影响级联对等待态后继的完备性。关联 DEC-014（cascadeIfBlocked 逐个过状态机设计）。"
next_action: review
---

# TASK-017 执行结果

## 1. 执行结论

已完成。实现 `StateOrchestrator`(注入 `TaskDocRepositoryPort`),组合 core 状态机(TASK-007)+ 状态映射(TASK-008)+ 依赖级联(TASK-008),提供 transition / applyResult / applyReview / cascadeIfBlocked 四方法,驱动 `ready→running→reviewing→done/rejected/blocked` 全链路。33 项单测覆盖 §7/§10/§15 关键路径(含 no_review 通过/不通过、级联、非法组合/非法转移抛错)。typecheck 0 错误、lint 无报错、全量 470 项回归全绿。

## 2. 完成内容

- `StateOrchestrator.transition(taskId, to, context)`:读 frontmatter → `validateTransition` → 写回 status(非法抛错)。
- `StateOrchestrator.applyResult(taskId, result, {orchestratorVerified})`:`mapResultToStatus` 映射 → 非法组合抛错 / 合法目标过 `validateTransition` 写回;含 no_review 免审三分(校验通过→done / 未通过→blocked)。
- `StateOrchestrator.applyReview(taskId, review)`:approved→done / rejected→rejected / needs-human→blocked;skipped 读 `.result.md` 校验产物后委托 applyResult(no_review 场景)。
- `StateOrchestrator.cascadeIfBlocked(taskId, allTasks)`:`cascadeBlock` 算后继 → 逐个过 `validateTransition` → 能流转者 blocked / 不能者显式 skipped,返回 `CascadeOutcome`。
- 私有 `applyTransition` / `applyResultForTask` / `isResultAcceptable` 抽取共享逻辑,避免重复读取与重复实现。

## 3. 修改文件

- src/application/index.ts — 追加 `export * from './state-orchestrator.js'`

## 4. 新增文件

- src/application/state-orchestrator.ts
- test/application/state-orchestrator.test.ts

## 5. 删除文件

暂无。

## 6. 架构决策

- DEC-014(proposed):StateOrchestrator 四方法职责切分、共享私有转移、applyResult 对 ok:false 抛错转人工(DEC-005 落地)、applyReview skipped 委托 applyResult 复用 no_review 三分、cascadeIfBlocked 逐个过状态机+不能则 skipped 返回 CascadeOutcome、isResultAcceptable 产物校验清单、confirmed 在内部方法取 false。

## 7. 偏离计划

无源码偏离。一处规格内在张力(级联 vs 状态机表)如实实现并记 ISS-006 提议,未自行越界改 core 状态机表或 Readme 规格。

## 8. 后续任务注意事项

- TASK-017 状态编排就绪,后续由 TASK-029(App 规划工作流)完成 P4 规划用例收尾。
- application 层经 `TaskDocRepositoryPort` 依赖 infra,不直接 import 实现类(ARCHITECTURE §4);CLI(TASK-026 task:run)在 Executor 返回后调 applyResult/applyReview、前置失败时调 cascadeIfBlocked。
- `applyResult` 对 §10 非法组合抛错(DEC-005「不静默」落地),上层 Orchestrator 须 catch 记 issue + 转 blocked/needs-human。
- `cascadeIfBlocked` 返回 `CascadeOutcome`,调用方据 `skipped` 转人工(ISS-006);不要假设所有后继都被 blocked。
- ISS-006:级联对 ready/draft 后继返回 skipped,待 Orchestrator 裁定处理方向。

## 9. 未解决问题

- ISS-006(medium,open):级联张力——状态机表无 ready/draft→blocked 边,与 Readme §7 级联文字矛盾;cascadeIfBlocked 对未启动后继返回 skipped,提议三方向(补状态机边 / 级联强制语义 / 接受并回写 Readme 澄清)待裁定。不阻塞本任务验收。
- ISS-004 / ISS-005 延续,本任务未触发(纯计算 + 内存 fake 测试,不引用 VerificationResultSchema;全量回归在 Node 22 下通过)。

## 10. 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | passed | 0 错误(strict + noUncheckedIndexedAccess) |
| `npm test -- application/state-orchestrator` | passed | 33 项单测全绿 |
| `npm run lint` | passed | eslint 无报错 |
| `npm test`(全量) | passed | 470 项全绿(Node 22 ABI 127,含 SQLite) |
