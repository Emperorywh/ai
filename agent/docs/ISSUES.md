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

---

## ISS-004 VerificationResultSchema（passed/failed/skipped）暂置于 result-schema.ts，未提升至 enums.ts

```yaml
id: ISS-004
title: "VerificationResultSchema（passed/failed/skipped）暂置于 result-schema.ts，未提升至 enums.ts"
status: open
severity: low
scope: core
created_from_task: TASK-005
owner: ""
recommended_action: "VerificationResultSchema 是 .result.md 的 verification.result 字段取值集合（passed/failed/skipped，§10）。TASK-005 的 enums.ts 处于 forbidden_paths，无法新增，故就近定义于 result-schema.ts。该枚举当前仅服务于 .result.md 上下文，不影响功能。建议：若后续任务（如 SQLite 索引 TASK-014、状态映射 TASK-008）需复用该枚举，由对应任务（届时 enums.ts 应在其 allowed_paths 内）将其提升至 enums.ts 统一管理，并在 result-schema.ts 改为复用；当前不动。"
```

提议自 `TASK-005-core-result-schema.result.md`。低优先级，不阻塞后续任务。

---

## ISS-005 better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法重编译，需 Node 22（ABI 127）运行

```yaml
id: ISS-005
title: "better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法重编译，需 Node 22（ABI 127）运行"
status: open
severity: low
scope: "infrastructure/sqlite"
created_from_task: TASK-013
owner: ""
recommended_action: "better-sqlite3 是原生模块，预编译二进制绑定特定 NODE_MODULE_VERSION。当前环境 Node v25.9.0（ABI 141）无对应预编译；nvm 可用的 Node 22.0.0（ABI 127）有预编译。本任务实现期间已用 prebuild-install（Node 22 运行）补回被先前 npm rebuild 失败清空的 build/Release/better_sqlite3.node，并将 nvm 全局切到 Node 22 完成全绿验证。影响：开发者与 CI 需在 Node 22（或装有 VS Build Tools + Desktop C++ 工作负载可 node-gyp 重编译的版本）下运行本项目的 SQLite 相关测试 / 命令；package.json engines \"node\": \">=20\" 实际受原生模块约束。建议（任选其一，待 Orchestrator / 用户裁定）：(A) 固定项目 Node 版本为 22——加 .nvmrc（22）或收紧 engines 上界，并在文档标注；(B) 待 better-sqlite3 发布 Node 25 预编译后升级（npm i better-sqlite3@latest 触发 prebuild-install 重取）；(C) CI / 本机预装 VS Build Tools + Desktop C++ 工作负载以支持任意 Node 版本下 node-gyp 重编译。不阻塞 TASK-013 验收（已用 Node 22 全绿），但 TASK-014 及后续依赖 SQLite 的 CLI 任务同样受此约束。注：当前 nvm 全局已切到 Node 22（用户原为 Node 25）。"
```

提议自 `TASK-013-infra-sqlite-schema.result.md`。实现期间处理：原二进制为 Node 22（ABI 127）编译、Node 25 加载报 `NODE_MODULE_VERSION` 不匹配；`npm rebuild` 失败（无 VS Build Tools 且 Node 25 超 VS2017 支持范围）并清空了 build/Release 原二进制；改用 `prebuild-install`（Node 22 运行）从 GitHub release 补回 ABI 127 预编译，`nvm use 22.0.0` 后 typecheck/test/lint 全绿。低优先级（workaround 存在：用 Node 22），待 Orchestrator 裁定处理方向。

---

## ISS-006 依赖级联张力：状态机表无 ready/draft→blocked 边，与 Readme §7 级联文字「后继自动进入 blocked」矛盾，cascadeIfBlocked 对未启动后继返回 skipped

```yaml
id: ISS-006
title: "依赖级联张力：状态机表无 ready/draft→blocked 边，与 Readme §7 级联文字「后继自动进入 blocked」矛盾，cascadeIfBlocked 对未启动后继返回 skipped"
status: open
severity: medium
scope: application/state-orchestrator + core/state-machine
created_from_task: TASK-017
owner: ""
recommended_action: |-
  Readme §7 文字「当 TASK-A 处于 rejected/failed/blocked 时，所有直接或间接 depends_on 到 TASK-A 的后继任务自动进入 blocked」，但同节状态流转规则代码块 ready→[running|draft|cancelled]、draft→[ready|cancelled] 均无 →blocked 边（TASK-007 忠实落地了流转代码块）。后果：级联最常见的场景——前置失败、后继处于 ready（等待执行）——cascadeIfBlocked 经 validateTransition(ready, blocked) 得 ok:false，后继只能进 skipped 无法 blocked，级联对未启动后继实际无效。TASK-017 的 core/state-machine.ts 处于 forbidden_paths 无法改表，故如实实现（running/reviewing→blocked 成功，ready/draft/已终态→skipped 显式返回 CascadeOutcome），不静默。建议（任选其一，待 Orchestrator 裁定）：(A) 在状态机表补 ready→blocked / draft→blocked 边（开新任务改 core/state-machine.ts + TASK_TRANSITIONS + state-machine 测试的 9×9 矩阵，并回写 Readme §7 流转代码块）——最贴合级联语义；(B) 级联改用「强制 blocked」语义绕过状态机（在 cascadeIfBlocked 内对级联场景直接 writeTask blocked，但违反任务 §8「所有状态变更必须先过 validateTransition」）；(C) 接受级联只对运行中（running/reviewing）后继有效，ready 后继保持 ready 等前置恢复（与 §7 文字偏差，需回写 Readme 级联描述澄清）。当前不阻塞 TASK-017 验收（级联核心路径 running/reviewing→blocked 已覆盖、skipped 显式返回可追踪），但影响级联对等待态后继的完备性。关联 DEC-014（cascadeIfBlocked 逐个过状态机设计）。
```

提议自 `TASK-017-app-state-orchestrator.result.md`。状态机流转表（TASK-007）与 §7 级联文字存在内在张力——流转代码块无 ready/draft→blocked 边，而级联文字要求后继自动 blocked。TASK-017 在 forbidden 约束下（不能改 core 状态机表）如实落地：cascadeIfBlocked 对运行中后继（running/reviewing）成功 blocked，对未启动 / 已终态后继返回 skipped 显式暴露。中等优先级，待 Orchestrator 裁定方向（A 补状态机边 / B 级联强制语义 / C 接受并回写 Readme）。
