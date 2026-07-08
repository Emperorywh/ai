---
doc: DECISIONS
status: active
---

# DECISIONS — 架构决策记录

> 本文件记录重要架构决策（见 `Readme.md` §6.6）。每条决策的稳定机器字段以 fenced YAML block 表达，Markdown 正文仅作补充；完整提议上下文见各 `TASK-XXX.result.md` 的 `global_update_requests.decisions`。
>
> 字段语义：`id` 由 Orchestrator 统一分配（`DEC-XXX`）；`status` 取 `proposed` / `accepted` / `superseded`；`scope` 为影响范围；`created_from_task` 为来源任务（`TASK-XXX`）或阶段（`SPEC` / `ARCHITECTURE`）。

---

## DEC-001 core 枚举采用 Zod schema 单一来源模式

```yaml
id: DEC-001
title: "core 枚举采用 Zod schema 单一来源模式"
status: accepted
scope: core
created_from_task: TASK-002
decision: "所有领域枚举在 src/core/enums.ts 中以 z.enum（或 z.union）定义为唯一来源，TS 联合类型由 z.infer 派生，遍历用 XxxSchema.options；禁止另立与 schema 不同源的常量数组或手写联合类型。"
rationale: "避免「TS 类型标注」与「Zod 运行时校验」两套取值各自维护导致漂移；Zod schema 同时是 frontmatter/文档校验与 SQLite 索引的输入，单一来源最符合长期架构正确性。"
consequences: "后续 TASK-003…009 必须复用本文件 schema，不得重复声明枚举取值；新增枚举时遵循同模式。开放集合（如 TaskId）类型退化为 string，运行时由 schema 兜底校验。"
```

提议自 `TASK-002-core-enums.result.md`。本模式已被 TASK-003、TASK-004 实际沿用；ISS-001 确认枚举取值权威后无遗留不确定性，已置 `accepted`（2026-07-08 裁定）。

---

## DEC-002 任务 frontmatter 的 id 字段复用 enums.ts 的 TaskIdSchema

```yaml
id: DEC-002
title: "任务 frontmatter 的 id 字段复用 enums.ts 的 TaskIdSchema"
status: accepted
scope: core
created_from_task: TASK-003
decision: "TaskFrontmatterSchema.id 直接复用 src/core/enums.ts 的 TaskIdSchema（/^TASK-\\d+$/），不为本字段另立 ^TASK-\\d{3,}$ 正则。"
rationale: "AGENTS.md §3「不复制粘贴重复逻辑」与 DEC-001 要求 id 校验规则只有一处定义；TaskIdSchema 的 \\d+ 是任务 §8 \\d{3,} 的超集，不拒绝任何真实 3 位任务 id（TASK-001…TASK-029 均通过），§11 正例验收不受影响。id 与 created_from_task 同为「任务 id」语义，同源校验更自洽。"
consequences: "本决策与任务 §8 字面（\\d{3,}）存在偏差，对应 ISS-002。若确认收紧，应改 enums.ts 的 TaskIdSchema 为 \\d{3,}（届时 TASK-003 id 字段随之收紧）；若确认放宽，应回写任务 §8 / Readme。后续 Schema 凡涉及任务 id 一律复用 TaskIdSchema。"
```

提议自 `TASK-003-core-task-schema.result.md`。ISS-002 已裁定方案 B（放宽 `\d+`），TASK-003 §8 已回写，本决策置 `accepted`（2026-07-08 裁定）。

---

## DEC-003 决策 / 问题 Schema 的 scope 取自由文本，created_from_task 取 ScopeSchema

```yaml
id: DEC-003
title: "决策 / 问题 Schema 的 scope 取自由文本，created_from_task 取 ScopeSchema"
status: accepted
scope: core
created_from_task: TASK-004
decision: "DecisionSchema / IssueSchema 的 created_from_task 字段复用 enums.ts 的 ScopeSchema（SPEC | ARCHITECTURE | TASK-\\d+）；scope 字段取自由文本（z.string().min(1)），不套枚举。"
rationale: "§6.6 / §6.7 把 scope 释义为「影响范围」，§10 模板正例用 scope: state / scope: api，TASK-003 已提交的 result.md 提议项用 scope: core，均为模块 / 层级自由文本，无法穷举为枚举。本 Schema 将同时校验 .result.md 的 global_update_requests 提议项（§9 数据流），若 scope 套 ScopeSchema 会直接拒绝项目自身已提交的产物与规格正例。created_from_task 语义明确（来源任务 / 阶段），可枚举，故复用 ScopeSchema。"
consequences: "本决策与任务 §8 字面「status/scope/severity 用枚举」、enums.ts ScopeSchema 注释「校验 created_from_task / scope 字段」存在偏差：实际仅 created_from_task 用枚举，scope 用自由文本。偏差见 ISS-003。若确认收紧 scope 为枚举，需另开任务改本 Schema 并修正 §10 示例与 TASK-003 result.md 的 scope 值（在 forbidden，需扩权）。"
```

提议自 `TASK-004-core-decision-issue-schema.result.md`。ISS-003 已裁定方案 A（自由文本），TASK-004 §8 与 enums.ts 注释已回写，本决策置 `accepted`（2026-07-08 裁定）。

---

## DEC-004 状态机采用「转移表 + 纯函数 + Result 判别联合」模式

```yaml
id: DEC-004
title: "状态机采用「转移表 + 纯函数 + Result 判别联合」模式"
status: proposed
scope: core/state-machine
created_from_task: TASK-007
decision: "任务状态流转以 Record<TaskStatus, readonly TaskStatus[]> 转移表（TASK_TRANSITIONS）编码 §7 全部合法边，canTransition 仅查表，validateTransition 在查表基础上叠加上下文前置条件（no_review / confirmed），返回 {ok:true|false, from, to, reason} 判别联合。状态机不做鉴权、不读写 I/O。"
rationale: "转移表以数据结构而非散落 if/switch 表达，便于单测做 9x9 完整矩阵审计与人工逐条核对 §7；canTransition/validateTransition 分离让「结构合法性」与「上下文合法性」各司其职；Result 判别联合以 ok 收窄类型，合法/非法都携带 from/to 便于上层日志审计。confirmed 仅是布尔事实、不区分「是谁确认」，恰好落在「结构前置条件」与「鉴权」的分界线上，符合任务 §12「状态机不做谁有权触发的细粒度鉴权」。"
consequences: "TASK-008 状态映射须复用 validateTransition 作为最终合法性闸门，不得另起转移表，否则两套表会漂移；TASK-017 状态编排负责从 frontmatter / 鉴权结果构造 TransitionContext 后调用 validateTransition；新增 §7 转移边时同步改 TASK_TRANSITIONS 与测试中的 LEGAL_EDGES。"
```

提议自 `TASK-007-core-state-machine.result.md`。状态机无运行时依赖、无边界冲突，待 Orchestrator 回写确认。

---

## DEC-005 领域规则层沿用「纯函数 + Result 判别联合」，状态映射非法组合返回 ok:false 而非抛异常

```yaml
id: DEC-005
title: "领域规则层沿用「纯函数 + Result 判别联合」，状态映射非法组合返回 ok:false 而非抛异常"
status: proposed
scope: core/rules
created_from_task: TASK-008
decision: "mapResultToStatus 返回 StatusMappingResult 判别联合（ok:true 携带 status + 可选 note / ok:false 携带 reason + 输入回显），三种非法组合（completed+retry / blocked+review / failed+review）返回 ok:false 而非抛异常；completed+review 在 no_review:true 时三分（orchestratorVerified 通过 → done、未通过 → blocked）；cascadeBlock 仅产出「应 blocked」后继集合，不判定后继能否合法流转到 blocked（交上层状态机）。switch(executionStatus) 配 never 穷尽性检查。"
rationale: "与 DEC-004 validateTransition 的 TransitionResult 同构，Orchestrator 收集非法组合后统一转人工而非中断编排；非法组合是 frontmatter 数据错误（§10，Zod 阶段不硬拒、由本函数运行期判定），判别联合比抛异常更便于上层优雅处理。completed+review+noReview+!verified→blocked 是 §7「校验不通过改走 blocked/failed，按 next_action 决定」在 next_action=review 语境下的保守落地（failed 应由 execution_status=failed 触发，产物自认为完成的保守等人工）。级联 / 映射只产目标建议，最终合法性归 TASK-017 经状态机二次闸门，避免 rules 层与 state-machine 职责重叠。"
consequences: "TASK-017 须对 mapResultToStatus 的 ok:false 记录 issue 并转人工（不得静默），对 ok:true 目标状态再过 validateTransition；新增 §10 映射分支或 ExecutionStatus / NextAction 枚举值时，never 穷尽性检查强制编译期补全 switch；若未来 §10 明确 completed+review+noReview+!verified 应映射 failed，改 mapResultToStatus 该分支即可（届时同步改测试）。"
```

提议自 `TASK-008-core-cascade-and-mapping.result.md`。领域规则无运行时依赖、无边界冲突；`completed+review+noReview+!verified→blocked` 系 §7 保守推断（见 TASK-008 result §7），待 Orchestrator 回写确认。

---

## DEC-006 验证 allowlist 与权限解析的 §16 关键解释：同名命令覆盖保留项目级 requires_permissions、路径重叠按路径段包含判定、启发式只产 warning 不授权

```yaml
id: DEC-006
title: "验证 allowlist 与权限解析的 §16 关键解释：同名命令覆盖保留项目级 requires_permissions、路径重叠按路径段包含判定、启发式只产 warning 不授权"
status: proposed
scope: core/rules
created_from_task: TASK-009
decision: "TASK-009 对 §16 三处未明文细节作如下解释并落地：（1）同名命令在项目级 TESTING.md 与任务级 verification 两处声明时任务级优先——保证该命令必入 allowlist（无视 layer 排除）且 source 标 'task'，但 requires_permissions 始终取自项目级声明（任务级 verification 是裸字符串无元数据），覆盖不抹除已声明能力，避免静默放权；（2）forbidden ∩ allowed 重叠按「路径段包含」判定（任一方为另一方祖先或完全相同即重叠，用 ancestor + '/' 做边界避免 src/foo 误判 src/foo-bar），任一重叠即 deny 优先、返回 ok:false 由 infrastructure 层拒绝启动，不静默取并集；（3）命令字符串启发式扫描只产 warning，绝不参与授权——授权只以 permissions × requires_permissions 交集为准（validateCommandPermissions）。"
rationale: "§16 明文「同一命令两处声明时以任务级为准」未指明 requires_permissions 归属，任务级 verification 又是裸字符串（无元数据字段）；取「保留项目级声明」是更安全方向（deny by default，绝不因覆盖而静默放宽能力边界），与 §16「能力不得通过魔法字符串授权、必须显式声明」精神一致。§16「forbidden ∩ allowed 重叠 deny 优先 + 拒绝启动」未定义「重叠」精度，路径段包含比精确匹配更贴合安全意图（allowed 子树落在 forbidden 内即矛盾），且以 ancestor+'/' 边界规避裸前缀误判。启发式只 warning 是 §16 明文要求，落地为 scanCommandHeuristics 与 validateCommandPermissions 完全解耦。三处均沿用 DEC-004/DEC-005 的「纯函数 + Result 判别联合」模式（resolvePathScope / validateCommandPermissions 返回 ok:true|ok:false+reason）。"
consequences: "TASK-010/012 解析 TESTING.md 与任务 frontmatter 后可直接传入 computeVerificationAllowlist / resolvePathScope / validateCommandPermissions；infrastructure 层（TASK-010 起）须在 Task Executor 启动前调用 resolvePathScope，重叠即拒绝启动不静默。若 Orchestrator 认为同名覆盖应抹除 requires_permissions（任务级完全替换），改 computeVerificationAllowlist 任务级分支一行（届时同步改测试与 DEC-006）；若认为路径重叠应收紧为精确匹配，改 pathsOverlap 判定即可。新增 Permission 枚举值时同步补 HEURISTIC_RULES（启发式不强制穷尽，warning 容错）。"
```

提议自 `TASK-009-core-verification-and-permissions.result.md`。验证 / 权限规则无运行时依赖、无边界冲突；三处 §16 解释（同名覆盖 requires_permissions 归属 / 路径重叠精度 / 启发式仅 warning）均为合理推断，待 Orchestrator 回写确认。
