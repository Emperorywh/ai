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

---

## DEC-007 frontmatter 解析边界语义：只认首部围栏、开而无闭或空围栏 → frontmatter=null、CRLF/LF 兼容、非法 YAML 抛错不静默

```yaml
id: DEC-007
title: "frontmatter 解析边界语义：只认首部围栏、开而无闭或空围栏 → frontmatter=null、CRLF/LF 兼容、非法 YAML 抛错不静默"
status: proposed
scope: "infrastructure/fs"
created_from_task: TASK-010
decision: "TASK-010 对 §9/§10 frontmatter 模板未明文的解析边界作如下解释并落地：（1）只认首部围栏——opening fence 必须是文档第一行且内容恰为 ---；其后的正文内出现的 ---（如 Markdown 水平线）不被误判，closing fence 取开围栏之后第一个内容恰为 --- 的行；（2）有开围栏但无闭合围栏（--- 起手但全文无第二个 ---）→ 不报错、整篇作为 body、frontmatter=null（与「无 frontmatter」对称，避免把残缺围栏后的正文当 YAML）；（3）空围栏（---\\n---）→ frontmatter=null；（4）CRLF/LF 兼容——行内容比对统一剥离行尾 \\r\\n / \\n，body 保留原始换行不规范化；（5）围栏内 YAML 语法非法时由 yaml 库抛错，不静默吞错（交上层仓储 catch + Zod 校验）。serializeDocument 以 frontmatter===null/undefined 表「无 frontmatter」，不输出围栏直接返回 body，保证 parse ∘ serialize 深度相等。"
rationale: "§8「只认首部围栏」与 §11「正文内 --- 不被误判」、§12「CRLF/LF 兼容」是明文要求；但「开而无闭」「空围栏」「非法 YAML」三处未明文。沿用业界 frontmatter 事实标准（gray-matter 约定）：开而无闭不抢正文（更安全，避免把一段以 --- 起手的正文误吞为 YAML）、空围栏等同无内容（null）、非法 YAML 抛错交上层处理（AGENTS.md「非法状态抛错、不静默」）。这几处选择对下游 TASK-011/012 仓储是稳定契约：仓储层据此先 parseDocument 拆结构，再用 core Schema 校验 frontmatter（null 或结构不符由 Zod 拒，天然把「无 frontmatter 的文档」判为非法）。round-trip 稳定性靠 yaml 库 stringify/parse 的互逆性 + serialize 对 null/undefined 的围栏省略对称处理共同保证。"
consequences: "TASK-011/012 仓储读取流程：parseDocument → frontmatter 为 null 或 Zod 校验失败即判文档非法（throw / 返回错误）；合法则按需改 body 与 frontmatter 后 serializeDocument 回写。若 Orchestrator 认为「开而无闭」应改为抛错（而非整篇作 body），改 parseDocument 的 closeIdx===-1 分支一行（届时同步改测试与 DEC-007）；若认为应规范化 body 换行（CRLF→LF），改 body 拼接处（当前保留原样，与 §「保留正文原样」一致）。新增文档类型（未来 review/task）复用同一解析器，无需另起围栏逻辑。"
```

提议自 `TASK-010-infra-frontmatter-parser.result.md`。frontmatter 解析器仅依赖既有 `yaml` 库、零反向依赖、无边界冲突；五处解析边界语义（只认首部围栏 / 开而无闭 / 空围栏 / CRLF 兼容 / 非法抛错）均为标准 frontmatter 语义（兼容 gray-matter 约定），待 Orchestrator 回写确认。

---

## DEC-008 TaskDocRepository 写入语义与文件命名派生：writeTask 仅更新、result/review 可新建且从任务 slug 派生路径、body 可选保留正文

```yaml
id: DEC-008
title: "TaskDocRepository 写入语义与文件命名派生：writeTask 仅更新、result/review 可新建且从任务 slug 派生路径、body 可选保留正文"
status: proposed
scope: "infrastructure/fs"
created_from_task: TASK-011
decision: "TASK-011 对 §2/§8/§9 未明文的写入语义与文件命名作如下解释并落地：（1）writeTask(task, body?) 仅更新「已存在」任务文件的 frontmatter——任务文件不存在即抛错；新建任务文件含 slug 命名（docs/tasks/TASK-XXX-<slug>.md 的 <slug>）是 CLI task-create（TASK-024）的命名决策，仓储不越界生成 slug（AGENTS.md §4 不提前实现后续任务逻辑）。（2）writeResult(result, body?)/writeReview(review, body?) 可新建——文件名按 §6 从任务文件 slug 派生（resolveSidecarPath：先扫现有 <id>-*<suffix>，唯一则复用、多个抛歧义、无则从任务文件 taskSlug 派生 <id>-<slug><suffix>），依据是 §6 文档树显式 result/review 与任务文件共用同一 slug，且「先有任务才有结果/审查」。（3）body 参数可选：传入则整体写入（frontmatter + body），未传则保留现有正文（readBodyIfExists，文件不存在返回空串），落地 §8「只更新 frontmatter 时做 frontmatter 替换 + 正文保留」、§12「避免抹掉人工维护的正文」——覆盖 Orchestrator 仅回填 execution_commits 的场景。（4）读取即 Zod 校验：readAndValidate 对文件不存在/缺 frontmatter/Zod 校验失败均抛带文件路径的 Error（不静默）。（5）listTasks 用 /^(TASK-\\d+)-.+\\.md$/ 提取 id（先排除 .result.md/.review.md），按数字部分数值排序（鲁棒于补零与否）。（6）readAndValidate 泛型签名用 <S extends z.ZodTypeAny> + z.infer<S>，不用 z.ZodType<T>（zod .default 使 schema 的 input/output 不同源——input 可选、output 必填——z.ZodType<T> 会把 T 绑到 input，导致 readTask 返回类型含可选字段、与 TaskFrontmatter 不兼容）。"
rationale: "§8 明文「写入保留正文，只更新 frontmatter 时做 frontmatter 替换 + 正文保留」指向 writeTask 是「更新」语义；§9 明文「writeResult/writeReview 是 Executor/Reviewer 的产物落盘」指向可新建。二者职责不对称源于：任务文件命名需 slug 决策（CLI 职责），而 result/review 文件名可从任务文件 slug 派生（§6 三者共用 slug，无新决策）。body 可选保留正文是 §8/§12 的直接落地，也服务 Orchestrator 合并阶段仅改 frontmatter 的真实流程（§3.2 回填 execution_commits）。读取即校验 + 抛错不静默遵循 AGENTS.md「非法状态抛错、不静默」。zod 泛型用 ZodTypeAny 约束是 TS 推断 gotcha 的标准解法——zod 的 ZodType<Output, Def, Input> 三参数中，z.ZodType<T> 令 Def/Input 默认=Output=T，传入带 .default 的 ZodObject 时 T 被推断成 input（含可选字段），与 output 类型不兼容；ZodTypeAny 是 zod 自身导出的「任意 ZodType」别名（不含字面 any token，过 eslint no-explicit-any），配合 z.infer<S> 准确取 Output。同步 I/O（readFileSync/writeFileSync/readdirSync）与 frontmatter-parser 同步风格一致，CLI 场景可接受，测试简单；application 层 ports 若定异步接口，结构类型兼容、适配层包 Promise 即可。"
consequences: "TASK-012 全局文档仓储复用本模式：读取即校验用 <S extends z.ZodTypeAny> + z.infer<S>（DecisionSchema/IssueSchema 校验同模式）；section 级合并需在 body 层面操作（parseDocument 拆 frontmatter+body → 改 body section → serializeDocument 回写，正文保留靠 readBodyIfExists）。CLI task-create（TASK-024）负责新建任务文件时命名 <slug>（title kebab 化等），仓储 writeTask 只更新不新建——若 Orchestrator 认为仓储应支持新建任务文件，需扩权并定义 slug 生成规则（届时改 writeTask + resolveTaskPath 新建分支 + DEC-008）。application 层（TASK-015 ports / TASK-017 编排）调用本仓储时：readXxx 须 try/catch 将 Error 转为业务结果（如「文档非法」转人工），writeXxx 写入失败（权限/磁盘）让 fs 错误冒泡或上层包装。若认为 result/review 文件名不应依赖任务文件 slug（如允许独立命名），改 resolveSidecarPath 的派生分支（当前从 taskSlug 派生）。同步 I/O 若需改异步，方法签名加 async/Promise，调用方相应调整。"
```

提议自 `TASK-011-infra-task-doc-repo.result.md`。任务文档仓储仅依赖 `node:fs`/`node:path` 内置 + 既有 core/frontmatter-parser、零反向依赖、无边界冲突；写入语义与文件命名派生（writeTask 仅更新 / result·review 可新建且从任务 slug 派生 / body 可选保留正文）系 §2/§8/§9/§6 的合理落地，`readAndValidate` 的 zod 泛型签名（`z.ZodTypeAny` 约束）系类型推断 gotcha 的标准解法，待 Orchestrator 回写确认。

---

## DEC-009 GlobalDocRepository section 合并与条目去重的关键解释：纯变换不做文件 I/O、section 按标题层级精确匹配且子节不截断父节、缺失 section 两种 mode 均视为新建、decisions/issues 用 fenced yaml block 沿用现有约定、readDecisions/readIssues 跳过非本类损坏块

```yaml
id: DEC-009
title: "GlobalDocRepository section 合并与条目去重的关键解释：纯变换不做文件 I/O、section 按标题层级精确匹配且子节不截断父节、缺失 section 两种 mode 均视为新建、decisions/issues 用 fenced yaml block 沿用现有约定、readDecisions/readIssues 跳过非本类损坏块"
status: proposed
scope: "infrastructure/fs"
created_from_task: TASK-012
decision: "TASK-012 对 §2/§3.2/§6.5/§6.6/§6.7/§8/§12 未明文的合并语义作如下解释并落地：（1）5 方法（applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues）均以文档完整内容（含 frontmatter）字符串为输入、返回合并后的完整文档字符串——纯变换，不做文件 I/O；文件读取/写回与合并编排（按 depends_on 拓扑序串行、多条 replace 命中同 section 后写者覆盖先写者 + 落 ISSUES）归 application 层 TASK-020，本仓储只提供底层 section/条目合并原语（§9「底层操作」）。frontmatter 经 parseDocument 拆出后原样保留、只改正文 section/条目，serializeDocument 回写。（2）section 定位基于 Markdown 标题层级（##/###）：trim 后精确匹配标题文本（大小写敏感，避免近似名误并），section 边界取「下一个同级或更高级标题」（level ≤ 当前 section level），故 ### 子节属于其父 ## section、不截断父节（§12 避免误合并相邻 section）；section 不存在时两种 mode（replace/append）均在文末新建 ## section（§8「缺失 section 视为新建」推及两种 mode，避免 replace 静默 no-op）。（3）decisions/issues 用 fenced YAML block 表达机器字段——§6.6/§6.7 明文接受「YAML frontmatter / fenced YAML block / 统一 YAML 列表」三选一，现有 DECISIONS.md/ISSUES.md 实际用 fenced YAML block（每条 ## DEC-XXX 标题 + fenced yaml + prose，--- 分隔），本仓储沿用之以保证 read(apply(x)) round-trip；appendDecision/appendIssue 按 item.id 去重——命中既有同 id 则替换其「标题 + fenced yaml block」（保留其后人工 prose），未命中（含空 id 提议态）在文末追加 --- + ## <id> <title> + fenced yaml（§11 同 id 再追加 = 更新）。（4）readDecisions/readIssues 解析正文全部 yaml 围栏块经 DecisionSchema/IssueSchema 校验返回数组（文档序），不能通过校验的块（非本类条目/损坏数据）被跳过——它们无法按 id 匹配、不参与去重；Schema 字段集不同天然区分 decision 与 issue 块（readDecisions 不误收 issue）。（5）新建 section / 条目标题层级默认 ##（PROGRESS.md 约定）。（6）readEntries 复用 DEC-008 的 <S extends z.ZodTypeAny> + z.infer<S> 泛型让返回元素类型由 schema 派生。"
rationale: "§2 方法签名 applyProgressUpdate(doc, ...) / appendDecision(doc, ...) 以 doc 为参数 + §9「输入全局文档现状 + 一条 update → 输出合并后文档」明确这是纯变换；文件 I/O 与拓扑序串行回写是 §3.2 明文的 Orchestrator 职责（TASK-020），仓储不越界。frontmatter 原样保留靠 parseDocument/serializeDocument 的 frontmatter/body 分离（TASK-010），只改正文避免误改全局文档元信息。section 标题层级精确匹配 + 子节不截断是 §12「避免误合并相邻 section」的直接落地（### 是 ## 的子节，替换 ## 应含其子节）。缺失 section 两种 mode 均新建：§8 仅明文 append 缺失视为新建，replace 缺失若 no-op 会静默丢弃更新（违反 AGENTS.md「不静默」），故推及 replace 同样新建。fenced YAML block 沿用现有文件：§6.6/§6.7 三选一未指明用哪种，但仓库 DECISIONS.md/ISSUES.md 已用 fenced block，round-trip 要求 read 能解析 apply 的产物，故必须与现有格式一致。readDecisions 跳过非本类块：正文可能含非 decision 的 yaml 块（如 TESTING.md 风格命令声明），Schema 校验是天然过滤器；损坏的 decision 块无法按 id 匹配故跳过不阻塞合并（合并用 readDecisions 查既有 id 去重，损坏块本就匹配不上）——若需严格校验抛错，由 application 层调用前单独校验文档完整性（不在本仓储合并原语内）。"
consequences: "TASK-020 合并编排调用本仓储：重读全局文档 → 逐条 applyProgressUpdate/appendDecision/appendIssue → 写回；多条 replace 命中同 section 的后写者覆盖 + 落 ISSUES 由 TASK-020 判定（不在本仓储）。application 层 ports（TASK-015）若定 GlobalDocRepositoryPort 含文件 I/O 方法，可在适配层包 fs 读写 + 调本仓储纯变换（结构类型兼容，本类无需 implements）。若 Orchestrator 认为：(a) readDecisions/readIssues 应对损坏块抛错而非跳过——加 strict 变体或改 readEntries 失败分支（届时同步改测试与 DEC-009）；(b) 缺失 section 的 replace 应 no-op 或抛错而非新建——改 applyProgressUpdate 的 createSection 分支（届时同步改测试）；(c) decisions/issues 应改用统一 YAML 列表而非 fenced block——需先迁移现有 DECISIONS.md/ISSUES.md 再改 read/append 格式（届时改 findCodeBlocks/renderYamlFence）；(d) 新建 section 应支持 ### 等深层级——createSection 标题层级需由调用方传入（当前固定 ##）。body 行尾在合并时规范化为 LF（frontmatter 字节级保留，body 按行 split/join）；现有全局文档均为 LF 不受影响，若未来需保 CRLF 需改 toLines/各 join 处。"
```

提议自 `TASK-012-infra-global-doc-repo.result.md`。全局文档仓储仅依赖既有 `zod`/`yaml` + core/frontmatter-parser、零反向依赖、无边界冲突；section 合并与条目去重的六处关键解释（纯变换不做文件 I/O / section 标题层级精确匹配 + 子节不截断父节 / 缺失 section 两种 mode 均视为新建 / decisions·issues 用 fenced yaml block 沿用现有约定 / readDecisions·readIssues 跳过非本类损坏块 / 新建 section 默认 `##`）均为 §2/§3.2/§6.5/§6.6/§6.7/§8/§12 的合理落地，待 Orchestrator 回写确认。

---

## DEC-010 SQLite schema 迁移设计与列约束：版本表为唯一事实来源（前向 only、事务性、IF NOT EXISTS 仅限 bootstrap）、JSON 文本列 DEFAULT、文本主键显式 NOT NULL、executions 以 task_id 为主键

```yaml
id: DEC-010
title: "SQLite schema 迁移设计与列约束：版本表为唯一事实来源（前向 only、事务性、IF NOT EXISTS 仅限 bootstrap）、JSON 文本列 DEFAULT、文本主键显式 NOT NULL、executions 以 task_id 为主键"
status: proposed
scope: "infrastructure/sqlite"
created_from_task: TASK-013
decision: "TASK-013 对 §3.1/§3.2/§8 未明文的迁移机制与列约束作如下解释并落地：（1）迁移机制——schema_migrations(version,name,applied_at) 版本表为「已应用版本」的唯一事实来源；MIGRATIONS 数组（{version,name,up} 前向 only、按 version 升序）为迁移定义单一来源；runMigrations 逐条检查版本表、未应用则 db.transaction 包「up + INSERT 版本记录」原子提交，up 抛错整条回滚（含已建表）+ 错误冒泡不静默；forward-only 不回滚、不复用已用版本号。（2）IF NOT EXISTS 边界——迁移版本表用 CREATE TABLE IF NOT EXISTS（它是 bootstrap：必须先存在才能查询已应用版本，重复调用时表已存在须 no-op）；4 张索引表 DDL 用裸 CREATE TABLE（由版本表守卫「建表只发生一次」，不用 IF NOT EXISTS 以保持迁移显式、避免掩盖 schema 漂移）。（3）列类型与约束——全部 TEXT（SQLite type affinity，派生索引无需强类型）；depends_on/allowed_paths/permissions 为 JSON 文本列（§8 明文「以 JSON 文本列存储」）且 NOT NULL DEFAULT '[]'（写入可省略、读出 JSON.parse），issues.owner NOT NULL DEFAULT ''（空串表「尚未指派」与 ISSUES.md owner 约定一致）；文本主键（id / task_id）显式 NOT NULL（SQLite 对非 INTEGER PRIMARY KEY 不隐式 NOT NULL——历史 quirk，显式声明符合 SQL 标准、杜绝 NULL 主键行）。（4）executions 以 task_id 为主键——一行 = 一个任务的「最近一次执行摘要」（§3.2「最近一次执行摘要」语义），任务重跑用 INSERT OR REPLACE 覆盖；commit_hash/commit_message/author/time 为单值列存「代表性 commit」（execution_commits 数组在索引中取首条/最新条，多 commit 全量索引留待后续需要时由 TASK-014+ 扩展，§3.2 为「至少包括」不强制全量）；review_result/next_action/commit_* 可空（任务可能尚未审查或无 commit）。（5）applied_at 用 new Date().toISOString()（ISO8601 UTC，与 reviewed_at §15 约定一致）。（6）表名 / SCHEMA_VERSION 导出为常量供 TASK-014 引用避免魔法字符串。"
rationale: "§3.2 明文 SQLite 是「派生存储、非事实来源、写入失败不阻断、可 rebuild-index 全量重建」——索引 schema 应简单、可重建、可演进。版本表 + 前向迁移是业界标准模式（knex / TypeORM / prisma migration 均如此），单一事实来源 + 事务原子提交保证「建表与版本记录同进退」、不出现「表建了但版本没记」的中间态。IF NOT EXISTS 仅限 bootstrap 的迁移表：数据表若用 IF NOT EXISTS 会在「版本表丢失但表存在」的异常态静默跳过迁移、掩盖 schema 漂移，裸 CREATE TABLE 让迁移显式、异常态显式失败。JSON 文本列是 §8 明文要求（SQLite 无原生数组类型）；DEFAULT '[]' 让 TASK-014 写入无依赖的任务时可省略 JSON 列、降低出错面。文本主键显式 NOT NULL 规避 SQLite 非 INTEGER 主键允许 NULL 的历史 quirk（SQL 标准要求 PK 隐式 NOT NULL，SQLite 因早期 bug 不强制，显式声明最安全）。executions 以 task_id 为主键：§3.2「最近一次执行摘要」是 per-task 的最新一份，PRIMARY KEY(task_id) + INSERT OR REPLACE 天然支持「重跑覆盖」；commit 单值列是任务 §2 DDL 的字面（executions(task_id,...,commit_hash,commit_message,author,time)），代表性 commit 满足「至少包括」清单，全量 execution_commits 索引超出本任务范围。applied_at UTC 与项目 datetime 约定一致。schema.ts 用 type-only import better-sqlite3（只取实例类型、自身不开连接）：DDL 与迁移编排是纯 SQL 字符串 + 对传入 db 的方法调用，不需要构造 Database，连接归属 TASK-014 / cli composition root，职责单一。"
consequences: "TASK-014 索引仓储：构造 / 首次写入前调用 runMigrations(db) 建表（幂等可重复）；读写用 prepare + run/get/all；depends_on/allowed_paths/permissions 写前 JSON.stringify、读后 JSON.parse；executions 重跑用 INSERT OR REPLACE 覆盖（task_id 主键）；表名用导出常量。新增列 / 表：按 version 递增追加 MIGRATIONS（如 v2 add-column-x），每条在事务内 up + 写版本，不复用版本号、不回滚。若 Orchestrator 认为：(a) executions 应支持多 commit 全量索引——新增 execution_commits(task_id,hash,message,author,time) 表 + 迁移 v2（届时改测试与 DEC-010）；(b) 索引表应用 IF NOT EXISTS 以容忍异常态——改 createInitialSchema 各 CREATE TABLE（但会掩盖 schema 漂移，不推荐）；(c) applied_at 应含本地时区——改 .toISOString() 为带 offset（当前 UTC，与 §15 一致）；(d) 应加索引（如 tasks.status 查询加速）——新增迁移加 CREATE INDEX。运行时原生模块约束见 ISS-005（Node 22 ABI 127 / 或装编译工具链重编译）。application 层 ports（TASK-015）若定 SqliteIndexRepositoryPort，适配层创建 Database 实例 + 调 runMigrations + 委托读写（结构类型兼容）。"
```

提议自 `TASK-013-infra-sqlite-schema.result.md`。SQLite schema 仅 type-only import 既有 `better-sqlite3` + `@types/better-sqlite3`、零反向依赖、无边界冲突；迁移机制与列约束的六处关键解释（版本表唯一事实来源 + 前向 only 事务性 / IF NOT EXISTS 仅限 bootstrap / JSON 文本列 DEFAULT / 文本主键显式 NOT NULL / executions task_id 主键 + commit 单值列 / applied_at UTC）均为 §3.1/§3.2/§8 的合理落地，待 Orchestrator 回写确认。

---

## DEC-011 IndexRepository 设计：写入容错 onWarning 吞错不阻断、rebuild 单事务原子 + 文档损坏冒泡、DocSources 由调用方传入全局文档内容、代表性 commit 取首条、查询面仅 queryTasks+getExecution

```yaml
id: DEC-011
title: IndexRepository 设计：写入容错 onWarning 吞错不阻断、rebuild 单事务原子 + 文档损坏冒泡、DocSources
  由调用方传入全局文档内容、代表性 commit 取首条、查询面仅 queryTasks+getExecution
status: proposed
scope: infrastructure/sqlite
created_from_task: TASK-014
decision: TASK-014 对 §2/§3.2/§8/§11
  未明文的索引仓储设计作如下解释并落地：（1）写入容错——upsertTask/upsertDecision/upsertIssue/upsertExecution
  写失败经构造注入的 onWarning 回调记告警后吞掉、不向上抛阻断（§3.2「索引写入失败不阻断状态流转和合并」）；onWarning 默认
  console.warn，可注入自定义回调便于测试断言（容错测试以「关闭 db 连接」可控注入失败，§12）。内部拆「严格直接插入
  insertXxx（失败抛错）」+「容错包装 tolerantWrite（try/catch + onWarning）」，rebuild 复用
  insertXxx 但不经 tolerantWrite。（2）rebuild 原子性——rebuildFromDocs 在单一 db.transaction
  内「清空四表 + 逐条 INSERT」，任一步抛错整体回滚、索引保持重建前状态；rebuild 用直接插入而非容错 upsert*：rebuild
  是显式修复命令，文档自身损坏应让错误显式冒泡由调用方处理，不静默丢行（否则索引 ≠ 文档违反 §11）；result/review
  附属文档不存在属预期（任务尚未执行/未审查）跳过该任务 execution，文档存在但损坏（Zod
  校验失败等）让错误冒泡触发回滚。（3）DocSources 由调用方传入全局文档内容——rebuildFromDocs({taskRepo,
  globalRepo, decisionsDoc, issuesDoc})：GlobalDocRepository 是纯字符串变换、无文件
  I/O（TASK-012 DEC-009），任务 §6 禁止修改 global-doc-repo.ts 加文件读取方法，故
  DECISIONS.md/ISSUES.md 内容须由调用方（CLI composition
  root，TASK-025）读盘后传入；tasks/executions 仍经
  TaskDocRepository（listTasks→readTask/readResult/readReview）。任务 §2 提示的
  {taskRepo, globalRepo} 签名不足以获取全局文档内容，故扩展为含 decisionsDoc/issuesDoc 的
  DocSources（不越界、不改规格）。（4）代表性 commit 取首条——executions 的
  commit_hash/message/author/time 单值列存 execution_commits 首条（DEC-010 委托 TASK-014
  决定取首条/最新条，本任务取首条作主实现 commit，多 commit 全量索引留待后续需要时新增 execution_commits 表 +
  迁移）。（5）查询面仅 queryTasks({status?,layer?}) + getExecution(taskId)——任务 §2
  明示这两个；decisions/issues 无公共读接口：索引用途为审计与 rebuild，其人读展示走 DECISIONS.md/ISSUES.md
  文档本身（测试以原始 SQL 校验 rebuild 产物）。（6）queryTasks 按 id 数值升序（与
  TaskDocRepository.listTasks 一致，鲁棒于补零）。（7）readResultOptional/readReviewOptional
  以 TaskDocRepository 错误前缀「文档不存在」区分「附属文档尚未产出」与「文档损坏」（DEC-008 稳定契约）。
rationale: §3.2 明文「索引写入失败不阻断、可 rebuild-index 全量重建、正确性以文档为准」——upsert* 容错吞错 +
  rebuild 全量重建是直接落地；onWarning 可注入让容错可测试（关闭 db 连接是最干净的可控失败注入，§12）。rebuild 原子性：清空
  + 重灌不在事务内则中途崩溃会留半空索引（比重建前更糟），单事务保证 all-or-nothing；用直接插入而非容错 upsert* 是因为
  rebuild 是显式修复、不应静默丢行（容错语义服务运行期状态流转，不服务修复命令）。DocSources
  传入文档内容是架构约束的直接推论：GlobalDocRepository 经 DEC-009 设计为纯变换无 I/O（合并编排归 application
  TASK-020），本任务 forbidden 含 global-doc-repo.ts 不能加读方法，故全局文档内容只能由上层传入；这与
  TaskDocRepository 同步 I/O（可被 index-repo 直接调）不对称，但源于两仓储设计分工不同，非缺陷。代表性 commit
  取首条：execution_commits 通常按时间序、首条是主实现 commit；取首条/最新条均可（DEC-010
  明示），取首条简单且语义清晰。查询面仅 tasks+executions：§3.2 索引主要查询场景是任务状态/依赖与执行摘要（status
  命令、依赖索引、恢复加速），decisions/issues 的索引行用于审计与 rebuild、人读展示走文档——故不为它们建公共读接口，避免提前实现后续
  CLI 逻辑（AGENTS §4）。id 数值升序与 listTasks 一致避免排序语义漂移。错误前缀区分缺失/损坏：TaskDocRepository
  对文件不存在与校验失败抛不同前缀的 Error（DEC-008 稳定契约），rebuild 据此跳过「尚未产出」的附属文档、对损坏文档冒泡——是
  forbidden 约束下（不能改文档仓储加 exists 方法）的最干净方案。
consequences: application 层（TASK-015 ports / TASK-017 编排）调用本仓储：状态流转 / 合并 /
  决策问题变更时调 upsert* 同步写索引（写失败仅告警不阻断），调 queryTasks/getExecution 做 status 查询与依赖索引；调
  rebuildFromDocs 做全量重建（须先读盘 DECISIONS.md/ISSUES.md 传入
  decisionsDoc/issuesDoc）。CLI rebuild-index（TASK-025）在 composition root 处 new
  Database(filePath) + new IndexRepository(db) + 读盘全局文档 + 调 rebuildFromDocs。若
  Orchestrator 认为：(a) decisions/issues 应有公共读接口（如 listDecisions/listIssues 供
  status 命令展示）——加 3 行方法 + 对应测试（届时同步改 DEC-011）；(b) 代表性 commit 应取最新条而非首条——改
  buildExecutionSummary 的 execution_commits[0] 为 [length-1]（届时同步改测试）；(c) rebuild
  应对损坏文档容错跳过而非冒泡——在 rebuildTasksAndExecutions 包 try/catch + onWarning（但会掩盖文档损坏，与
  §11「索引=文档全集」张力，不推荐）；(d) readResultOptional 的错误前缀判定应改为更稳的机制——需先给
  TaskDocRepository 加 exists 方法（扩权改文档仓储，违反本任务 forbidden）或用错误子类（改 DEC-008）；(e)
  upsert* 容错应抛特定非阻断错误而非纯吞——改 tolerantWrite 返回 Result（当前纯吞 + onWarning，最贴合
  §3.2「不阻断」）。运行时原生模块约束见 ISS-005。新增索引列 / 多 commit 全量索引：按 DEC-010 追加迁移
  v2。application 层 ports（TASK-015）若定 SqliteIndexRepositoryPort，适配层创建 Database +
  调 runMigrations + 委托读写（结构类型兼容，本类无需 implements）。
```

## DEC-012 Context Pack 生成器与 Ports 设计：任务文件路径从 result_file 派生、refreshSourceFiles all-or-nothing、必读核心并入 required_docs 输出、GlobalDocRepositoryPort 文件 I/O 前瞻契约、GitMergePort.rebaseOnto 冲突不抛断

```yaml
id: DEC-012
title: Context Pack 生成器与 Ports 设计——任务文件路径从 result_file 派生、refreshSourceFiles
  all-or-nothing、必读核心并入 required_docs 输出、GlobalDocRepositoryPort 文件 I/O 前瞻契约、GitMergePort.rebaseOnto
  冲突不抛断
status: proposed
scope: application/context-pack-generator + application/ports
created_from_task: TASK-015
decision: TASK-015 对 §8/§9/§11 与 ARCHITECTURE §4 未明文的设计点作如下解释并落地：（1）任务文件路径派生——当前任务文件属必读核心（§8）但
  frontmatter 不含 slug、不计入 required_docs 数组；本模块从 workflow_outputs.result_file（§9 约定 docs/tasks/TASK-XXX-<slug>.result.md）派生任务文件路径：去尾部 .result.md 加 .md（与任务文件共用
  slug），纯计算无需 I/O；result_file 不以 .result.md 结尾视为违反 §9 约定，显式抛错不静默（AGENTS §3）。（2）refreshSourceFiles all-or-nothing——§8「任务转入 running 前若依赖已完成，Orchestrator 用实际 .result.md 清单刷新」+ §11「依赖未完成时不刷新（保留预填）」推论：仅当 depends_on 非空且全部在 dependencyResults 中时，用各依赖 modified_files ∪ created_files 并集替换预填 source_files；无依赖（无可刷新来源）或任一未完成均保留预填。任务转入 running 前依赖必已全部 done（§7），故刷新分支在 ready→running 触发。（3）必读核心并入 required_docs 输出——§8「任务文件本身不计入 required_docs 数组」指 frontmatter 声明值，非计算清单；computeContextPack 的输出 required_docs 含必读核心 + 任务文件（作完整注入文档），frontmatter 省略必读核心也补齐（§8「不得通过省略必读核心缩小范围」）。（4）不扩展范围——输出只取并集去重，最终清单 ⊆ 候选来源（任务 §8）。（5）Ports 设计——4 个 Port（TaskDocRepositoryPort / GlobalDocRepositoryPort / WorktreePort / GitMergePort）方法集对齐现有 / 计划 infra 实现；TaskDocRepositoryPort 逐项匹配 TaskDocRepository，GlobalDocRepositoryPort 正文变换逐项匹配 GlobalDocRepository + 文件 I/O（readGlobalDoc/writeGlobalDoc，GlobalDocName 联合）为前瞻契约（当前 GlobalDocRepository 纯变换无 I/O，DEC-009，CLI 适配器组合 fs 满足），WorktreePort/GitMergePort 对齐 TASK-018 计划方法集；infra 类无需 implements，CLI composition root wiring（ARCHITECTURE §4）。（6）GitMergePort.rebaseOnto 冲突不抛断——对齐 TASK-019 §2「失败（冲突）则返回冲突清单，不抛断」，冲突探测走 listConflicts、清理走 abortOrCleanRebase。
rationale: 任务文件路径：frontmatter 无 slug（slug 命名是 CLI task-create 职责，TASK-011 注记），而 result_file 按 §9 含完整 slug 路径，去 .result.md 加 .md 即得任务文件——是最干净的纯计算派生，无需 I/O 也无需 glob。抛错而非静默回退：违反 §9 约定的 result_file 是任务定义错误，应显式暴露（AGENTS §3），静默回退会产出错误清单。refreshSourceFiles all-or-nothing：§8「若依赖已完成」（全部）+ §11「未完成时不刷新」共同指向 all-or-nothing；部分刷新（仅已完成依赖）会让 source_files 混合预填与部分实际产物，语义模糊且与「任务 running 前依赖必全部 done」的运行期不变量冲突。无依赖保留预填：无依赖则无 .result.md 可刷新，预填（Orchestrator 按 allowed_paths/architecture 圈定）即终值。必读核心并入 required_docs 输出：§8「任务文件本身不计入 required_docs 数组」的「数组」特指 frontmatter 声明数组（故模板 required_docs 只列 AGENTS/ARCHITECTURE/PROGRESS），计算清单则需把任务文件作为完整注入文档纳入；放 required_docs（而非新字段）因 ContextPack 三字段结构已固定、任务文件是「完整注入」语义与 required_docs 同类。Ports 对齐 infra：结构类型兼容（ARCHITECTURE §4）要求 Port 方法集与 infra 实现匹配，TaskDocRepositoryPort 逐项对齐保证 CLI 可直接注入 TaskDocRepository；GlobalDocRepositoryPort 的 I/O 是 application 层 TASK-020「重读→合并→回写」的必需（application 不能 import fs），但当前 GlobalDocRepository 经 DEC-009 设计为纯变换无 I/O，故 I/O 作前瞻契约由 CLI 适配器组合满足——这是两仓储设计分工（TaskDocRepository 同步 I/O / GlobalDocRepository 纯变换）的直接推论，非缺陷。rebaseOnto 不抛断：TASK-019 明示合并失败返回冲突清单不抛断，原语层据此设计（rebase 留冲突态，listConflicts 探测），应用层编排冲突处理。
consequences: TASK-017 状态编排复用：ready→running 时调 refreshSourceFiles 取新 source_files → writeTask 回写 frontmatter → computeContextPack 产最终清单（或 TASK-022 直接读已回写的 context_pack）。TASK-022 SDK 适配器按 computeContextPack 输出的 ContextPack 注入文档内容（required_docs 完整注入 / optional_doc_excerpts 按章节 / source_files 允许阅读）。TASK-018 落地 WorktreeAdapter/GitMergeAdapter 后结构性满足 WorktreePort/GitMergePort（方法集已对齐）。TASK-020 section 回写经 GlobalDocRepositoryPort 的 readGlobalDoc→变换→writeGlobalDoc（CLI 适配器组合 fs + GlobalDocRepository 提供 I/O）。TASK-025 CLI composition root wiring：TaskDocRepository 直接注入 TaskDocRepositoryPort；GlobalDocRepositoryPort 注入组合 fs + GlobalDocRepository 的适配器；WorktreePort/GitMergePort 注入 TASK-018 的 Adapter。若 Orchestrator 认为：(a) 任务文件应单列字段而非并入 required_docs——改 computeContextPack 输出结构（届时需同步改 ContextPack Schema + §8）；(b) refreshSourceFiles 应部分刷新（仅已完成依赖）——改 allDepsCompleted 判定为逐依赖累加（与 §11「未完成不刷新」张力）；(c) GlobalDocRepositoryPort 不应含 I/O（改由 application 函数收 doc 内容参数）——TASK-020 调整 writebackGlobalDocs 签名 + 本 Port 删 read/writeGlobalDoc；(d) result_file 派生应容错（非 .result.md 回退 id 模式）——改 taskFilePath 加 fallback（但 slug 未知，需 glob，引入 I/O 违反纯计算）。
```

---

## DEC-013 调度器设计：mergeOrder 与 topologicalOrder 同向、detectParallelizable 返回可并行批次、保守路径重叠判定、环检测自包含于 Kahn、SchedulerTask 最小投影、空 allowed_paths 不冲突、确定性输出

```yaml
id: DEC-013
title: "调度器设计——mergeOrder 与 topologicalOrder 同向、detectParallelizable 返回可并行批次、保守路径重叠判定、环检测自包含于 Kahn、SchedulerTask 最小投影、空 allowed_paths 不冲突、确定性输出"
status: proposed
scope: application/scheduler
created_from_task: TASK-016
decision: |-
  TASK-016 对 §3.2/§11 与任务 §7/§8 未明文的设计点作如下解释并落地：（1）mergeOrder 与 topologicalOrder 同向——§3.2「合并顺序按 depends_on 拓扑序，先合并被依赖方，再合并依赖方」与执行序（依赖完成后才执行后继）在拓扑意义下同向（均被依赖方在前），故 mergeOrder 当前复用 topologicalOrder 算法；独立导出以表达合并场景语义，便于未来在合并侧引入额外约束（如 worktree 基线对齐 / execution_commits 回填顺序）时与执行序分化解耦。（2）detectParallelizable 返回「可并行批次」TaskId[][] 而非裸拓扑层——§3.2「只有互无 depends_on 依赖、且 allowed_paths 不重叠才允许并行」要求分组必须处理路径冲突：先 Kahn 分层（层内互无依赖），再层内按 allowed_paths 不重叠做最早适配贪心分组，每个分组是一个可安全并行批次；同层路径冲突者拆成多批，单元素批次表示无法与同层任何任务并行。返回按拓扑依赖序排列（批次 i 只依赖 < i 批次），Orchestrator 按批次调度。（3）保守路径重叠判定（pathsOverlap）——任务 §7「前缀包含或 glob 相交视为重叠（保守，倾向不并行）」+ §8：normalizePath 统一分隔符 / 尾部斜杠后，相等 / 目录段包含（祖先关系）/ glob 字面前缀相交 / 任一字面前缀为空（根级通配如 *.ts 或起首即通配）→ 判重叠；兄弟文件 / 不相交目录 → 不重叠。取 glob 首个通配符前的字面目录前缀做段包含比较，避免实现完整 glob 交集（NP-hard，任务 §7「不判定细粒度」）。（4）环检测自包含于 Kahn——Kahn 排序完成节点数 < 总数即存在入度永不为 0 的节点（环上或依赖环），返回 cyclic 供调用方抛错；不 import core 的 detectDependencyCycle，因为环检测是拓扑排序的自然副产物，自包含内聚，且 SchedulerTask 投影无需 status 字段（core 的 detectDependencyCycle 需 CascadeTask 含 status）。与 core 的 DFS 三色环检测是不同算法服务不同入口，非重复逻辑。（5）SchedulerTask 最小投影（id/depends_on/allowed_paths）——结构类型兼容 TaskFrontmatter，应用层不必为调度另行装配。（6）空 allowed_paths 视为不与任何任务路径重叠——§3.2「.result.md 是内置产物不计入 allowed_paths」，故无写路径的只读 / 纯计算任务不与他任务文件冲突，可并行。（7）确定性输出——Kahn 入度 0 节点按 id 数值升序解并列，层内分组按 id 升序遍历，结果稳定可复现。
rationale: |-
  mergeOrder 同向：§3.2 明文合并序 = depends_on 拓扑序（被依赖方在前），与执行序无方向差异；分两个函数是为语义清晰 + 未来分化点，当前共享算法避免重复。可并行批次而非裸层：§3.2 的并行条件同时含「互无依赖」与「路径不重叠」两个维度，仅返回拓扑层会把路径冲突的任务混在同一层（调用方仍需自判），返回可并行批次让 Orchestrator 直接按批次调度、组内并行、组间串行。保守重叠：任务 §7 明示「保守策略，倾向不并行」与 §3.2「默认串行」一致，宁可低估并行度也不冒险并发写同文件；glob 交集精确判定是 NP-hard，任务 §7「用 glob/prefix 相交判定即可」授权用字面前缀近似。环检测自包含：Kahn 天然检测环（无需额外 DFS 前置），scheduler 的核心是拓扑排序、环是其副产物，一体化更内聚；不耦合 core detectDependencyCycle 的 CascadeTask 投影（需 status），SchedulerTask 更最小。空 allowed_paths 不冲突：.result.md 不计入 allowed_paths（§3.2），纯计算任务无业务写路径，与任何任务都不文件冲突，禁止其并行会无谓降低并行度。确定性：拓扑排序本有多解（并列任务任意序），固定 id 数值升序使输出可复现，便于测试断言与上层确定性调度 / 合并。
consequences: |-
  TASK-017 状态编排复用：topologicalOrder 决定执行序 / mergeOrder 决定合并序（§3.2 先合并被依赖方）；detectParallelizable 供 Orchestrator 选可并行任务子集调度多 worktree。TASK-026 CLI task:run 经调度器取执行序编排。TASK-019 合并回填用 mergeOrder。保守重叠判定可能低估并行度（如两个 glob 实际不相交但字面前缀被判相交），但安全优先、可通过细化 glob 判定（未来任务）提升。mergeOrder 当前 = topologicalOrder，若未来合并序需分化（如 audit commit 顺序约束），改 mergeOrder 独立实现不影响 topologicalOrder。若 Orchestrator 认为：(a) detectParallelizable 应返回裸拓扑层（路径冲突由上层再判）——改返回 layers 直接输出（但与 §3.2「路径不重叠才并行」张力）；(b) 路径重叠应精确判定 glob 交集——引入 glob 匹配库（新增依赖，需扩权）或自实现 minimatch 逻辑；(c) 环检测应复用 core detectDependencyCycle——补 status 投影或泛化 core 接口（改 core，需扩权）；(d) 空 allowed_paths 应视为与一切冲突（保守）——改 tasksPathOverlap 对空数组返回 true（降低并行度）。
```

提议自 `TASK-016-app-scheduler.result.md`。调度器仅 type-only import 既有 core 的 `TaskId`、零运行时依赖、零反向依赖、无边界冲突；七处设计解释（mergeOrder 同向 / 可并行批次语义 / 保守重叠 / 环自包含 / SchedulerTask 投影 / 空 allowed_paths 不冲突 / 确定性）均为 §3.2/§11/任务 §7/§8 的合理落地，待 Orchestrator 回写确认。

---

## DEC-014 StateOrchestrator 设计——四方法职责切分、applyResult/applyReview 共享私有转移、cascadeIfBlocked 逐个过状态机+不能则 skipped、产物校验清单、confirmed 取 false

```yaml
id: DEC-014
title: "StateOrchestrator 设计——四方法职责切分、applyResult/applyReview 共享私有转移、cascadeIfBlocked 逐个过状态机+不能则 skipped、产物校验清单、confirmed 取 false"
status: proposed
scope: application/state-orchestrator
created_from_task: TASK-017
decision: |-
  TASK-017 对 §5.1/§7/§10/§15 与 ARCHITECTURE §4 未明文的编排设计作如下解释并落地：（1）四方法职责——transition 是显式入口（context 全由调用方构造，含 confirmed）；applyResult 按 §10 映射并转移；applyReview 按 §15 映射；cascadeIfBlocked 按 §7 级联。（2）applyResult/applyReview 共享私有 applyResultForTask+applyTransition——transition 读 task 后调 applyTransition，applyResult 读 task 后调 applyResultForTask，applyReview 读 task 后按 review_result 分派（skipped 读 result 后调 applyResultForTask），避免重复读取。（3）applyResult 对 mapResultToStatus 的 ok:false（§10 非法组合）抛错转人工——DEC-005 consequences 明示「TASK-017 须对 ok:false 记 issue 并转人工（不得静默）」，单方法层面抛错是最明确的「不静默」，上层 catch 记 issue。（4）applyReview 的 skipped 分支委托 applyResult 复用 no_review 三分逻辑——读 .result.md → isResultAcceptable 校验产物 → applyResultForTask(task, result, verified)，避免重复实现 completed+review+no_review 的 done/blocked 分支（DEC-005）。（5）cascadeIfBlocked 逐个过 validateTransition，能流转者 writeTask blocked、不能者记 skipped 返回 CascadeOutcome——不抛错中断（级联是批量推进，单个后继无法流转不应阻断其余）、不静默跳过（skipped 显式返回让调用方知情转人工）。（6）产物校验清单 isResultAcceptable——.result.md 可读（readResult 不抛错即 Schema 通过）+ verification 无 result==='failed'（passed/skipped 放行）+ global_update_requests 三子项结构（ResultFrontmatterSchema 强制），内容非空不强制；对应 §7/§15「Orchestrator 校验 .result.md、验证结果和全局更新建议齐全」。（7）confirmed 在 applyResult/applyReview/cascadeIfBlocked 内部取 false——这三类从 running/reviewing 出发的合法转移均不依赖 confirmed（failed→* 与 done→blocked 的 confirmed 闸门由 transition 显式入口承载）；任何非法 from 都被 validateTransition 拦截抛错。
rationale: |-
  四方法切分对齐任务 §2 的四个用例，各自语义独立。共享私有方法遵循 AGENTS §3「不复制粘贴重复逻辑」——applyTransition（校验+写回）被 transition/applyResult/applyReview 复用，applyResultForTask（映射+转移）被 applyResult/applyReview-skipped 复用。ok:false 抛错：DEC-005 把「记录 issue 并转人工」的职责放在 TASK-017，单方法抛错让上层 Orchestrator 在 catch 中记 issue + 标 blocked/needs-human，比返回判别联合更直接（本类不是批量收集器）。skipped 委托 applyResult：§15 明示 skipped 时「Orchestrator 仍必须检查 .result.md、验证结果和全局更新建议是否齐全，才能置 done；不通过则走 blocked/failed」——这正是 mapResultToStatus 在 completed+review+noReview 的三分（DEC-005），复用避免两套产物校验逻辑漂移。cascadeIfBlocked 不抛错：级联针对一前置的全部后继，若某后继（如已 done）无法流转就抛错会阻断对其余后继的级联，且「无法级联」是状态机约束的如实反映而非异常；返回 CascadeOutcome 让调用方显式处理 skipped（AGENTS §3「不静默」=显式可追踪，非=抛错）。产物清单对应 §7/§15 明文三项；verification 无 failed 是「验证结果齐全」的最小判定（Executor 自报 passed/skipped 均可接受，failed 表示任务未真正通过验证）。confirmed=false 安全：mapResultToStatus 从 running 出发的合法目标（reviewing/done/blocked/failed/cancelled）经 validateTransition 时，仅 running→done 需 no_review（由 task.no_review 满足），confirmed 不参与；非法 from（如对已 done 任务 applyResult）被 validateTransition 拦截抛错，confirmed 取值不影响安全性。
consequences: |-
  TASK-019/020 合并回写不在此类（状态编排与合并解耦）；TASK-029 规划用例经本类驱动任务流转；CLI（TASK-026 task:run）在 Executor 返回后调 applyResult/applyReview、前置失败时调 cascadeIfBlocked。ISS-006：级联对 ready/draft 后继返回 skipped（状态机表无对应边），与 Readme §7 级联文字张力，待 Orchestrator 裁定。若 Orchestrator 认为：(a) applyResult 对 ok:false 应返回结果而非抛错（便于批量编排收集多任务问题）——改 applyResultForTask 返回判别联合（届时同步改 DEC-014 + 测试）；(b) cascadeIfBlocked 对 skipped 应抛错而非返回——改 skipped 分支为 throw（但中断批量级联）；(c) isResultAcceptable 应校验 global_update_requests 非空——改校验逻辑（但任务可能确实无更新，会误判）；(d) 级联应强制 blocked 绕过状态机——需先扩状态机表补 ready/draft→blocked 边（改 core，见 ISS-006）。新增 ReviewResult / TaskStatus 取值时 switch 穷尽性检查（applyReview default never）强制补全。
```

提议自 `TASK-017-app-state-orchestrator.result.md`。状态编排器仅 type-only import core 类型 + 值 import core 纯函数 + type-only import `./ports.js`、零反向依赖、无边界冲突；七处编排设计解释（四方法职责 / 共享私有转移 / ok:false 抛错转人工 DEC-005 落地 / skipped 委托 applyResult / cascadeIfBlocked 逐个过状态机+不能则 skipped / 产物校验清单 / confirmed 取 false）均为 §5.1/§7/§10/§15 与 ARCHITECTURE §4 的合理落地；级联张力见 ISS-006，待 Orchestrator 回写确认。

## DEC-015 Git 适配器设计——子进程调 git + GitAdapterError 领域错误、create 记录基线 commit、reset clean -fd 保留 node_modules、fastForwardMain 用 update-ref 避免 merge commit、rebase 冲突不抛断、collect 用字段/记录分隔符去换行、abort 幂等

```yaml
id: DEC-015
title: "Git 适配器设计——子进程调 git + GitAdapterError 领域错误、create 记录基线 commit、reset clean -fd 保留 node_modules、fastForwardMain 用 update-ref 避免 merge commit、rebase 冲突不抛断、collect 用字段/记录分隔符去换行、abort 幂等"
status: proposed
scope: infrastructure/git/worktree-adapter
created_from_task: TASK-018
decision: |-
  TASK-018 对 §3.2 / §7 / §8 / §12 与 ARCHITECTURE §4 未明文的 git 适配设计作如下解释并落地：（1）通过 spawnSync 调系统 git，不引入重型 git 库（§8「不引入重型 git 库」），同步风格与 frontmatter-parser / task-doc-repo 一致。（2）子进程错误统一转 GitAdapterError（含 command / exitCode / stderr），区分「spawn 自身失败（找不到 git / cwd 不存在）→ 抛 Error」与「git 业务退出码非 0 → 抛 GitAdapterError」（§12，AGENTS §4 不静默）。（3）create 把 mainRef 经 rev-parse 解析为绝对 commit hash 记入 bases Map，reset 据此精确回基线——即便 main 后续已变也回到原基线（§7「从干净状态重跑」）；内存 Map 单进程内有效，跨进程恢复靠 git 状态 + frontmatter（§3.2，见 ISS-008）。（4）reset 用 reset --hard <base> + clean -fd（不含 -x）——保留被忽略文件如 node_modules（§12「node_modules 不归本适配器」，依赖复用归 CLI TASK-026）。（5）remove 幂等：worktree remove 与 branch -D 各自用 existsSync / rev-parse --verify 守卫，不依赖 stderr 文本判定（规避 Windows / 本地化 stderr 差异）。（6）fastForwardMain 先 merge-base --is-ancestor <mainRef> <branch> 验证 ff 可行（不可则抛 GitAdapterError「需先 rebase」），再 update-ref refs/heads/<mainRef> <branch> 移动 ref——直接移动 ref 不切换工作区、绝不产生 merge commit（§3.2）；假定 mainRef 为短分支名（如 main），构造 refs/heads/<mainRef>。（7）rebaseOnto 用 tryGit 不抛，冲突时 rebase 停在中间态（退出码非 0），isRebaseInProgress 探测 rebase-merge / rebase-apply 目录区分「冲突停顿（静默返回，留 listConflicts 探测）」与「真错误（抛 GitAdapterError）」（GitMergePort.rebaseOnto 契约「冲突不抛断」，TASK-019 §2）。（8）collectPostRebaseCommits 用 --format 以 0x1F 分隔字段、0x1E 分隔记录 + --reverse 时间正序，规避 message 含换行干扰，解析时去每条记录首尾换行（git --format 每条后追加换行导致下一条首部残留换行）。（9）abortOrCleanRebase 幂等：tryGit rebase --abort，无进行中的 rebase 时 git 报错被静默，仍有中间态却失败才抛错（§3.2「丢弃不完整 rebase」）。（10）两适配器构造同形（mainRepoDir + worktreesDir），CLI composition root wiring 时一并注入；模块级辅助 branchName / rawExec / runGit / tryGit / isRebaseInProgress 共用不复制粘贴（AGENTS §3）。结构兼容 WorktreePort / GitMergePort 无需显式 implements（ARCHITECTURE §4）。
rationale: |-
  子进程调 git 而非引入 isomorphic-git / simple-git：§8 明文「不引入重型 git 库」，且 git CLI 行为是事实来源（worktree / rebase / update-ref 语义清晰、与 §3.2 描述一一对应）。GitAdapterError 封装 stderr：§12「子进程错误需捕获并转为领域错误」，上层据 stderr / exitCode 显式分派（冲突 vs 分叉 vs ref 不存在），比裸 Error 字符串匹配稳健。create 记录 commit hash 而非 ref：main 是移动 ref，reset 需回到「创建时的基线」而非「当前 main」（§7 重跑同一基线），hash 是不可变锚点。clean -fd 不含 -x：被忽略文件（node_modules）是依赖产物，reset 重跑需复用而非重装（§12 明确 node_modules 归 CLI 层处理）。remove 幂等用 existsSync + rev-parse：stderr 文本随 locale / git 版本变（Windows 可能本地化），结构化判定更可靠。fastForwardMain 用 update-ref：git checkout main && git merge --ff-only 会切换主工作区（副作用，Orchestrator 在主分支维护状态时危险），update-ref 只移动 ref 不动工作区且原子；先验 is-ancestor 保证线性（非 ff 抛错，避免误产生 merge commit）。rebaseOnto 区分冲突停顿：git rebase 冲突退出码非 0 与 ref 无效等真错误同为非 0，靠 isRebaseInProgress（探测 rebase-merge/rebase-apply 中间态目录）精确区分，落实 Port「冲突不抛断」契约。collect 用 0x1F/0x1E：commit message 可含空格 / 括号 / 换行（%B），用 ASCII 控制字符作分隔避免与 message 内容冲突，--reverse 时间正序符合审计直觉。abortOrCleanRebase 幂等：§3.2 恢复逻辑可能多次调用 abort（已无 rebase 也调），git rebase --abort 无 rebase 时报错需静默，但若 abort 后仍处中间态说明异常须抛。
consequences: |-
  TASK-019 rebase-ff 合并编排经 GitMergePort 调 rebaseOnto（冲突不抛断→listConflicts→转 blocked）+ collectPostRebaseCommits（rebase 后回填 execution_commits）+ commitAuditResult（audit commit）+ fastForwardMain（ff 回收），严格按 §3.2 顺序（rebase→collect→audit commit→ff）串联。TASK-021 幂等恢复用 branchMerged（已进入 main 跳过合并）+ abortOrCleanRebase（丢弃不完整 rebase）。TASK-026 task:run 经 WorktreePort create/reset/retain/remove 管理 worktree 生命周期。ISS-007：commitAuditResult 依赖 git user.name/email 已配置（本适配器不设 config，AGENTS §4 不隐藏兼容），CLI init（TASK-023）须确保仓库配置。ISS-008：reset 基线为内存 Map，跨 CLI 进程续跑（restart_on_retry）时 bases 丢失会抛错，需 application 层重新 create 或持久化基线。fastForwardMain 假定 mainRef 短分支名——若未来需支持完整 ref 或 commit，改 update-ref 的 ref 构造逻辑。Windows 路径：worktreePath 用 resolve 保证绝对，git worktree add 接受 Windows 绝对路径（测试在 Git Bash + git 2.53 验证）。若 Orchestrator 认为：(a) reset 应支持跨进程恢复基线——改持久化到 worktree git config（见 ISS-008 方案 A）；(b) fastForwardMain 应切换工作区 checkout main——改用 merge --ff-only（但副作用）；(c) collectPostRebaseCommits 应用 %B 全 message——改 fmt + 解析（多行 message）。新增 Port 方法时两适配器须同步补全（结构兼容）。
```

提议自 `TASK-018-infra-git-worktree.result.md`。Git 适配器仅 type-only import core 的 ExecutionCommit / TaskId、零反向依赖、不 import application/cli（结构兼容 WorktreePort / GitMergePort）、无边界冲突；十处 git 适配设计解释（子进程调 git / GitAdapterError 领域错误 / create 记录基线 commit / reset clean -fd 保留 node_modules / remove 幂等 / fastForwardMain 用 update-ref 避免 merge commit / rebase 冲突不抛断 / collect 用 0x1F·0x1E 分隔去换行 / abort 幂等 / 两适配器构造同形）均为 §3.2 / §7 / §8 / §12 与 ARCHITECTURE §4 的合理落地；commit 身份依赖见 ISS-007、reset 基线跨进程持久化见 ISS-008，待 Orchestrator 回写确认。
