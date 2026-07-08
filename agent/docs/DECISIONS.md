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
status: proposed
scope: core
created_from_task: TASK-002
decision: "所有领域枚举在 src/core/enums.ts 中以 z.enum（或 z.union）定义为唯一来源，TS 联合类型由 z.infer 派生，遍历用 XxxSchema.options；禁止另立与 schema 不同源的常量数组或手写联合类型。"
rationale: "避免「TS 类型标注」与「Zod 运行时校验」两套取值各自维护导致漂移；Zod schema 同时是 frontmatter/文档校验与 SQLite 索引的输入，单一来源最符合长期架构正确性。"
consequences: "后续 TASK-003…009 必须复用本文件 schema，不得重复声明枚举取值；新增枚举时遵循同模式。开放集合（如 TaskId）类型退化为 string，运行时由 schema 兜底校验。"
```

提议自 `TASK-002-core-enums.result.md`。本模式已被 TASK-003（任务 Schema）、TASK-004（决策 / 问题 Schema）实际沿用，待 Orchestrator 确认后置为 `accepted`。

---

## DEC-002 任务 frontmatter 的 id 字段复用 enums.ts 的 TaskIdSchema

```yaml
id: DEC-002
title: "任务 frontmatter 的 id 字段复用 enums.ts 的 TaskIdSchema"
status: proposed
scope: core
created_from_task: TASK-003
decision: "TaskFrontmatterSchema.id 直接复用 src/core/enums.ts 的 TaskIdSchema（/^TASK-\\d+$/），不为本字段另立 ^TASK-\\d{3,}$ 正则。"
rationale: "AGENTS.md §3「不复制粘贴重复逻辑」与 DEC-001 要求 id 校验规则只有一处定义；TaskIdSchema 的 \\d+ 是任务 §8 \\d{3,} 的超集，不拒绝任何真实 3 位任务 id（TASK-001…TASK-029 均通过），§11 正例验收不受影响。id 与 created_from_task 同为「任务 id」语义，同源校验更自洽。"
consequences: "本决策与任务 §8 字面（\\d{3,}）存在偏差，对应 ISS-002。若确认收紧，应改 enums.ts 的 TaskIdSchema 为 \\d{3,}（届时 TASK-003 id 字段随之收紧）；若确认放宽，应回写任务 §8 / Readme。后续 Schema 凡涉及任务 id 一律复用 TaskIdSchema。"
```

提议自 `TASK-003-core-task-schema.result.md`。统一方向依赖 ISS-002 的裁定。

---

## DEC-003 决策 / 问题 Schema 的 scope 取自由文本，created_from_task 取 ScopeSchema

```yaml
id: DEC-003
title: "决策 / 问题 Schema 的 scope 取自由文本，created_from_task 取 ScopeSchema"
status: proposed
scope: core
created_from_task: TASK-004
decision: "DecisionSchema / IssueSchema 的 created_from_task 字段复用 enums.ts 的 ScopeSchema（SPEC | ARCHITECTURE | TASK-\\d+）；scope 字段取自由文本（z.string().min(1)），不套枚举。"
rationale: "§6.6 / §6.7 把 scope 释义为「影响范围」，§10 模板正例用 scope: state / scope: api，TASK-003 已提交的 result.md 提议项用 scope: core，均为模块 / 层级自由文本，无法穷举为枚举。本 Schema 将同时校验 .result.md 的 global_update_requests 提议项（§9 数据流），若 scope 套 ScopeSchema 会直接拒绝项目自身已提交的产物与规格正例。created_from_task 语义明确（来源任务 / 阶段），可枚举，故复用 ScopeSchema。"
consequences: "本决策与任务 §8 字面「status/scope/severity 用枚举」、enums.ts ScopeSchema 注释「校验 created_from_task / scope 字段」存在偏差：实际仅 created_from_task 用枚举，scope 用自由文本。偏差见 ISS-003。若确认收紧 scope 为枚举，需另开任务改本 Schema 并修正 §10 示例与 TASK-003 result.md 的 scope 值（在 forbidden，需扩权）。"
```

提议自 `TASK-004-core-decision-issue-schema.result.md`。统一方向依赖 ISS-003 的裁定。
