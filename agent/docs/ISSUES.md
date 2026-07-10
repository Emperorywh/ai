---
doc: ISSUES
status: active
---

# ISSUES — 未解决问题记录

> 本文件记录未解决问题、阻塞项和需要人工确认的事项（见 `Readme.md` §6.7）。每个问题的稳定机器字段以 fenced YAML block 表达，Markdown 正文仅作补充；完整提议上下文见各 `TASK-XXX.result.md` 的 `global_update_requests.issues`。
>
> 字段语义：`id` 由 Orchestrator 统一分配（`ISS-XXX`）；`status` 取 `open` / `resolved`；`severity` 取 `low` / `medium` / `high` / `critical`；`scope` 为影响范围；`owner` 为责任人（空串表示尚未指派，等待人工认领）；`created_from_task` 为来源任务或阶段。

## 项目收尾遗留清单（2026-07-10）

> 项目已完成全部 29 个任务并执行 Readme §11 第 10 步收尾。下列 **12 项 open** 为 v0.1.0 范围外的已知遗留，均非阻塞，按类别分组；权威字段见各条 fenced YAML。ISS-009 已由 TASK-026 落地路由适配器、本次收尾标记 resolved。

- **SDK 接入类**（解锁后连带收敛）：
  - ISS-012（medium）— Claude Agent SDK 未安装 / API 未确认，`ClaudeSdkExecutor` 需 SDK 就位才能调模型；当前以 DryRun + 注入骨架交付。后续入口：单立 SDK 选型任务。
  - ISS-016（medium）— `task:review` 默认 `LocalReviewer` 确定性产 approved 不经真实审查；SDK 就位后注入真实 Reviewer（连带 ISS-012）。
- **语义张力类**（需 Orchestrator 裁定方向）：
  - ISS-006（medium）— 依赖级联张力：状态机表无 `ready/draft→blocked` 边，`cascadeIfBlocked` 对未启动后继返回 skipped。
  - ISS-010（low）— §3.2 未明文 append 与 replace 同 section 混合时的冲突语义。
  - ISS-011（low）— 合并恢复补做回写时 progress append 在重复恢复下可能重复追加。
- **环境约束类**：
  - ISS-005（low）— `better-sqlite3@11.10.0` 需 Node 22（ABI 127）预编译，本机无 VS Build Tools 无法重编译（建议固定 Node 22 / 升级 / 预装编译工具链）。
- **跨进程 / 工作区同步类**：
  - ISS-007（low）— `commitAuditResult` 依赖仓库已配置 git `user.name/email`，适配器不设 config。
  - ISS-008（medium）— `WorktreeAdapter.reset` 基线存内存 Map，跨 CLI 进程续跑（restart_on_retry）丢失。
  - ISS-014（low）— `fastForwardMain` 用 update-ref 不检出工作区，已由 `syncMainWorktreeFile` 针对性补齐（统一策略未裁定）。
- **代码复用 / 增强类**：
  - ISS-015（low）— `task-review.ts` 与 `task-run.ts` 重复合并逻辑，建议抽 cli 共享助手模块。
  - ISS-004（low）— `VerificationResultSchema` 暂置于 `result-schema.ts` 未提升至 `enums.ts`（后续复用时提升）。
  - ISS-017（low）— MCP 配置文件格式与 init 衔接未落地（待具体 server 需求出现）。

> 已解决：ISS-001 / ISS-002 / ISS-003（2026-07-08）、ISS-013 / ISS-018（TASK-024，2026-07-10）、ISS-009（TASK-026，2026-07-10 本次收尾）。

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

## ISS-007 commitAuditResult 依赖 git user.name / user.email 已配置，本适配器不设 config（AGENTS §4 不隐藏兼容）

```yaml
id: ISS-007
title: "commitAuditResult 依赖 git user.name / user.email 已配置，本适配器不设 config（AGENTS §4 不隐藏兼容）"
status: open
severity: low
scope: infrastructure/git/worktree-adapter
created_from_task: TASK-018
owner: ""
recommended_action: |-
  commitAuditResult 内部执行 git commit，若仓库未配置 user.name / user.email，git 报错「Please tell me who you are」导致抛 GitAdapterError。本适配器不主动 git config 设置身份（AGENTS §4「运行时容错必须作为显式错误处理或能力声明，不作为隐藏兼容逻辑存在」）——commit 身份是仓库 / 全局环境配置，非适配器职责。当前测试夹具用 local config（git config user.email/name）保证可 commit。建议（待 Orchestrator 确认）：(A) CLI init（TASK-023）在 agent init 时检测并提示 / 写入仓库 user.name + user.email（推荐，init 是显式配置时机）；(B) 在 commitAuditResult 前用 git config user.name 检测缺失并抛带指引的领域错误（显式失败优于隐藏默认）；(C) 接受现状，文档约定使用方须确保 git 身份配置。不阻塞 TASK-018 验收（适配器语义正确，commit 身份是环境前置），但 TASK-023 / TASK-026 落地 CLI 时须处理，否则 task:run 回填 audit commit 会失败。关联 DEC-015。
```

提议自 `TASK-018-infra-git-worktree.result.md`。commitAuditResult 调 `git commit` 需 git 身份配置，本适配器不设 config（AGENTS §4）。低优先级——适配器语义正确，commit 身份是环境前置；建议 CLI init（TASK-023）显式配置，待 Orchestrator 确认方向。

## ISS-008 reset 基线为内存 Map，跨 CLI 进程续跑（restart_on_retry）时丢失，reset 会抛错

```yaml
id: ISS-008
title: "reset 基线为内存 Map，跨 CLI 进程续跑（restart_on_retry）时丢失，reset 会抛错"
status: open
severity: medium
scope: infrastructure/git/worktree-adapter
created_from_task: TASK-018
owner: ""
recommended_action: |-
  WorktreeAdapter.reset 依赖 create 时记入 bases Map 的基线 commit hash。§7 续跑语义（rejected→ready / blocked→ready）保留已存在的 worktree，若 frontmatter 声明 restart_on_retry: true 则 reset 重跑。但每次 CLI 调用（task:run）是新进程、新适配器实例，bases Map 不跨进程持久——跨 CLI 续跑触发 reset 时 bases 无记录，抛「未由本适配器 create，无法确定重置基线」。当前实现单进程内 create→reset 有效（测试覆盖），但 §3.2 续跑通常跨 CLI 调用。建议（任选其一，待 Orchestrator 裁定）：(A) create 时把基线 hash 写入 worktree 的 git config（如 git config workflow.base <hash>，存于主仓库 .git/worktrees/<id>/config），reset 时读回——跨进程持久、与 worktree 生命周期绑定（推荐，worktree 删除即随 config 消失）；(B) reset 从 git 推断基线（worktree 分支首个 commit 的 parent，或与 main 的 merge-base），但 main 可能已变、worktree 可能无 commit，推断不可靠；(C) application 层（TASK-026）在跨进程续跑发现 worktree 已存在时，先 remove 旧 worktree 再 create 新 worktree（绕过 reset，但丢失「保留 worktree」语义）。不阻塞 TASK-018 验收（适配器在单进程 create→reset 链路正确，跨进程是组合层问题），但 TASK-026 task:run 落地续跑前须选定方案，否则 restart_on_retry 在跨 CLI 场景失效。关联 DEC-015（create 记录基线设计）。
```

提议自 `TASK-018-infra-git-worktree.result.md`。WorktreeAdapter.reset 的基线 commit 存于内存 Map，跨 CLI 进程续跑（restart_on_retry）时丢失导致 reset 抛错。中等优先级——单进程内 create→reset 链路正确（已测试），但 §3.2 续跑通常跨 CLI 调用；建议 create 写 worktree git config 持久化基线（方案 A），待 Orchestrator 裁定。

## ISS-009 合并用例 docs port 需按 taskId 路由到各 worktree/docs/tasks，TaskDocRepository 单 tasksDir 无法覆盖多 worktree，wiring 归 TASK-025/026

```yaml
id: ISS-009
title: "合并用例 docs port 需按 taskId 路由到各 worktree/docs/tasks，TaskDocRepository 单 tasksDir 无法覆盖多 worktree，wiring 归 TASK-025/026"
status: resolved
severity: low
scope: application/merge/rebase-ff
created_from_task: TASK-019
owner: ""
recommended_action: |-
  rebaseAndFastForward 处理一批任务时，各任务 .result.md 分布在各自 worktree 内（Executor 产出，§3.2「worktree 中只读引用全局文档，Task Executor 把更新写入 .result.md」），合并逐任务在各自 worktree 进行（rebase/commitAuditResult/ff 均操作 task/<id> worktree）。GitMergePort 天然按 taskId 经 WorktreePort/GitMergeAdapter.worktreePath(taskId) 寻址 worktree（单 GitMergeAdapter 实例覆盖所有任务）；但 TaskDocRepositoryPort 的 readResult(taskId)/writeResult(result) 经 TaskDocRepository 单一固定 tasksDir 寻址，无法区分多 worktree 的 docs/tasks。故 CLI composition root（TASK-025/026）wiring MergePorts.docs 时须组合一个按 taskId 路由的适配器（taskId → worktreesDir/<taskId>/docs/tasks 的 TaskDocRepository），而非直接注入单 tasksDir 的 TaskDocRepository。本任务测试用闭包路由夹具（worktreeDocs）模拟该 wiring 验证编排逻辑，wiring 本身归 TASK-025/026。不阻塞 TASK-019 验收（编排逻辑经 ports 接口正确，路由是组合层职责），但 TASK-025/026 落地 CLI 时须实现该路由适配器，否则多任务合并回填 execution_commits 会写错位置（主仓库 docs/tasks 而非 worktree）。关联 DEC-016（MergePorts 设计）。
```

提议自 `TASK-019-app-merge-rebase-ff.result.md`。合并用例的 docs port 需按 taskId 路由到各 worktree/docs/tasks，而 TaskDocRepository 单 tasksDir 无法覆盖多 worktree（GitMergePort 天然按 taskId 寻址 worktree）。低优先级——编排逻辑经 ports 接口正确（测试用路由夹具验证），路由适配器是 CLI wiring 层职责；建议 TASK-025/026 落地 CLI 时实现按 taskId 路由的 docs 适配器，待 Orchestrator 确认。

**Resolution（TASK-026，2026-07-10）**：方案已落地——TASK-026 `task:run`（`src/cli/commands/task-run.ts`）在合并阶段以 `new TaskDocRepository(join(wtPath, 'docs', 'tasks'))` 把 `MergePorts.docs` 按 taskId（经 wtPath）路由到各 worktree 的 docs/tasks（task-run.ts:233 读 result、:308 合并写 result），`rebaseAndFastForwardMerge` 注释明文标注 ISS-009。ISS-009 不再可操作，标记 resolved。

---

## ISS-010 §3.2 未明文 append 与 replace 混合（同 section 既 append 又 replace）时的冲突语义，本任务按字面落地（append 不算冲突，replace 在 apply 阶段逐条变换时覆盖此前 append）

```yaml
id: ISS-010
title: "§3.2 未明文 append 与 replace 混合（同 section 既 append 又 replace）时的冲突语义，本任务按字面落地（append 不算冲突，replace 在 apply 阶段逐条变换时覆盖此前 append）"
status: open
severity: low
scope: application/merge/section-writeback
created_from_task: TASK-020
owner: ""
recommended_action: |-
  Readme §3.2 line 122 仅明文「append 按拓扑序拼接，不同 section 互不影响直接合并；多条 replace 命中同一 section 时按拓扑序后写者覆盖先写者，先写者落选」，未涉及「同一 section 既 append 又 replace」的混合场景。TASK-020 按字面落地：append 不参与冲突检测（多条 append 视为叠加），replace 与 append 混合时按 applyProgressUpdate 逐条变换的自然顺序处理——拓扑序上 replace 在 append 之后则 replace 覆盖此前 append 的内容、append 在 replace 之后则 append 追加到 replace 结果上，二者均不计入冲突清单（视为「后写者覆盖先写者」总体精神的逐条 apply 自然结果）。该解释合理但规格未明文，可能与其他 Orchestrator 期望（如「同 section 的 append+replace 也应算冲突」）不符。建议（任选其一，待 Orchestrator 裁定）：(A) 接受现状并回写 Readme §3.2 澄清「混合时按逐条 apply 的自然顺序，不计冲突」；(B) 把同 section 的 append+replace 组合也纳入冲突检测（改 detectProgressConflicts）；(C) 规定混合时 replace 恒优先（先 apply 所有 replace 再 apply append）。不阻塞 TASK-020 验收（核心 replace-replace 冲突 + append 叠加 + replace 覆盖 append 已测试覆盖），详见 DEC-017。
```

提议自 `TASK-020-app-merge-section-writeback.result.md`。§3.2 仅明文「多条 replace 命中同一 section」为冲突场景，append/replace 混合语义未明文。TASK-020 在 forbidden 约束下按字面落地（append 不计冲突，replace 逐条 apply 覆盖 append 为顺序结果）。低优先级，不阻塞验收（核心冲突场景已覆盖），待 Orchestrator 裁定方向（A 接受并回写 Readme / B 纳入冲突检测 / C replace 恒优先）。关联 DEC-017。

---

## ISS-011 「补做回写」无法判定全局文档回写是否已部分完成——progress append 在同一崩溃被多次恢复时会重复追加（合并进度不写 SQLite 的必然结果）

```yaml
id: ISS-011
title: "「补做回写」无法判定全局文档回写是否已部分完成——progress append 在同一崩溃被多次恢复时会重复追加（合并进度不写 SQLite 的必然结果）"
status: open
severity: low
scope: application/merge/recovery
created_from_task: TASK-021
owner: ""
recommended_action: |-
  Readme §3.2 line 125 明文合并操作幂等可恢复、合并进度不写 SQLite（可从 git 状态加 frontmatter status 完全重建），并把恢复分两路：「已进入则跳过合并、仅补做未完成的全局文档回写；未进入则丢弃中间态重新 rebase」。但「仅补做未完成」隐含一个判定：回写是否已（部分）完成。由于合并进度（含回写进度）不写 SQLite，恢复只能从 git 状态（branchMerged）重建「合并」进度，无法重建「回写」进度——branchMerged==true 仅说明合并已完成，不说明回写是否已落盘。故 TASK-021 recoverMerge 合并完成时一律重新执行 writebackGlobalDocs：对 decisions/issues（按 id 去重）与 progress replace（后写者覆盖）幂等，但 progress append（按拓扑序拼接）在同一崩溃被多次恢复调用时会重复追加同一 content。不阻塞验收（合并的幂等保证由 branchMerged 守住，单次恢复内回写正确；append 重复仅在异常的「同一崩溃多次 recoverMerge」时发生）。建议（任选其一，待 Orchestrator 裁定）：(A) 接受现状 + 规定 Orchestrator「一次崩溃一次恢复」（推荐，最简，契合 §3.2 不写进度）；(B) 引入回写完成标记（如 .result.md frontmatter 增 writeback_applied 字段，但与 §3.2「合并进度不写 SQLite」精神需权衡——frontmatter 非 SQLite，可接受）；(C) writebackGlobalDocs 对 append 也做幂等化（如按 content 去重，但 append 语义本就是叠加，去重会破坏合法的重复 append）。详见 DEC-018。
```

提议自 `TASK-021-app-merge-recovery.result.md`。§3.2 明文合并进度不写 SQLite，恢复只能从 git 状态（branchMerged）重建合并进度，无法重建回写进度；故 recoverMerge 合并完成时一律重做 writebackGlobalDocs——decisions/issues/replace 幂等，但 progress append 在同一崩溃被多次恢复时会重复追加。低优先级，不阻塞验收（合并幂等由 branchMerged 守住，单次恢复内回写正确），待 Orchestrator 裁定（A 接受 + 一次崩溃一次恢复 / B 回写完成标记 / C append 幂等化）。关联 DEC-018。

---

## ISS-012 Claude Agent SDK 未安装 / API 未确认（R1）——ClaudeSdkInvocation 无真实实现，ClaudeSdkExecutor 需 SDK 就位才能调用模型

```yaml
id: ISS-012
title: "Claude Agent SDK 未安装 / API 未确认（R1）——ClaudeSdkInvocation 无真实实现，ClaudeSdkExecutor 需 SDK 就位才能调用模型"
status: open
severity: medium
scope: infrastructure/sdk
created_from_task: TASK-022
owner: ""
recommended_action: |-
  Readme §3.1 把 Claude Agent SDK 列为执行引擎适配层、§12 R1 明文「SDK API 未确认是本计划最高风险」、任务 §1 §2 要求「先确认 SDK 版本与接口，再以接口隔离方式实现」。但本仓库 package.json 无 `@anthropic-ai/claude-agent-sdk`、node_modules 无该包；AGENTS / 任务红线禁止新增 npm 依赖（确需新增须停下提议，不改 package.json）。故 TASK-022 无法在本任务安装 / 确认 SDK，以「接口 + DryRun + 注入骨架」交付：`ClaudeSdkInvocation` 为接口隔离的注入句柄但无真实实现，`ClaudeSdkExecutor` 构造注入 null 时 execute 抛 `ExecutorNotConfiguredError`（不伪造调用）；`DryRunLocalExecutor` 提供占位 .result.md 供前置链路联调。不阻塞验收（§11 允许 DryRun 交付、§12 R1 允许接口 + DryRun 收尾），但 TASK-026 task:run 真正调用模型前必须解决。建议（待 Orchestrator 裁定）：(A) 单独立一个 SDK 选型任务——确认 Claude Agent SDK 版本（当前最新 `@anthropic-ai/claude-agent-sdk`）、子 agent 派发方式、Context Pack 注入方式（system prompt / 文件注入 / tool use）、权限与 hooks 注入点，落 DECISIONS，并扩权新增依赖后实现真实 ClaudeSdkInvocation（推荐，符合「先确认再实现」）；(B) 暂以 DryRun 跑通全链路，SDK 接入延后到 CLI 全部就位后统一接入；(C) 若确认使用其他执行引擎（如直接 Claude API / 本地模型），改 ClaudeSdkInvocation 适配（契约不变）。本任务的 ClaudeSdkExecutor 编排逻辑 + DryRun + 契约均经测试（14 项），SDK 就位时只需补 invocation 实现。详见 DEC-019。
```

提议自 `TASK-022-infra-claude-sdk-adapter.result.md`。SDK 未安装（package.json 无 `@anthropic-ai/claude-agent-sdk`）且 API 未确认（§12 R1），红线禁新增依赖。TASK-022 以「接口 + DryRun + 注入骨架」交付：ClaudeSdkInvocation 无真实实现，ClaudeSdkExecutor 未注入 invocation 时抛 ExecutorNotConfiguredError 不伪造；DryRunLocalExecutor 提供占位 .result.md 供前置链路联调。中优先级，不阻塞验收（§11/§12 允许 DryRun 交付），但 TASK-026 task:run 真正跑模型前必须解决，待 Orchestrator 裁定 SDK 选型（A 单立选型任务 / B DryRun 跑通后统一接入 / C 换执行引擎）。关联 DEC-019。

---

## ISS-013 CLI 命令任务的 allowed_paths 应含 framework.ts

```yaml
id: ISS-013
title: "CLI 命令任务的 allowed_paths 应含 framework.ts"
status: resolved
severity: low
scope: docs/tasks（CLI 命令任务规格）
created_from_task: TASK-025
owner: ""
recommended_action: |-
  TASK-025 把 status.ts/rebuild-index.ts/index.ts/test 列为 allowed_paths，但 CLI 命令注册单一入口 createProgram 位于 src/cli/framework.ts（TASK-023 既定模式、ARCHITECTURE §7 文档化的注册点）——新增命令必须在此追加 register<Name>Command 调用，方能被 runCli（其内部 createProgram）识别，否则 caw status / caw rebuild-index 为未知命令。本任务已对 framework.ts 做同层 src/cli 增量改动（2 行 import + 2 行 register 调用 + 注释），未碰 forbidden_paths（src/core/application/infrastructure）。建议（任选其一，待 Orchestrator 裁定）：(A) TASK-026/027 等 CLI 命令任务的 allowed_paths 显式加入 src/cli/framework.ts（推荐，最小改动，匹配实际）；(B) 在 ARCHITECTURE §7 注明 framework.ts 为所有 CLI 命令任务的共享注册点、视为隐含 allowed（需放宽边界判定的实现）；(C) 重构为 index.ts 驱动注册（破坏 runCli 单一入口的既定模式，不推荐）。src/cli/index.ts（bin 入口）经评估无需改动（runCli 已统管，任务列入 allowed_paths 属冗余）。不阻塞验收（改动同层、非破坏性、与 TASK-023 模式一致）。
```

提议自 `TASK-025-cli-status-and-rebuild-index.result.md`。CLI 命令注册入口 createProgram 在 framework.ts，不在本任务 allowed_paths，但新增命令必须改它；已做同层增量未碰 forbidden_paths。低优先级，不阻塞验收，待 Orchestrator 裁定（A 后续 CLI 任务纳 framework.ts / B ARCHITECTURE 注明共享注册点 / C 重构 index.ts 驱动不推荐）。关联 DEC-021。TASK-026（task:run）延续同一模式：allowed_paths 同样未含 framework.ts，做同层 src/cli 最小注册增量（1 行 import + 1 行 register 调用），未碰 forbidden_paths，进一步印证方案 A 的必要性。

**Resolution（TASK-024，2026-07-10）**：TASK-024（plan / task:create）延续同一先例——allowed_paths 未含 framework.ts，做同层 src/cli 最小注册增量（2 行 import + 2 行 register 调用 + 注释更新），未碰 forbidden_paths。至此 CLI 命令任务（TASK-023/024/025/026/027）全部完成，无后续任务需套用本建议，ISS-013 不再可操作，标记 resolved（实际采纳方案 A 的精神，但因无后续 CLI 任务而不需再改任务规格）。关联 DEC-028。

---

## ISS-014 fastForwardMain 用 update-ref 不检出工作区，task:run 需手动同步主工作区结果文件

```yaml
id: ISS-014
title: "fastForwardMain 用 update-ref 不检出工作区，task:run 需手动同步主工作区结果文件"
status: open
severity: low
scope: cli（task:run）/ infrastructure（git worktree-adapter fastForwardMain）
created_from_task: TASK-026
owner: ""
recommended_action: |-
  GitMergeAdapter.fastForwardMain（TASK-018）以 git update-ref refs/heads/<mainRef> 移动主分支 ref、不更新主仓库工作区文件（update-ref 只动 ref，不 checkout）。task:run 合并回收后 .result.md 已在 main 历史中，但主工作区缺该文件（产物原本只在 worktree），caw status（经 TaskDocRepository 读工作区文件取执行摘要）会误判任务「未执行」。task:run 已以 syncMainWorktreeFile（git checkout <mainRef> -- <result_file>，仅检出结果文件到主工作区 + 索引、不动任务 status 的工作区写回）针对性补齐，使 status 能正确展示。建议（任选其一，待 Orchestrator 裁定）：(A) 在 fastForwardMain 内部或专门步骤统一处理工作区同步（ff 后 checkout 受影响路径），但需避免覆盖 Orchestrator 的 status 工作区写回；(B) status 命令在结果文件工作区缺失时从 git 历史回退读取（git show <mainRef>:<path>）；(C) 接受工作区 stale、文档化「合并后需 git checkout」。不阻塞验收（task:run 已针对性同步、单测验证结果文件主工作区可见）。
```

提议自 `TASK-026-cli-task-run.result.md`。TASK-018 fastForwardMain 的 update-ref 设计（避免 checkout / merge commit）天然不更新主工作区，与 TASK-026「status 权威在主仓库工作区文件」叠加产生 stale；task:run 以 syncMainWorktreeFile 补齐。低优先级，不阻塞验收，待 Orchestrator 裁定统一工作区同步策略。关联 DEC-022。

---

## ISS-015 task-review.ts 与 task-run.ts 重复合并逻辑（3 私有助手就地重实现）+ 跨命令 import，建议抽取 cli 共享助手模块

```yaml
id: ISS-015
title: "task-review.ts 与 task-run.ts 重复合并逻辑（3 私有助手就地重实现）+ 跨命令 import，建议抽取 cli 共享助手模块"
status: open
severity: low
scope: cli（task-review.ts / task-run.ts）
created_from_task: TASK-027
owner: ""
recommended_action: |-
  task-run.ts 的 rebaseAndFastForwardMerge / syncMainWorktreeFile / appendMergeConflictIssue 三个私有助手未导出，task-review.ts 因本任务 allowed_paths 不含 task-run.ts、且遵循既有 cli 命令 self-contained 惯例（status/rebuild-index/task-run 之间无跨命令 import），就地重实现了相同逻辑（AGENTS §3 重复逻辑）。另 task-review.ts 跨命令 import 了 task-run.ts 的 2 个导出助手（createFsGlobalDocRepo / sequentialIdAllocator）。建议（任选其一，待 Orchestrator 裁定）：(A) 后续任务扩 allowed_paths 把 task-run.ts 的合并助手导出并由 task-review.ts 复用（最小改动，但加深 task-run.ts 作为「共享助手库」的耦合）；(B) 抽取 cli 共享助手模块（如 src/cli/shared/merge-helpers.ts + fs-global-doc.ts），由 task-run.ts / task-review.ts 共同复用（推荐，收口合并机械与全局文档 fs 适配，需新任务的 allowed_paths 含该新模块 + task-run.ts 做迁移）；(C) 接受重复、文档化（违背 AGENTS §3，不推荐）。不阻塞本任务验收（逻辑一致、13 项单测覆盖;重复仅影响可维护性）。
```

提议自 `TASK-027-cli-task-review.result.md`。task-run.ts 的合并助手（rebaseAndFastForwardMerge 等）私有未导出、且 task-review.ts allowed_paths 不含 task-run.ts，导致合并机械重复实现;另跨命令 import 了 2 个导出助手。低优先级，不阻塞验收，待 Orchestrator 裁定抽取 cli 共享助手模块。关联 DEC-023。

---

## ISS-016 task:review 默认 LocalReviewer 确定性产 approved 不经真实审查，生产须注入真实 Reviewer

```yaml
id: ISS-016
title: "task:review 默认 LocalReviewer 确定性产 approved 不经真实审查，生产须注入真实 Reviewer"
status: open
severity: medium
scope: cli（task:review LocalReviewer）
created_from_task: TASK-027
owner: ""
recommended_action: |-
  task:review 默认 Reviewer 为 LocalReviewer，确定性产 approved（§12「SDK 未就位用本地审查器兜底，避免阻塞」，复用 TASK-022 DryRunLocalExecutor 产 completed 的哲学）。当前 caw task:review <id> 无注入时即自动放行 approve→done→合并，不经任何真实审查——与「独立 Reviewer 审查」的 §5.3/§15 设计意图存在张力（DryRunLocalExecutor 产 completed 至少不伪造「成功执行」，LocalReviewer 产 approved 则是直接放行合并）。SDK 就位（ISS-012/DEC-019）后应由上层注入真实 reviewer agent。建议（任选其一，待 Orchestrator 裁定）：(A) SDK 未就位期间在 framework 注册层对默认 LocalReviewer 输出显著 stderr 告警（如「warning: 使用本地审查器兜底，未做真实审查」），提示生产须注入 Reviewer；(B) 要求显式 --allow-local-reviewer 标志才启用默认 LocalReviewer，否则拒绝并提示注入 Reviewer（更安全，但增加摩擦）;（C）接受现状、文档化默认行为。不阻塞本任务验收（§12 明文允许本地兜底，reviewer 可注入）。关联 DEC-023 / ISS-012。
```

提议自 `TASK-027-cli-task-review.result.md`。task:review 默认 LocalReviewer 产 approved 系 §12「避免阻塞」落地，复用 DryRun 哲学;但 review 的「放行合并」语义比 execution 的「completed」更需谨慎。中优先级（安全/正确性关注），不阻塞验收（§12 明文允许、可注入），待 Orchestrator 裁定默认行为防护（告警 / 显式标志）。关联 DEC-023 / ISS-012。

---

## ISS-017 MCP 配置文件格式与 init 衔接未落地，createMcpAdapterFromConfig 只接受 raw 对象

```yaml
id: ISS-017
title: "MCP 配置文件格式与 init 衔接未落地，createMcpAdapterFromConfig 只接受 raw 对象"
status: open
severity: low
scope: infrastructure（mcp-adapter 配置加载）
created_from_task: TASK-028
owner: ""
recommended_action: |-
  TASK-028 落地的 MCP 适配器骨架中，createMcpAdapterFromConfig(raw) 只接受「已解析的 raw 对象」（用 McpServersConfigSchema 校验后构造 McpAdapter），不读文件、不绑定具体配置文件路径。但 init（TASK-023）生成的项目骨架（AGENTS.md + docs/{SPEC,ARCHITECTURE,PLAN,PROGRESS,DECISIONS,ISSUES,TESTING}.md + docs/tasks/）尚无 MCP 配置文件——任务 §8 明文「依赖配置文件格式（与 init 生成的项目配置衔接）」目前无对接对象。SPEC 范围亦无具体 MCP server 清单（R5「无具体 server 清单」）。故配置文件格式（建议如项目根 .caw/mcp.json 或在 AGENTS/docs 内声明 server 清单）+ CLI wiring（读配置 → createMcpAdapterFromConfig → 构造 McpAdapter → 注入 Executor / 具体调用方）+ 具体 server 接入（浏览器/设计/项目管理等）均留待后续任务。不阻塞 TASK-028 验收（§8/§12 明文避免过度设计，骨架只交付结构与注册机制，可单测）。建议：待具体 MCP server 需求出现时，新增任务定义配置文件格式 + init 模板追加 MCP 配置占位 + CLI 注入链路。关联 DEC-024。
```

提议自 `TASK-028-infra-mcp-adapter-skeleton.result.md`。MCP 配置加载只接受 raw 对象、不读文件，系 §12「避免过度设计」落地（init 无 MCP 配置文件、SPEC 无 server 清单 R5，过早绑定文件格式属臆测）。低优先级（前瞻性 TODO，非缺陷），不阻塞验收（骨架结构 + 注册机制可单测）。关联 DEC-024。

## ISS-018 validatePlanningInputs 的 specReviewed/architectureReviewed 判定来源未机器化定义

```yaml
id: ISS-018
title: "validatePlanningInputs 的 specReviewed/architectureReviewed 判定来源未机器化定义"
status: resolved
severity: low
scope: application（planning-workflow 前置校验）
created_from_task: TASK-029
owner: ""
recommended_action: |-
  TASK-029 的 validatePlanningInputs 接收 specReviewed / architectureReviewed 布尔（DEC-025：application 不读文件，文件状态作显式输入），但 Readme §11 第 4 步要求 Reviewer 独立审查 SPEC / ARCHITECTURE 后才进入第 5 步（生成 PLAN），「审查通过」的机器化判据未在工作流中明确——即「CLI 如何判定 specReviewed=true」无标准。可选方案：(A) 要求显式 `--reviewed` / `--bootstrap <source_spec>` 命令行标志由人工声明；(B) 检查 docs/ISSUES.md 无 created_from_task 为 SPEC / ARCHITECTURE 的 open 项；(C) 检查 docs/DECISIONS.md 是否有 SPEC / ARCHITECTURE 阶段审查通过的决策记录；(D) 检查 docs/SPEC.md / docs/ARCHITECTURE.md frontmatter 是否有 reviewed 标志（需扩文档协议）。当前 application 层只消费布尔（不读文件，§7），不阻塞 TASK-029 验收（纯逻辑三态可单测）。建议 TASK-024（cli-plan-and-task-create）plan 命令落地时确定判据并固化（推荐 A 人工显式声明最简单、最不易误判，或 B 基于 ISSUES 记录）。关联 DEC-025。
```

提议自 `TASK-029-app-planning-workflow.result.md`。validatePlanningInputs 的「已审查」判定来源未机器化定义，系 application 层「只消费布尔、不读文件」（DEC-025）与 §11「Reviewer 审查 SPEC/ARCHITECTURE」之间的衔接 gap——判据属 CLI composition root（TASK-024）职责，非 application 缺陷。低优先级，不阻塞本任务验收（application 层纯逻辑三态可单测）。关联 DEC-025。

**Resolution（TASK-024，2026-07-10）**：采用原方案 A——TASK-024 plan 命令以 `--reviewed` 布尔标志作「SPEC/ARCHITECTURE 已通过 Reviewer 独立审查」的机器判据，CLI composition root 判定 docs/SPEC.md / docs/ARCHITECTURE.md 存在性 + 该标志后传入 validatePlanningInputs（standard 模式硬性前置）。最简单、最不易误判（不依赖启发式 / 不读 ISSUES-DECISIONS 推断审查状态）。关联 DEC-028。

## ISS-019 zod peer 版本冲突——SDK 要 zod ^4，项目 zod ^3，须 --legacy-peer-deps 安装

```yaml
id: ISS-019
title: "zod peer 版本冲突——SDK 要 zod ^4，项目 zod ^3，须 --legacy-peer-deps 安装"
status: open
severity: medium
scope: package.json + 安装流程
created_from_task: TASK-030
owner: ""
recommended_action: |-
  `@anthropic-ai/claude-agent-sdk@0.3.206`（唯一版本，无旧版可选）peerDependencies 要 zod ^4.0.0，项目锁定 zod ^3.23.8（实际 3.25.76）。TASK-030 以 `npm install --legacy-peer-deps` + 显式声明 SDK 的 2 个 peer（@anthropic-ai/sdk、@modelcontextprotocol/sdk）解决：zod 保持 3.25.76（3→4 过渡版兼容 SDK .d.ts，typecheck + 全量 692 项测试全绿印证 @anthropic-ai/sdk peerOptional `^3.25.0 || ^4.0.0` 兼容意图）。不阻塞本任务验收（包就位 + 全绿）。代价：安装命令须带 --legacy-peer-deps（fresh install 不带会因 zod peer 报错），此约束持久。建议 Orchestrator 裁定：(A) 加项目根 .npmrc 设 legacy-peer-deps=true 持久化安装约束（.npmrc 不在 TASK-030 allowed_paths，需独立动作）；(B) 独立 zod 4 升级任务（破坏性，波及全项目 core/application/infrastructure zod 代码，须全量适配后改用正经 npm install 无 flag）；(C) 维持现状 + 文档/CI 标注安装命令。推荐 A（最小侵入持久化）或 C（现状可用），B 为长期清洁方案但成本高。关联 DEC-030。
```

提议自 `TASK-030-infra-sdk-dependency-and-client.result.md`。zod peer 冲突系 SDK 0.3.206 把 zod 外部化为 peer 且要求 ^4.0.0、与项目锁定 ^3.23.8 不兼容（SDK 无旧版可选）；本任务以 --legacy-peer-deps + 显式声明 peer + zod 保持 3.x（过渡版 3.25.76 兼容）解决，安装约束持久。medium 优先级（不阻塞本任务，但影响 fresh install 流程 / CI），待 Orchestrator 裁定 A/B/C。关联 DEC-030。

## ISS-020 SDK 及其 peer 引入 4 个传递依赖安全漏洞

```yaml
id: ISS-020
title: "SDK 及其 peer 引入 4 个传递依赖安全漏洞（npm audit：2 moderate/1 high/1 critical）"
status: open
severity: low
scope: package.json 传递依赖
created_from_task: TASK-030
owner: ""
recommended_action: |-
  扩权安装 @anthropic-ai/claude-agent-sdk + @anthropic-ai/sdk + @modelcontextprotocol/sdk 后，npm audit 报 4 个传递依赖漏洞（2 moderate / 1 high / 1 critical，来自上述包的子依赖链）。TASK-030 范围仅为装 SDK + 建 sdk-client，不处理传递依赖漏洞（不在 allowed_paths，且处置需评估升级/替换/override 影响）。不阻塞本任务验收（不影响 typecheck/test/sdk-client 功能；漏洞多在开发期/CLI 子进程上下文，非运行时数据面）。建议后续任务或人工 `npm audit` 评估：若漏洞涉及实际可达路径，用 npm overrides 钉补丁版本或升级 SDK/peer；若为不可达传递依赖，文档标注接受。关联 DEC-030。
```

提议自 `TASK-030-infra-sdk-dependency-and-client.result.md`。SDK 及 peer 的传递依赖漏洞系扩权引入，本任务不处理（范围外 + 需评估影响）。low 优先级（非运行时数据面），建议后续 npm audit 评估处置。关联 DEC-030。

## ISS-021 init.test.ts 测试标题/注释语义过时——TASK-031 扩展 init 产物加 .caw/config.json 后「不创建 docs/ 以外」名不副实（断言全绿，仅文档张力）

```yaml
id: ISS-021
title: "init.test.ts 测试标题/注释语义过时——TASK-031 扩展 init 产物加 .caw/config.json 后「不创建 docs/ 以外」名不副实（断言全绿，仅文档张力）"
status: open
severity: low
scope: test/cli/init.test.ts（不在 TASK-031 allowed_paths，未改）
created_from_task: TASK-031
owner: ""
recommended_action: |-
  TASK-031 往 init.ts 的 DOC_FILES 追加 .caw/config.json（SPEC §6/§13.2 要求 caw init 预置 provider profile），init 产物现含 docs/ 以外的配置文件。test/cli/init.test.ts（不在本任务 allowed，未改）的「仅写文档骨架，不创建 docs/ 以外的无关文件」测试（第 69 行）标题 + 第 75 行注释「docs/ 下文件数恰为清单声明数（SPEC/ARCHITECTURE/...+ tasks/.gitkeep）」现语义过时——.caw/config.json 是 docs/ 以外的「有关」文件。断言本身全绿不阻塞验收：(1) 第 9 行 EXPECTED_PATHS 动态派生自 DOC_FILES（自动含 .caw/config.json）；(2) 第 33/59 行 created/skipped 比对 EXPECTED_PATHS（动态跟上）；(3) 第 72-74 行 created 中每个路径都在 EXPECTED_PATHS 白名单内（toContain）通过；(4) 第 76 行 DOC_DOC_PATHS.length===8 只过滤 docs/ 前缀（.caw/config.json 不计入，仍 8）。仅测试标题/注释文档张力。建议后续任务（更新 init 测试时）把标题改为「仅写 DOC_FILES 清单内文件」等准确表述，注释补「.caw/config.json 是 SPEC §6 要求的 provider profile 配置」。关联 DEC-032。
```

提议自 `TASK-031-cli-provider-profile.result.md`。init.test.ts 测试标题/注释因 init 产物扩展（加 .caw/config.json）语义过时，断言全绿不阻塞（EXPECTED_PATHS 动态派生自 DOC_FILES + DOC_DOC_PATHS 只数 docs/），low 优先级（仅文档张力），建议后续更新测试表述。关联 DEC-032。
