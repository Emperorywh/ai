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

---

## DEC-016 rebase-ff 合并编排设计——批量拓扑序合并、冲突清单 + 传递后继 skipped、回填时序（audit 前 collect）、MergePorts 端口聚合、docs 按 taskId 路由、只产出不仲裁

```yaml
id: DEC-016
title: "rebase-ff 合并编排设计——批量拓扑序合并、冲突清单 + 传递后继 skipped、回填时序（audit 前 collect）、MergePorts 端口聚合、docs 按 taskId 路由、只产出不仲裁"
status: proposed
scope: application/merge/rebase-ff
created_from_task: TASK-019
decision: |-
  TASK-019 对 §3.2 / 任务 §2/§7/§8/§9/§12 与 ARCHITECTURE §4 未明文的合并编排设计作如下解释并落地：（1）函数签名处理一批任务（非单任务）——depends_on 含 TASK-016 暗示用 mergeOrder 排拓扑序，§2「按拓扑序逐任务」、§3.2「合并顺序由 application 层按 depends_on 拓扑序决定」均要求本函数内部排序后逐任务合并；签名 `rebaseAndFastForward(ports, tasks, {mainRef})`，tasks 为待合并任务集合。（2）合并只用拓扑序不用并行路径重叠判定，故投影 MergeTask → SchedulerTask 时 allowed_paths 填空数组（mergeOrder/topologicalOrder 不依赖 allowed_paths，仅 detectParallelizable 用）。（3）冲突探测：rebaseOnto 冲突不抛断（GitMergePort 契约），用 listConflicts 非空判定冲突（ports.ts 注释「留待 listConflicts 探测」），冲突则 abortOrCleanRebase 清理中间态（不破坏 main）+ 返回清单，不抛断（§2「失败则返回冲突清单，不抛断」）。（4）冲突任务的传递后继连带 skipped——§3.2 硬约束「任何任务不得先于其依赖任务回收到主分支」：若被依赖方冲突未 ff，依赖方 rebase 到不含被依赖方改动的 main 仍可能 ff 成功，违反拓扑约束；故用 transitiveDependents 算冲突任务的传递后继闭包，标记 pending 跳过（不改 frontmatter 状态，仅本轮跳过，§7「不做仲裁」——置 blocked/写 ISSUES 归 Orchestrator）。（5）回填时序严格按 §12 最高风险点：collectPostRebaseCommits 必须在 commitAuditResult 之前——collect 用 main..HEAD 取实现 commit，audit commit 提交后才会出现在 HEAD，此前采集确保 execution_commits 只含实现 commit 不含 audit commit（§3.2「audit commit 只作记录载体不计入 execution_commits」）；rebase 前旧 hash 一律丢弃（collect 基线用 rebase 后的 mainRef）。（6）回填仅改 frontmatter execution_commits，writeResult body 未传保留正文（DEC-008 仓储语义）。（7）MergePorts 聚合 {git: GitMergePort, docs: TaskDocRepositoryPort}，由 CLI composition root wiring（ARCHITECTURE §4）。（8）只产出 {merged, conflicts, skipped, results}，不做合并冲突仲裁决策（§7）、不做全局文档 section 回写（TASK-020）、不做幂等恢复（TASK-021）。沿用「纯编排 + Result 判别联合 + 结构类型投影」模式（承接 DEC-004/005/014）。
rationale: |-
  处理一批而非单任务：depends_on 显式列 TASK-016（mergeOrder），且 §2/§3.2 明文「按拓扑序逐任务」「合并顺序由 application 层决定」，若单任务则无需 TASK-016；批量内部排序把拓扑序逻辑封装在合并用例内，调用方（Orchestrator/CLI）一次调用完成整批合并。冲突用 listConflicts 探测而非 rebaseOnto 返回值：GitMergePort.rebaseOnto 返回 void（契约「冲突不抛断」），冲突态只能经 listConflicts（diff --diff-filter=U）或 isRebaseInProgress 探测；listConflicts 同时给出冲突文件清单（§3.2「冲突清单写入 ISSUES」所需），一石二鸟。传递后继 skipped：§3.2 拓扑约束是硬约束非仲裁——不实现 skipped 会让依赖方在依赖未回收时误 ff 进 main（违反 §3.2）；「转 blocked + 写 ISSUES」才是仲裁（改状态/写全局文档，Orchestrator 职责 §7），skipped 仅本轮跳过不改状态，二者边界清晰。回填时序：§12 明示「rebase 重写 hash，回填时机错误导致审计 hash 失真」是最高风险，collect 在 audit 前 = 用 main..HEAD（audit 尚未提交）精确取实现 commit；若 audit 在前，audit commit 会混入 main..HEAD 污染 execution_commits。MergePorts 聚合而非单 adapter 参数：合并同时需要 git 原语（rebase/ff/collect/audit）与文档读写（readResult/writeResult 回填），是两个独立 Port，聚合为单一参数贴合任务签名 `rebaseAndFastForward(adapter, task, {mainRef})` 的 adapter 语义。只产出不仲裁：§7 明文「不做合并冲突的仲裁决策（只产出冲突清单，TASK-020/Orchestrator 决策置 blocked）」，本函数返回 conflicts 清单即完成职责，blocked 状态流转归 TASK-017 StateOrchestrator、写 ISSUES 归 TASK-020。
consequences: |-
  TASK-020 section 回写在 rebaseAndFastForward 成功合并后串行回写全局文档（PROGRESS/DECISIONS/ISSUES），按 §3.2「合并回写时 Orchestrator 按 depends_on 拓扑序串行处理，每次回写前基于最新主分支重读全局文档」；conflicts 清单是 TASK-020/Orchestrator 转 blocked + 写 ISSUES 的输入。TASK-021 幂等恢复用 rebaseAndFastForward 的合并链路 + branchMerged（已 ff 跳过）/ abortOrCleanRebase（清不完整 rebase）实现崩溃恢复。TASK-026 task:run 经 rebaseAndFastForward 在 Executor 产出 .result.md + 审查通过后合并回收。MergePorts.docs 需按 taskId 路由到各 worktree/docs/tasks（见 ISS-009，TaskDocRepository 单 tasksDir 无法覆盖多 worktree，wiring 归 TASK-025/026）。MergeTask 投影复用：TaskFrontmatter 直接可传（结构兼容 id/depends_on/workflow_outputs）。若 Orchestrator 认为：(a) 冲突应立即停止后续所有任务（含无依赖者）——改 pending 为「遇冲突即 break」，但会漏合并独立任务；(b) skipped 应自动转 blocked——本函数加 StateOrchestrator 依赖越界（§7 仲裁归 Orchestrator），不改；(c) 应单任务签名由调用方循环——拆分 mergeOrder 职责到调用方，但失去「拓扑序封装」。回填时序若改（collect 在 audit 后）会导致 execution_commits 含 audit commit，违反 §3.2。
```

提议自 `TASK-019-app-merge-rebase-ff.result.md`。合并编排仅 type-only import core 的 ExecutionCommit / TaskId / TaskStatus + 值 import core 纯函数 transitiveDependents + 值 import 同层 mergeOrder + type-only import `../ports.js`、零反向依赖（不 import infrastructure/cli 实现类，ARCHITECTURE §4）、无边界冲突；八处合并编排设计解释（批量拓扑序合并 / 冲突用 listConflicts 探测 / 冲突传递后继 skipped / 回填时序 audit 前 collect / 回填仅改 frontmatter / MergePorts 聚合 / 只产出不仲裁 / 沿用 Result 判别联合模式）均为 §3.2 / 任务 §2/§7/§8/§12 与 ARCHITECTURE §4 的合理落地；多 worktree docs 路由见 ISS-009，待 Orchestrator 回写确认。

---

## DEC-017 section-writeback 合并编排设计——progress 冲突仅 replace-replace、IdAllocator 无状态注入、串行读→合并→写、docs 完整 Record、只产出不仲裁

```yaml
id: DEC-017
title: "section-writeback 合并编排设计——progress 冲突仅 replace-replace、IdAllocator 无状态注入、串行读→合并→写、docs 完整 Record、只产出不仲裁"
status: proposed
scope: application/merge/section-writeback
created_from_task: TASK-020
decision: |-
  TASK-020 对 §3.2 / §10 与任务 §2/§7/§8/§9/§12 与 ARCHITECTURE §4 未明文的回写编排设计作如下解释并落地：（1）progress 冲突检测仅针对同一 section 的多条 replace——§3.2 字面「多条 replace 命中同一 section 时按拓扑序后写者覆盖先写者，先写者落选」，append 不参与冲突（多条 append 视为按拓扑序叠加），故 detectProgressConflicts 按 section 分组 replace、拓扑序最后一条为 winner、其余每条生成 ProgressWritebackConflict{section, task_id, content, superseded_by} 并记入落选序号集合；apply 阶段落选 replace 跳过、append 与未落选 replace 总 apply。（2）append 与 replace 混合（同 section 既 append 又 replace）按 applyProgressUpdate 逐条变换的自然顺序处理——replace 在 append 之后则覆盖 append、append 在 replace 之后则追加到 replace 结果，二者均不计冲突（§3.2 未明文，见 ISS-010）。（3）IdAllocator 无状态注入式——接口 {nextDecisionId(usedIds), nextIssueId(usedIds)} 接收当前已用 id 集合返回一个不冲突新 id（DEC-XXX/ISS-XXX），编号策略由实现决定（典型现有最大编号+1）；writebackGlobalDocs 维护 usedIds（既有非空 id ∪ 本批次已分配）在每次分配前传入，保证不撞既有且批次内唯一，单一分配点。（4）decisions/issues 提议项 id 非空则沿用（appendDecision/appendIssue 按 id 去重：命中既有则替换标题+yaml block、否则文末追加），空则分配。（5）串行回写——单次调用内对每份文档读一次 → 逐条纯变换合并 → 写一次（§3.2 明确串行、§12 不引入并发；逐条 apply 到内存文档等价于「每条重读最新主分支」）。（6）docs 返回完整 Record<GlobalDocName,string>——有请求才合并+写盘、无请求保留读取原文不写盘（避免无变更的空提交）；docs 始终含三份（读取的或合并后的），消费方无需处理可选。（7）只产出不仲裁——返回 WritebackOutcome{docs, progress_conflicts, assigned_decision_ids, assigned_issue_ids}，不直接置 blocked（§7 仲裁归 Orchestrator）、不回写 .result.md 提议项 id（assigned ids 交 Orchestrator 经 TaskDocRepositoryPort.writeResult 回填，不在本函数）。沿用「纯编排 + 结构类型投影」模式（承接 DEC-014/016）。
rationale: |-
  progress 冲突仅 replace-replace：§3.2 字面把冲突场景限定为「多条 replace 命中同一 section」，append 是「按拓扑序拼接」（叠加语义非覆盖），故 append 不入冲突清单；同 section 多 replace 才是「多个任务都想独占该 section 内容」的真冲突。落选 replace 跳过不 apply：若 apply 了会被后写者立即覆盖（apply 顺序 = 拓扑序，winner 在 loser 之后），徒增中间态；直接跳过让 winner 的 apply 成为该 section 的最终写入，干净。IdAllocator 无状态：号段生成集中在 allocator（单一分配点，§8），本编排只维护 usedIds（既有 ∪ 批次内），二者职责清晰；无状态便于测试注入 fake（不必构造有状态对象的种子），且 allocator 可被任意编号策略复用。id 非空沿用：Task Executor 理论上可预填 id（Schema 允许非空），沿用其 id 经 appendDecision 去重（命中替换）是对提议方既定 id 的尊重，不强行重分配。串行读→合并→写：§3.2 明文串行、§12 明文不引入并发合并；读一次后在内存逐条 apply（纯变换）再写一次，与「每条重读最新主分支」在无并发下等价且更高效，避免每条都触发文件 I/O。docs 完整 Record：消费方（Orchestrator / 测试）拿到三份完整文档（有变更的是合并后、无变更的是原文），类型干净（Record 非 Partial）无需可选处理；无请求不写盘避免 git 产生无 diff 的空提交（§3.2 回写应只在有变更时落盘）。只产出不仲裁：§7 明文「不直接把任务置 blocked（产出冲突清单，由编排/CLI 决策）」，本函数返回冲突清单 + assigned ids 即完成职责，置 blocked 归 TASK-017 StateOrchestrator、写 ISSUES 由 Orchestrator 据冲突清单执行（§3.2「先写者落选并由 Orchestrator 将冲突项写入 docs/ISSUES.md」）、回填 .result.md id 由 Orchestrator 据 assigned ids 经 TaskDocRepositoryPort 执行。
consequences: |-
  TASK-021 幂等恢复在合并链路崩溃后，对分支已 ff 进 main 的任务跳过合并、仅补做未完成的 section 回写（调 writebackGlobalDocs）；未进入则 abortOrCleanRebase + 重走 rebaseAndFastForward。TASK-026 task:run 在合并回收后调 writebackGlobalDocs 回写全局文档，并据 progress_conflicts 置 blocked + 写 ISSUES、据 assigned ids 回填 .result.md。Orchestrator wiring：GlobalDocRepositoryPort 由 CLI（TASK-025）组合 fs + GlobalDocRepository 满足全契约（readGlobalDoc/writeGlobalDoc 读盘 + 委托正文变换，DEC-009/012），IdAllocator 由 CLI 提供（现有最大编号+1 的 sequential 实现）。若 Orchestrator 认为：(a) append 与 replace 混合应也计入冲突——改 detectProgressConflicts 把同 section 的 append+replace 组合也纳入（届时同步改 ISS-010 + 测试）；(b) IdAllocator 应有状态（内部计数器）——改接口为无参 nextXxxId + 构造时传入种子（但失去 usedIds 推断的纯度）；(c) docs 应为 Partial（只含变更文档）——改返回类型（消费方需处理可选）；(d) 无请求文档也应写盘（保持统一写）——去掉 if (length>0) 守卫直接写（但产生空提交）；(e) assigned ids 应由本函数直接回写 .result.md——需注入 TaskDocRepositoryPort（增加端口依赖，但回写 .result.md 是 Orchestrator 编排职责，不推荐）。新增 GlobalDocName 取值时 Record<GlobalDocName,string> 强制补全 docs 初始化。
```

提议自 `TASK-020-app-merge-section-writeback.result.md`。section 回写编排仅 type-only import core 类型 + type-only import `../ports.js`、零反向依赖（不 import infrastructure/cli 实现类，ARCHITECTURE §4）、无边界冲突；七处回写编排设计解释（progress 冲突仅 replace-replace / append·replace 混合按逐条 apply 自然顺序 / IdAllocator 无状态注入 / id 非空沿用 / 串行读→合并→写 / docs 完整 Record 无请求不写盘 / 只产出不仲裁）均为 §3.2 / §10 / 任务 §2/§7/§8/§9/§12 与 ARCHITECTURE §4 的合理落地；append·replace 混合语义张力见 ISS-010，待 Orchestrator 回写确认。

---

## DEC-018 recovery 合并幂等恢复编排设计——branchMerged 唯一分叉点、未合并先 abort 再重合并、合并完成补回写、冲突不回写、RecoveryPorts extends MergePorts、taskId 一致性校验

```yaml
id: DEC-018
title: "recovery 合并幂等恢复编排设计——branchMerged 唯一分叉点、未合并先 abort 再重合并、合并完成补回写、冲突不回写、RecoveryPorts extends MergePorts、taskId 一致性校验"
status: proposed
scope: application/merge/recovery
created_from_task: TASK-021
decision: |-
  TASK-021 对 §3.2 合并幂等段落与任务 §2/§7/§8/§9/§11/§12 与 ARCHITECTURE §4 未明文的恢复编排设计作如下解释并落地：（1）以 `branchMerged(taskId, mainRef)` 为唯一恢复分叉点——§3.2 明文「用 git branch --merged 检查 worktree 分支是否已进入主分支：已进入则跳过合并、未进入则丢弃中间态重新 rebase」，故恢复的真判定是「分支是否已进 main」（合并完成的 git 事实），而非「是否存在 rebase 中间态」。branchMerged==true → skipped-merged（幂等跳过，不 rebase/不 ff）；branchMerged==false → 进入重合并分支。（2）未合并时一律先 abortOrCleanRebase 再 rebaseAndFastForward——§12 难点是「识别不完整 rebase 中间态需可靠判据」；本编排不自行探测 rebase 目录（探测归 GitMergePort.abortOrCleanRebase 内部 TASK-018 isRebaseInProgress），而是「未合并即视作合并未完成，先 abort（幂等：有中间态则 abort、无则 no-op）再重合并」。这避免两个陷阱：(a) 若「探测到中间态才 abort、否则直接 rebase」，则在 rebase 进行中二次 rebase git 会直接报错；(b) 若依赖脆弱的 rebase 目录字符串探测则与 infra 重复实现。一律 abort + 重合并把「中间态」判定完全下沉到幂等的 abortOrCleanRebase，本编排只关心 branchMerged 事实。（3）合并完成（skipped-merged / redone-merged，mergeResult.ok==true）时补做 writebackGlobalDocs——§3.2「已进入则跳过合并、仅补做未完成的全局文档回写」；恢复无法判定回写是否已部分完成（合并进度不写 SQLite），故一律重新执行回写（decisions/issues 按 id 去重幂等、progress replace 后写者覆盖幂等；append 重复见 ISS-011）。冲突（redone-conflict）不回写——合并未完成不应落全局文档，冲突清单随 mergeResult 返回交 Orchestrator 仲裁置 blocked + 写 ISSUES（§3.2/§7）。（4）单任务恢复——recoverMerge 接受单个 taskId + MergeTask 投影，重合并调 rebaseAndFastForward([task])（单元素），不批量恢复（Orchestrator 按任务逐个调，§3.2 串行）；taskId 与 task.id 一致性防御校验（不一致抛错不静默，AGENTS §4）。（5）RecoveryPorts extends MergePorts——复用 TASK-019 合并端口聚合（git + docs）增加 globalRepo（TASK-020 回写所需），结构类型兼容（CLI wiring 注入三个适配器），避免重新声明 git/docs。（6）MergeRecoveryAction 三态 + writeback 可空——outcome 用判别联合语义（mergeResult.ok 区分红蓝结局），writeback 在冲突时为 null，消费方据 action/mergeResult/writeback 决策后续（Orchestrator 据冲突转 blocked + 写 ISSUES、据 writeback.assigned ids 回填 .result.md）。沿用「纯编排 + 判别联合 + 结构类型投影」模式（承接 DEC-014/016/017）。
rationale: |-
  branchMerged 唯一分叉点：§3.2 把恢复判定明文为「git branch --merged 检查是否进入主分支」，分支是否进 main 是合并完成的唯一 git 事实来源（合并进度不写 SQLite，§3.2）；以它为分叉点使恢复完全可从 git 状态重建，不依赖任何外部进度文件或内存状态。未合并先 abort 再重合并：§12 难点的可靠解——与其在本编排重复实现 rebase 中间态探测（脆弱、与 infra 重复），不如把「未合并」统一视作「合并未完成，先幂等清理再重来」；abortOrCleanRebase 已幂等（TASK-018：有 rebase 进行则 abort、无则 no-op 不抛），故「一律先 abort」对无中间态场景零成本，对有中间态场景正确清理，且规避「rebase 进行中二次 rebase 报错」陷阱。合并完成补回写：§3.2 字面「仅补做未完成的全局文档回写」；由于回写进度无判据（不写 SQLite），「补做」只能解释为「重新执行」（writebackGlobalDocs 对 decisions/issues/replace 幂等），这是「合并进度可从 git 状态完全重建」原则在回写侧的自然延伸——回写本身可重做。冲突不回写：合并未完成时落全局文档会污染主分支（§3.2 全局状态只在主分支维护），且冲突需 Orchestrator 仲裁（置 blocked/写 ISSUES）后才能决定该任务命运，不应在恢复内擅自回写。单任务恢复：合并链路是 per-task 的（§3.2 串行、TASK-019 逐任务），崩溃恢复也应 per-task（Orchestrator 逐个调），不引入批量恢复的状态复杂度；taskId 一致性校验防止调用方误传不匹配的 task 投影导致 git 操作错位（防御性，AGENTS §4 不静默）。RecoveryPorts extends MergePorts：DRY——合并端口已在 TASK-019 定义，恢复在其上仅加 globalRepo，extends 复用而非重声明，且 CLI wiring 三个适配器一次性注入。outcome 判别联合：与 rebase-ff（MergeTaskResult）/ section-writeback（WritebackOutcome）/ state-orchestrator（CascadeOutcome）同构，消费方据 action + mergeResult.ok + writeback 三维度决策，类型安全且不静默。
consequences: |-
  TASK-026 task:run 在合并阶段崩溃重入时，对每个未确认合并的任务调 recoverMerge 恢复（Orchestrator 编排，逐任务串行）；据 redone-conflict 的 mergeResult.conflicts 经 TASK-017 StateOrchestrator 置 blocked + TASK-020 写 ISSUES；据 writeback.assigned_decision_ids/assigned_issue_ids 经 TaskDocRepositoryPort.writeResult 回填 .result.md 提议项 id（同 TASK-020 回写流程）。Orchestrator wiring（TASK-025/026）：RecoveryPorts 三端口同 TASK-019/020 wiring（GitMergeAdapter + 按 taskId 路由 docs 适配器 ISS-009 + globalRepo 组合 fs + GlobalDocRepository DEC-012），IdAllocator 同 TASK-020（现有最大编号+1）。若 Orchestrator 认为：(a) append 重复追加不可接受——需引入回写完成标记（如 frontmatter 字段或单独进度文件，但 §3.2 明文合并进度不写 SQLite，可能需回写专用标记，见 ISS-011）；(b) 应批量恢复多任务——改 recoverMerge 接受 tasks[]（但失去 per-task 的清晰恢复边界，且 Orchestrator 已串行调度，不推荐）；(c) 冲突也应回写——需定义冲突任务的 global_update_requests 落盘策略（但合并未完成不应落全局状态，不推荐）；(d) branchMerged 之外应额外探测 rebase 中间态做更细粒度恢复——需在本编排引入 rebase 目录判定（与 infra isRebaseInProgress 重复，违背单一来源，不推荐）。新增 MergeRecoveryAction 取值时条件分支需同步。
```

提议自 `TASK-021-app-merge-recovery.result.md`。幂等恢复编排仅 type-only import core 的 `TaskId` + 值 import 同层 rebase-ff / section-writeback + type-only import `../ports.js` 的 `GlobalDocRepositoryPort`、零反向依赖（不 import infrastructure/cli 实现类，ARCHITECTURE §4；不依赖 SQLite——恢复判定只依赖 git 状态 + frontmatter，§3.2）、无边界冲突；六处恢复编排设计解释（branchMerged 唯一分叉点 / 未合并先 abort 再重合并规避中间态探测陷阱 / 合并完成补回写 / 冲突不回写 / 单任务恢复 + taskId 一致性校验 / RecoveryPorts extends MergePorts + outcome 判别联合）均为 §3.2 合并幂等段落与任务 §2/§7/§8/§9/§11/§12 与 ARCHITECTURE §4 的合理落地；「补做回写」无法判定部分完成致 append 可能重复见 ISS-011，待 Orchestrator 回写确认。

---

## DEC-019 Claude Agent SDK 适配器设计——接口隔离 + 注入式 SDK 句柄 + DryRun 兜底 + 不引入 SDK 依赖 + 被 cli 依赖不经 application

```yaml
id: DEC-019
title: "Claude Agent SDK 适配器设计——接口隔离 + 注入式 SDK 句柄 + DryRun 兜底 + 不引入 SDK 依赖 + 被 cli 依赖不经 application"
status: proposed
scope: infrastructure/sdk
created_from_task: TASK-022
decision: |-
  TASK-022 对 Readme §3.1（SDK 为执行引擎适配层）/ §5.2（Task Executor）/ §12 R1（SDK API 未确认）/ 任务 §1 §2 §7 §8 §11 §12 未明文的 SDK 适配设计作如下解释并落地：（1）接口隔离——`executor-contract.ts` 定义与具体 SDK 无关的 `TaskExecutor` 契约（execute(ExecuteInput): Promise<ExecuteOutcome>），core/application 不 import 本文件（ARCHITECTURE §4：executor-contract 仅被 cli 依赖、不经 application，不构成反向依赖），SDK 类型不外泄到 core/application。（2）注入式 SDK 句柄 `ClaudeSdkInvocation`——编排层（ClaudeSdkExecutor）与「依赖具体 SDK API 的调用 + 输出解析」解耦：句柄 `run(SdkRunInput): Promise<SdkRunReport>` 负责调用模型并把输出解析为可落 .result.md 的 SdkRunReport，编排层只组装入参 / 落盘报告，不猜测 SDK 具体 API。这把 R1「SDK API 未确认」的未知面收敛到单个可替换的注入点，SDK 就位时只需提供 invocation 实现并注入 ClaudeSdkExecutor。（3）DryRun 兜底——`DryRunLocalExecutor` 在 SDK 未就位时产出占位 .result.md（completed + 验证 skipped + 全局更新空 + review，过 ResultFrontmatterSchema），供 cli / application 前置链路（状态流转 / 合并 / 回写）无模型联调，§11「确认 + 接口 + DryRun 收尾」的直接落地。（4）不引入 SDK 依赖（红线）——package.json 无 @anthropic-ai/claude-agent-sdk、AGENTS / 任务红线禁新增 npm 依赖，故不 import 具体 SDK；ClaudeSdkExecutor 构造接收 `ClaudeSdkInvocation | null`，null 时 execute 抛 `ExecutorNotConfiguredError`，不伪造 SDK 调用（§7 明文「若 SDK API 无法在本次确认，落 ISSUES 并以 DryRun 交付，不得伪造 SDK 调用」）。（5）被 cli 依赖不经 application——契约 + 两执行器均属 cli composition root 职责，application 经 ports 访问 infra（TaskDocRepositoryPort 等读 .result.md），不感知执行引擎；cli task:run 在 worktree 创建 + Context Pack 计算 + 权限解析 + §18 提示组装后构造 ExecuteInput 调 execute。（6）权限注入用 TASK-009 解析结果——`ExecutorPermissionBoundary`（allowed/forbidden/permissions/verification_commands）由 cli 用 resolvePathScope（启动前检测重叠拒绝启动）+ computeVerificationAllowlist 产出后注入，Executor 不二次解析 frontmatter。沿用「契约接口 + 纯函数 + 注入式句柄 + 共享 persistResult」模式。
rationale: |-
  接口隔离（§1 / §8 / ARCHITECTURE §4）：core 不依赖 SDK 是硬约束，把 SDK 适配放 infrastructure/sdk 并以契约接口暴露，使 application / cli 的上层逻辑不绑定具体 SDK，SDK 可替换（未来可换其他模型 / 本地模型）。注入式句柄：R1「SDK API 未确认」是本计划最高风险——与其在编排层硬编码 SDK 调用（一旦 API 变动需改编排 + 重测全链路），不如把「调用 + 解析」隔离为 ClaudeSdkInvocation 注入点，编排层只做稳定的「组装入参 / 落盘报告」，二者独立演进、独立测试（编排用 fake invocation 测）。DryRun 兜底：§11 明文允许「确认 + 接口 + DryRun 收尾」，前置任务（合并 / 回写 / 状态流转）需要 .result.md 产物驱动联调，DryRun 提供无需模型的合法产物，避免前置链路被 SDK 阻塞。不引入依赖：AGENTS / 任务红线禁新增 npm 依赖，且 SDK API 未确认时引入依赖是赌博（版本 / 接口都可能变），故以「红线 + 风险」双重理由不引入；ExecutorNotConfiguredError 使「SDK 未就位」成为显式失败而非静默 fallback（§4 不保留隐式 fallback）。不伪造：§7 明文，伪造 SDK 调用会产出虚假 .result.md 污染下游状态流转 / 合并，违反「不静默」「状态显式可追踪」。被 cli 依赖不经 application：保持 application 经 ports 访问 infra 的纯净边界，SDK 适配是「如何执行」的 infra / cli 细节，application 只关心「执行后读 .result.md」的文档协议。权限用 TASK-009 解析结果：单一来源——路径重叠 / 验证 allowlist 已在 core 解析，Executor 消费解析后边界快照不重复实现。
consequences: |-
  SDK 就位后（待 Orchestrator 裁定选型）：由专门任务实现真实 `ClaudeSdkInvocation`（含 SDK 版本 / 子 agent 派发 / Context Pack 注入方式 / 权限与 hooks 注入点的确认，落 DECISIONS），cli composition root（TASK-025/026）构造该 invocation 注入 ClaudeSdkExecutor。`SdkRunReport` 的精确形态（如何把模型输出映射为 executionStatus / 文件清单 / verification / globalUpdateRequests / nextAction）依赖 SDK 真实 API，待 SDK 就位时确认——若 SDK 输出形态与当前 SdkRunReport 差异大，可能需调整 SdkRunReport 字段或加 invocation 内转换层（不破坏 TaskExecutor 契约，只影响 ClaudeSdkInvocation 实现）。DryRunLocalExecutor 长期保留：作为本地联调 / 测试夹具（前置任务测试可用 DryRun 产 .result.md 驱动），不随 SDK 就位移除。cli task:run（TASK-026）wiring：选 DryRun 或 ClaudeSdkExecutor 由 CLI 参数 / 配置决定（如 `--dry-run` 或无 SDK 时默认 DryRun + 告警）。若 Orchestrator 认为：(a) 应在本任务引入 SDK 依赖——需先扩权（改 package.json 非本任务 allowed，红线，不推荐）；(b) ClaudeSdkExecutor 应在编排层直接调 SDK（去 invocation 注入）——失去接口隔离与可测性，SDK API 变动需重测全链路（不推荐）；(c) DryRun 应执行验证命令而非全 skipped——偏离「占位」语义，引入 shell exec + 权限校验复杂度，且验证命令执行更适合放 cli 编排层（task:run 在 Executor 返回后跑验证记录到 .result.md，待 TASK-026 确认）。execution_commits 始终留空（Orchestrator 回填，§3.2），两执行器一致。新增 TaskExecutor 实现时须保证 execute 返回时 .result.md 已落盘且过 Schema（persistResult 守卫）。
```

提议自 `TASK-022-infra-claude-sdk-adapter.result.md`。SDK 适配器（executor-contract 仅 type-only import core 类型 + claude-sdk-adapter 值 import ResultFrontmatterSchema + type-only import core 类型 + 值 import 同层 serializeDocument + 值 import ./executor-contract.js）零反向依赖（不 import application/cli、不 import 具体 SDK，ARCHITECTURE §4）、无边界冲突；六处 SDK 适配设计解释（接口隔离 / 注入式句柄解耦 SDK API / DryRun 兜底 / 不引入依赖不伪造 / 被 cli 依赖不经 application / 权限用 TASK-009 解析结果）均为 §3.1 / §5.2 / §12 R1 与任务 §1 §2 §7 §8 §11 §12 与 ARCHITECTURE §4 的合理落地；SDK 未安装 / API 未确认致 ClaudeSdkExecutor 需 SDK 就位见 ISS-012，待 Orchestrator 裁定选型后确认。

---

## DEC-020 CLI 命令名 caw + commander exitOverride 透传退出码 + 业务错误统一 GeneralError=1 + init 幂等不覆盖 + init 零领域依赖

```yaml
id: DEC-020
title: "CLI 命令名 caw + commander exitOverride 透传退出码 + 业务错误统一 GeneralError=1 + init 幂等不覆盖 + init 零领域依赖"
status: proposed
scope: cli
created_from_task: TASK-023
decision: |-
  TASK-023 对 Readme §3.1（CLI 为第一阶段主入口）/ §6 文档体系 / §6.1 AGENTS / 任务 §2 §8 §11 §12 未明文的 CLI 框架与 init 设计作如下解释并落地：（1）命令名——package.json name 为 `coding-agent-workflow`，bin 与 `program.name()` 统一取短名 `caw`（命令调用 `caw init <dir>` 等），bin 指向编译产物 `./dist/cli/index.js`。（2）退出码约定——`CliExitCode`：Success=0（成功，含 commander --help/--version 正常退出、init 全新建、init 幂等跳过）、GeneralError=1（命令业务执行错误）；commander 用法错误（未知命令 / 参数缺失 / 非法参数）经 `exitOverride((err) => { throw err })` 转 `CommanderError`，runCli 透传其 `exitCode`（commander 默认 1），不另行分类。（3）exitOverride 取代 commander 默认 process.exit——commander 默认在 --help/用法错误时 `process.exit`，会直接终止测试进程且无法由调用方控制退出码；改 `exitOverride` 把退出意图抛成可捕获的 CommanderError，runCli 统一管控退出码、且使 `runCli` 可被单元测试断言退出码（不真退进程）。（4）program 不设默认 action——commander 在 program 同时拥有子命令与自身 action 时，会把未匹配子命令的 token 当作默认 action 的参数吞掉（实测未知命令返回 0），故不设 program 默认 action；空 argv 的帮助展示由 runCli 显式 `program.outputHelp()` 处理（outputHelp 只写 stdout、不触发 exit），未知命令交回 commander 默认报错（返回非零）。（5）init 幂等——已存在的目标文件一律 `existsSync` 跳过不覆盖（含用户已修改的文件），返回 `{created, skipped, projectRoot}`；全新与全部跳过均返回 Success=0（幂等是预期行为，非错误）。（6）init 零领域依赖——init 只写模板文件，不 import core/application/infrastructure（任务 §6 硬约束），模板内嵌于 `DOC_FILES` 常量单一来源，内容为目标项目通用骨架（§6.1-6.8 章节占位），非本项目自身 AGENTS 副本（§12 风险点）。沿用「命令入口 + 退出码约定 + 错误输出格式 + 模板常量 + 纯 I/O 函数 + Result 抛错」模式。
rationale: |-
  命令名 caw：package.json name 全名过长不便命令行输入，短名 caw（coding-agent-workflow 首字母）简洁且 bin 与 program.name 一一对应避免分裂；后续 CLI 任务（TASK-024-027）统一用 `caw <command>`。退出码约定：任务 §8「0 成功、非 0 失败，细分码在 framework 约定」要求 framework 固化退出码；commander 自身已有成熟的退出码语义（--help/version=0、用法错误=1），透传其 exitCode 比另行发明一套更一致、更少惊喜；业务错误统一 1 而非细分多码——本阶段无需求区分「目标非目录 / 权限不足 / I/O 错误」等子类，细分码属过度设计（AGENTS 不制造隐式状态），失败信息经 stderr message 区分即可，未来确需细分再扩 CliExitCode。exitOverride：runCli 返回退出码而非 process.exit 是为了让 bin（src/cli/index.ts）与单元测试共用同一入口——测试断言 `await runCli([...])` 的返回值，无需 spawn 子进程跑 dist（dist 需 build 且慢、且 Windows 路径 / 退出码采集复杂），e2e 测试直接在进程内跑 commander 更快更可靠（AGENTS §5 CLI e2e 在临时目录验证）。不设默认 action：实测 commander v12 在 program 有 action 时吞未知命令返回 0，与「未知命令应非零退出」的预期矛盾，去掉 action + runCli 拦截空 argv 是最小修复（不引入额外配置）。init 幂等：任务 §11「重复执行不覆盖既有文件」是硬性验收，existsSync 跳过是标准做法；幂等跳过返回 0 而非非零——重跑 init 是合法的「补全缺失文件」操作，非错误（§8 幂等语义）。零领域依赖：任务 §6 明文 init 不碰 core/application/infrastructure，且 init 生成目标项目骨架与本项目领域无关，引入领域依赖会制造 cli→core 的不必要耦合（ARCHITECTURE §3 允许 cli→application→core，但 init 不需要），保持 init 为纯模板生成器使职责单一、可独立测试。模板内嵌单一来源 DOC_FILES：避免模板内容散落，改一处即可。
consequences: |-
  后续 CLI 任务（TASK-024-027）沿用本约定：（a）命令名统一 `caw`，新命令在 `src/cli/commands/<name>.ts` 导出 `register<Name>Command(program)`，于 `createProgram()` 追加调用（createProgram 为命令注册单一入口）。（b）退出码：业务错误抛错由 runCli 统一 catch 返回 GeneralError=1，命令内只需正常抛错（如状态校验失败 / 文档不存在），不需自行 process.exit；用法错误透传 commander exitCode；测试经 `runCli([...])` 断言退出码 + 经命令模块纯函数断言产物。（c）需要领域逻辑的 CLI 命令（status/rebuild-index/task:run/task:review）经 application ports + composition root wiring 注入 infra（TASK-025+），不在 init 模式内混入——init 保持零依赖。（d）bin 需 `npm run build` 产出 dist/cli/index.js 后方作为 `caw` 全局命令运行（本任务验收不含 build，bin 字段先注册；测试不依赖 bin、直接调 runCli）。若 Orchestrator 认为：(1) 命令名应取全名 `coding-agent-workflow` 或其他——改 bin + program.name 一处即可，影响小；(2) 应细分更多退出码（如目标非目录=2、I/O 错误=3）——扩 CliExitCode 枚举 + 命令抛带码的自定义错误，本任务保持最小集；(3) init 应注入 SPEC/ARCHITECTURE 具体内容——任务 §7 明文「不强制注入，只生成空骨架，内容由用户/Orchestrator 填」，故保持占位；(4) 模板内容应更丰富——可在 DOC_FILES 调整，但需与 §6 各文档「应包含」清单对齐。本任务 9 项 e2e 单测覆盖：文档生成 / §6.1 约束关键词 / 幂等不覆盖（含篡改后不覆盖）/ 目标非目录抛错 / 不越界写文件 / runCli 成功 / 幂等成功 / --help 成功 / 未知命令非零。
```

提议自 `TASK-023-cli-framework-and-init.result.md`。CLI 框架（framework 值 import commander + 值 import ./commands/init.js）+ init（值 import commander + node:fs/node:path 内置）零反向依赖（不 import core/application/infrastructure，任务 §6 硬约束）、无边界冲突；六处 CLI/init 设计解释（命令名 caw / 退出码透传 commander exitCode + 业务错误统一 1 / exitOverride 取代 process.exit 使退出码可控可测 / 不设默认 action 避免吞未知命令 / init 幂等不覆盖 / init 零领域依赖）均为 §3.1 / §6 / §6.1 与任务 §2 §8 §11 §12 的合理落地；命令名 caw 与退出码约定影响后续 CLI 任务（TASK-024-027），待 Orchestrator 确认。

---

## DEC-021 CLI 索引库默认路径 <项目根>/.caw/index.db + status 命令以文档为权威不读 SQLite

```yaml
id: DEC-021
title: "CLI 索引库默认路径 <项目根>/.caw/index.db + status 命令以文档为权威不读 SQLite"
status: proposed
scope: cli（status / rebuild-index）
created_from_task: TASK-025
decision: |-
  TASK-025 对 Readme §3.1/§3.2 未明文的 CLI 索引库路径与 status 读取源作如下解释并落地：（1）rebuild-index 维护的 SQLite 索引库默认路径为 `<项目根>/.caw/index.db`（相对项目根，父目录 .caw/ 随首次重建由 mkdirSync recursive 建立），可经 `--db <path>` 覆盖、`--project-root <dir>` 指定项目根（默认 cwd）；全局文档假定位于 `<项目根>/docs/`（DECISIONS.md/ISSUES.md，§6 文档体系）。（2）status 命令一律以 docs/tasks frontmatter 为权威——collectStatus 经 TaskDocRepository.listTasks→readTask 取 id/title/status/layer，执行摘要经 readResult(+readReview)→buildExecutionSummary 综合，不读取 SQLite 索引；索引是派生存储，仅由 rebuild-index 全量重建维护。沿用「命令模块 + 纯函数 + registerXxxCommand + Result 抛错」模式（承接 DEC-020）。
rationale: |-
  索引库路径：§3.1/§3.2 把 SQLite 定为「派生存储」但未约定文件路径，需 CLI composition root 决定一个稳定默认。选 .caw/index.db：.caw/ 为工具私有目录（与 docs/ 文档协议目录平级、不污染文档）、index.db 语义明确；--db/--project-root 覆盖满足自定义部署（CI / 多项目）。status 文档权威：直接落地 §3.1 硬约束「索引不参与状态机判定、任何『读状态』的判断都不得只依赖 SQLite」——任务 status 属「读状态」，必须取自 frontmatter，索引仅加速；本骨架为保证正确性与验收「无索引可展示」不引入对索引文件的运行时读依赖，避免展示过期派生数据。执行摘要也走文档（buildExecutionSummary）而非索引 getExecution，保证与 frontmatter 一致、无过期风险。
consequences: |-
  .caw/ 目录进入项目工作区（建议各项目 .gitignore 忽略 .caw/，工具不自动改 .gitignore）。status 当前不利用索引加速（留作未来优化：可在保证状态回读 frontmatter 前提下用 queryTasks/getExecution 加速任务定位与执行摘要，索引缺失回退文档）。rebuild-index 假定全局文档位于 <项目根>/docs/（与 §6 一致）；全局文档缺失视为空集（readDecisions/readIssues 对无 fenced yaml 返回 []）。后续 CLI 命令沿用 DEC-020 + DEC-021：新命令在 src/cli/commands/<name>.ts 导出 register<Name>Command，于 createProgram()（framework.ts，ISS-013）追加注册。若 Orchestrator 认为：(1) 索引库应放他处（如 .git/caw/index.db 复用 .git、或用户级目录）——改 DEFAULT_DB_REL 一处即可；(2) status 应优先读索引加速——需在保证状态字段回读 frontmatter 前提下加索引快路径 + 回退文档（当前骨架未做，避免过期数据）；(3) 默认项目根应用 process.cwd() 之外的方式（如向上搜索含 docs/ 的目录）——可在 wiring 层加项目根探测。本任务 22 项单测覆盖：collectStatus 文档权威/过滤/空目录、formatStatus、status runCli（成功/无索引可展示/--status 过滤/非法枚举非零/目录缺失非零）、rebuildIndex（行数=文档全集/经 IndexRepository 校验/幂等/无全局文档零决策问题/自定义 db/目录缺失抛错）、rebuild-index runCli（成功+统计+破坏性提示/目录缺失非零）。
```

提议自 `TASK-025-cli-status-and-rebuild-index.result.md`。status/rebuild-index 命令（status 值 import core TaskStatusSchema/LayerSchema + 值 import infra TaskDocRepository/buildExecutionSummary；rebuild-index 值 import better-sqlite3 Database + 值 import infra IndexRepository/GlobalDocRepository/TaskDocRepository/表名常量）作为 cli composition root 直接 wiring infra（ARCHITECTURE §4 允许 cli→infra，application 不得直接 import infra 不影响 cli）、无边界冲突；两处 CLI 设计解释（索引库默认路径 .caw/index.db + status 文档权威不读 SQLite）均为 §3.1/§3.2 硬约束的合理落地，待 Orchestrator 确认。关联 ISS-013（framework.ts allowed_paths）。

---

## DEC-022 task:run 新鲜合并走 rebaseAndFastForward+writebackGlobalDocs，recoverMerge 留作崩溃续跑

```yaml
id: DEC-022
title: "task:run 新鲜合并走 rebaseAndFastForward+writebackGlobalDocs，recoverMerge 留作崩溃续跑"
status: proposed
scope: cli（task:run 合并编排）
created_from_task: TASK-026
decision: |-
  TASK-026 对 Readme §3.2（合并链路）/任务 §2（done 才合并、调 019/020/021、失败走恢复）的合并编排作如下解释并落地：task:run 的「done 免审合并」走 rebaseAndFastForward（TASK-019）+ writebackGlobalDocs（TASK-020）；recoverMerge（TASK-021）不作为新鲜合并入口，仅作为「合并链路崩溃后续跑 task:run 时」的恢复机制（由上层按 git 状态触发）。合并冲突（019 返回 conflicts）由 task:run 直接置 done→blocked（Orchestrator confirmed=true）+ appendMergeConflictIssue 登记进 docs/ISSUES.md，不经 021。
rationale: |-
  recoverMerge 以 GitMergePort.branchMerged（git merge-base --is-ancestor branch main）为唯一恢复分叉点。对 DryRun（及任何「产出未提交 .result.md」的执行器）的新鲜执行：worktree 分支从 main 基线创建、Executor 仅写出未提交产物、分支 HEAD == main 基线 → branchMerged 恒为真（commit 是自身的祖先），recoverMerge 会判「已合并」而 skipped-merged 跳过合并、仅补回写，导致未提交产物永不进入 main。rebaseAndFastForward 经 commitAuditResult（git add + commit）把未提交产物落盘后再 fast-forward，是新鲜合并的正确路径。021 的 branchMerged 语义假设「合并已被尝试过」，与新鲜执行的前置状态不兼容。
consequences: |-
  task:run 单次成功执行不调用 recoverMerge；崩溃续跑（重入 task:run 时任务可能已 running + 部分合并）需上层状态检测 + 021 假设对齐，本任务未实现（单次 e2e 不触发），留作后续。task:review（TASK-027）的合并可复用同一 019+020 路径。021 在「合并已部分完成（如已 commitAuditResult 但未 ff）」的崩溃续跑下仍可能因 branchMerged 假设而重复审计提交——续跑幂等性需进一步设计（本任务范围外）。若 Orchestrator 认为：(1) 应统一经 recoverMerge——需先在 worktree 内提交产物（如让 Executor 或 task:run 在合并前 commit）使分支领先基线，方能经 branchMerged==false 走重合并，但会与 commitAuditResult 重复提交冲突；(2) 新鲜合并应另起独立入口——本任务以 019+020 直接组合已满足。本任务 13 项 e2e/单测覆盖：DryRun reviewing 不合并 / DryRun done(no_review) 合并回收 / 产物未通过 blocked / 依赖未完成拒绝 / 依赖产物刷新 source_files / 非 ready 拒绝 / 路径重叠拒绝启动 / 合并冲突 blocked+ISSUES / parseTestingCommands / runCli 退出码。
```

提议自 `TASK-026-cli-task-run.result.md`。task:run（值 import application StateOrchestrator/computeContextPack/refreshSourceFiles/rebaseAndFastForward/writebackGlobalDocs + 值 import core resolvePathScope/computeVerificationAllowlist + 值 import infra DryRunLocalExecutor/GitMergeAdapter/TaskDocRepository/WorktreeAdapter/GlobalDocRepository/buildStartupPrompt）作为 cli composition root 直接 wiring infra（ARCHITECTURE §4 允许 cli→infra/application/core，application 不得直接 import infra 不影响 cli）、无边界冲突；合并编排解释（新鲜合并走 019+020、021 留作崩溃续跑）是 §3.2 合并链路与 recoverMerge branchMerged 语义的合理落地，待 Orchestrator 确认。关联 ISS-014（fastForwardMain 工作区同步）。

---

## DEC-023 task:review 设计——Reviewer 注入式契约（复用 TASK-022 模式）+ LocalReviewer 兜底 + applyReview 经 cli 路由适配器 + 合并复用 019+020

```yaml
id: DEC-023
title: "task:review 设计——Reviewer 注入式契约（复用 TASK-022 模式）+ LocalReviewer 兜底 + applyReview 经 cli 路由适配器 + 合并复用 019+020"
status: proposed
scope: cli（task:review 审查编排）
created_from_task: TASK-027
decision: |-
  TASK-027 对 Readme §5.3/§15（审查映射）/§12（reviewer 可复用 TASK-022 契约、SDK 未就位本地兜底）/§3.2（合并）的审查编排作如下解释并落地：（1）审查引擎以注入式 `Reviewer` 契约承载（review(input)→ReviewOutcome，approved/rejected/needs-human-confirmation），复用 TASK-022 Executor 的「注入式句柄」模式；SDK 未就位（ISS-012）时默认 `LocalReviewer` 确定性产 approved 兜底（与 DryRunLocalExecutor 产 completed 同义，§12「避免阻塞」），真实 reviewer agent 待 SDK 选型后注入。（2）状态映射统一走 StateOrchestrator.applyReview（§15 四映射：approved→done / rejected→rejected / needs-human→blocked / skipped→产物校验三分）；applyReview 的 skipped 分支内部 readResult 需读 worktree 的 .result.md，而 task 状态权威在 main——经 cli 层 `reviewOrchestratorRepo(main, worktree)` 路由适配器组合双仓储（readTask/writeTask→main、readResult→worktree，ISS-009 路由细化）。（3）合并走 rebaseAndFastForward(019)+writebackGlobalDocs(020)（同 DEC-022，不调 recoverMerge）；approved→done 才合并，reviewing/rejected/blocked 一律不合并且保留 worktree（§8）。（4）审查结论写 main 仓库 .review.md（§5.3 与 .result.md 执行事实分离，不污染）。
rationale: |-
  Reviewer 与 Executor 同属「cli composition root 注入的执行引擎适配」（ARCHITECTURE §4：executor-contract 仅被 cli 依赖），故复用注入式句柄模式而非在 application 定义新端口（避免 application 感知 SDK）。applyReview 的 skipped 分支读 .result.md，而 .result.md 在 worktree（task:run 产物，尚未合并入 main）、task 状态权威在 main——单 TaskDocRepository（单 tasksDir）无法兼顾（ISS-009 细化），故在 cli 层组合双仓储做路由（application 层不感知，结构类型满足 TaskDocRepositoryPort）。LocalReviewer 默认 approved 系 §12「避免阻塞」的直接落地（needs-human/rejected 均阻塞，唯 approved 放行）。合并机械与 task:run 一致（DEC-022），021 仍仅作崩溃续跑——task:review 的 done 合并对 DryRun/未提交产物场景与 task:run 同构，recoverMerge 的 branchMerged 误判风险同样存在。
consequences: |-
  task:review 的审查能力当前依赖注入；默认 LocalReviewer 不做真实审查（ISS-016），生产须注入真实 Reviewer（SDK 就位后，ISS-012/DEC-019 延伸）。路由适配器为 cli 层组合，ISS-009 的「按 taskId 路由」在此细化为「按文档类型路由」（task→main / result→worktree），未来多 worktree 并行审查可沿用此模式。task-review.ts 与 task-run.ts 存在重复合并逻辑（3 私有助手就地重实现，ISS-015），建议后续抽取 cli 共享助手模块。合并机械复用 DEC-022，无新增合并入口。若 Orchestrator 认为：(1) Reviewer 契约应下沉 infrastructure（如 executor-contract 同级）——需扩 TASK-027 后续任务 allowed_paths，本任务以 cli 层契约交付不阻塞；(2) LocalReviewer 默认应更保守（如 needs-human）——与 §12「避免阻塞」冲突，需先改规格。本任务 13 项 e2e/单测覆盖：approved→done 合并 / rejected 保留 worktree / needs-human→blocked 保留 worktree / no_review skipped 产物校验双路径（done/blocked）/ 审查结论隔离（.review.md vs .result.md）/ 默认 LocalReviewer / 状态前置（非 reviewing 拒绝）/ worktree 缺失拒绝 / 合并冲突 blocked+ISSUES / runCli 退出码（成功 + 非零）。
```

提议自 `TASK-027-cli-task-review.result.md`。task:review（值 import application StateOrchestrator/rebaseAndFastForward/writebackGlobalDocs + type-only import application ports + 值 import core 无 + 值 import infra GitMergeAdapter/TaskDocRepository + 跨命令 import task-run.ts 导出助手 createFsGlobalDocRepo/sequentialIdAllocator）作为 cli composition root 直接 wiring infra（ARCHITECTURE §4 允许 cli→infra/application/core）、无边界冲突；审查编排解释（Reviewer 注入式契约复用 TASK-022 + applyReview 路由适配器 + 合并复用 019+020）是 §5.3/§15/§12/§3.2 的合理落地，待 Orchestrator 确认。关联 ISS-015（重复合并逻辑）/ ISS-016（LocalReviewer 默认 approved）/ DEC-022（合并机械复用）。

---

## DEC-024 MCP 适配器骨架设计——transport 判别联合 + 零 core 依赖 + 骨架恒抛错 + 配置加载接受 raw

```yaml
id: DEC-024
title: "MCP 适配器骨架设计——transport 判别联合 + 零 core 依赖 + 骨架恒抛错 + 配置加载接受 raw"
status: proposed
scope: infrastructure（mcp-adapter 骨架）
created_from_task: TASK-028
decision: |-
  TASK-028 对 Readme §3.1（MCP 工具扩展职责边界：接入外部工具能力，不承载核心工作流领域逻辑）/任务 §2/§7/§8/§12 的 MCP 适配骨架作如下解释并落地：（1）`McpServerConfigSchema` 用 `z.discriminatedUnion('transport', stdio/http/sse)` 表达 transport 判别联合（stdio 含 command 必填 + args/env 默认 [] / {}，http/sse 含 url），类型安全且 TS 可正确收窄，避免 flat 可选字段无法区分 stdio 的 command 与 http 的 url。（2）`register(name, config)` 把注册名与 transport 配置分离（name 是注册表 key、config 不含 name），配置条目 `McpServerEntry = {name, config}` 嵌套结构避免 flat intersection 与判别联合的解析歧义；同名覆盖更新（便于配置重载）。（3）骨架阶段 `callTool(server, tool, args)` 恒抛错——未注册抛 McpServerNotRegisteredError（含已注册清单）、已注册抛 McpServerNotConfiguredError（连接未实现），声明为 async 匹配真实 MCP 调用契约，不伪造 McpToolResult（呼应 TASK-022 DryRun 哲学）。（4）错误体系 McpAdapterError（base）+ 两子类，复用 TASK-022 ExecutorError 模式。（5）`createMcpAdapterFromConfig(raw)` 只做「Zod 校验 + 构造」、不读文件 / 不绑定路径（init 尚无 MCP 配置文件，§12 避免过度设计）。（6）MCP 配置 schema 就近用 zod 定义在 infrastructure/mcp，不污染 core（§3.1 MCP 属 infra 关注点，且本任务 forbidden core），实现零 core 依赖。
rationale: |-
  判别联合是表达「不同 transport 有不同连接参数」的正确抽象（stdio 需 command/args/env、http/sse 需 url），且本仓库 Core Schema 一贯追求精度（task-schema/result-schema 等），flat 可选字段会让 TS 无法区分 stdio 与 http 的专属字段、收窄失效。name 与 config 分离让注册表 key 与 server 配置解耦，便于别名 / 重载；嵌套 entry（{name, config}）比 flat intersection 更稳健（判别联合 + intersection 在 Zod 解析层有歧义风险）。骨架恒抛错遵循 §7「具体 server 实现留空并抛『未配置』错误」且不伪造（与 TASK-022 不伪造 SDK 调用同源）。配置加载只接受 raw 对象而非文件，避免为不存在的配置文件格式过度设计（init 未生成 MCP 配置文件，R5 无 server 清单）。零 core 依赖是 forbidden_paths 的自然结果且最干净——MCP 配置 schema 是外部系统适配关注点（§3.1），不必上升为领域模型。
consequences: |-
  骨架可直接用于「注册 + 列举 + 调用代理」联调与测试；真实 server 接入时需：实现具体 transport 连接（替换 callTool 抛错为真实调用，stdio 起子进程 / http/sse 建连）、`_args` 去前缀消费为调用参数、定义配置文件格式与 CLI wiring（读配置→createMcpAdapterFromConfig→注入调用方）。具体 MCP server 清单未定（SPEC R5），后续按需另立任务（浏览器/设计/项目管理等）。ISS-017 记录「配置文件格式与 init 衔接未落地」留待后续。本任务 34 项单测覆盖：schema 正反例（判别联合 transport / http url 格式 / 未知 transport / 默认值 / entry name 非空）+ 注册/注销/列举（插入序 / 同名覆盖 / 空 name 拒绝 / list 不泄露 env）+ callTool 骨架（未注册 / 已注册未实现两路径 / 错误信息含名 / 错误类继承）+ 配置加载（合法 / mcp_servers 缺失默认 / 非法 entry / 非数组）+ 端到端。详见 ISS-017。
```

提议自 `TASK-028-infra-mcp-adapter-skeleton.result.md`。MCP 适配器骨架（仅依赖既有 zod，零反向依赖——不 import core/application/cli，MCP 配置 schema 属 infra 关注点就近定义；不依赖具体 MCP server SDK，SPEC 无 server 清单 R5）作为 infrastructure 适配层骨架、无边界冲突；设计解释（transport 判别联合 + 注册表 name/config 分离 + 骨架恒抛错不伪造 + 配置加载接受 raw 不绑定文件 + 零 core 依赖）是 §3.1/§7/§8/§12 的合理落地，待 Orchestrator 确认。关联 ISS-017（配置文件格式与 init 衔接未落地）/ DEC-019（TASK-022 注入式句柄 + DryRun 不伪造哲学，本骨架 callTool 恒抛错同源）。

## DEC-025 规划用例纯逻辑校验——application 不读文件，文件存在性 / 审查状态作显式输入

```yaml
id: DEC-025
title: "规划用例纯逻辑校验——application 不读文件，文件存在性 / 审查状态作显式输入"
status: proposed
scope: application（planning-workflow 前置校验）
created_from_task: TASK-029
decision: |-
  TASK-029 的 validatePlanningInputs 接收显式布尔输入（specExists / architectureExists / specReviewed / architectureReviewed + 可选 sourceSpec），application 层不读文件、不做 I/O。文件存在性与「已审查」状态由 CLI composition root（TASK-024 plan 命令）判定后传入。返回 PlanningValidationResult 判别联合三态：standard（SPEC + ARCHITECTURE 均存在且已审查）/ bootstrap（自举 source_spec 替代 + needsHumanConfirmation 固定 true）/ failed（missing 清单）；标准模式优先（即便同时声明 source_spec，只要 SPEC + ARCHITECTURE 审查通过就走标准）；空白 sourceSpec 视为未声明。
rationale: |-
  application 层定位是「产出领域模型」（ARCHITECTURE §3），文件 I/O 与存在性判定属 CLI / infra 职责。任务 §7「不写文件」精神延伸至读：规划前置校验的「文件存在 / 已审查」更适合 CLI 直接判定后传布尔，避免为前置校验在 ports 引入新的 fs 接口（现有 ports 面向任务 / 全局文档读写，不含通用「文件存在性」探测）。判别联合（standard/bootstrap/failed，非抛错）让调用方据 failed.missing 把缺失项展示给人工，不静默。标准优先符合 §6「目标项目通过 docs/SPEC.md + docs/ARCHITECTURE.md 承载长期协议」——自举例外（§6 / §11）只用于新系统实现本工作流自身。自举 needsHumanConfirmation 固定 true 落实 §11 验收「自举 source_spec 输入可通过，但必须返回需要人工 / Reviewer 确认的标记」。
consequences: |-
  TASK-024 plan 命令须在 CLI 层判定文件存在 + 审查状态后传布尔——需定义「已审查」机器化判据（见 ISS-018：可选显式标志 / 检查 ISSUES 无 SPEC|ARCHITECTURE open 项 / 检查 DECISIONS 审查记录）。本用例可在纯单元测试中覆盖三态（无需临时目录 / 文件夹具，与 context-pack-generator / scheduler 同为纯计算）。validatePlanningInputs 不依赖任何 port，零 I/O 副作用，零反向依赖（仅 import core 类型）。关联 DEC-026 / DEC-027（同任务另两设计）/ ISS-018（审查判据待定）。
```

提议自 `TASK-029-app-planning-workflow.result.md`。规划前置校验作纯逻辑（显式布尔输入、判别联合输出）是 application 层「只产领域模型」定位的合理落地，无边界冲突；standard / bootstrap / failed 三态 + 标准优先 + 自举 needsHumanConfirmation 落实 §6 / §11 与任务 §7 / §11 验收。待 Orchestrator 确认。关联 ISS-018（specReviewed 判定来源待 TASK-024 定义）。

## DEC-026 createTaskDrafts 的 source_files 预填 + context_pack 双层存储

```yaml
id: DEC-026
title: "createTaskDrafts 的 source_files 预填 + context_pack 双层存储"
status: proposed
scope: application（planning-workflow 任务草案）
created_from_task: TASK-029
decision: |-
  TASK-029 的 createTaskDrafts 对 source_files 采用预填规则（Readme §8）：TaskDraftSpec.source_files 显式提供则用之，否则按 depends_on 各依赖任务（同一批 drafts）的 allowed_paths 并集预填（依赖指向集合外任务时跳过，存在性校验归 validateTaskGraph）。context_pack 双层存储：（1）frontmatter.context_pack 存「裁剪声明」——required_docs / optional_doc_excerpts 来自 spec + 预填 source_files，不含必读核心（AGENTS / ARCHITECTURE / PROGRESS）与当前任务文件；（2）TaskDraftResult.contextPack 存 computeContextPack 产出的「完整注入清单」——必读核心 ∪ 当前任务文件 ∪ 声明。所有任务 status 固定 draft（任务 §8：任务拆分必须先生成 draft，不得直接 ready），经 TaskFrontmatterSchema.parse 校验（任务 §11 验收「通过 Schema」）。
rationale: |-
  §8 明文「拆分阶段依赖尚未执行，先按依赖任务的 allowed_paths 预填 source_files；任务转入 running 前若依赖已完成，Orchestrator 用实际 .result.md 清单刷新该字段」——故默认按依赖 allowed_paths 并集预填；spec.source_files 显式提供时尊重调用方精确控制（如纯计算任务无写路径但需读特定源码，或调用方已知更精确范围）。双层存储符合 context-pack-generator 设计（CORE_REQUIRED_DOCS 是运行时下限、frontmatter 省略也补齐）+ §8「当前任务文件是 Context Pack 入口载体、本身不计入 required_docs 数组」——故 frontmatter 不存任务文件 / 必读核心；而 TaskDraftResult.contextPack 调 computeContextPack 产出完整清单，供调用方预览实际注入范围，同时落实任务 §2「调用 computeContextPack 生成初始 context_pack」。frontmatter 裁剪声明也与现有项目任务文件一致（required_docs 仅 AGENTS / ARCHITECTURE / PROGRESS，不含任务文件）。
consequences: |-
  TASK-024 落盘任务文件时写 frontmatter（裁剪声明）；TaskDraftResult.contextPack 供 CLI 预览 / 日志，不落盘。后续 ready→running 时 refreshSourceFiles 读 frontmatter.context_pack.source_files（预填值）用依赖 .result.md 实际产物替换，链路自洽（computeContextPack 内部 refreshSourceFiles 对空 dependencyResults 保留预填）。非法 result_file（不以 .result.md 结尾）在 computeContextPack 阶段抛错（computeContextPack 内 taskFilePath 校验 §9 约定），重复 id 抛错。关联 DEC-012（result_file→任务文件路径派生）/ DEC-025（同任务前置校验）/ DEC-027（同任务图校验）。
```

提议自 `TASK-029-app-planning-workflow.result.md`。source_files 按依赖 allowed_paths 预填是 §8 的直接落地；context_pack 双层存储（frontmatter 裁剪声明 + TaskDraftResult 完整清单）兼顾 §8「任务文件不计入 required_docs」与任务 §2「调用 computeContextPack」，无边界冲突。待 Orchestrator 确认。关联 DEC-012（context-pack-generator result_file 派生）/ ISS-018。

## DEC-027 validateTaskGraph 完全复用 scheduler 公开 API 检测环与路径冲突，零重复私有逻辑

```yaml
id: DEC-027
title: "validateTaskGraph 完全复用 scheduler 公开 API 检测环与路径冲突，零重复私有逻辑"
status: proposed
scope: application（planning-workflow 任务图校验）
created_from_task: TASK-029
decision: |-
  TASK-029 的 validateTaskGraph 完全复用已有公开 API，不重新实现 scheduler 私有路径判定逻辑。依赖环检测：scheduler.topologicalOrder（遇环抛错 → hasCycle:true）+ core detectDependencyCycle 取闭合环路径（诊断用）。allowed_paths 路径冲突检测：scheduler.detectParallelizable——对每对「互无依赖」任务 (A,B) 单独喂 detectParallelizable([A,B])，返回两单元素批次 [[A],[B]] 即判冲突（单批次 [[A,B]] = 可并行）。重复 id 先单独检测（避免 topologicalOrder 内 assertUniqueIds 抛错被误判为「依赖环」）。TaskGraphValidationResult.ok = 无重复 id 且无依赖环；路径冲突为 warning 不阻断规划（§3.2 默认串行，冲突只影响并行度）。detectPathConflicts 对同 id 对与有依赖关系对（A→B 或 B→A）跳过——前者已由 duplicateIds 报告，后者本就串行不计路径冲突。
rationale: |-
  任务 §2「复用调度器检测依赖环和 allowed_paths 并行冲突」字面要求复用 scheduler。scheduler 的 pathsOverlap / literalPrefix / normalizePath / isAncestorOrSame / GLOB_CHARS 为模块私有未导出，本任务 allowed_paths 不含 scheduler.ts（无法改其导出），重新实现这 ~50 行路径判定属复制粘贴（违反 AGENTS §3，且会产生 ISS-015 类技术债）。通过对每对无依赖任务单独喂 detectParallelizable([A,B])，用其「单批次 = 可并行 / 两单元素批次 = 路径冲突」语义反推冲突对，零重复 scheduler 私有逻辑，判定一致性天然保证（同一公开函数）。代价是 O(n²) 次 detectParallelizable 调用（每次内部建图），但规划期一次性校验、任务数有限（本项目 29 个，通常项目数十量级），完全可接受。环路径用 core detectDependencyCycle（返回闭合路径，比 topologicalOrder 的抛错形态更具诊断价值，且 detectDependencyCycle 不抛错、返回结构化结果，适合校验场景）；hasCycle 用 topologicalOrder catch 满足 §2「复用调度器」字面。重复 id 先检测避免 topologicalOrder 内 assertUniqueIds 抛错被误判为环（两种「图不合法」原因分开报告）。
consequences: |-
  validateTaskGraph 零路径判定重复逻辑（规避 ISS-015 类技术债）；路径冲突检测不暴露具体重叠路径对（PathConflict 仅 taskA / taskB），调用方可自行查两任务 allowed_paths 定位重叠。detectPathConflicts 对同 id 对跳过（避免 detectParallelizable 内 assertUniqueIds 抛错）。大任务集（数百）下 O(n²) detectParallelizable 可能有性能开销，届时可优化为单次全图 detectParallelizable + 层内配对（当前不做，避免过度设计）。关联 DEC-013（scheduler 路径重叠保守判定）/ DEC-025 / DEC-026（同任务）。
```

提议自 `TASK-029-app-planning-workflow.result.md`。validateTaskGraph 完全复用 scheduler（topologicalOrder / detectParallelizable）+ core（detectDependencyCycle）公开 API、零重复私有路径逻辑，是任务 §2「复用调度器」与 AGENTS §3「不复制粘贴」的兼顾落地，无边界冲突。待 Orchestrator 确认。关联 DEC-013（scheduler 路径重叠保守判定，本任务路径冲突复用其 detectParallelizable 分组语义）。

---

## DEC-028 plan / task:create CLI 命令设计——计划定义经 --from 配置文件、ISS-018 用 --reviewed 标志、task-create 拥有共享 writeTaskFile/buildTaskBody/slugify、先校验任务图后写盘、task:create 拒绝覆盖

```yaml
id: DEC-028
title: "plan / task:create CLI 命令设计——计划定义经 --from 配置文件、ISS-018 用 --reviewed 标志、task-create 拥有共享 writeTaskFile/buildTaskBody/slugify、先校验任务图后写盘、task:create 拒绝覆盖"
status: proposed
scope: cli/commands/plan.ts + task-create.ts
created_from_task: TASK-024
decision: |-
  plan 命令经 `--from <YAML/JSON>` 接受显式计划定义（title+phases+tasks），`parsePlanDefinition(raw)` 经本地 `PlanDefinitionSchema`（任务子 schema 复用 core TaskIdSchema/LayerSchema/PermissionSchema）校验后交 TASK-029 PlanningWorkflow（不在 CLI 实现智能拆分，§7/§12）。ISS-018「已审查」机器判据采用显式 `--reviewed` 布尔标志传入 validatePlanningInputs（standard 模式硬性前置，未携带且无 sourceSpec → 拒绝生成）。planProject 顺序：判 SPEC/ARCHITECTURE 存在 → validatePlanningInputs → createPlanDraft（模型）→ createTaskDrafts（模型）→ validateTaskGraph（先校验后写盘——依赖环/重复 id 抛错、路径冲突 warning）→ 落盘 PLAN.md + 任务文件。task-create.ts 拥有共享 `writeTaskFile(tasksDir, draft)`（serializeDocument + §9 十三节正文模板）/ `buildTaskBody` / `slugify`，plan.ts 跨命令 import 复用（延续 ISS-015）；`taskFileFromResult` 就地重实现（task-run.ts 私有未导出）。task:create 拒绝覆盖既有任务文件（创建已存在任务几乎总是 id 冲突误操作）；slug 从 title 派生或 `--slug` 显式提供，纯中文标题派生空时要求显式 --slug。
rationale: |-
  §7 明令不在 CLI 实现智能拆分、§12 限本任务为可一次闭环骨架，故计划定义显式提供而非模型生成（智能拆分留独立后续任务）；ISS-018 要求机器化「已审查」判据，--reviewed 标志最明确（AGENTS §3 显式能力声明，不依赖启发式 / 不读 ISSUES-DECISIONS 推断审查状态，避免误判）；共享 writeTaskFile 落 task-create 因「新建任务文件 + 正文模板」是 task:create 的天然职责、plan 批量复用顺理成章，避免重复 §9 正文模板；先校验任务图后写盘避免依赖环/重复 id 留下半成品任务文件污染 docs/tasks（planProject 抛错时 docs/tasks 不被触碰）；task:create 拒绝覆盖因创建已存在任务几乎总是 id 冲突误操作，静默覆盖会丢失既有任务定义。
consequences: |-
  智能拆分（SPEC/ARCHITECTURE → 任务草案）仍需独立后续任务（§7/§12，当前以显式配置文件闭环骨架交付）；taskFileFromResult 三处重实现（task-run / task-create）待 ISS-015 提议的 cli 共享助手模块（如 src/cli/shared/）收口；--reviewed 标志为 standard 模式硬性前置，未携带且无 sourceSpec 时 plan 拒绝生成（ISS-018 落地）；task:create 不覆盖既有文件，重生成任务须经 plan 命令或先删除既有文件。关联 DEC-020（CLI 命令名 caw + 退出码约定）/ DEC-025/026/027（TASK-029 PlanningWorkflow）/ ISS-015（cli 共享助手）/ ISS-018（resolved）/ ISS-013（resolved）。
```

提议自 `TASK-024-cli-plan-and-task-create.result.md`。plan / task:create 命令设计为「显式计划定义 + PlanningWorkflow 校验 + 先校验后写盘」的可一次闭环骨架，ISS-018 以 --reviewed 标志落地、ISS-013 随 CLI 命令任务全部完成而 resolved。沿用 DEC-020 CLI 退出码约定与 framework.ts 注册模式。待 Orchestrator 确认。

## DEC-029 Claude Agent SDK 真实接入——扩权立项 + Provider Profile 多 provider（env 注入）+ 6 任务拆分

```yaml
id: DEC-029
title: "Claude Agent SDK 真实接入——扩权立项 + Provider Profile 多 provider（env 注入）+ 6 任务拆分"
status: proposed
scope: docs/SPEC_claude-sdk-integration.md + docs/PLAN_claude-sdk-integration.md + docs/tasks/TASK-030~035
created_from_task: PLAN_claude-sdk-integration（规划产出）
decision: |-
  基于 SPEC_claude-sdk-integration（2026-07-10 访谈 + §12 字段名校准）把 TASK-022 的 ClaudeSdkInvocation 骨架落地为真实 @anthropic-ai/claude-agent-sdk 调用。三条关键决策：(1) 扩权独立成 TASK-030——新增 SDK 依赖违反 TASK-001 红线（PLAN_coding-agent-workflow §0-8），须显式立项、不在其他任务越权改 package.json。(2) 多 provider 接入（SPEC §6 提升为 P0）经 options.env 注入：第三方端点注入 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL + 三档 ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL 映射（Claude Code 内部按任务复杂度自动选档，三档必须全映射），官方走 ANTHROPIC_API_KEY；caw init 预置 anthropic + glm 两 profile；env 整体替换子进程环境须 ...process.env 展开。(3) provider 配置经 invocation/reviewer 实现类构造函数注入，SdkRunInput 契约不改（SPEC §3）。§12 字段名已对照官方类型参考校准：abortController（非 abortControllerSignal）、systemPrompt（非 customSystemPrompt/appendSystemPrompt，用 {type:'preset',preset:'claude_code',append}）、env / settingSources（默认 []，须显式 'project' 才加载 CLAUDE.md）/ maxThinkingTokens。拆 6 任务（030 sdk-client+扩权 / 031 provider-profile / 032 invocation 实现 / 033 reviewer / 034 task:run 接线 / 035 task:review 接线+CI），030/031 可并行，core/application 零改动，新增点全在 infrastructure/sdk + cli。
rationale: |-
  SPEC §0 F1-F5 哲学（自主执行 / 全 JSON 产 frontmatter / 纯软约束不挂 canUseTool / 无硬上限 / 软件只做可见性+校验+容错）贯穿；扩权独立因红线要求显式、不可藏在实现任务里；env 注入是接入第三方 Anthropic 兼容端点的唯一手段（options.model 只换模型 id 不换端点），经用户 GLM 接入示例验证；构造注入 provider 配置避免改 SdkRunInput 契约（SPEC §3 锁定）；§12 校准消除原 TASK-022「待 SDK 确认」的 R1 风险，字段名落地为可编码级。
consequences: |-
  TASK-030~035 为 v0.2.0 阶段，推进 ISS-012（SDK 就位）/ ISS-016（真实 Reviewer，解除 LocalReviewer 自动放行）；PROGRESS 恢复 status: active。provider 配置文件（.caw/config.json）schema 为最小定义，正式 schema 化校验留 P1。deepseek profile / SDK mock / cost 累计告警为 P1 不在本 PLAN。关联 DEC-019（TASK-022 SDK 适配器接口隔离）/ ISS-012 / ISS-016。
```

提议自 `PLAN_claude-sdk-integration`（规划产出）。把 TASK-022 的 SDK 适配器骨架落地为真实执行引擎，多 provider 接入（env 注入）为 P0 核心、扩权独立立项。SPEC §12 字段名已对照官方类型参考校准。待 Orchestrator 确认。

## DEC-030 扩权新增 Claude Agent SDK 依赖 + zod peer 冲突处理

```yaml
id: DEC-030
title: "扩权新增 @anthropic-ai/claude-agent-sdk 依赖 + zod peer 冲突处理（--legacy-peer-deps + 显式声明 peer + zod 保持 3.x）"
status: proposed
scope: package.json + infrastructure/sdk
created_from_task: TASK-030
decision: |-
  TASK-030 扩权新增 `@anthropic-ai/claude-agent-sdk@^0.3.206`（PLAN §0-2 扩权独立立项、SPEC §13.2）。安装时发现 SDK 把 zod / @anthropic-ai/sdk / @modelcontextprotocol/sdk 全外部化为 peerDependencies（dependencies 为空），其中 zod peer 要 ^4.0.0 与项目锁定 zod ^3.23.8（实际 3.25.76）冲突；SDK 0.3.206 为唯一版本（无兼容 zod 3 的旧版）。处置决策：(1) zod 保持 ^3.23.8 不升级——升级 zod 4 是破坏性变更，波及全项目 core/application/infrastructure 的 zod 代码（core/schemas 的 z.string().datetime()/z.discriminatedUnion 等），远超 TASK-030 allowed_paths 边界，须独立任务（ISS-019）；(2) 以 `npm install --legacy-peer-deps` 绕过 peer 检查装 SDK——zod 3.25.76 是 zod 3→4 过渡版（@anthropic-ai/sdk peerOptional `^3.25.0 || ^4.0.0` 印证兼容意图），实测 typecheck 0 错误 + 全量 692 项测试全绿，证明 SDK .d.ts 在 zod 3.25.76 下完全可用；(3) 显式声明 SDK 的 2 个 peer（@anthropic-ai/sdk@^0.110.0、@modelcontextprotocol/sdk@^1.29.0）入 package.json dependencies——SDK 把它们外部化为 peer，消费者须自行声明以保证可重现（fresh install 不带 --legacy-peer-deps 时，peer 缺失/冲突仍报错，故安装约束持久，见 ISS-019）。沿用 DEC-029 扩权立项结论落地。
rationale: |-
  扩权是 PLAN §0-2 / SPEC §16 显式立项（TASK-001 红线），本任务即承担。zod 不升级：(a) 升级波及面远超 TASK-030 边界（forbidden_paths 含 src/core/application，core/schemas 大量 zod 代码可能需适配）；(b) 3.25.76 经实测兼容 SDK（typecheck + 全量测试全绿），无需升级即可工作；(c) zod 4 升级应作为独立任务充分评估（ISS-019）。--legacy-peer-deps：npm 标准安装选项（非代码 hack），在 AGENTS §3「不引入临时 patch」语境下属可接受的安装约束（非隐藏兼容逻辑，已在 ISS-019/DECISIONS 显式记录 + SPEC/任务约束可追溯）。显式声明 peer：SDK 设计要求消费者提供 peer，声明入 dependencies 保证 package.json 完整可重现（package-lock 已记录）。安装约束（须 --legacy-peer-deps）持久——.npmrc 不在本任务 allowed，留 ISS-019 提议 Orchestrator 加 .npmrc 或立 zod 4 任务。
consequences: |-
  package.json dependencies 现 7 项（+SDK +2 peer，zod 不变）。安装命令须 `npm install --legacy-peer-deps`（持久约束，ISS-019）：fresh checkout / CI 须同样方式。后续 SDK 升级若 peer 放宽 zod 要求或 SDK 出兼容 zod 3 的版本，可去除 --legacy-peer-deps。zod 4 升级（若 Orchestrator 采纳）须独立任务全量适配 core/application/infrastructure zod 代码后，改用正经 `npm install`（无 flag）。关联 DEC-029（PLAN 立项）/ DEC-031（sdk-client 设计 + R-API）/ ISS-019（zod peer 冲突）/ ISS-020（传递依赖漏洞）。
```

提议自 `TASK-030-infra-sdk-dependency-and-client.result.md`。扩权新增 SDK 依赖遇 zod peer 冲突（SDK 要 ^4、项目 ^3），以 --legacy-peer-deps + 显式声明 peer + zod 保持 3.x（过渡版兼容）解决，经实测 typecheck + 全量测试全绿。不升级 zod 因波及面超本任务边界（独立任务 ISS-019）。沿用 DEC-029 扩权立项。待 Orchestrator 确认。

## DEC-031 sdk-client 会话工厂设计 + §12 字段对照安装版 .d.ts 校准

```yaml
id: DEC-031
title: "sdk-client 会话工厂设计——query 注入 + 流式 + abort + cost 采集 + §12 字段对照安装版 .d.ts 校准（R-API 差异回写 SPEC）"
status: proposed
scope: infrastructure/sdk/sdk-client.ts
created_from_task: TASK-030
decision: |-
  sdk-client 集中 query() 装配 + 流式消费 + abort + cost/usage 采集为可复用工厂（SPEC §13.1），供 032/033 复用。设计五要点：(1) 注入式 query 句柄 SdkQueryFn——把真实 SDK query 隔离为可替换注入点（承接 DEC-019 哲学），runSdkSession 默认 defaultSdkQuery（真实 SDK），测试注入 fake query 流零真实 API（SPEC §11）；(2) buildSdkOptions 按 §12 装配——全部字段名对照安装版 0.3.206 .d.ts 校准通过（abortController/cwd/env/model/permissionMode/systemPrompt(preset+append)/settingSources/includePartialMessages/stderr），不传 canUseTool(F3)/maxTurns(F4)/resume·continue·forkSession(§2.2)；(3) §12 R-API 三处差异已回写 SPEC §12——(a) permissionMode 'bypassPermissions' 必须同时 allowDangerouslySkipPermissions:true（.d.ts 1695/1707-1711 硬性要求，§12 原未列），(b) SDKResultError.subtype 扩展 error_max_budget_usd/error_max_structured_output_retries（§12 原只列 3 个），sdk-client 把 subtype 当 string 透传不穷举枚举，(c) SDKMessage 联合成员大幅扩展（0.3.206 含 status/auth_status/task_*/hook_*/rate_limit_event 等数十种），sdk-client 只对 §12 列举的 type(system-init/assistant/user/stream_event/result/compact_boundary) 关注、其余经 onMessage 透传不阻断；(4) collectResult 纯结构化采集（subtype/cost/usage/turns/duration/isError/resultText + raw resultMessage），不判 executionStatus（归 032 据 subtype+is_error+JSON 综合判定）；(5) abort 不捕获——abortController.abort() 后 SDK 经流抛 AbortError 向上传播，调用方（032）catch 据此产降级 result（§9 保留 worktree）。sdk-client 不 import core（输入输出均 SDK/基础类型），不承载领域逻辑（JSON 提取/重试/降级归 032）。
rationale: |-
  集中工厂避免 032/033 两处重复装配 query/流式/cost（SPEC §13.1 明列 sdk-client 为可选复用件）。注入式 query 承接 DEC-019（编排与 SDK API 解耦、测试 fake），runSdkSession 默认真实 query 开箱即用、测试 fake 覆盖编排逻辑。§12 R-API 回写：SPEC §12「校准来源」明言「实现时仍以安装版 .d.ts 为最终准绳（R-API），差异回写本节」——本任务实证三处差异并回写，使 §12 与安装版 0.3.206 一致（bypassPermissions 的 allowDangerouslySkipPermissions 是阻塞性差异，不设 SDK 拒绝）。subtype 当 string 透传：避免穷举枚举与 SDK 版本耦合（subtype 随版本扩展），sdk-client 只采集不解释。abort 不捕获：§9 要求调用方据中断产降级 result，sdk-client 传播 AbortError 让调用方决策（容错分类归 032）。不判 executionStatus：sdk-client 是通用会话工厂（execution + review 共用），executionStatus 判定含领域语义（结合 JSON 产出）归 032。
consequences: |-
  SPEC §12 已据本任务 R-API 差异回写（bypassPermissions+allowDangerouslySkipPermissions、subtype 扩展、SDKMessage 联合扩展说明）。sdk-client 为 032/033 共用入口，两者只组装 SdkSessionInput + 处理 SdkSessionReport/异常。SDK 升级时须重新对照 .d.ts 校准（§12 R-API 持续约束），重点核 allowDangerouslySkipPermissions 是否仍需、subtype/SDKMessage 是否再扩展。defaultSdkQuery 经 value import query 加载真实 SDK（模块加载即 import，纯 JS 无 native 依赖，安全）。关联 DEC-019（注入式句柄）/ DEC-029（PLAN 立项 §12 校准）/ DEC-030（扩权）/ ISS-012（SDK 就位——包已装，真实调用留 032/035）。
```

提议自 `TASK-030-infra-sdk-dependency-and-client.result.md`。sdk-client 作 SDK 会话工厂供 032/033 复用，§12 字段对照安装版 0.3.206 .d.ts 校准并回写三处 R-API 差异（bypassPermissions 须 allowDangerouslySkipPermissions / subtype 扩展 / SDKMessage 联合扩展）。沿用 DEC-019 注入式句柄哲学。待 Orchestrator 确认。
