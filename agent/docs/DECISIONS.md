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
