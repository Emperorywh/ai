---
task_id: TASK-009
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/rules/verification-rules.ts
  - src/core/rules/permission-rules.ts
  - test/core/rules/verification-permission.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/rules
    result: passed
    notes: "vitest run core/rules，2 文件 92 用例全部通过（新增 verification-permission 41 项 + 原依赖级联 51 项）"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 8 文件 273 用例全通过（含新增 41 项，原 232 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-009（Core 验证 allowlist 与权限解析）已完成：src/core/rules/verification-rules.ts 提供 computeVerificationAllowlist（layer 裁剪 + 任务级并集/覆盖），src/core/rules/permission-rules.ts 提供 resolvePathScope（deny 优先 + 拒绝启动）/ validateCommandPermissions（requires_permissions ⊆ permissions）/ scanCommandHeuristics（仅 warning 不授权），41 项单测。Core 层（type + domain）至此全部完成（P1 收尾）。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备，Core 层全部完成。状态机提供流转合法性判定（canTransition / validateTransition）；依赖级联 / 状态映射以纯函数提供（transitiveDependents / cascadeBlock / mapResultToStatus）；验证 allowlist 与权限解析以纯函数提供：computeVerificationAllowlist（§16 layer 裁剪 + 任务级覆盖）、resolvePathScope（allowed/forbidden 重叠 deny 优先 + 拒绝启动）、validateCommandPermissions（requires_permissions ⊆ permissions）、scanCommandHeuristics（命令字符串启发式仅产 warning，不参与授权）；均不做鉴权执行、不读写 frontmatter / SQLite、不执行命令。工具链 npm run typecheck / npm test（273 项）/ npm run lint 全绿。仍无 CLI 命令、infra 适配实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/rules/verification-rules.ts 与 permission-rules.ts 建立：均仅依赖同层 enums 的 Layer / Permission 类型（零运行时依赖、零反向依赖），不引入 zod（输入由上层以已校验的对象 / 字符串传入）。沿用「数据结构 + 纯函数 + Result 判别联合」模式（承接 DEC-004 / DEC-005）：resolvePathScope / validateCommandPermissions 返回判别联合（ok:true | ok:false+reason+细节），与 validateTransition / mapResultToStatus 同构。verification-rules 以 Map<命令行, VerificationCommand> 做去重合并，layer 裁剪用 commandAppliesToLayer（layers undefined → 全 layer / 含本 layer → 命中 / 显式 [] → 不命中），同名命令任务级覆盖时保留项目级 requires_permissions（避免静默放权）。permission-rules 路径重叠用「路径段包含」判定（ancestor + '/' 边界，非裸字符串前缀），规范化统一反斜杠与尾部斜杠；启发式扫描产 warning 但绝不进授权判定（§16）。src/core/index.ts 继续 export * 聚合 rules/ 新增两个模块（NodeNext 需 .js 后缀），Core 层（enums + 4 Schema + state-machine + 4 rules）全部完成。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "验证 allowlist 与权限解析复用要点（TASK-009）：computeVerificationAllowlist({ taskLayer, testingCommands, taskVerification }) 实现 §16——项目级命令按 layer 裁剪（layers 未声明→全 layer；显式 []→不命中，与 undefined 区分），与任务级 verification 取并集按命令行去重，同名命令任务级优先（source='task'、无视 layer 排除），requires_permissions 始终取自项目级声明（任务级裸字符串无元数据，覆盖不抹除已声明能力）。输出 VerificationCommand{ command, source, requires_permissions }。resolvePathScope(allowed, forbidden) 检测路径重叠（路径段包含：任一方为另一方祖先或相同即重叠），重叠返回 ok:false+overlaps+reason（deny 优先，infrastructure 层据此拒绝启动）；不重叠 ok:true。validateCommandPermissions(command, taskPermissions) 校验 command.requires_permissions ⊆ taskPermissions（验证命令执行授权自动获得，不检查 run_commands），缺失返回 ok:false+missing。scanCommandHeuristics(command) 对命令字符串做启发式扫描返回 warning（install/network/dev_server/browser/delete/config 六类），绝不参与授权——授权只走 validateCommandPermissions。CommandPermissionSpec 是结构类型，TASK-010/012 解析 TESTING.md / 任务 frontmatter 后可直接传 VerificationCommand。路径重叠判定需 infrastructure 层（TASK-010 起）在 Task Executor 启动前调用 resolvePathScope，重叠即拒绝启动不静默。§16 同名命令覆盖时 requires_permissions 取项目级声明系 DEC-006 解释，待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务验证 allowlist / 权限解析不消费 .result.md 的 verification.result 字段，未触发提升，ISS-004 维持现状不阻塞。TASK-009 无新 issue：enums.ts 的 Layer / Permission 仅 import 类型读用（未触及 enums.ts），未新增依赖，无边界冲突。同名命令覆盖保留项目级 requires_permissions、路径重叠按路径段包含判定系 §16 解释（DEC-006 proposed），非规格偏离。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-010：Infra frontmatter 解析器（layer: data，depends_on: TASK-001 已完成）。解析任务 / .result.md / .review.md frontmatter（YAML → Zod 校验），落地 src/infrastructure/fs/frontmatter-parser.ts；自此开启 infrastructure 层。Core 层（type + domain）已全部完成（P1 收尾）。"
  decisions:
    - id: ""
      title: "验证 allowlist 与权限解析的 §16 关键解释：同名命令覆盖保留项目级 requires_permissions、路径重叠按路径段包含判定、启发式只产 warning 不授权"
      status: proposed
      scope: "core/rules"
      decision: "TASK-009 对 §16 三处未明文细节作如下解释并落地：（1）同名命令在项目级 TESTING.md 与任务级 verification 两处声明时任务级优先——保证该命令必入 allowlist（无视 layer 排除）且 source 标 'task'，但 requires_permissions 始终取自项目级声明（任务级 verification 是裸字符串无元数据），覆盖不抹除已声明能力，避免静默放权；（2）forbidden ∩ allowed 重叠按「路径段包含」判定（任一方为另一方祖先或完全相同即重叠，用 ancestor + '/' 做边界避免 src/foo 误判 src/foo-bar），任一重叠即 deny 优先、返回 ok:false 由 infrastructure 层拒绝启动，不静默取并集；（3）命令字符串启发式扫描只产 warning，绝不参与授权——授权只以 permissions × requires_permissions 交集为准（validateCommandPermissions）。"
      rationale: "§16 明文「同一命令两处声明时以任务级为准」未指明 requires_permissions 归属，任务级 verification 又是裸字符串（无元数据字段）；取「保留项目级声明」是更安全方向（deny by default，绝不因覆盖而静默放宽能力边界），与 §16「能力不得通过魔法字符串授权、必须显式声明」精神一致。§16「forbidden ∩ allowed 重叠 deny 优先 + 拒绝启动」未定义「重叠」精度，路径段包含比精确匹配更贴合安全意图（allowed 子树落在 forbidden 内即矛盾），且以 ancestor+'/' 边界规避裸前缀误判。启发式只 warning 是 §16 明文要求，落地为 scanCommandHeuristics 与 validateCommandPermissions 完全解耦。三处均沿用 DEC-004/DEC-005 的「纯函数 + Result 判别联合」模式（resolvePathScope / validateCommandPermissions 返回 ok:true|ok:false+reason）。"
      consequences: "TASK-010/012 解析 TESTING.md 与任务 frontmatter 后可直接传入 computeVerificationAllowlist / resolvePathScope / validateCommandPermissions；infrastructure 层（TASK-010 起）须在 Task Executor 启动前调用 resolvePathScope，重叠即拒绝启动不静默。若 Orchestrator 认为同名覆盖应抹除 requires_permissions（任务级完全替换），改 computeVerificationAllowlist 任务级分支一行（届时同步改测试与 DEC-006）；若认为路径重叠应收紧为精确匹配，改 pathsOverlap 判定即可。新增 Permission 枚举值时同步补 HEURISTIC_RULES（启发式不强制穷尽，warning 容错）。"
      created_from_task: TASK-009
  issues: []
next_action: review
---

# TASK-009 执行结果

## 1. 执行结论

任务完成。在 `src/core/rules/verification-rules.ts` 落地 §16 验证 allowlist 计算（`computeVerificationAllowlist`：layer 裁剪 + 任务级并集/覆盖），在 `src/core/rules/permission-rules.ts` 落地 §16 权限模型（`resolvePathScope` deny 优先 + 拒绝启动、`validateCommandPermissions` requires_permissions 覆盖校验、`scanCommandHeuristics` 仅 warning 不授权）；`src/core/index.ts` 经 `./rules/*.js` 再导出；`test/core/rules/verification-permission.test.ts` 41 项用例覆盖 layer 裁剪五态、任务级覆盖 / 并集 / 顺序 / 去重、路径重叠六态（精确 / 双向包含 / 兄弟 / 段边界 / 规范化 / 空）、requires_permissions 校验六态、启发式扫描六类 + 命令链、以及「启发式不参与授权」集成场景。typecheck / test / lint 三项验证全绿。Core 层（type + domain）至此全部完成（P1 收尾）。

## 2. 完成内容

- `verification-rules.ts`：
  - `computeVerificationAllowlist({ taskLayer, testingCommands, taskVerification })` —— §16 allowlist 计算：项目级命令按 layer 裁剪（`commandAppliesToLayer`：undefined→全 layer / 含本 layer→命中 / 显式 []→不命中），与任务级 verification 取并集，按命令行去重；同名命令任务级优先（source 置 'task'、无视 layer 排除），requires_permissions 取自项目级声明。
  - `TestingCommand`（项目级声明：command / layers? / requires_permissions?）、`VerificationCommand`（合并结果：command / source / requires_permissions）、`VerificationCommandSource`（'project' | 'task'）、`ComputeVerificationAllowlistInput` 类型。
  - 输出顺序确定：先裁剪命中的项目级命令（TESTING.md 顺序），后任务级新增命令（verification 顺序）。
- `permission-rules.ts`：
  - `resolvePathScope(allowed, forbidden)` —— §16 deny 优先：路径段包含判定重叠（`isAncestorOrEqual` 用 `ancestor + '/'` 边界），任一重叠返回 `ok:false + overlaps + reason`（拒绝启动），无重叠 `ok:true`；`normalizePath` 统一反斜杠 / 尾部斜杠，空路径跳过。
  - `validateCommandPermissions(command, taskPermissions)` —— 校验 `requires_permissions ⊆ permissions`（验证命令执行授权自动获得，不检查 run_commands），缺失返回 `ok:false + missing`；`CommandPermissionSpec` 结构类型兼容 `VerificationCommand`。
  - `scanCommandHeuristics(command)` —— 命令字符串启发式扫描，六类规则（install / network / dev_server / browser / delete / config）各产一条 warning，**绝不参与授权**。
  - `PathScopeResult` / `CommandPermissionsResult` 判别联合（与 `TransitionResult` / `StatusMappingResult` 同构）。
- 单测 41 项：layer 裁剪（未声明全 layer / 声明命中 / 声明排除 / 显式 [] / page 精确匹配）、任务级覆盖与并集（同名 source=task / 覆盖保留 requires_permissions / 无视 layer 排除 / 匹配被排除声明取其 requires_permissions / 裸命令空 requires / 并集 / 去重 / 顺序 / 空输入）、路径重叠（无重叠 ok / 精确 / allowed 含于 forbidden / forbidden 含于 allowed / 兄弟不重叠 / 段边界 foo vs foo-bar / 规范化 / 空路径跳过 / 多组上报 / 双空）、requires_permissions 校验（全覆盖 / 未覆盖 / 部分 / 空 requires / 不检查 run_commands / 超集）、启发式（install / pnpm add / curl / npm start / rm / 命令链多命中 / 无匹配空 / 结构完整）、集成（启发式不授权 / 显式声明未覆盖拒绝 / 完整流水线裁剪→取 requires_permissions→校验）。

## 3. 修改文件

- `src/core/index.ts` —— 追加 `export * from './rules/verification-rules.js'`、`export * from './rules/permission-rules.js'` 及 TASK-009 注释，其余不变。

## 4. 新增文件

- `src/core/rules/verification-rules.ts` —— 验证 allowlist 计算（§16 layer 裁剪 + 任务级覆盖）。
- `src/core/rules/permission-rules.ts` —— 路径作用域冲突检测 / 命令能力校验 / 启发式扫描（§16 权限模型）。
- `test/core/rules/verification-permission.test.ts` —— 验证 allowlist 与权限解析单测（41 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：TASK-009 对 §16 三处未明文细节的解释——（1）同名命令覆盖保留项目级 requires_permissions（不抹除已声明能力，避免静默放权）；（2）路径重叠按路径段包含判定（非精确匹配、非裸字符串前缀），任一重叠即 deny 优先拒绝启动；（3）启发式扫描只产 warning 不参与授权（§16 明文，落地为 scanCommandHeuristics 与 validateCommandPermissions 完全解耦）。沿用 DEC-004/DEC-005 的「纯函数 + Result 判别联合」模式。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 `computeVerificationAllowlist` / `resolvePathScope` / `validateCommandPermissions`（+ 启发式扫描）全部落地；§11 验收的「layers 裁剪（未声明/声明）」「任务级覆盖项目级同名命令」「路径重叠 deny 优先 + 拒绝启动」「requires_permissions 未覆盖拒绝、启发式只 warning 不授权」均有用例；§12 风险点「命令字符串匹配不得作授权依据」以 scanCommandHeuristics 与 validateCommandPermissions 完全解耦 + 集成用例显式保障。

三处 §16 未明文细节的解释（同名覆盖 requires_permissions 归属 / 路径重叠精度 / 启发式仅 warning）见 DEC-006，均为合理推断而非规格偏离，不另开 issue。

## 8. 后续任务注意事项

- `computeVerificationAllowlist` 的 `testingCommands` 由 infrastructure 层（TASK-012 全局文档仓储解析 docs/TESTING.md）装配为 `TestingCommand[]`；`taskLayer` / `taskVerification` 取自任务 frontmatter（TASK-010 解析）。
- `resolvePathScope` 须由 infrastructure 层（TASK-010 起）在 Task Executor 启动前调用，`ok:false` 即拒绝启动并告警，不得静默取并集；`overlaps` 可直接用于告警信息。
- `validateCommandPermissions` 的 `command` 为结构类型 `CommandPermissionSpec`，可直接传 `computeVerificationAllowlist` 产出的 `VerificationCommand`，无需转换；`taskPermissions` 取自任务 frontmatter `permissions`。
- `scanCommandHeuristics` 仅作 IDE / 日志提示，调用方不得把 `suggested_permissions` 并入授权集合；授权只走 `validateCommandPermissions`。
- TASK-022（SDK 权限注入）应消费 `validateCommandPermissions` 的 `ok` 结果与 `resolvePathScope` 的有效作用域，把能力边界注入 agent；本任务不实现注入（任务 §7「不做什么」）。

## 9. 未解决问题

无新 issue。本任务边界清晰：enums.ts（Layer / Permission）仅 import 类型读用，未触及；未新增依赖；§12「命令字符串匹配不得作授权依据」风险点以启发式与授权判定解耦 + 集成用例显式覆盖（「命令未声明 requires_permissions 时，即便启发式告警，validateCommandPermissions 仍 ok」）。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不涉及本任务——验证 allowlist / 权限解析不消费 `.result.md` 的 `verification.result` 字段，ISS-004 维持 open、不阻塞。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/rules` | passed | vitest 2 文件 92 用例全通过（新增 41 + 原 51） |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 8 文件 273 用例全通过（含新增 41 项） |

## 11. 人工验收建议

- 复核 `computeVerificationAllowlist` 与 §16 逐条一致：layer 裁剪（未声明=全 layer / 含本 layer / 显式 []=不命中）、任务级覆盖（同名 source='task'、无视 layer 排除）、requires_permissions 取项目级声明。
- 复核 `resolvePathScope`：路径段包含判定（src/core 含 src/core/rules/a.ts；src/foo 与 src/foo-bar 不重叠）、双向包含均判重叠、deny 优先 + 拒绝启动。
- 复核 `validateCommandPermissions`：只校验 requires_permissions ⊆ permissions，不检查 run_commands（验证命令执行授权自动获得）；缺失返回 missing。
- 复核启发式扫描绝不参与授权（集成用例：命令漏声明 requires_permissions 时启发式告警但 validateCommandPermissions 仍 ok）。
- 确认 DEC-006 三处 §16 解释（同名覆盖保留 requires_permissions / 路径重叠路径段包含 / 启发式仅 warning）是否符合 §16 意图。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：§16 三处解释，承接 DEC-004/DEC-005）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
