---
task_id: TASK-030
execution_status: completed
modified_files:
  - package.json
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sdk/sdk-client.ts
  - test/infrastructure/sdk/sdk-client.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm install
    result: passed
    notes: "扩权安装 @anthropic-ai/claude-agent-sdk@0.3.206 + 2 个 peer（@anthropic-ai/sdk@0.110.0、@modelcontextprotocol/sdk@1.29.0），zod 保持 3.25.76；须 --legacy-peer-deps（详见 ISS-019）"
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess；印证 zod 3.25.76 兼容 SDK 0.3.206 .d.ts）"
  - command: npm test -- infrastructure/sdk/sdk-client
    result: passed
    notes: "12 项全过（buildSdkOptions §12 字段校准 4 / collectResult 终止信息采集 3 / runSdkSession 流式+abort 5）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test
    result: passed
    notes: "全量 692 项无回归（原 680 + sdk-client 12）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-030（扩权新增 Claude Agent SDK 依赖 + sdk-client 会话工厂）已完成：`package.json` 扩权新增 `@anthropic-ai/claude-agent-sdk@^0.3.206` + 2 个 peer（`@anthropic-ai/sdk@^0.110.0`、`@modelcontextprotocol/sdk@^1.29.0`，SDK 把三者全外部化为 peer）；zod 保持 `^3.23.8`（实际 3.25.76，zod 3→4 过渡版兼容 SDK 类型）。`src/infrastructure/sdk/sdk-client.ts` 提供可复用 query 会话工厂——`buildSdkOptions(input)`（§12 字段校准装配：cwd/model/env/permissionMode:'bypassPermissions'+allowDangerouslySkipPermissions/systemPrompt(preset+append)/settingSources(['project'])/includePartialMessages:true/abortController/stderr；不传 canUseTool/maxTurns/resume·continue·forkSession）+ `collectResult(result)`（从 SDKResultMessage 采集 subtype/total_cost_usd/usage(input/output/cache_* tokens)/num_turns/duration_ms/duration_api_ms/is_error/result 文本）+ `runSdkSession(input, queryFn?)`（装 options → 跑 query → for-await 消费 SDKMessage 流经 onMessage 回调透传 → 命中 type:'result' 采集 → 返回 SdkSessionReport；abortController.abort() 后 SDK 抛 AbortError 不捕获向上传播；流结束无 result 抛错不静默）。`SdkQueryFn` 注入式 query 句柄（默认 defaultSdkQuery 真实 SDK query，测试注入 fake 覆盖，零真实 API）。12 项单测。SDK 字段名对照安装版 0.3.206 .d.ts 校准（R-API 差异：bypassPermissions 须 allowDangerouslySkipPermissions、subtype 扩展、SDKMessage 联合扩展——回写 SPEC §12）。扩权安装遇 zod peer 冲突（SDK 要 zod ^4，项目 zod 3），以 --legacy-peer-deps + 显式声明 peer + zod 保持 3.x 解决（ISS-019）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- Claude Agent SDK 会话工厂：`sdk-client.ts`（`src/infrastructure/sdk/sdk-client.ts`）集中 `@anthropic-ai/claude-agent-sdk` 的 query() 装配 + 流式消费 + abort + cost/usage 采集，作为「一次自主会话」可复用工厂供 TASK-032（ClaudeSdkInvocation 真实实现）/ TASK-033（SDK 版 Reviewer）复用，避免两处重复装配 query/流式/cost 逻辑（SPEC §13.1）。`buildSdkOptions(SdkSessionInput): Options` 按 §12 装配 options——permissionMode 'bypassPermissions' + 必须的 allowDangerouslySkipPermissions:true（安装版 .d.ts 硬性要求）、systemPrompt {type:'preset',preset:'claude_code',append}、settingSources 默认 ['project']、includePartialMessages:true、abortController、stderr、env/model 透传（多 provider env 由调用方经 031 组装）、显式不传 canUseTool(F3)/maxTurns(F4)/resume·continue·forkSession(§2.2)。`collectResult(SDKResultMessage): SdkSessionReport` 结构化采集终止信息（subtype/cost/usage/turns/duration/isError/resultText + raw resultMessage），不判 executionStatus（归 TASK-032）。`runSdkSession(input, queryFn=defaultSdkQuery)` 主入口：for-await 消费 SDKMessage 流，每条经 onMessage 回调透传（§7 实时流式 + 完整日志），命中 result 采集；abortController.abort() 后 SDK 抛 AbortError 不捕获向上传播（§9，调用方据此产降级 result）；流结束无 result 抛错不静默。`SdkQueryFn` 注入式 query 句柄把真实 SDK 调用隔离为可替换注入点（测试注入 fake query 流，零真实 API，SPEC §11）；`defaultSdkQuery` 为真实 SDK query 的注入适配。sdk-client 纯 infra（value import query + type import 类型），不反向依赖 application/cli，不承载任务领域逻辑（JSON 提取/重试/降级归 TASK-032）。SDK 已就位（TASK-022 的 ISS-012「SDK 未安装」核心部分解决——包已装入，真实 API 调用留 TASK-032/035）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/infrastructure/sdk/sdk-client.ts` 建立：value import `@anthropic-ai/claude-agent-sdk` 的 `query`（注入适配 defaultSdkQuery）+ type import `Options`/`SDKMessage`/`SDKResultMessage`/`SettingSource`，零反向依赖（不依赖 application/cli；不 import core——sdk-client 输入输出均为 SDK/基础类型，无 core 领域类型需求）。沿用「纯函数 + 注入式句柄 + Result 抛错」模式：`buildSdkOptions`（§12 字段装配纯函数，settingSources readonly→mutable 展开）+ `collectResult`（result 采集纯函数，usage cache_* 可选 ?? 0 兜底，success 经 subtype 判别收窄取 result 文本）+ `runSdkSession`（async 主入口，for-await 消费 + onMessage 透传 + result 采集 + abort 不捕获传播）。`SdkQueryFn` 类型 + `defaultSdkQuery` 常量把真实 SDK query 隔离为注入点（承接 DEC-019 注入式句柄哲学，测试 fake 覆盖）。`SdkSessionInput`（prompt/cwd/env/systemPromptAppend/model?/abortController/settingSources?/stderr?/onMessage? 全由调用方组装）+ `SdkSessionReport`（终止信息 + raw resultMessage）为 invocation/reviewer 共用契约。`noUncheckedIndexedAccess` 下 `for await` 安全、seen[0]?.type 用可选链。`src/infrastructure/index.ts` 追加 `./sdk/sdk-client.js` 再导出（NodeNext 需 `.js` 后缀）。SDK 字段名对照安装版 0.3.206 .d.ts 校准（DEC-031 + SPEC §12 回写）：options 全部一致（abortController/cwd/env/model/permissionMode/systemPrompt/settingSources/includePartialMessages/stderr）；R-API 差异三处——(1) permissionMode 'bypassPermissions' 须同时 allowDangerouslySkipPermissions:true（.d.ts 1695/1707-1711 硬性要求，§12 未列）；(2) SDKResultError.subtype 扩展 error_max_budget_usd/error_max_structured_output_retries（§12 只列 3 个，sdk-client 把 subtype 当 string 透传不穷举）；(3) SDKMessage 联合成员大幅扩展（status/auth_status/task_*/hook_*/rate_limit_event 等，sdk-client 只对 §12 列举的 type 关注、其余经 onMessage 透传）。扩权安装遇 zod peer 冲突：SDK peer 要 zod ^4.0.0，项目 zod ^3.23.8（实际 3.25.76）——以 `npm install --legacy-peer-deps` + 显式声明 2 个 peer 解决，zod 保持 3.x 不升级（升级 zod 4 波及全项目 core/application/infrastructure zod 代码，超 TASK-030 边界，独立任务 ISS-019）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- sdk-client 会话工厂复用要点（TASK-030）：`runSdkSession(input, queryFn?)`（`src/infrastructure/sdk/sdk-client.ts`）是 TASK-032（ClaudeSdkInvocation）/ TASK-033（SDK Reviewer）调 SDK 的共用入口——装好 options + 跑 query + 流式消费 + result 采集，调用方只组装 SdkSessionInput + 处理 SdkSessionReport / 异常。`SdkSessionInput` 字段全由调用方组装：prompt（startup_prompt + Context Pack 清单）、cwd（worktree）、env（多 provider，TASK-031 按 SPEC §6 组装规则 { ...process.env, <token注入键>, ANTHROPIC_BASE_URL?, 三档映射, ...extraEnv }——⚠ env 整体替换子进程环境，调用方须展开 process.env）、systemPromptAppend（边界/权限清单/产出指令，SPEC §4.4/§4.6）、model（provider 档位映射值）、abortController（SIGINT 接入）、onMessage（§7 流式回调，调用方渲染终端 + 落日志）。`queryFn` 默认 defaultSdkQuery（真实 SDK），测试注入 fake。`SdkSessionReport` 含 subtype/totalCostUsd/usage(input/output/cache_* tokens)/numTurns/durationMs/durationApiMs/isError/resultText + raw resultMessage（供容错分类取 permission_denials/errors/modelUsage，SPEC §8）。abort：abortController.abort() 后 SDK 经流抛 AbortError，runSdkSession 不捕获向上传播——调用方（032）catch 据此产降级 result（§9 保留 worktree）。TASK-032 真实 invocation 经 runSdkSession 跑自主 query，据 report + 模型 JSON 产出（经 §4.2 fenced 块提取）组装 SdkRunReport（重试降级在 032）；TASK-033 reviewer 对称经 runSdkSession 跑独立审查会话。SDK 字段名以安装版 0.3.206 .d.ts 为准（DEC-031 R-API 差异已记 + SPEC §12 已回写）。安装约束（ISS-019）：`npm install` 须带 `--legacy-peer-deps`（SDK peer 要 zod ^4 与项目 zod 3 冲突）；fresh checkout 后须同样方式安装。详见 DEC-030/031 + ISS-019/020。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-019（medium，open）新增自 TASK-030：zod peer 版本冲突——`@anthropic-ai/claude-agent-sdk@0.3.206` peerDependencies 要 zod ^4.0.0，项目锁定 zod ^3.23.8（实际 3.25.76）。SDK 0.3.206 为唯一版本（无兼容 zod 3 的旧版可选）。本任务以 `npm install --legacy-peer-deps` + 显式声明 SDK 的 2 个 peer（@anthropic-ai/sdk、@modelcontextprotocol/sdk）解决：zod 保持 3.25.76（3→4 过渡版，兼容 SDK .d.ts，typecheck/全量 692 项测试全绿印证 @anthropic-ai/sdk peerOptional `^3.25.0 || ^4.0.0` 的兼容意图）。代价：安装命令须带 --legacy-peer-deps（fresh install 不带会因 zod peer 报错）。不阻塞本任务验收（包就位 + 全绿），但建议 Orchestrator 裁定：(A) 加项目根 .npmrc 设 legacy-peer-deps=true（持久化安装约束，.npmrc 不在本任务 allowed_paths）；(B) 独立 zod 4 升级任务（破坏性，波及全项目 core/application/infrastructure zod 代码，须全量适配后正经 SDK peer）；(C) 维持现状 + 文档标注安装命令。详见 ISS-019。\n- ISS-020（low，open）新增自 TASK-030：SDK 及其 peer 引入 4 个传递依赖安全漏洞（npm audit 报 2 moderate / 1 high / 1 critical，来自 @anthropic-ai/sdk / @modelcontextprotocol/sdk 的子依赖链）。本任务范围仅为装 SDK + 建 sdk-client，不处理传递依赖漏洞（不在 allowed_paths，且需评估升级/替换影响）。不阻塞验收（不影响 typecheck/test/sdk-client 功能），建议后续任务或人工 `npm audit` 评估处置。详见 ISS-020。"
    - section: "建议下一个任务"
      mode: replace
      content: "- **TASK-031（Provider Profile 配置读取 + SDK env 组装）** —— `PLAN_claude-sdk-integration` 的第二个任务（layer: page，depends_on TASK-023 ✅ done）。读 `.caw/config.json` provider profile（SPEC §6）+ 组装 SDK env（§6 组装规则 + §12 env 项，多 provider 经 options.env 接 GLM/DeepSeek）+ init 预置 anthropic/glm。**TASK-030 与 TASK-031 无相互依赖，031 本可与 030 并行起步**（本轮已先做 030，031 现为下一个）。拓扑序下一批（依赖 030+031）：TASK-032（ClaudeSdkInvocation 真实实现，depends_on 022✅/030✅/031）、TASK-033（SDK 版 Reviewer，depends_on 027✅/030✅/031）——待 031 完成后两者解锁并可并行。sdk-client（030）已就位供 032/033 复用（runSdkSession 共用入口）。推进 ISS-012（SDK 就位——本任务已装包，真实调用留 032/035）。v0.1.0 终态快照保留于上方各 section；SPEC §12 已据安装版 .d.ts 回写 R-API 差异（DEC-031）。tag/发版（当前 0.1.0/private:true）由人工决定。"
  decisions:
    - id: ""
      title: "扩权新增 @anthropic-ai/claude-agent-sdk 依赖 + zod peer 冲突处理（--legacy-peer-deps + 显式声明 peer + zod 保持 3.x）"
      status: proposed
      scope: package.json + infrastructure/sdk
      created_from_task: TASK-030
      decision: "TASK-030 扩权新增 `@anthropic-ai/claude-agent-sdk@^0.3.206`（PLAN §0-2 扩权独立立项、SPEC §13.2）。安装时发现 SDK 把 zod / @anthropic-ai/sdk / @modelcontextprotocol/sdk 全外部化为 peerDependencies（dependencies 为空），其中 zod peer 要 ^4.0.0 与项目锁定 zod ^3.23.8（实际 3.25.76）冲突；SDK 0.3.206 为唯一版本（无兼容 zod 3 的旧版）。处置决策：(1) zod 保持 ^3.23.8 不升级——升级 zod 4 是破坏性变更，波及全项目 core/application/infrastructure 的 zod 代码（core/schemas 的 z.string().datetime()/z.discriminatedUnion 等），远超 TASK-030 allowed_paths 边界，须独立任务（ISS-019）；(2) 以 `npm install --legacy-peer-deps` 绕过 peer 检查装 SDK——zod 3.25.76 是 zod 3→4 过渡版（@anthropic-ai/sdk peerOptional `^3.25.0 || ^4.0.0` 印证兼容意图），实测 typecheck 0 错误 + 全量 692 项测试全绿，证明 SDK .d.ts 在 zod 3.25.76 下完全可用；(3) 显式声明 SDK 的 2 个 peer（@anthropic-ai/sdk@^0.110.0、@modelcontextprotocol/sdk@^1.29.0）入 package.json dependencies——SDK 把它们外部化为 peer，消费者须自行声明以保证可重现（fresh install 不带 --legacy-peer-deps 时，peer 缺失/冲突仍报错，故安装约束持久，见 ISS-019）。沿用 DEC-029 扩权立项结论落地。"
      rationale: "扩权是 PLAN §0-2 / SPEC §16 显式立项（TASK-001 红线），本任务即承担。zod 不升级：(a) 升级波及面远超 TASK-030 边界（forbidden_paths 含 src/core/application，core/schemas 大量 zod 代码可能需适配）；(b) 3.25.76 经实测兼容 SDK（typecheck + 全量测试全绿），无需升级即可工作；(c) zod 4 升级应作为独立任务充分评估（ISS-019）。--legacy-peer-deps：npm 标准安装选项（非代码 hack），在 AGENTS §3「不引入临时 patch」语境下属可接受的安装约束（非隐藏兼容逻辑，已在 ISS-019/DECISIONS 显式记录 + SPEC/任务约束可追溯）。显式声明 peer：SDK 设计要求消费者提供 peer，声明入 dependencies 保证 package.json 完整可重现（package-lock 已记录）。安装约束（须 --legacy-peer-deps）持久——.npmrc 不在本任务 allowed，留 ISS-019 提议 Orchestrator 加 .npmrc 或立 zod 4 任务。"
      consequences: "package.json dependencies 现 7 项（+SDK +2 peer，zod 不变）。安装命令须 `npm install --legacy-peer-deps`（持久约束，ISS-019）：fresh checkout / CI 须同样方式。后续 SDK 升级若 peer 放宽 zod 要求或 SDK 出兼容 zod 3 的版本，可去除 --legacy-peer-deps。zod 4 升级（若 Orchestrator 采纳）须独立任务全量适配 core/application/infrastructure zod 代码后，改用正经 `npm install`（无 flag）。关联 DEC-029（PLAN 立项）/ DEC-031（sdk-client 设计 + R-API）/ ISS-019（zod peer 冲突）/ ISS-020（传递依赖漏洞）。"
    - id: ""
      title: "sdk-client 会话工厂设计——query 注入 + 流式 + abort + cost 采集 + §12 字段对照安装版 .d.ts 校准（R-API 差异回写 SPEC）"
      status: proposed
      scope: infrastructure/sdk/sdk-client.ts
      created_from_task: TASK-030
      decision: "sdk-client 集中 query() 装配 + 流式消费 + abort + cost/usage 采集为可复用工厂（SPEC §13.1），供 032/033 复用。设计五要点：(1) 注入式 query 句柄 SdkQueryFn——把真实 SDK query 隔离为可替换注入点（承接 DEC-019 哲学），runSdkSession 默认 defaultSdkQuery（真实 SDK），测试注入 fake query 流零真实 API（SPEC §11）；(2) buildSdkOptions 按 §12 装配——全部字段名对照安装版 0.3.206 .d.ts 校准通过（abortController/cwd/env/model/permissionMode/systemPrompt(preset+append)/settingSources/includePartialMessages/stderr），不传 canUseTool(F3)/maxTurns(F4)/resume·continue·forkSession(§2.2)；(3) §12 R-API 三处差异已回写 SPEC §12——(a) permissionMode 'bypassPermissions' 必须同时 allowDangerouslySkipPermissions:true（.d.ts 1695/1707-1711 硬性要求，§12 原未列），(b) SDKResultError.subtype 扩展 error_max_budget_usd/error_max_structured_output_retries（§12 原只列 3 个），sdk-client 把 subtype 当 string 透传不穷举枚举，(c) SDKMessage 联合成员大幅扩展（0.3.206 含 status/auth_status/task_*/hook_*/rate_limit_event 等数十种），sdk-client 只对 §12 列举的 type(system-init/assistant/user/stream_event/result/compact_boundary) 关注、其余经 onMessage 透传不阻断；(4) collectResult 纯结构化采集（subtype/cost/usage/turns/duration/isError/resultText + raw resultMessage），不判 executionStatus（归 032 据 subtype+is_error+JSON 综合判定）；(5) abort 不捕获——abortController.abort() 后 SDK 经流抛 AbortError 向上传播，调用方（032）catch 据此产降级 result（§9 保留 worktree）。sdk-client 不 import core（输入输出均 SDK/基础类型），不承载领域逻辑（JSON 提取/重试/降级归 032）。"
      rationale: "集中工厂避免 032/033 两处重复装配 query/流式/cost（SPEC §13.1 明列 sdk-client 为可选复用件）。注入式 query 承接 DEC-019（编排与 SDK API 解耦、测试 fake），runSdkSession 默认真实 query 开箱即用、测试 fake 覆盖编排逻辑。§12 R-API 回写：SPEC §12「校准来源」明言「实现时仍以安装版 .d.ts 为最终准绳（R-API），差异回写本节」——本任务实证三处差异并回写，使 §12 与安装版 0.3.206 一致（bypassPermissions 的 allowDangerouslySkipPermissions 是阻塞性差异，不设 SDK 拒绝）。subtype 当 string 透传：避免穷举枚举与 SDK 版本耦合（subtype 随版本扩展），sdk-client 只采集不解释。abort 不捕获：§9 要求调用方据中断产降级 result，sdk-client 传播 AbortError 让调用方决策（容错分类归 032）。不判 executionStatus：sdk-client 是通用会话工厂（execution + review 共用），executionStatus 判定含领域语义（结合 JSON 产出）归 032。"
      consequences: "SPEC §12 已据本任务 R-API 差异回写（bypassPermissions+allowDangerouslySkipPermissions、subtype 扩展、SDKMessage 联合扩展说明）。sdk-client 为 032/033 共用入口，两者只组装 SdkSessionInput + 处理 SdkSessionReport/异常。SDK 升级时须重新对照 .d.ts 校准（§12 R-API 持续约束），重点核 allowDangerouslySkipPermissions 是否仍需、subtype/SDKMessage 是否再扩展。defaultSdkQuery 经 value import query 加载真实 SDK（模块加载即 import，纯 JS 无 native 依赖，安全）。关联 DEC-019（注入式句柄）/ DEC-029（PLAN 立项 §12 校准）/ DEC-030（扩权）/ ISS-012（SDK 就位——包已装，真实调用留 032/035）。"
  issues:
    - id: ""
      title: "zod peer 版本冲突——SDK 要 zod ^4，项目 zod ^3，须 --legacy-peer-deps 安装"
      status: open
      severity: medium
      scope: package.json + 安装流程
      created_from_task: TASK-030
      owner: ""
      recommended_action: "`@anthropic-ai/claude-agent-sdk@0.3.206`（唯一版本，无旧版可选）peerDependencies 要 zod ^4.0.0，项目锁定 zod ^3.23.8（实际 3.25.76）。TASK-030 以 `npm install --legacy-peer-deps` + 显式声明 SDK 的 2 个 peer（@anthropic-ai/sdk、@modelcontextprotocol/sdk）解决：zod 保持 3.25.76（3→4 过渡版兼容 SDK .d.ts，typecheck + 全量 692 项测试全绿印证 @anthropic-ai/sdk peerOptional `^3.25.0 || ^4.0.0` 兼容意图）。不阻塞本任务验收（包就位 + 全绿）。代价：安装命令须带 --legacy-peer-deps（fresh install 不带会因 zod peer 报错），此约束持久。建议 Orchestrator 裁定：(A) 加项目根 .npmrc 设 legacy-peer-deps=true 持久化安装约束（.npmrc 不在 TASK-030 allowed_paths，需独立动作）；(B) 独立 zod 4 升级任务（破坏性，波及全项目 core/application/infrastructure zod 代码，须全量适配后改用正经 npm install 无 flag）；(C) 维持现状 + 文档/CI 标注安装命令。推荐 A（最小侵入持久化）或 C（现状可用），B 为长期清洁方案但成本高。关联 DEC-030。"
    - id: ""
      title: "SDK 及其 peer 引入 4 个传递依赖安全漏洞（npm audit：2 moderate/1 high/1 critical）"
      status: open
      severity: low
      scope: package.json 传递依赖
      created_from_task: TASK-030
      owner: ""
      recommended_action: "扩权安装 @anthropic-ai/claude-agent-sdk + @anthropic-ai/sdk + @modelcontextprotocol/sdk 后，npm audit 报 4 个传递依赖漏洞（2 moderate / 1 high / 1 critical，来自上述包的子依赖链）。TASK-030 范围仅为装 SDK + 建 sdk-client，不处理传递依赖漏洞（不在 allowed_paths，且处置需评估升级/替换/override 影响）。不阻塞本任务验收（不影响 typecheck/test/sdk-client 功能；漏洞多在开发期/CLI 子进程上下文，非运行时数据面）。建议后续任务或人工 `npm audit` 评估：若漏洞涉及实际可达路径，用 npm overrides 钉补丁版本或升级 SDK/peer；若为不可达传递依赖，文档标注接受。关联 DEC-030。"
next_action: review
---

# TASK-030 执行结果

## 1. 执行结论

任务完成。`PLAN_claude-sdk-integration` 的第一个任务（扩权 + sdk-client 会话工厂）落地：

- **扩权**：`package.json` 新增 `@anthropic-ai/claude-agent-sdk@^0.3.206` + 2 个 peer（`@anthropic-ai/sdk@^0.110.0`、`@modelcontextprotocol/sdk@^1.29.0`）。SDK 把三者全外部化为 peerDependencies，消费者须声明。
- **zod peer 冲突处理**：SDK peer 要 zod ^4，项目 zod ^3.23.8（实际 3.25.76）。以 `npm install --legacy-peer-deps` + zod 保持 3.x 解决——3.25.76 是 zod 3→4 过渡版，兼容 SDK .d.ts（typecheck + 全量 692 项测试全绿印证）。升级 zod 4 超出本任务边界，独立任务 ISS-019。
- **sdk-client.ts**：可复用 query 会话工厂（buildSdkOptions / collectResult / runSdkSession + SdkQueryFn 注入），供 TASK-032/033 复用。字段对照安装版 0.3.206 .d.ts 校准（§12 R-API 三处差异已回写 SPEC）。

12 项单测全绿，typecheck / lint 0 错误，全量 692 项无回归。

## 2. 完成内容

- `package.json` 扩权新增 3 个依赖（SDK + 2 peer），zod 保持 `^3.23.8`。
- 新建 `src/infrastructure/sdk/sdk-client.ts`：
  - `SdkQueryFn`（注入式 query 句柄类型）+ `defaultSdkQuery`（真实 SDK query 的注入适配）。
  - `SdkSessionInput`（prompt/cwd/env/systemPromptAppend/model?/abortController/settingSources?/stderr?/onMessage?）。
  - `SdkSessionReport`（subtype/cost/usage/turns/duration/isError/resultText + raw resultMessage）。
  - `buildSdkOptions(input)`（§12 字段校准装配，含 R-API 差异 allowDangerouslySkipPermissions）。
  - `collectResult(result)`（终止信息纯结构化采集，不判 executionStatus）。
  - `runSdkSession(input, queryFn?)`（装 options → 跑 query → for-await 流式经 onMessage 透传 → 采集 result → 返回 report；abort 不捕获传播；流无 result 抛错）。
- `src/infrastructure/index.ts` 追加 `./sdk/sdk-client.js` 导出。
- 新建 `test/infrastructure/sdk/sdk-client.test.ts`（12 项：buildSdkOptions §12 字段校准 4 / collectResult 采集 3 / runSdkSession 流式+abort 5）。

## 3. 修改文件

- `package.json`（扩权新增 SDK + 2 peer）
- `src/infrastructure/index.ts`（追加 sdk-client 导出）

## 4. 新增文件

- `src/infrastructure/sdk/sdk-client.ts`
- `test/infrastructure/sdk/sdk-client.test.ts`
- `docs/tasks/TASK-030-infra-sdk-dependency-and-client.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-030（proposed）：扩权新增 SDK 依赖 + zod peer 冲突处理（--legacy-peer-deps + 显式声明 peer + zod 保持 3.x，详见 rationale 论证不升级 zod）。
新增 DEC-031（proposed）：sdk-client 会话工厂设计（query 注入 + 流式 + abort + cost 采集 + §12 字段对照安装版 .d.ts 校准 + R-API 三处差异回写 SPEC）。

## 7. 偏离计划

无规格偏离。两处超出 PLAN/SPEC 原预期的发现已按 R-DEP/R-API 规则显式记录：

1. **zod peer 冲突**（R-DEP 延伸）：PLAN/SPEC 原预期「新增 @anthropic-ai/claude-agent-sdk」单一依赖，实际 SDK 把 zod / @anthropic-ai/sdk / @modelcontextprotocol/sdk 全外部化为 peer，且 zod peer 要 ^4 与项目 ^3 冲突。按 R-DEP「扩权显式立项」+ AGENTS §3「不引入临时 patch / 显式记录」处理：--legacy-peer-deps + 显式声明 peer + zod 保持 3.x（经实测兼容），落 DEC-030 + ISS-019，不改 forbidden_paths。
2. **§12 R-API 差异**（R-API 落地）：SPEC §12「实现以安装版 .d.ts 为最终准绳，差异回写本节」。本任务实证三处差异（bypassPermissions 须 allowDangerouslySkipPermissions / subtype 扩展 / SDKMessage 联合扩展），已回写 SPEC §12，落 DEC-031。sdk-client 据此编码（字段名与 §12 一致，差异处按安装版 .d.ts）。

sdk-client 不实现 ClaudeSdkInvocation 真实类（TASK-032）、不做 Provider Profile（TASK-031）、不调真实 API（TASK-035 CI）——严格遵守 §7。

## 8. 后续任务注意事项

- **安装约束**（ISS-019）：`npm install` 须带 `--legacy-peer-deps`。fresh checkout / CI 须同样方式。Orchestrator 可加 .npmrc 或立 zod 4 升级任务。
- **sdk-client 复用**（TASK-032/033）：`runSdkSession(input, queryFn?)` 共用入口。调用方组装 SdkSessionInput（env 经 031 按 §6 组装、⚠ 须展开 process.env）+ 处理 SdkSessionReport/AbortError。
- **abort 处理**（TASK-032）：runSdkSession 不捕获 AbortError，032 须 catch 据此产降级 result（§9 保留 worktree）。
- **executionStatus 判定归 032**：sdk-client 的 collectResult 只采集不判 status；032 据 subtype/is_error + 模型 JSON 产出综合判定 SdkRunReport.executionStatus。
- **SDK 升级校准**（§12 R-API 持续约束）：SDK 升级时须重新对照 .d.ts，重点核 allowDangerouslySkipPermissions 是否仍需、subtype/SDKMessage 是否再扩展，差异回写 §12。
- **传递依赖漏洞**（ISS-020）：npm audit 报 4 个，后续评估处置。

## 9. 未解决问题

- ISS-019（medium，open）：zod peer 冲突——SDK 要 zod ^4，项目 zod ^3，须 --legacy-peer-deps 安装。详见 frontmatter issues / DEC-030。
- ISS-020（low，open）：SDK 及 peer 的 4 个传递依赖安全漏洞。详见 frontmatter issues / DEC-030。
- ISS-012（medium，open）进展：本任务已装 SDK 包（ISS-012「SDK 未安装」核心部分解决），真实 API 调用留 TASK-032/035。ISS-012 维持 open 直到真实 invocation 就位。
- 既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017）与本任务无触发：sdk-client 纯 infra（不依赖 SQLite、不改状态机、不触发级联/合并），Node v22（ISS-005 约束满足）下全绿。

## 10. 验证结果

- `npm install`（--legacy-peer-deps）：✓ SDK@0.3.206 + @anthropic-ai/sdk@0.110.0 + @modelcontextprotocol/sdk@1.29.0 装入 node_modules，zod 保持 3.25.76。
- `npm run typecheck`：✓ 0 错误（印证 zod 3.25.76 兼容 SDK 0.3.206 .d.ts）。
- `npm test -- infrastructure/sdk/sdk-client`：✓ 12/12 全过。
- `npm run lint`：✓ 0 错误。
- `npm test`（全量）：✓ 692/692 全过（原 680 + sdk-client 12，无回归）。

本任务不依赖 SQLite 原生模块（sdk-client 纯 TypeScript + SDK 类型），typecheck/test/lint 在 Node v22 下全绿。

## 11. 人工验收建议

- 重点核 sdk-client 字段名与 SPEC §12 + 安装版 .d.ts 一致：`buildSdkOptions` 产 abortController/permissionMode/systemPrompt(preset+append)/settingSources/includePartialMessages/env/cwd/stderr，且 **allowDangerouslySkipPermissions:true**（R-API 差异，不设 SDK 拒绝 bypassPermissions）。
- 核不传排除项：buildSdkOptions 不设 canUseTool/maxTurns/resume/continue/forkSession（测试覆盖）。
- 核注入式 query：runSdkSession 接受 queryFn 参数，测试注入 fake query 流断言采集 + abort（零真实 API）。
- 核 abort 传播：fake query 抛 AbortError，runSdkSession rejects AbortError（不捕获）。
- 核 ISS-019 zod peer 冲突处理是否认可（--legacy-peer-deps + zod 保持 3.x），及是否采纳 A（.npmrc）/B（zod 4 升级任务）/C（现状）之一。
- 核 DEC-031 §12 R-API 差异回写是否符合预期（bypassPermissions+allowDangerouslySkipPermissions / subtype 扩展 / SDKMessage 联合扩展）。
- 核 package.json 扩权范围：SDK + 2 peer 是否接受（PLAN 原只提 SDK，peer 是 SDK 运行/类型必需）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress 六条 section（完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-031）、DEC-030 + DEC-031（proposed）、ISS-019 + ISS-020（open）。另 SPEC §12 已据 R-API 差异回写（bypassPermissions 须 allowDangerouslySkipPermissions / subtype 扩展 / SDKMessage 联合扩展说明）。
