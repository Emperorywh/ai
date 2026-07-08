---
doc: ISSUES
status: active
---

# ISSUES — 未解决问题记录

> 本文件记录未解决问题、阻塞项和需要人工确认的事项（见 `Readme.md` §6.7）。每个问题的稳定机器字段以 fenced YAML block 表达，Markdown 正文仅作补充；完整提议上下文见各 `TASK-XXX.result.md` 的 `global_update_requests.issues`。
>
> 字段语义：`id` 由 Orchestrator 统一分配（`ISS-XXX`）；`status` 取 `open` / `resolved`；`severity` 取 `low` / `medium` / `high` / `critical`；`scope` 为影响范围；`owner` 为责任人（空串表示尚未指派，等待人工认领）；`created_from_task` 为来源任务或阶段。

---

## ISS-001 Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 完整取值

```yaml
id: ISS-001
title: "Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 完整取值"
status: resolved
severity: medium
scope: core
created_from_task: TASK-002
owner: ""
recommended_action: "由 Orchestrator 在 Readme.md（§6.6/§6.7）或文档中确认这三个字段的权威取值集合后回写。当前 src/core/enums.ts 给出的最小推断集——DecisionStatus: proposed|accepted|superseded；IssueStatus: open|resolved；IssueSeverity: low|medium|high|critical——仅以 Readme §10 示例值（accepted/open/high）锚定，其余基于工作流语义推断，TASK-004 已据此复用落地，未确认前不应视为最终事实来源。"
```

提议自 `TASK-002-core-enums.result.md`。TASK-004 已基于该推断集实现 `DecisionSchema` / `IssueSchema` 并通过验收。已解决（2026-07-08）：Orchestrator 确认 `enums.ts` 推断集为权威取值，已回写 Readme §6.6 / §6.7。

---

## ISS-002 任务文件 id 正则精度不一致：§8 的 \d{3,} 与 enums.ts TaskIdSchema 的 \d+

```yaml
id: ISS-002
title: "任务文件 id 正则精度不一致：§8 的 \\d{3,} 与 enums.ts TaskIdSchema 的 \\d+"
status: resolved
severity: medium
scope: core
created_from_task: TASK-003
owner: ""
recommended_action: "由 Orchestrator 确认统一方向后回写：方案 A——把 enums.ts 的 TaskIdSchema 收紧为 /^TASK-\\d{3,}$/（需开新任务改 enums.ts，TASK-003 的 id 字段随之收紧，Scope 联合中的 TaskId 分支同步收紧）；方案 B——把 TASK-003 §8 与 Readme §9 模板说明放宽为 \\d+（接受任意位数）。TASK-003 已按方案 B 的精神（复用 \\d+）落地，等待确认。不阻塞验收（\\d+ 是超集，所有真实 id 通过），但影响「id 与 created_from_task 是否同精度」的长期一致性（关联 DEC-002）。"
```

提议自 `TASK-003-core-task-schema.result.md`。已解决（2026-07-08）：Orchestrator 选方案 B（放宽 `\d+`），TASK-003 §8 已回写；DEC-002 同步置 `accepted`。

---

## ISS-003 scope 字段语义张力：任务 §8「用枚举」 vs §6.6/§10/TASK-003 的自由文本实际用法

```yaml
id: ISS-003
title: "scope 字段语义张力：任务 §8「用枚举」 vs §6.6/§10/TASK-003 的自由文本实际用法"
status: resolved
severity: medium
scope: core
created_from_task: TASK-004
owner: ""
recommended_action: "由 Orchestrator 确认统一方向后回写：方案 A（确认自由文本，推荐）——回写 TASK-004 §8 去掉 scope 的「用枚举」措辞、修正 enums.ts ScopeSchema 注释为仅 created_from_task，本实现无需改动；方案 B（收紧为枚举）——需为 scope 选定枚举（如 LayerSchema 或新增），改本 Schema，并修正 §10 示例 scope: state/api 与 TASK-003 result.md scope: core（后者在 forbidden_paths，需扩权新任务）。TASK-004 已按方案 A 落地，不阻塞验收（关联 DEC-003）。"
```

提议自 `TASK-004-core-decision-issue-schema.result.md`。已解决（2026-07-08）：Orchestrator 选方案 A（自由文本），TASK-004 §8 与 enums.ts 注释已回写；DEC-003 同步置 `accepted`。
