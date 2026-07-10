---
task_id: TASK-033
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - test/infrastructure/sdk/claude-sdk-reviewer.test.ts
  - docs/tasks/TASK-033-infra-sdk-reviewer.result.md
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/sdk/claude-sdk-reviewer
    result: passed
    notes: "26 项全过（extractReviewJson 6 / ClaudeSdkReviewer 20：name 1 + 正常产出 approved/rejected 2 + 入参装配投影 1 + model 省略 1 + JSON 重试 §4.3 含反馈 2 + 重试耗尽降级 needs-human 1 + safeParse 失败 1 + default 容漏 1 + 鉴权立即降级 1 + 网络退避耗尽 1 + 网络重试中成功 1 + SIGINT abort 1 + 预先 abort 1 + is_error 1 + unknown 1 + §7 回调透传 1 + 降级形态契约 1 + outcome 契约 1）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test
    result: passed
    notes: "全量 780 项无回归（原 754 + reviewer 26）。Node v22.23.1（ABI 127，满足 ISS-005）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-033（SDK 版 Reviewer 实现）已完成：`src/infrastructure/sdk/claude-sdk-reviewer.ts`（infrastructure/sdk）提供 `ClaudeSdkReviewer`（实现 Reviewer 契约，task-review.ts，§5 独立于 TaskExecutor）——构造注入 provider 配置（env/model，TASK-031 组装产物）+ 可观测回调（onMessage/stderr，§7）+ 测试注入点（runSession/sleep/random）；`review(SdkReviewInput) → SdkReviewOutcome` 起独立审查 SDK 会话（与执行会话分离，§5/Readme §5.2-5.3 职责分离不共享历史）→ 组装审查 prompt（审查说明 + .result.md frontmatter 摘要 + worktree/result_file 路径供模型 Read/git diff 自读）+ systemPromptAppend（Readme §15 审查清单 14 项 + review-frontmatter 产出契约）→ sdk-client runSdkSession 跑自主 query → JSON 提取重试降级（§4.3：提取 ```review-frontmatter fenced 块优先缺则回退 json 取最后一块 → ReviewJsonSchema.safeParse（snake_case 模型产出，对齐 ReviewOutcome）→ parse 失败带反馈重试 N=2 次、耗尽降级 needs-human-confirmation + findings 记 parse 错不伪造 approved §5）→ 容错分类（§8 复用 TASK-032 classifyFault：abort/auth 立即降级、network 指数退避重试 max 3 耗尽降级、unknown 显式降级不静默、is_error 会话非瞬时降级）→ 中断（§9 abortController 跨重试共享、SIGINT abort 捕获 AbortError 产 needs-human 降级保留 worktree 不回滚）→ 成功映射 SdkReviewOutcome。导出纯函数 `extractReviewJson`（§5 fenced 块提取判别联合，review-frontmatter 标记）+ 类型 `SdkReviewInput`/`SdkReviewOutcome`/`ReviewExtractResult`/`ClaudeSdkReviewerOptions`。降级统一 `needs-human-confirmation` + findings 记原因（含 task_id 便于追溯），与执行侧 degradedReport（failed+needs-human + issues）对称但 ReviewOutcome 无 issue/verification 字段故形态更简。`LocalReviewer`（task-review.ts）保留作兜底（SDK 未配置/key 缺失），CLI 035 装配处注入 ClaudeSdkReviewer 替换。26 项单测（fake sessionQueue 队列 + recordingSleep + 零抖动 random，零真实 API）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- SDK 版 Reviewer（ClaudeSdkReviewer）：`ClaudeSdkReviewer`（`src/infrastructure/sdk/claude-sdk-reviewer.ts`）实现 Reviewer 契约（task-review.ts）的真实调用类（SPEC §5 / Readme §15）。构造 `ClaudeSdkReviewerOptions`（providerEnv 必填 / model 可选 / runSession·sleep·random 测试注入点 / jsonRetryMax=2 / techRetryMax=3 / backoffBaseMs=1000 / abortController SIGINT / onMessage·stderr §7 观测）；`review(SdkReviewInput)` 组装审查 prompt（审查说明 + .result.md frontmatter 摘要：task_id/execution_status/next_action/三类文件清单/verification 结果 + worktree/result_file 路径供模型 Read/diff 自读）+ systemPromptAppend（Readme §15 审查清单 14 项 + review-frontmatter snake_case 产出契约）→ 默认经 sdk-client runSdkSession 跑独立审查 query（cwd=worktree，模型用 Read/Bash(git diff) 读 worktree 改动）→ JSON 提取重试降级 + 容错分类 + 中断 → SdkReviewOutcome。导出纯函数 `extractReviewJson`（§5 fenced 块判别联合，review-frontmatter 标记优先缺则回退 json 取最后一块）。容错分类复用 TASK-032 `classifyFault`（同层 import 纯函数，abort/auth/network/unknown）。provider 配置经构造注入（env/model 来自 TASK-031，SdkReviewInput 契约不改），CLI 035 composition root 装配实例后替换 task-review.ts 默认 LocalReviewer。纯 infrastructure：依赖 sdk-client（同层）+ claude-sdk-invocation-impl（同层 classifyFault）+ core Schema（ResultFrontmatter/ReviewResultSchema 类型 + 运行时校验），不反向依赖 application/cli、不 import cli 的 Reviewer 契约（分层 infra↛cli + forbidden_paths）——靠 TS 结构类型兼容让 035 wiring 注入（ARCHITECTURE §4 无需 implements）。SDK 真实 API 调用留 TASK-035 CI（本任务 fake sessionQueue 单测零真实 API）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/infrastructure/sdk/claude-sdk-reviewer.ts` 建立：依赖 `zod`（core 已用）+ core Schema（ReviewResultSchema/ResultFrontmatter/ReviewResult 运行时校验 + 类型）+ 同层 sdk-client（runSdkSession + SdkSessionInput/Report 类型）+ 同层 claude-sdk-invocation-impl（classifyFault + FaultCategory 容错分类纯函数复用），零反向依赖（不 import application/cli；不 import cli 的 Reviewer 契约，靠结构类型兼容）。沿用「Zod schema 单一来源 + z.infer 派生 + 纯函数 + 判别联合」模式（同 TASK-032）：`ReviewJsonSchema`（snake_case 模型产出，review_result 复用 ReviewResultSchema.exclude(['skipped']) 单一来源、required_changes/findings 给 default 容 R-JSON 漏报）；`extractReviewJson`（§5 fenced 块判别联合，review-frontmatter 标记优先缺则回退 json 取最后一块，与 extractResultJson 同构仅标记不同）；REVIEW_CHECKLIST_ITEMS（Readme §15 审查清单 14 项机器可注入形式）；REVIEW_JSON_OUTPUT_INSTRUCTION（review-frontmatter snake_case 产出契约）；prompt/append/summary/feedback 装配纯函数（buildReviewPrompt/buildResultSummary/buildReviewSystemPromptAppend/buildParseFeedback）；降级 outcome 纯函数（degradedOutcome，统一 §4.3/§8/§9 降级形态：review_result=needs-human-confirmation + required_changes 留空 + findings 记原因含 task_id）；mapToReviewOutcome（成功路径）。`ClaudeSdkReviewer` 有界重试 for 循环（1 + jsonRetryMax + techRetryMax，同 invocation-impl）；abortController 跨重试共享 + 每轮前置 aborted 检查；复用 classifyFault 容错分类（abort/auth 立即降级、network 指数退避重试耗尽降级、unknown 降级、is_error 降级——全部降级为 needs-human-confirmation）。审查侧降级与执行侧对称但形态不同（ReviewOutcome 无 issue/verification 字段，降级只产 findings）。`src/infrastructure/index.ts` 追加 `export * from './sdk/claude-sdk-reviewer.js'`。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- ClaudeSdkReviewer 复用要点（TASK-033）：`ClaudeSdkReviewer`（`src/infrastructure/sdk/claude-sdk-reviewer.ts`）是 TASK-035（task:review 接线）的 reviewer 注入对象——035 在 composition root（task-review.ts:200 当前 `options.reviewer ?? new LocalReviewer()`）用 `new ClaudeSdkReviewer({ providerEnv, model, onMessage, stderr, abortController })` 装配（providerEnv/model 经 `composeProviderEnv`/resolveProfile 从 TASK-031 组装），替换默认 LocalReviewer（key 缺失/SDK 未配置时回退 LocalReviewer 兜底，SPEC §5 / §6 key 缺失策略）。构造必填 `providerEnv: Record<string,string>`（TASK-031 buildProviderEnv 产物），可选 `model`（profile modelMapping 档位值，省略用 SDK 默认）。§7 可观测：构造注入 `onMessage`（SDKMessage 流式回调，035 渲染终端 + 落日志）+ `stderr` 透传到 sdk-client。§9 中断：构造注入 `abortController`（035 wire 进程 SIGINT → controller.abort()），reviewer 跨重试共享、abort 后产 needs-human-confirmation 降级 outcome 保留 worktree。**结构兼容 Reviewer 契约**：ClaudeSdkReviewer 不 import cli（分层 infra↛cli + task-review.ts forbidden），本地定义 SdkReviewInput/SdkReviewOutcome 结构对齐 ReviewInput/ReviewOutcome（字段逐一一致：task_id/result/worktree_path/result_file 与 review_result/required_changes/findings），靠 TS 结构类型兼容让 035 wiring 注入（ARCHITECTURE §4 无需 implements）。**结构兼容性由 035 wiring typecheck 自然验证**（在 task-review.ts 内单一 ResultFrontmatter identity，不触发 test 跨文件类型 identity 怪异）——本任务 test 内联的 cli 类型泛型断言因 TS 把经不同文件到达的 ResultFrontmatter 当两个 identity 而误报，故不保留 test 内断言。审查侧模型 JSON 为 snake_case（review_result/required_changes/findings，§5 对齐 ReviewOutcome），与执行侧 camelCase 不同（无需转换）。容错分类复用 TASK-032 classifyFault（ISS-022 局限同延）。**真实 API 调用经 sdk-client defaultSdkQuery（TASK-030），本任务单测全 fake（sessionQueue 队列 + recordingSleep），真实 API 契约断言留 TASK-035 CI**。SPEC §5「对照 §15 审查清单」的 §15 经核实为 Readme.md §15（审查清单是 Readme 权威内容，SPEC §15 是风险与缓解），reviewer 注入 Readme §15 全部 14 项清单。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-012（medium，open）进展：本任务实现审查侧真实 ClaudeSdkReviewer，SDK 真实调用经 sdk-client 就绪，执行侧（032）+ 审查侧（033）真实实现均就位；双侧真实闭环待 TASK-034（task:run 接线）+ TASK-035（task:review 接线 + CI 真实 API 契约断言）。既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017/019/020/021/022）与本任务无触发：claude-sdk-reviewer 纯 infrastructure（不依赖 SQLite、不改状态机、不触发级联/合并），Node v22（ISS-005 约束满足）下全量 780 项绿。ISS-016（真实 Reviewer）由本任务推进（审查侧真实实现就位，035 接线后闭环）。ISS-022（classifyFault 启发式）同延——reviewer 复用同一 classifyFault，局限不变（真实 API 错误措辞待 035 CI 观测）。"
    - section: "建议下一个任务"
      mode: replace
      content: "- **TASK-034（task:run CLI 接线 + 可观测性）** —— `PLAN_claude-sdk-integration` 第五个任务（layer: page，depends_on TASK-026✅/031✅/032✅ 全 done）。在 `src/cli/commands/task-run.ts`（TASK-026 现有 runTask）composition root 装配真实 SDK 执行链：用 `new ClaudeSdkExecutor(new ClaudeSdkInvocationImpl({ providerEnv, model, onMessage, stderr, abortController }))` 替换默认 DryRunLocalExecutor（providerEnv/model 经 `composeProviderEnv`/resolveProfile 从 TASK-031 组装，key 缺失回退 DryRun + 显式标注）；wire §7 可观测（onMessage 终端流式渲染 + stderr 日志落盘）、§9 SIGINT 中断（abortController wire process SIGINT）；按 profile token 环境变量就位决定默认走 SDK executor、`--executor dry-run` 显式回退。**TASK-034 与 TASK-035 互不依赖且可并行**（034 改 task-run.ts、035 改 task-review.ts，互为 forbidden 但文件不冲突；034 depends 026/031/032 全 done，035 depends 027/031/033 现全 done）。拓扑序：TASK-035（task:review 接线 + CI 真实 API，depends_on 027✅/031✅/033✅ 现全 done，**已解锁可启动**）——035 在 task-review.ts:200 装配 `new ClaudeSdkReviewer(...)` 替换默认 LocalReviewer（key 缺失回退），并新建 CI 真实 API 契约断言子集（至少 anthropic + glm 各一最小任务，SPEC §14 第 7-8 项）。推进 ISS-012（SDK 真实调用——034 接线 + 035 CI 真实 API 断言）/ ISS-016（真实 Reviewer——035 接线）。v0.1.0 终态快照保留于上方各 section。tag/发版（当前 0.1.0/private:true）由人工决定。"
  decisions:
    - id: ""
      title: "ClaudeSdkReviewer 设计——独立审查会话 + snake_case 模型 JSON（对齐 ReviewOutcome）+ review-frontmatter 标记 + 复用 classifyFault + 结构类型兼容 Reviewer 契约（不 import cli）"
      status: proposed
      scope: src/infrastructure/sdk（claude-sdk-reviewer.ts）+ src/infrastructure/index.ts
      created_from_task: TASK-033
      decision: "claude-sdk-reviewer.ts 按 SPEC §5 / Readme §15 / §4.3 / §8 / §9 落地 SDK 版 Reviewer 真实类 ClaudeSdkReviewer（实现 Reviewer 契约，task-review.ts 契约不改）。七项关键设计：(1) 独立审查会话——review(ReviewInput) 内部起一次独立 SDK 会话（复用 sdk-client runSdkSession），与执行会话（ClaudeSdkInvocation）分离、不共享对话历史（§5/Readme §5.2-5.3 职责分离）；cwd=worktree_path 让模型用 Read/Bash(git diff) 自读 worktree 实际改动。(2) 审查对象——input.result（.result.md frontmatter 关键字段摘要：task_id/execution_status/next_action/三类文件清单/verification 结果）注入 prompt + result_file 路径告知模型 Read 全文（含 global_update_requests）；对照 Readme §15 审查清单 14 项逐项核查。(3) 模型 JSON 为 snake_case——审查侧模型产 review_result/required_changes/findings（§5 示例 + ReviewOutcome 接口字段名），与执行侧 camelCase（executionStatus/modifiedFiles）不同，直接用基于 ReviewOutcome 的 ReviewJsonSchema safeParse 无需 camelCase→snake_case 转换（review_result 复用 ReviewResultSchema.exclude(['skipped']) 单一来源，required_changes/findings 给 default 容 R-JSON 漏报）。(4) fenced 块标记 review-frontmatter——与执行侧 result-frontmatter 对称、语义清晰（审查产出 vs 执行产出），提取规则同构（优先 review-frontmatter 缺则回退 json 取最后一块，review-frontmatter 块存在但 JSON 非法直接报 json-parse 不退求 json 块）。(5) JSON 重试降级（§4.3 同执行侧）——parse/校验失败把错误反馈追加进重试会话 prompt（新会话无历史 §2.2），重试 N=2，耗尽降级 review_result: needs-human-confirmation（**不伪造 approved**，§5）+ required_changes 留空 + findings 记 parse 错。(6) 容错分类 + 中断（§8/§9 复用 TASK-032 classifyFault + 对称降级）——SPEC §5 只明文 JSON 重试降级，但 runSdkSession 会抛技术错误（网络/鉴权/abort），不处理会让 review 崩溃而非降级，故实现完整 §8 容错分类（复用 classifyFault：abort/auth 立即降级、network 指数退避 max 3 耗尽降级、unknown 显式降级）+ §9 中断（abortController 跨重试共享、SIGINT 捕获 AbortError 降级保留 worktree），全部降级 needs-human-confirmation + findings 记原因（ReviewOutcome 无 issue/verification 字段故降级形态比执行侧 degradedReport 简，只产 findings）。(7) 结构类型兼容 Reviewer 契约（ARCHITECTURE §4 无需 implements）——Reviewer/ReviewInput/ReviewOutcome 定义在 cli/commands/task-review.ts（forbidden + 分层 infra↛cli），reviewer 不 import cli，本地定义 SdkReviewInput/SdkReviewOutcome 结构对齐契约（字段逐一一致），靠 TS 结构类型兼容让 TASK-035 wiring 注入。SPEC §5「对照 §15 审查清单」的 §15 经核实为 Readme.md §15（审查清单是 Readme 权威内容，SPEC §15 是风险与缓解）。"
      rationale: "独立会话 + snake_case：SPEC §5 明文「独立 SDK 会话（与执行分离）」+ §5 JSON 示例为 snake_case（review_result/required_changes/findings，与 ReviewOutcome 接口字段名一致），故审查侧无需 camelCase schema（与执行侧 §4.2 张力 DEC-033 不同，审查侧字段名本就 snake_case 对齐）。review-frontmatter 标记：与 result-frontmatter 对称便于模型区分产出类型，提取同构不恶性重复。复用 classifyFault：SPEC §8 容错分类规则通用（abort/auth/network/unknown），TASK-032 已实现为同层 export 纯函数，reviewer 直接 import 复用避免重复（DRY），局限（ISS-022）同延。技术故障降级 needs-human-confirmation：SPEC §5「降级 needs-human 不伪造 approved」是 JSON 耗尽场景，但技术故障（网络/鉴权/abort）同理应降级（崩溃不可取），统一降级 needs-human-confirmation + findings 记原因（保留 worktree 供人工审查）与执行侧降级理念对称（执行侧 failed+needs-human，审查侧 needs-human-confirmation）。结构类型兼容：Reviewer 契约在 cli（forbidden + 分层硬约束 infra↛cli 双重禁止 import），executor-contract.ts（TASK-022）模式本应把契约提 infra，但 task-review.ts frozen 不能移，故靠 TS 结构类型兼容（ARCHITECTURE §4 明文「infra 实现类无需显式 implements，wiring 注入结构兼容」）。§15 引用澄清：SPEC §5 提「§15 审查清单」但 SPEC §15 是风险与缓解，审查清单（14 项核查）是 Readme §15 的权威内容，故 reviewer 注入 Readme §15 清单。"
      consequences: "ClaudeSdkReviewer 为 TASK-035（task:review 接线）注入对象：035 在 task-review.ts:200 composition root 用 `new ClaudeSdkReviewer({ providerEnv, model, onMessage, stderr, abortController })` 替换默认 LocalReviewer（key 缺失回退 LocalReviewer 兜底）。结构兼容性由 035 wiring typecheck 自然验证（task-review.ts 内单一 ResultFrontmatter identity；本任务 test 内联 cli 类型泛型断言因 TS 把经不同文件到达的 ResultFrontmatter 当两个 identity 误报 unrelated，故不保留 test 内断言——非真实不兼容）。snake_case schema 裁定使审查侧与执行侧 JSON 形态分化（执行 camelCase SdkResultJsonSchema / 审查 snake_case ReviewJsonSchema），各有专属 schema 对齐各自契约接口。容错分类复用 classifyFault 使 ISS-022（启发式局限）同时影响执行侧与审查侧，TASK-035 CI 真实 API 观测后一次细化两处通用。降级统一 needs-human-confirmation：审查失败/故障/中断一律回人工（保留 worktree），不伪造 approved——安全兜底（R-JSON 审查谎报风险由降级 + CI 断言缓解）。§7/§9 回调与 abortController 由 035 wire（本实现只消费注入）。关联 DEC-033（ClaudeSdkInvocation 同模式参照）/ DEC-029/030/031/032（SDK 立项+依赖+sdk-client+provider-profile）/ ISS-012（SDK 就位，本任务推进审查侧真实实现）/ ISS-016（真实 Reviewer，本任务推进）/ ISS-022（classifyFault 启发式同延）。"
  issues: []
next_action: review
---

# TASK-033 执行结果

## 1. 执行结论

任务完成。`PLAN_claude-sdk-integration` 第四个任务（SDK 版 Reviewer）落地：

- **claude-sdk-reviewer.ts**（新）：实现 `ClaudeSdkReviewer`——经 sdk-client 起独立审查会话 + 模型 JSON（snake_case）提取校验 + 重试降级（§4.3）+ 容错分类（§8，复用 classifyFault）+ 中断处理（§9），返回 `SdkReviewOutcome`。
- **Reviewer 契约不改**（task-review.ts forbidden）：靠 TS 结构类型兼容，本地定义对齐契约的 SdkReviewInput/SdkReviewOutcome（ARCHITECTURE §4 无需 implements）。
- **LocalReviewer 保留**作兜底（SDK 未配置/key 缺失），TASK-035 装配处注入 ClaudeSdkReviewer 替换。

26 项单测全绿（fake sessionQueue + recordingSleep + 零真实 API），typecheck / lint 0 错误，全量 780 项无回归。

## 2. 完成内容

- 新建 `src/infrastructure/sdk/claude-sdk-reviewer.ts`：
  - **模型 JSON schema**：`ReviewJsonSchema`（snake_case，§5，review_result 复用 ReviewResultSchema.exclude(['skipped']) 单一来源、required_changes/findings 给 default 容 R-JSON 漏报）+ `ReviewExtractResult` 判别联合类型。
  - **纯函数**：`extractReviewJson`（§5 fenced 块提取，review-frontmatter 标记优先缺则回退 json 取最后一块）、prompt/append/summary/feedback 装配（buildReviewPrompt/buildResultSummary/buildReviewSystemPromptAppend/buildParseFeedback）、`degradedOutcome`（统一降级形态 needs-human-confirmation + findings）、`mapToReviewOutcome`（成功路径）。
  - **类 `ClaudeSdkReviewer`**：构造注入 providerEnv/model + 测试注入点（runSession/sleep/random）+ §7 观测回调 + abortController；`review(SdkReviewInput)` 有界重试循环组装会话 → runSdkSession → JSON 提取重试降级 + 容错分类（复用 classifyFault）+ 中断 → SdkReviewOutcome。
  - **审查清单**：REVIEW_CHECKLIST_ITEMS（Readme §15 全部 14 项）注入 systemPromptAppend。
- 改 `src/infrastructure/index.ts`：追加 `export * from './sdk/claude-sdk-reviewer.js'`。
- 新建 `test/infrastructure/sdk/claude-sdk-reviewer.test.ts`（26 项）。

## 3. 修改文件

- `src/infrastructure/index.ts`（追加 reviewer 导出）

## 4. 新增文件

- `src/infrastructure/sdk/claude-sdk-reviewer.ts`
- `test/infrastructure/sdk/claude-sdk-reviewer.test.ts`
- `docs/tasks/TASK-033-infra-sdk-reviewer.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-034（proposed）：ClaudeSdkReviewer 设计——独立审查会话 + snake_case 模型 JSON（对齐 ReviewOutcome）+ review-frontmatter 标记 + 复用 classifyFault + 结构类型兼容 Reviewer 契约（不 import cli）。

## 7. 偏离计划

无规格偏离。SPEC §5（审查模型）/ §4.3（JSON 重试降级）/ §8（容错分类）/ §9（中断）全部按字面落地。

三处实现具体化（已记 DEC-034，非偏离）：

1. **审查侧模型 JSON 为 snake_case**（§5 显式示例 + ReviewOutcome 接口字段名），与执行侧 camelCase（§4.2 / DEC-033）不同——审查侧无需 camelCase 专属 schema 裁定，直接基于 ReviewOutcome 字段的 snake_case schema safeParse。
2. **技术性故障降级**（§8/§9）：SPEC §5 只明文 JSON 重试降级（耗尽 needs-human-confirmation），但 runSdkSession 会抛技术错误（网络/鉴权/abort），不处理会导致 review 崩溃而非降级。故实现完整 §8 容错分类（复用 TASK-032 classifyFault）+ §9 中断，全部降级 needs-human-confirmation + findings 记原因（AGENTS §3 显式错误处理）。
3. **结构类型兼容 Reviewer 契约**（不 import cli）：Reviewer/ReviewInput/ReviewOutcome 定义在 cli/commands/task-review.ts（forbidden + 分层 infra↛cli），reviewer 本地定义对齐契约结构，靠 TS 结构类型兼容（ARCHITECTURE §4）。

严格遵守 §7：不改 Reviewer/ReviewInput/ReviewOutcome 契约（forbidden task-review.ts 守住）、不改 claude-sdk-adapter.ts / sdk-client.ts（forbidden 守住，只 import 类型/纯函数）、不挂 canUseTool（F3）、不与执行会话共享历史（§5）、不做 CLI 接线（035）、不调真实 API（fake 单测）。

## 8. 后续任务注意事项

- **035 接线**（task:review）：composition root（task-review.ts:200 当前 `options.reviewer ?? new LocalReviewer()`）改为按配置注入 `new ClaudeSdkReviewer({ providerEnv, model, onMessage, stderr, abortController })` 替换默认 LocalReviewer（key 缺失/SDK 未配置回退 LocalReviewer 兜底，SPEC §5 / §6 key 缺失策略）。providerEnv/model 经 `composeProviderEnv`/resolveProfile（TASK-031）组装。
- **结构兼容验证**（035）：ClaudeSdkReviewer 不 import cli，靠结构类型兼容 Reviewer。**035 wiring 的 typecheck 会自然验证兼容性**（task-review.ts 内单一 ResultFrontmatter identity，不触发 test 跨文件 identity 怪异）。本任务 test 内联的 cli 类型泛型断言因 TS 把经不同文件到达的 ResultFrontmatter 当两个 identity（unrelated）而误报，故不保留 test 内断言。
- **§7 可观测**（035）：构造注入 `onMessage`（SDKMessage 流式回调，035 渲染终端 + 落日志）+ `stderr` 透传到 sdk-client。
- **§9 中断**（035）：构造注入 `abortController` 并 wire 进程 SIGINT → controller.abort()，reviewer 跨重试共享、abort 后产 needs-human-confirmation 降级保留 worktree。
- **真实 API**（035 CI）：经 sdk-client defaultSdkQuery（TASK-030）跑真实 query，断言契约（过 ReviewFrontmatterSchema + review_result ∈ 合法枚举 + 状态流转）不断言文本；观测真实错误消息后细化 classifyFault（ISS-022，执行/审查两侧通用）。
- **审查侧模型 JSON snake_case**：模型产出 review_result/required_changes/findings（§5），reviewer 直接消费，无需转换。
- **SPEC §5「§15 审查清单」= Readme.md §15**（审查清单是 Readme 权威内容，SPEC §15 是风险与缓解），reviewer 注入 Readme §15 全部 14 项。

## 9. 未解决问题

- 无新增 issue。容错分类复用 TASK-032 classifyFault（ISS-022 启发式局限同延——真实 API 错误措辞待 035 CI 观测，一次细化执行/审查两侧通用）。降级统一 needs-human-confirmation（安全兜底，不伪造 approved）。
- ISS-012（medium，open）进展：本任务实现审查侧真实 ClaudeSdkReviewer，执行侧（032）+ 审查侧（033）真实实现均就位；双侧真实闭环待 034 接线 + 035 CI。ISS-016（真实 Reviewer）由本任务推进。
- 既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017/019/020/021/022）与本任务无触发：claude-sdk-reviewer 纯 infrastructure（不依赖 SQLite、不改状态机、不触发级联/合并），Node v22 下全量 780 项绿。

## 10. 验证结果

- `npm run typecheck`：✓ 0 错误。
- `npm test -- infrastructure/sdk/claude-sdk-reviewer`：✓ 26/26 全过。
- `npm run lint`：✓ 0 错误。
- `npm test`（全量）：✓ 780/780 全过（原 754 + reviewer 26，无回归）。

本任务不依赖 SQLite 原生模块（claude-sdk-reviewer 纯 TypeScript + zod + 同层 sdk-client/invocation-impl 类型 + classifyFault），Node v22.23.1（ABI 127，满足 ISS-005）下全绿。零真实 API（fake sessionQueue + recordingSleep 单测，真实 API 留 TASK-035 CI）。

## 11. 人工验收建议

- 重点核 §4.3 JSON 重试降级：模型产非法 JSON（提取失败 / safeParse 失败）带反馈重试 N=2，耗尽降级 needs-human-confirmation + findings 记 parse 错（**不伪造 approved**，§5 验收，单测「JSON 重试耗尽」+「safeParse 失败重试」覆盖）。
- 核 §8 容错分类（复用 classifyFault）：鉴权错（401）立即降级不重试、网络错（503/ECONNRESET/429/500）指数退避重试 max 3（延迟 1000/2000/4000）耗尽降级、unknown 显式降级不静默、is_error 会话降级（验收，单测覆盖，全部降级 needs-human-confirmation）。
- 核 §9 中断：SIGINT abort（AbortError）产 needs-human-confirmation 降级保留 worktree、abortController 预先 abort 直接降级不调会话（验收，单测覆盖）。
- 核 §5 提取：```review-frontmatter 块（最后一块）/ 缺则回退 ```json / 无块报 no-fenced-block（单测 extractReviewJson 覆盖）。
- 核 DEC-034 snake_case schema 裁定（§5 模型产 snake_case 直接对齐 ReviewOutcome，与执行侧 camelCase DEC-033 不同）。
- 核结构类型兼容 Reviewer 契约设计（不 import cli，ARCHITECTURE §4 无需 implements；兼容性由 035 wiring typecheck 验证）。
- 核「技术性故障降级 needs-human-confirmation」是否符合预期（SPEC §5 只明文 JSON 降级，本任务扩展到 §8/§9 技术故障）。
- 核 LocalReviewer 兜底保留（task-review.ts 不改，035 装配处注入替换）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress 六条 section（完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-034）、DEC-034（proposed）。无新增 issue（容错分类复用 classifyFault，ISS-022 同延）。
