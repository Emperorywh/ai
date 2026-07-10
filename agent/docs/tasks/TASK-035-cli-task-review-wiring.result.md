---
doc: result
task_id: TASK-035
execution_status: completed
modified_files:
  - src/cli/commands/task-review.ts
created_files:
  - test/integration/claude-sdk-real-api.test.ts
  - .github/workflows/ci.yml
  - docs/tasks/TASK-035-cli-task-review-wiring.result.md
deleted_files: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test）
  - command: npm test -- task-review
    result: passed
    notes: 既有 13 项全绿（不破）—— auto 回退 LocalReviewer 使 TASK-461/462 runCli 默认路径测试不受影响
  - command: npm test -- claude-sdk-real-api
    result: passed
    notes: 16 项（14 passed + 2 skipped）—— 8 assembleReviewer + 2 reviewTaskWithAssembly e2e + 2 runCli --reviewer + 2 无 key skip 标注；2 skipped 为真实 API 子集（本地无 key）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 warning
  - command: npm test
    result: passed
    notes: 全量 804 passed + 2 skipped / 33 文件全绿（TASK-034 为 790，本任务 +14）
global_update_requests:
  progress:
    - mode: append
      section: 当前完成到哪个任务
      content: |
        - TASK-035（task:review CLI 接线 + CI 真实 API 契约）已完成：`src/cli/commands/task-review.ts`（TASK-027 现有 reviewTask 主体零改动）新增 composition root + CI 真实 API 契约——`assembleReviewer(input) → { reviewer, observability }`（SPEC §6/§13.2 composition root，对称 TASK-034 assembleExecutor：`readProfileConfig → composeProviderEnv`（TASK-031）→ 构造 `ClaudeSdkReviewer`（TASK-033）；reviewerKind 三态：`local` 显式回退 LocalReviewer（不读 token）/ `sdk` 显式 SDK（token 缺失抛错不回退，对称 task:run --executor sdk）/ 省略=auto 读 profile——**关键差异**：auto + key 缺失/配置缺失回退 LocalReviewer + 显著告警（§12 兜底 + ISS-016 不静默放行），**不报错**（与 task:run auto + token 缺失报错不同，因 review 有 LocalReviewer 合法兜底）；`--model` 作具体模型名直写 reviewer.model；可观测回调 onMessage/stderr/abortController 注入 reviewer）+ `reviewTaskWithAssembly`（assembleReviewer → reviewTask → cost 经 getCost 合并入 TaskReviewOutcome，finally close）。`TaskReviewOutcome` 增可选 `cost?: CostSummary`（复用 task-run.ts 导出类型，SDK 路径非空 DryRun/Local undefined）。`registerTaskReviewCommand` 增 `--provider`/`--model`/`--reviewer`/`--config` 四选项（`parseReviewerKind` 校验）；`printOutcome` 增 cost 行打印。reviewTask 本身零改动（`options.reviewer ?? new LocalReviewer()` 保留作直接注入 / legacy 默认，既有 13 测试不破）。**复用而非重实现** task-run.ts 已导出的 `createObservability`/`CostSummary`/`Observability`（import 非修改，forbidden 禁修改非禁依赖，延续 task-review.ts TASK-027 已 import task-run.ts 先例 + AGENTS §3 DRY）。新建 `test/integration/claude-sdk-real-api.test.ts`（14 项 fake + 2 项真实 API 条件跑）+ `.github/workflows/ci.yml`（baseline 基础回归 + real-api-contract 受 secret 控制的真实 API 契约子集，无 key 自动 skip 显式标注）。14 项新增测试 + 既有 13 项全绿，全量 804 项回归全绿。真实 API 流式/cost/model 契约断言留 CI 首次跑通（本任务本地无 key 零真实 API）。**v0.2.0 Claude Agent SDK 接入（PLAN_claude-sdk-integration）至此全部 6 任务完成，双侧真实闭环**。
    - mode: replace
      section: 建议下一个任务
      content: |
        - **v0.2.0 Claude Agent SDK 真实接入（PLAN_claude-sdk-integration）全部 6 个任务（TASK-030~035）已完成**——SDK 依赖+sdk-client（030）/ provider-profile（031）/ ClaudeSdkInvocationImpl 执行侧（032）/ ClaudeSdkReviewer 审查侧（033）/ task:run 接线+§7 可观测性（034）/ task:review 接线+CI 真实 API 契约（035）。双侧（执行 + 审查）真实 SDK 调用闭环，多 provider（anthropic + glm）接入，CI 真实 API 契约子集受 secret 控制（无 key 自动 skip 显式标注）。ISS-012（SDK 就位）/ ISS-016（真实 Reviewer）由本 PLAN 推进至「真实实现就位 + CLI 接线就位」，真实 API 契约首次跑通留 CI 配置 secret 后验证（ISS-024）。**无后续 SDK 接入任务待执行**——后续增强属 P1（deepseek 等更多 provider / cost 累计告警 / SDK mock 降低 CI 成本 / zod 4 升级 ISS-019 / 传递依赖漏洞 ISS-020 / classifyFault 真实错误措辞细化 ISS-022 / cli 共享助手抽取 ISS-015），非本 PLAN 范围。tag/发版（当前 0.1.0/private:true，SDK 接入后语义上宜升 0.2.0）由人工决定。v0.1.0 终态快照保留于上方各 section。
  decisions:
    - id: ''
      title: task:review composition root 装配策略（assembleReviewer reviewerKind 三态 + auto key 缺失回退 LocalReviewer 不报错）+ CI 真实 API 契约策略（describe.skipIf 有 key 跑/无 key skip 标注 + 断言契约不断言文本）
      status: proposed
      rationale: |
        TASK-035 把审查侧 SDK 装配收敛为独立 `assembleReviewer(input) → { reviewer, observability }`（SPEC §6/§13.2
        composition root），与 reviewTask 编排解耦：reviewTask 仍只接受 `options.reviewer`（TASK-027 既有注入点不变），
        CLI action 经 `reviewTaskWithAssembly`（assembleReviewer → reviewTask → cost 合并）串联。装配策略 `reviewerKind`
        三态：`local`（不读 token 直回退 LocalReviewer）/ `sdk`（显式 SDK，token 缺失抛错不回退，对称 task:run --executor sdk）/
        省略=auto（读 profile，token 就位走 SDK）。**与 task:run（assembleExecutor）的关键差异**：task:run 的 auto + token 缺失
        = 报错（执行必须用 SDK，DryRun 是显式选项，SPEC §14.3）；task:review 的 auto + key 缺失/配置缺失 = 回退 LocalReviewer
        + 显著告警（审查有 LocalReviewer 合法兜底，§12「SDK 未就位用本地审查器兜底」+ ISS-016 不静默放行）。该差异是必要的：
        使 `caw task:review <id>`（无 --reviewer）在无 provider 配置时仍跑通（LocalReviewer 确定性 approved → done + 合并），
        不阻断既有工作流；同时也使既有 task-review.test.ts 的 runCli 默认路径测试（TASK-461/462）无需 --reviewer local 标注即
        不破（test/cli/task-review.test.ts 不在本任务 allowed_paths，不可改）。
        CI 真实 API 契约策略（SPEC §11/§14-7/8）：经 vitest `describe.skipIf(!hasKey)` 条件运行——有 ANTHROPIC_API_KEY/
        ZHIPU_API_KEY 时跑最小审查任务（ClaudeSdkReviewer 真实调用，断言 review_result ∈ 合法枚举 + system init model 反映
        档位映射，不断言文本）；无 key 时该子集自动 skip 并经 `describe.skipIf(hasKey)` 反向 describe 跑「skip 显式标注」测试
        （断言 hasKey===false + console.warn 标注），不静默通过。CI workflow 分两 job：baseline（typecheck/lint/test 无真实
        API，快）+ real-api-contract（受 secret 控制，无 key 自动 skip）。
        复用判断：task-run.ts 虽在本任务 forbidden_paths，但 forbidden 约束的是「修改」而非「依赖」——task-review.ts 自 TASK-027
        起即 `import { createFsGlobalDocRepo, sequentialIdAllocator } from './task-run.js'`（先例），本任务仅扩展该 import 追加
        createObservability/CostSummary/Observability（TASK-034 已导出），符合 AGENTS §3「不复制粘贴重复逻辑」（DRY）。
        若不 import 复用而就地重实现 createObservability（~120 行），反成 ISS-015 既抱怨的重复。
      alternatives_considered: |
        装配逻辑塞进 reviewTask 内（破坏 reviewTask 纯编排 + 既有 13 测试需全改）；CLI action 内联装配（cost 流转割裂、不可单测装配）；
        auto + key 缺失报错（对称 task:run，但 task:review 有 LocalReviewer 合法兜底，且会破既有 runCli 测试 + 阻断无配置环境
        的既有工作流）；就地重实现 createObservability（违反 DRY，ISS-015 既抱怨）；真实 API 契约用完整 task:review CLI 链路
        （需 reviewing git/worktree 夹具，过重；直接测 ClaudeSdkReviewer 装配注入对象更轻量且契约等价——SdkReviewOutcome 的
        review_result ∈ 枚举即等价 .review.md 过 ReviewFrontmatterSchema）。
      impact: |
        task-review.ts 新增 ~230 行（装配 + CI 测试导入 + CLI 选项），reviewTask 主体零改动。task:review CLI 默认行为变化：
        `caw task:review <id>`（无 --reviewer）从 TASK-027 静默 LocalReviewer 变为 auto 读 profile（token 就位走真实
        ClaudeSdkReviewer，缺失回退 LocalReviewer + 显著告警）。后续若升 reviewerKind 语义或抽 cli 共享助手（ISS-015），assembleReviewer
        与 assembleExecutor 可统一收口。CI workflow 首建（.github/workflows/ci.yml），项目首次有 CI。关联 DEC-035（task:run 装配
        策略，本任务对称复用）/ DEC-036（§7 可观测性，createObservability 复用）/ DEC-034（ClaudeSdkReviewer 设计）/ DEC-033
        （ClaudeSdkInvocation 同模式参照）。
  issues:
    - id: ''
      title: CI 真实 API 契约断言未经真实环境验证（本地无 key）——system init model 字段提取 + GLM 档位前缀待 CI 首次跑通确认
      status: open
      severity: medium
      scope: test/integration/claude-sdk-real-api.test.ts
      created_from_task: TASK-035
      owner: ''
      recommended_action: |
        本任务本地无 ANTHROPIC_API_KEY/ZHIPU_API_KEY，真实 API 契约子集经 describe.skipIf 跳过（2 skipped），其断言逻辑未经
        真实 SDK 响应验证。首次在 CI 配置 secret 跑通时需确认：① `runRealReviewContract` 的 onMessage 捕获 system init 消息的
        model 字段路径（`(m as {subtype?:string}).subtype === 'init'` → `(m as {model?:string}).model`）是否与安装版 0.3.206
        实际 SDKSystem init 消息结构一致（SPEC §12 第 3 条据类型参考写作，R-API 风险——若 model 在嵌套对象或字段名不同，initModel
        断言 toBeTruthy/toContain 失败，需对照 .d.ts 调整提取路径）；② GLM 第三方端点 system init 的 model 是否真为 `glm-*` 前缀
        （R-PROVIDER，GLM 兼容端点行为差异——若 GLM 回传模型名不含 glm- 前缀，`toContain('glm-')` 断言需放宽）；③ 真实 API 错误
        措辞经 classifyFault（ISS-022）分类是否符合预期（执行/审查两侧通用，观测后一次细化）；④ ClaudeSdkReviewer 真实审查的
        review_result 分布（approved/rejected/needs-human-confirmation）与最小 .result.md 夹具的契合度。非阻塞（SPEC §11 明文真实
        API 集成在 CI、§14-7/8 验收以 CI 跑通为准），但首次 CI 跑通前真实契约未经实证。建议 CI 配置 secret 后首次跑通时人工核验
        上述断言，按需调整提取路径 / 放宽前缀 / 细化 classifyFault。
next_action: review
---

# TASK-035 执行结果

## 1. 执行结论

**completed**。在 `src/cli/commands/task-review.ts`（TASK-027 现有 reviewTask 主体零改动）落地 SDK 接线 + CI 真实 API 契约，复用 TASK-031（provider-profile）/033（ClaudeSdkReviewer）/034（createObservability/CostSummary，import 复用）的已就位产物。14 项新增测试 + 既有 13 项全绿，全量 804 项回归全绿。**v0.2.0 Claude Agent SDK 接入（PLAN_claude-sdk-integration）至此全部 6 任务完成，双侧（执行 + 审查）真实闭环。**

## 2. 实际改动

### 修改
- **`src/cli/commands/task-review.ts`**：
  - imports 增量：`ClaudeSdkReviewer`（infrastructure）/ `createObservability`/`CostSummary`/`Observability`（./task-run.js，import 复用非修改）/ `DEFAULT_CONFIG_PATH`/`composeProviderEnv`/`readProfileConfig`（../config/provider-profile.js，forbidden 只 import）/ `SDKMessage` 类型（@anthropic-ai/claude-agent-sdk，type-only）。
  - `TaskReviewOutcome` 增可选 `cost?: CostSummary`（§7.3，LocalReviewer 为 undefined）。
  - 新增 composition root 段：`ReviewerFactory` 类型 + `AssembleReviewerInput`/`AssembledReviewer` 接口 + `assembleReviewer()`（local 回退 / sdk+auto 读 profile 组装 env 构造 ClaudeSdkReviewer；**auto key 缺失/配置缺失 catch 回退 LocalReviewer + warn，sdk 不回退**）+ `defaultReviewerFactory`（真实 ClaudeSdkReviewer）+ `ReviewTaskWithAssemblyOptions` 接口 + `reviewTaskWithAssembly()`（装配 → reviewTask → cost 合并，finally close）。
  - `TaskReviewCommandOptions` 增 `provider`/`model`/`reviewer`/`configPath` 四字段；`registerTaskReviewCommand` 增 `--provider`/`--model`/`--reviewer`/`--config` 四选项 + `parseReviewerKind()` 校验；action 改调 `reviewTaskWithAssembly`；`printOutcome` 增 cost 行打印。
  - **`reviewTask()` 主体未改**（`options.reviewer ?? new LocalReviewer()` 保留作直接注入 / legacy 默认）。

### 新建
- **`test/integration/claude-sdk-real-api.test.ts`**（16 项 = 14 fake + 2 真实 API 条件跑）：8 assembleReviewer composition root（local/auto 无配置回退/auto token 缺失回退/sdk 就位/sdk 缺失抛错/glm provider/model 覆盖/非法值）+ 2 reviewTaskWithAssembly e2e（SDK fake reviewer → cost 非空 done / auto 无配置 → 回退 LocalReviewer → done）+ 2 runCli --reviewer（local 成功 / foo 非法非零）+ 4 CI 真实 API 契约（anthropic + glm 各：有 key 跑 / 无 key skip 标注，describe.skipIf 条件运行）。
- **`.github/workflows/ci.yml`**（项目首个 CI）：baseline job（typecheck + lint + test，无真实 API）+ real-api-contract job（受 ANTHROPIC_API_KEY/ZHIPU_API_KEY secret 控制，无 key 自动 skip 显式标注）；两 job 均 Node 22 + npm_config_legacy_peer_deps=true（ISS-019/005）。
- **`docs/tasks/TASK-035-cli-task-review-wiring.result.md`**（本文件）。

## 3. 验证结果

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 0 错误 |
| `npm test -- task-review` | ✅ 13 passed（既有不破，auto 回退 LocalReviewer 守住 runCli 默认路径测试）|
| `npm test -- claude-sdk-real-api` | ✅ 14 passed + 2 skipped（真实 API 无 key）|
| `npm run lint` | ✅ 0 错误 0 warning |
| `npm test`（全量）| ✅ 804 passed + 2 skipped / 33 文件（TASK-034 为 790，本任务 +14）|

## 4. 验收逐条对照（任务 §11 / SPEC §14-5/7/8）

- ✅ `task:review` 走 SDK reviewer：assembleReviewer + fake factory 测覆盖（SDK 路径构造 ClaudeSdkReviewer + onMessage/abortController 注入），SdkReviewOutcome review_result ∈ 合法枚举即等价 .review.md 过 ReviewFrontmatterSchema（review_result 是 Schema 枚举字段，单测断言）。
- ✅ `--provider glm` + ZHIPU_API_KEY 路径：assembleReviewer glm 测覆盖（factory 收到 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL + ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.2）；真实 API 跑通 + system init model 反映 GLM 档位断言留 CI 首次跑通（ISS-024，本地无 key）。
- ✅ CI 无 key 时该子集 skip 且显式标注：describe.skipIf(hasKey) 反向 describe 跑「skip 显式标注」测试（断言 hasKey===false + console.warn），不静默通过；CI workflow real-api-contract job 受 secret 控制。
- ✅ `typecheck` 0 错误。

## 5. 红线守界

- 源码仅改 `allowed_paths` 内 `src/cli/commands/task-review.ts` + 新建 `test/integration/claude-sdk-real-api.test.ts` + `.github/workflows/ci.yml`；`forbidden_paths`（core/application/infrastructure/task-run.ts/init.ts/provider-profile.ts）零改动——只经 import 消费（provider-profile 函数 / task-run.ts createObservability+CostSummary / infrastructure ClaudeSdkReviewer / SDK 类型），不改其源码。
- `Reviewer` 契约 / `ClaudeSdkReviewer` 实现 / sdk-client / createObservability 实现零改动（§7 不做什么 + AGENTS §3 DRY 复用）。
- 不新增 npm 依赖（复用 TASK-030 已装的 @anthropic-ai/claude-agent-sdk type-only + 既有 zod）。
- fake 单测驱动 onMessage，零真实 API（§7 不做什么，真实 API 留 CI）。
- 既有 `test/cli/task-review.test.ts`（不在 allowed_paths）零改动——auto 回退 LocalReviewer 设计保证既有 13 测试不破。

## 6. forbidden_paths 的 import 判断说明

本任务 `forbidden_paths` 含 `src/cli/commands/task-run.ts` 与 `src/cli/config/provider-profile.ts`，但 task-review.ts **import 了两者**的导出（createObservability/CostSummary/Observability + composeProviderEnv/readProfileConfig/DEFAULT_CONFIG_PATH）。判断依据：

- **forbidden_paths 约束的是「文件修改权」（写），不是「依赖读取权」（import）**。AGENTS §2 措辞「修复需要越过 forbidden_paths」指修改；ARCHITECTURE §4 只约束跨层依赖方向（application 不直接 import infra 实现），不约束同层（cli 内部）依赖。
- **先例**：task-review.ts 自 TASK-027 起即 `import { createFsGlobalDocRepo, sequentialIdAllocator } from './task-run.js'`（line 29），证明 cli 内部跨命令 import forbidden 文件是被允许的既有模式。
- **DRY**：AGENTS §3「不复制粘贴重复逻辑」要求复用 task-run.ts 已导出的 createObservability（~120 行）而非就地重实现；ISS-015 本就在抱怨 task-review.ts/task-run.ts 重复逻辑，重实现会加重该 issue。

若 Orchestrator 认定 forbidden 含 import，应在 ISSUES 记录并扩 allowed_paths 抽 cli 共享助手模块（ISS-015 既提的 src/cli/shared/）收口 assembleReviewer/assembleExecutor/createObservability。

## 7. global_update_requests

- progress：TASK-035 完成条目（append）+ 建议下一个任务 replace（v0.2.0 全部完成）。
- decisions：DEC-037（task:review 装配策略 + CI 契约策略，proposed）。
- issues：ISS-024（CI 真实 API 契约首次跑通验证，medium）。

## 8. 遗留 issue 与 next_action

- ISS-024（medium，open）：CI 真实 API 契约断言未经真实环境验证（本地无 key）——system init model 字段提取路径 + GLM 档位前缀 + classifyFault 真实错误措辞待 CI 首次跑通确认。
- ISS-012（medium）进展→闭环：本任务完成审查侧 task:review CLI 接线，双侧（执行 034 + 审查 035）真实 SDK 调用闭环；真实 API 契约首次跑通留 CI。
- ISS-016（medium）进展→闭环：task:review 默认从 LocalReviewer 升级为 auto 读 profile（token 就位走真实 ClaudeSdkReviewer），真实 Reviewer 接线就位。
- next_action: review（completed + review 合法组合，TASK-008 状态映射）。
