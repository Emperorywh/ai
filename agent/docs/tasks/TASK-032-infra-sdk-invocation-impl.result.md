---
task_id: TASK-032
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts
  - docs/tasks/TASK-032-infra-sdk-invocation-impl.result.md
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/sdk/claude-sdk-invocation-impl
    result: passed
    notes: "30 项全过（classifyFault 6 / extractResultJson 6 / Impl 正常产出与入参装配 3 / JSON 重试 §4.3 含耗尽降级 5 / 容错分类 §8 鉴权/网络退避/unknown 3 / §9 中断 2 / is_error 1 / §7 回调透传 1 / 降级 verification 一致性 1 / report 形态契约 1 + name 1）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test
    result: passed
    notes: "全量 754 项无回归（原 724 + invocation-impl 30）。Node v22.23.1（ABI 127，满足 ISS-005）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-032（ClaudeSdkInvocation 真实实现）已完成：`src/infrastructure/sdk/claude-sdk-invocation-impl.ts`（infrastructure/sdk）提供 `ClaudeSdkInvocation` 接口（TASK-022）的真实实现类 `ClaudeSdkInvocationImpl`——构造注入 provider 配置（env/model，TASK-031 组装产物，SdkRunInput 契约不改）+ 可观测回调（onMessage/stderr，§7，CLI 034 注入）+ 测试注入点（runSession/sleep/random）；`run(SdkRunInput) → SdkRunReport` 经 sdk-client（030）`runSdkSession` 跑一次自主 query → 提取模型末尾 ```result-frontmatter fenced 块 JSON（§4.2，优先该标记缺则回退 ```json、取最后一块）→ `SdkResultJsonSchema.safeParse`（camelCase 模型产出形态，§4.2 SdkRunReport 对齐；SPEC 张力见 DEC-033）→ JSON 重试降级（§4.3，parse 失败带反馈重试 N=2 次、耗尽降级 failed+needs-human + verification skipped + issues 记 parse 错）→ 容错分类（§8，`classifyFault` 把 SDK 抛错分 abort/auth/network/unknown：abort/auth 立即降级不重试、network 指数退避重试 max 3 耗尽降级、unknown 显式降级不静默、is_error 会话非瞬时降级）→ 中断（§9，abortController 跨重试共享、SIGINT abort 捕获 AbortError 产 blocked+needs-human 降级、保留 worktree 不回滚）→ 成功映射 SdkRunReport 补 cost 摘要行。`ClaudeSdkExecutor` 编排逻辑（claude-sdk-adapter.ts:248）不变，只消费 SdkRunReport（任务 §7）。30 项单测（fake sessionQueue 队列 + recordingSleep + 零抖动 random，零真实 API）。SPEC §4.2 camelCase 模型 JSON vs 任务 §2/§4.3「ResultFrontmatterSchema.safeParse」(snake_case) 张力据 §4.2 显式示例裁定为 camelCase 专属 schema（executor 已负责 SdkRunReport→ResultFrontmatter snake_case 映射），回写 SPEC §4.3（DEC-033）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- ClaudeSdkInvocation 真实实现：`ClaudeSdkInvocationImpl`（`src/infrastructure/sdk/claude-sdk-invocation-impl.ts`）实现 TASK-022 定义的注入式 SDK 调用句柄接口，把「依赖具体 SDK API 的调用 + 模型输出解析」落地为可注入测试的真实类（SPEC §4 / §8 / §9）。构造 `ClaudeSdkInvocationOptions`（providerEnv 必填 / model 可选 / runSession·sleep·random 测试注入点 / jsonRetryMax=2 / techRetryMax=3 / backoffBaseMs=1000 / abortController SIGINT / onMessage·stderr §7 观测）；`run(SdkRunInput)` 组装会话 prompt（§18 startupPrompt + Context Pack 文件清单 §4.6 + JSON 重试反馈）+ systemPromptAppend（§4.4 边界声明软约束 + §4.2 产出契约 result-frontmatter JSON 指令，稳定不随重试变）→ 默认经 sdk-client runSdkSession 跑自主 query → JSON 提取重试降级 + 容错分类 + 中断处理 → SdkRunReport。导出纯函数 `classifyFault(error): abort|auth|network|unknown`（§8 显式启发式分类，HTTP 状态码 \\bNNN\\b 独立数字匹配避免误吞）+ `extractResultJson(resultText): ExtractResult`（§4.2 fenced 块提取判别联合）+ 类型 `FaultCategory`。provider 配置经构造注入（env/model 来自 TASK-031，SdkRunInput 契约不改），CLI 034 composition root 装配实例后注入 `ClaudeSdkExecutor(invocation)`（claude-sdk-adapter.ts 消费，编排不变）。纯 infrastructure：依赖 sdk-client（同层）+ core Schema（运行时校验 + 类型）+ claude-sdk-adapter/executor-contract 契约类型（同层，可 import 不可改），不反向依赖 application/cli、不 import provider-profile（env 由 034 组装传入）。SDK 真实 API 调用留 TASK-035 CI（本任务 fake sessionQueue 单测零真实 API）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/infrastructure/sdk/claude-sdk-invocation-impl.ts` 建立：依赖 `zod`（core 已用）+ core Schema（ExecutionStatusSchema/NextActionSchema/ResultVerificationSchema/GlobalUpdateRequestsSchema 运行时校验 + ContextPack/Issue/IssueSeverity 类型）+ 同层 sdk-client（runSdkSession + SdkSessionInput/Report 类型）+ 同层 claude-sdk-adapter（ClaudeSdkInvocation/SdkRunInput/SdkRunReport 契约类型，可 import 不可改），零反向依赖（不 import application/cli；不 import provider-profile，env 由 034 组装后经构造注入）。沿用「Zod schema 单一来源 + z.infer 派生 + 纯函数 + 判别联合」模式：`SdkResultJsonSchema`（camelCase 模型产出，复用 core 子 schema，modifiedFiles/createdFiles/deletedFiles/verification/globalUpdateRequests 给 default 容 R-JSON 漏报、executionStatus+nextAction 两核心硬性必填）；`classifyFault`（§8 启发式分类，message+name 文本匹配，全在函数内可审、非隐藏兼容）；`extractResultJson`（§4.2 fenced 块判别联合，优先 result-frontmatter 缺则 json、取最后一块）；prompt/append 装配纯函数（buildSessionPrompt/buildContextPackList/buildSystemPromptAppend/buildBoundaryDeclaration/buildParseFeedback）；降级 report 纯函数（degradedReport，统一 §4.3/§8/§9 降级形态：文件清单留空 + verification skipped 保留 allowlist 顺序 + 一条 issue 记故障）；mapToSdkRunReport（成功路径补 cost 摘要）。`ClaSdkInvocationImpl` 有界重试 for 循环（1 + jsonRetryMax + techRetryMax，避免 eslint no-constant-condition 的 while(true)，尾 return 类型安全兜底）。`noUncheckedIndexedAccess` 下 matchAll 结果 / behaviors[i] 显式判空守卫。abortController 跨重试共享 + 每轮前置 aborted 检查（中断后不重试）。`src/infrastructure/index.ts` 追加 `export * from './sdk/claude-sdk-invocation-impl.js'`。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- ClaudeSdkInvocation 复用要点（TASK-032）：`ClaudeSdkInvocationImpl`（`src/infrastructure/sdk/claude-sdk-invocation-impl.ts`）是 TASK-034（task:run 接线）的 executor 注入对象——034 在 composition root 用 `new ClaudeSdkExecutor(new ClaudeSdkInvocationImpl({ providerEnv, model, ... }))` 装配（providerEnv/model 经 `composeProviderEnv`/resolveProfile 从 TASK-031 组装），替换 task-run.ts 当前的默认 DryRunLocalExecutor。构造必填 `providerEnv: Record<string,string>`（TASK-031 buildProviderEnv 产物，SDK env 整体替换子进程环境），可选 `model`（profile modelMapping 档位值，省略用 SDK 默认）。§7 可观测：构造注入 `onMessage`（SDKMessage 流式回调，034 渲染终端 + 落日志）+ `stderr`（子进程 stderr 回调）透传到 sdk-client SdkSessionInput。§9 中断：构造注入 `abortController`（034 wire 进程 SIGINT → controller.abort()），invocation 跨重试共享、abort 后产 blocked+needs-human 降级 report 保留 worktree。`run(SdkRunInput)` 产 SdkRunReport 后 ClaudeSdkExecutor（编排不变）落 .result.md。**真实 API 调用经 sdk-client defaultSdkQuery（TASK-030），本任务单测全 fake（sessionQueue 队列 + recordingSleep），真实 API 契约断言留 TASK-035 CI**。容错分类 `classifyFault` 据 SDK 抛错的 name+message 文本启发式判定（§8，SDK 错误体系未全列 R-API），TASK-035 观测真实 API 错误后可按需细化匹配规则（ISS-022）。模型产出 JSON 字段为 camelCase（§4.2 SdkRunReport 形态），executor 落盘时转 snake_case ResultFrontmatter（claude-sdk-adapter.ts:259 不变）；SPEC §4.3「ResultFrontmatterSchema.safeParse」措辞据 §4.2 示例裁定为 camelCase 专属 schema（DEC-033，已回写 SPEC）。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-022（low，open）新增自 TASK-032：SDK 错误分类 `classifyFault` 采用 name+message 文本启发式匹配（abort/auth/network/unknown，§8）——SPEC §12/§8 未穷举 SDK 具体错误类与 code，且错误形态随 SDK 版本变动（R-API）。当前匹配规则覆盖常见 HTTP 状态码（401/403/429/5xx \\bNNN\\b 独立数字）+ 关键词（unauthor/forbidden/authentication/invalid key|token|credential / econn/etimedout/fetch failed/network/socket/timeout/rate limit / abort），但真实 API（尤其第三方 GLM/DeepSeek 端点）的错误消息措辞未经实证。**不阻塞验收**（§11 验收项为 fake 单测，分类逻辑经 fake 错误覆盖全绿；§8 容错分类是显式可审规则非隐藏兼容）。建议 TASK-035 CI 真实 API 跑通后观测实际错误消息，按需细化 classifyFault 匹配规则（或引入 SDK 错误类判别）。详见 ISS-022。\n- ISS-012（medium，open）进展：本任务实现真实 ClaudeSdkInvocation（执行侧），SDK 真实调用经 sdk-client defaultSdkSession 就绪，执行侧真实闭环待 TASK-034 接线 + TASK-035 CI 真实 API 契约断言；审查侧真实 Reviewer 仍留 TASK-033。既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017/019/020/021）与本任务无触发：invocation-impl 纯 infrastructure（不依赖 SQLite、不改状态机、不触发级联/合并），Node v22（ISS-005 约束满足）下全量 754 项绿。"
    - section: "建议下一个任务"
      mode: replace
      content: "- **TASK-033（SDK 版 Reviewer）** —— `PLAN_claude-sdk-integration` 第四个任务（layer: data，depends_on TASK-027✅/030✅/031✅ 全 done）。在 `src/infrastructure/sdk/claude-sdk-reviewer.ts` 实现 `ClaudeSdkReviewer`（Reviewer 契约独立于 TaskExecutor，§5）：内部起独立 SDK 会话（复用 sdk-client runSdkSession + provider-profile env），以 .result.md frontmatter + worktree 实际改动为审查对象，prompt 要求模型对照 §15 审查清单产出 JSON → `ReviewOutcome`（review_result: approved|rejected|needs-human-confirmation + required_changes + findings），JSON parse 重试 + 降级策略同 §4.3（耗尽降级 needs-human-confirmation 不伪造 approved，§5）。**TASK-033 与 TASK-032 互不依赖且可并行**（032 已完成；033 是审查侧 reviewer 实现，独立文件，复用同套 sdk-client + provider-profile 模式）。拓扑序后续：TASK-034（task:run 接线，depends_on 026✅/032✅ 全 done，已解锁）/ TASK-035（task:review 接线 + CI 真实 API，depends_on 027✅/033）——034 现已可启动（032 done），035 待 033 完成。推进 ISS-012（SDK 真实调用——034 接线 + 035 CI）/ ISS-016（真实 Reviewer——033）。v0.1.0 终态快照保留于上方各 section。tag/发版（当前 0.1.0/private:true）由人工决定。"
  decisions:
    - id: ""
      title: "ClaudeSdkInvocation 真实实现设计——构造注入 provider 配置 + §4.2 camelCase 模型 JSON 提取校验 + §4.3 JSON 重试降级 + §8 启发式容错分类 + §9 abortController 中断"
      status: proposed
      scope: src/infrastructure/sdk（claude-sdk-invocation-impl.ts）+ src/infrastructure/index.ts
      created_from_task: TASK-032
      decision: "claude-sdk-invocation-impl.ts 按 SPEC §4/§8/§9 落地 ClaudeSdkInvocation 真实类 ClaudeSdkInvocationImpl，ClaudeSdkExecutor 编排（claude-sdk-adapter.ts:248）不变。六项关键设计：(1) provider 配置经构造注入——env/model 来自 TASK-031 组装产物经构造函数注入（Cli 034 composition root 装配），SdkRunInput 契约不改（任务 §8 / PLAN §0-5）；本实现不 import provider-profile（env 已组装好直接用），保持 infrastructure 不依赖 cli/config。(2) 模型 JSON 校验用 camelCase 专属 schema SdkResultJsonSchema——SPEC 张力：§4.2 示例模型产出为 camelCase（executionStatus/modifiedFiles/...对齐 SdkRunReport），但任务 §2/§4.3 文字提「ResultFrontmatterSchema.safeParse」（snake_case），二者字段名不同直接 safeParse 必失败；据 §4.2 显式示例裁定为 camelCase schema（复用同一套 core 子 schema ExecutionStatusSchema/NextActionSchema/ResultVerificationSchema/GlobalUpdateRequestsSchema），snake_case 落盘映射由 executor 负责（claude-sdk-adapter.ts:259 不变）；modifiedFiles/createdFiles/deletedFiles/verification/globalUpdateRequests 给 default 容 R-JSON 漏报，executionStatus+nextAction 两核心硬性必填。(3) §4.2 提取规则——优先 ```result-frontmatter fenced 块（§4.2 指定标记），缺失回退 ```json，取最后一块（模型可能先示例块后真实块）；result-frontmatter 块存在但 JSON 非法直接报 json-parse 失败（不退求 json 块）交重试修正。(4) §4.3 JSON 重试降级——parse/校验失败把错误反馈追加进**重试会话 prompt**（新会话无对话历史 §2.2 不续跑，反馈须在初始 prompt），重试 N=2（首次+2 次），耗尽降级 failed+needs-human + verification 全 skipped（保留 allowlist 命令顺序）+ 一条 issue 记 parse 错（id 留空 Orchestrator 分配）。(5) §8 容错分类——classifyFault 按 SDK 抛错 name+message 文本启发式分 abort/auth/network/unknown：abort（AbortError/message abort，§9）→ blocked+needs-human 保留 worktree 不回滚；auth（401/403/unauthor/forbidden/invalid key|token|credential/authentication）→ 立即 failed 不重试；network（429/5xx/ECONN*/ETIMEDOUT/fetch failed/network/socket/timeout/rate limit）→ 指数退避重试 max 3（base 1s×2^n+半区间抖动）耗尽降级；unknown → 显式降级 failed+needs-human 不静默（错误摘要入 issues+summary）；is_error 会话（session 级错误非瞬时）→ 降级不重试。HTTP 状态码 \\bNNN\\b 独立数字匹配避免误吞更长数字串。(6) §9 中断——abortController 跨重试共享（CLI 034 注入并 wire SIGINT），每轮前置 signal.aborted 检查（中断后不重试），SDK 抛 AbortError 与正常返回 result 两种分支兼容（try/catch AbortError + 正常路径）。"
      rationale: "构造注入 provider 配置：SPEC §8/任务 §8 明文「provider 配置经构造函数注入，SdkRunInput 契约不改」，CLI 034 装配实例；invocation 不读配置文件保持纯 infra。camelCase schema 裁定：§4.2 示例（用户验证）显式给 camelCase 字段且明文「对齐 SdkRunReport」，与「ResultFrontmatterSchema.safeParse」(snake_case) 冲突时以更具体的 §4.2 示例为准——ResultFrontmatterSchema 校验的应是最终落盘的 snake_case frontmatter（executor 已在落盘前 persistResult 做此校验，claude-sdk-adapter.ts:65），invocation 只需校验模型原始 camelCase 产出。提取取最后一块：§4.2「最后一块 result-frontmatter」，模型可能先输出格式示例再产真实块。JSON 反馈进 prompt 而非 systemPromptAppend：新会话无历史（§2.2），反馈须在初始 prompt 模型才看见；systemPromptAppend 稳定（边界+产出契约不随重试变）。启发式容错分类：SPEC §12/§8 未穷举 SDK 错误类/code 且随版本变（R-API），name+message 文本匹配是显式可审规则（§8「运行时容错必须作为显式错误处理」AGENTS §3），全在 classifyFault 函数内可审、非隐藏兼容；真实 API 错误观测后可细化（ISS-022）。abortController 共享 + 前置检查：避免 abort 后继续重试；§9 两种结束分支兼容（SDK 版本行为差异）。降级 verification 全 skipped：§4.3 明文「verification 标 skipped」；保留 allowlist 命令顺序供 Orchestrator 审计。有界 for 循环：避免 eslint no-constant-condition（eslint:recommended error）禁的 while(true)，1+jsonRetryMax+techRetryMax 界保证终止。"
      consequences: "ClaudeSdkInvocationImpl 为 TASK-034（task:run 接线）注入对象：034 用 `new ClaudeSdkExecutor(new ClaudeSdkInvocationImpl({providerEnv, model, onMessage, stderr, abortController}))` 替换默认 DryRunLocalExecutor；TASK-033（SDK Reviewer）复用同套 sdk-client + provider-profile + JSON 重试降级模式（独立会话、独立类）。camelCase schema 裁定使 SPEC §4.3「ResultFrontmatterSchema.safeParse」措辞需据 §4.2 修正为「模型产出 camelCase JSON 经 SdkResultJsonSchema 校验」（已回写 SPEC §4.3，回写属 MD 全权限）。启发式容错分类的局限：真实 API（GLM/DeepSeek 端点）错误消息措辞未经实证，可能漏判（ISS-022 low），TASK-035 CI 观测后细化。abortController 须由 034 wire SIGINT（本实现不 wire，只消费注入的 controller）。模型谎报 verification/modified_files（R-JSON）由重试+降级兜底、风险用户接受（§15）。SDK 中断后 worktree 保留（§9，不自动回滚 F3）。关联 DEC-029/030/031/032（SDK 立项+依赖+sdk-client+provider-profile）/ ISS-012（SDK 就位，本任务推进执行侧真实调用）/ ISS-016（真实 Reviewer，留 033）/ ISS-022（错误分类启发式）。"
  issues:
    - id: ""
      title: "SDK 错误分类 classifyFault 采用 name+message 文本启发式——真实 API（尤其 GLM/DeepSeek 端点）错误措辞未经实证，TASK-035 观测后或需细化匹配规则"
      status: open
      severity: low
      scope: src/infrastructure/sdk/claude-sdk-invocation-impl.ts（classifyFault）
      created_from_task: TASK-032
      owner: ""
      recommended_action: "SPEC §8 容错分类表（鉴权/网络5xx/限流/safety/JSON/中断）要求按错误类型分别处置，但 §12/§8 未穷举 Claude Agent SDK 的具体错误类（class）与 code，且错误形态随 SDK 版本变动（R-API，安装版 0.3.206）。本任务 classifyFault 按 SDK 抛出的 error.name + error.message 文本启发式分类为 abort/auth/network/unknown：abort（name==='AbortError' 或 message 含 abort）、auth（\\b401|403\\b / unauthor/forbidden/authentication / invalid ...key|token|credential）、network（\\b429|5xx\\b / econn/etimedout/enetunreach/eai_again/fetch failed/network/socket/timeout/rate limit）、其余 unknown。HTTP 状态码用 (?:^|\\D)(NNN)(?:\\D|$) 匹配独立数字避免误吞更长数字串。**该分类是显式可审规则**（§8 + AGENTS §3 显式错误处理，全在 classifyFault 函数内可审、非隐藏兼容逻辑），**不阻塞验收**（§11 验收项为 fake 单测，经 fake Error 覆盖 abort/auth/network/unknown 全路径全绿）。局限：真实 API（尤其第三方 GLM/DeepSeek 兼容端点，R-PROVIDER）的错误消息措辞未经实证，可能漏判某类错误为 unknown（unknown 仍显式降级 failed+needs-human 不静默，不会无限重试或崩溃，但可能本该重试的网络错被判 unknown 不重试）。建议 TASK-035 CI 真实 API 跑通后观测实际错误消息，按需细化 classifyFault 匹配规则（或引入 SDK 错误类/类型判别替代纯文本匹配）。关联 DEC-033。"
next_action: review
---

# TASK-032 执行结果

## 1. 执行结论

任务完成。`PLAN_claude-sdk-integration` 第三个任务（ClaudeSdkInvocation 真实实现）落地：

- **claude-sdk-invocation-impl.ts**（新）：实现 `ClaudeSdkInvocationImpl`——经 sdk-client 跑自主 query + 模型 JSON 提取校验 + 重试降级（§4.3）+ 容错分类（§8）+ 中断处理（§9），返回 `SdkRunReport`。
- **ClaudeSdkExecutor 编排不变**：只消费 SdkRunReport，契约不改（任务 §7）。
- **camelCase 模型 JSON schema**（SPEC §4.2 vs §4.3 张力裁定）：模型产出 camelCase（SdkRunReport 形态），用专属 schema 校验，executor 负责 snake_case 落盘映射（DEC-033）。

30 项单测全绿（fake sessionQueue + recordingSleep + 零真实 API），typecheck / lint 0 错误，全量 754 项无回归。

## 2. 完成内容

- 新建 `src/infrastructure/sdk/claude-sdk-invocation-impl.ts`：
  - **模型 JSON schema**：`SdkResultJsonSchema`（camelCase，§4.2，复用 core 子 schema，文件清单/verification/globalUpdateRequests 给 default 容 R-JSON 漏报，executionStatus+nextAction 硬性必填）+ `FaultCategory` / `ExtractResult` 判别联合类型。
  - **纯函数**：`classifyFault(error)`（§8 容错分类 abort/auth/network/unknown，HTTP 状态码独立数字匹配）、`extractResultJson(resultText)`（§4.2 fenced 块提取，优先 result-frontmatter 缺则 json、取最后一块）、prompt/append 装配、`degradedReport`（统一降级形态）、`mapToSdkRunReport`（成功路径补 cost 摘要）。
  - **类 `ClaudeSdkInvocationImpl`**：构造注入 providerEnv/model + 测试注入点（runSession/sleep/random）+ §7 观测回调 + abortController；`run(SdkRunInput)` 有界重试循环组装会话 → runSdkSession → JSON 提取重试降级 + 容错分类 + 中断 → SdkRunReport。
- 改 `src/infrastructure/index.ts`：追加 `export * from './sdk/claude-sdk-invocation-impl.js'`。
- 新建 `test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts`（30 项）。

## 3. 修改文件

- `src/infrastructure/index.ts`（追加 invocation 实现导出）

## 4. 新增文件

- `src/infrastructure/sdk/claude-sdk-invocation-impl.ts`
- `test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts`
- `docs/tasks/TASK-032-infra-sdk-invocation-impl.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-033（proposed）：ClaudeSdkInvocation 真实实现设计——构造注入 provider 配置 + §4.2 camelCase 模型 JSON 提取校验（SPEC 张力裁定）+ §4.3 JSON 重试降级 + §8 启发式容错分类 + §9 abortController 中断。

## 7. 偏离计划

无规格偏离。SPEC §4（执行模型）/ §8（容错分类）/ §9（中断）/ §12（SDK API）全部按字面落地。

两处实现具体化（已记 DEC-033，非偏离）：
1. **SPEC §4.2 vs §4.3 张力**：§4.2 示例模型产出为 camelCase（对齐 SdkRunReport），但任务 §2/§4.3 文字提「ResultFrontmatterSchema.safeParse」（snake_case），二者字段名不同。据 §4.2 显式示例裁定为 camelCase 专属 schema，snake_case 落盘映射由 executor（不变）负责。**已回写 SPEC §4.3**（MD 全权限）澄清措辞。
2. **§8 容错分类的判定方式**：SPEC §8 表格给分类与处置但未指定如何从 SDK 错误对象判定类别（§12 未穷举 SDK 错误类/code，R-API）。本任务用 name+message 文本启发式（显式可审规则，ISS-022 记局限）。

严格遵守 §7：不改 ClaudeSdkInvocation/SdkRunInput/SdkRunReport/ClaudeSdkExecutor（forbidden 守住）、不挂 canUseTool（F3）、不设 maxTurns（F4）、不做 Reviewer（033）、不做 CLI 接线（034）、不调真实 API（fake 单测）。

## 8. 后续任务注意事项

- **034 接线**（task:run）：composition root 用 `new ClaudeSdkExecutor(new ClaudeSdkInvocationImpl({ providerEnv, model, onMessage, stderr, abortController }))` 替换默认 DryRunLocalExecutor。providerEnv/model 经 `composeProviderEnv`/resolveProfile（TASK-031）组装。
- **§7 可观测**（034）：构造注入 `onMessage`（SDKMessage 流式回调，034 渲染终端 + 落日志）+ `stderr` 透传到 sdk-client。
- **§9 中断**（034）：构造注入 `abortController` 并 wire 进程 SIGINT → controller.abort()，invocation 跨重试共享、abort 后产 blocked+needs-human 降级保留 worktree。
- **真实 API**（035 CI）：经 sdk-client defaultSdkQuery（TASK-030）跑真实 query，断言契约（过 Schema + 合法枚举 + 状态流转）不断言文本；观测真实错误消息后细化 classifyFault（ISS-022）。
- **模型 JSON camelCase**：模型产出字段为 camelCase（§4.2），executor 落盘转 snake_case（不变）；SPEC §4.3 措辞已回写澄清。
- **TASK-033 复用模式**：ClaudeSdkReviewer 复用同套 sdk-client runSdkSession + provider-profile env + JSON 重试降级（独立会话、§5）。

## 9. 未解决问题

- ISS-022（low，open）：classifyFault 启发式错误分类——真实 API（GLM/DeepSeek）错误措辞未经实证，可能漏判，TASK-035 观测后细化。**不阻塞验收**（§11 fake 单测全绿，unknown 仍显式降级不静默）。详见 frontmatter issues / DEC-033。
- ISS-012（medium，open）进展：本任务实现执行侧真实 ClaudeSdkInvocation，SDK 真实调用经 sdk-client 就绪；执行侧闭环待 034 接线 + 035 CI；审查侧真实 Reviewer 留 033。
- 既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017/019/020/021）与本任务无触发：invocation-impl 纯 infrastructure（不依赖 SQLite、不改状态机、不触发级联/合并），Node v22 下全量 754 项绿。

## 10. 验证结果

- `npm run typecheck`：✓ 0 错误。
- `npm test -- infrastructure/sdk/claude-sdk-invocation-impl`：✓ 30/30 全过。
- `npm run lint`：✓ 0 错误。
- `npm test`（全量）：✓ 754/754 全过（原 724 + invocation-impl 30，无回归）。

本任务不依赖 SQLite 原生模块（invocation-impl 纯 TypeScript + zod + 同层 sdk-client/adapter 类型），Node v22.23.1（ABI 127，满足 ISS-005）下全绿。零真实 API（fake sessionQueue + recordingSleep 单测，真实 API 留 TASK-035 CI）。

## 11. 人工验收建议

- 重点核 §4.3 JSON 重试降级：模型产非法 JSON（提取失败 / safeParse 失败）带反馈重试 N=2，耗尽降级 failed+needs-human + verification skipped + issues 记 parse 错（验收，单测「JSON 重试耗尽」+「safeParse 失败重试」覆盖）。
- 核 §8 容错分类：鉴权错（401）立即 failed 不重试、网络错（503/ECONNRESET/429/500）指数退避重试 max 3（延迟 1000/2000/4000）耗尽降级、unknown 显式降级不静默、is_error 会话降级（验收，单测覆盖）。
- 核 §9 中断：SIGINT abort（AbortError）产 blocked+needs-human 降级保留 worktree、abortController 预先 abort 直接降级不调会话（验收，单测覆盖）。
- 核 §4.2 提取：```result-frontmatter 块（最后一块）/ 缺则回退 ```json / 无块报 no-fenced-block（单测 extractResultJson 覆盖）。
- 核 DEC-033 camelCase schema 裁定是否符合预期（SPEC §4.2 显式 camelCase 示例 vs §4.3「ResultFrontmatterSchema.safeParse」snake_case 措辞张力）。
- 核 ISS-022 启发式错误分类局限是否认可（显式可审规则，真实 API 观测后细化）。
- 核 ClaudeSdkExecutor 编排确实未改（forbidden_paths claude-sdk-adapter.ts 守住，只 import 契约类型）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress 六条 section（完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-033）、DEC-033（proposed）、ISS-022（low，open）。另回写 SPEC §4.3 澄清 camelCase 模型 JSON 校验措辞（SPEC §4.2 vs §4.3 张力裁定）。
