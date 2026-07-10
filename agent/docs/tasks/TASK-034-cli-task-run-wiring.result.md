---
doc: result
task_id: TASK-034
execution_status: completed
modified_files:
  - src/cli/commands/task-run.ts
created_files:
  - docs/tasks/TASK-034-cli-task-run-wiring.result.md
deleted_files: []
verification:
  - command: npm run typecheck
    result: passed
    notes: tsc --noEmit 0 错误（strict + noUncheckedIndexedAccess，src + test）
  - command: npm test -- cli/task-run
    result: passed
    notes: 23 项全绿（13 既有 + 10 新增：6 assembleExecutor + 1 §7 可观测性 + 1 e2e + 2 runCli 装配选项）
  - command: npm run lint
    result: passed
    notes: eslint --ext .ts src test 干净
  - command: npm test
    result: passed
    notes: 全量 790 项 / 32 文件全绿（TASK-033 为 780，本任务 +10）
global_update_requests:
  progress:
    - mode: replace
      section: 当前完成到哪个任务
      content: |
        - TASK-034（task:run CLI 接线 + 可观测性）已完成：`src/cli/commands/task-run.ts`（TASK-026 现有 runTask 不变）新增 composition root + §7 可观测性——`assembleExecutor(input)`（§6/§13.2：readProfileConfig → composeProviderEnv → 构造 ClaudeSdkInvocationImpl + ClaudeSdkExecutor，`--executor dry-run` 显式回退 DryRun、auto/sdk 路径 token 缺失由 buildProviderEnv 抛 ProviderTokenMissingError 不静默 §14.3；`--model` 作具体模型名直写 invocation.model §6）+ `createObservability`（§7 三项可见性经 onMessage 驱动：终端流式渲染 assistant text/tool_use + user tool_result / 完整日志惰性落盘 .caw/logs/<task>-<ts>.log 含时间戳+轮次+类型+JSON / result 消息采集 cost；§9 abortController wire SIGINT，close 移除监听）+ `runTaskWithAssembly`（assembleExecutor → runTask → cost 经 getCost 合并入 TaskRunOutcome，finally close）。`TaskRunOutcome` 增可选 `cost?: CostSummary`（totalCostUsd/input/output/cache_* tokens/numTurns/durationMs，SDK 路径非空 DryRun undefined）。`registerTaskRunCommand` 增 `--provider`/`--model`/`--executor`/`--config` 四选项，action 经 runTaskWithAssembly 装配。runTask 本身不变（`options.executor ?? DryRunLocalExecutor` 保留作直接注入 / legacy 默认，既有测试不破）。10 项新增 e2e/单测（fake invocation 驱动 onMessage 验装配 + cost + 日志 + 流式；真实 API 契约断言留 TASK-035 CI）。
  decisions:
    - id: ''
      title: task:run composition root 装配策略（assembleExecutor 分层 + executor 优先注入 + executorKind 三态）
      status: proposed
      rationale: |
        TASK-034 把 SDK 装配收敛为独立 `assembleExecutor(input) → { executor, observability }`（§6/§13.2 composition root），
        与 runTask 编排解耦：runTask 仍只接受 `options.executor`（TASK-026 既有注入点不变），CLI action 经
        `runTaskWithAssembly`（assembleExecutor → runTask → cost 合并）串联。装配策略 `executorKind` 三态：
        `dry-run`（不读 token 直回退）/ `sdk`（显式 SDK）/ 省略=auto（读 profile，token 就位走 SDK，缺失由
        buildProviderEnv 抛 ProviderTokenMissingError 不静默，SPEC §14.3 / §6 key 缺失）。`--model` 作具体模型名
        直接写入 invocation.model（SPEC §6「覆盖具体模型，写入 options.model」，省略则 SDK 经 ANTHROPIC_DEFAULT_*_MODEL
        env 按档位自选）。executor 优先注入保留 runTask 可测性（既有 13 项测试直接注入 executor 不破）。
      alternatives_considered: 装配逻辑塞进 runTask 内（破坏 runTask 纯编排 + 既有测试需全改）；CLI action 内联装配（cost 流转割裂、不可单测装配）。
      impact: task-run.ts 新增 ~250 行（装配 + 可观测 + CLI 选项），runTask 主体零改动。后续 TASK-035 task:review 装配可对称复用本模式。
    - id: ''
      title: §7 可观测性统一上下文（createObservability：onMessage 三合一 + §9 SIGINT abort + cost 入 outcome）
      status: proposed
      rationale: |
        §7 三项可见性（实时流式 / 完整日志 / cost 摘要）+ §9 SIGINT 中断经单一 `createObservability` 上下文汇集：
        onMessage 回调同时驱动（1）终端渲染 assistant/user 消息（tool_use 名+路径摘要 / tool_result 状态，
        stream_event 等仅入日志不渲染保持终端可读）、（2）惰性 appendFileSync 日志（首条消息建目录，DryRun 无消息
        不产空文件；逐消息记 ISO 时间戳+轮次+类型+JSON）、（3）result 消息采集 cost；stderr 回调追加日志；
        abortController wire process SIGINT（Ctrl+C → abort → invocation catch 产降级 result 保留 worktree §9），
        close() 移除 SIGINT 监听防泄漏。cost（CostSummary）经 runTaskWithAssembly 的 getCost() 合并入 TaskRunOutcome
        供 printOutcome 打印 + 测试断言。onMessage/stderr/abortController 注入 ClaudeSdkInvocationImpl（TASK-032）
        → sdk-client（TASK-030）for-await 透传 SDKMessage 流。
      alternatives_considered: 三项可见性分三个回调（调用方组装繁琐、易漏）；cost 从 .result.md summary 反解析（summary 是自由文本非结构化，不可靠）。
      impact: TaskRunOutcome 增可选 cost 字段（DryRun undefined，向后兼容）；终端输出含 cost 行。SIGINT 单次 abort 后不支持二次强退（graceful 降级为 SPEC §9 既定取舍，未来可加二次 SIGINT → process.exit 增强，本任务不做）。
  issues:
    - id: ''
      title: TASK-034 frontmatter allowed_paths test 路径笔误（test/cli/commands/ 实际为 test/cli/）
      status: open
      severity: low
      scope: docs/tasks/TASK-034-cli-task-run-wiring.md
      created_from_task: TASK-034
      owner: ''
      recommended_action: |
        任务 frontmatter `allowed_paths` 列 `test/cli/commands/task-run.test.ts`，但本项目测试目录无 commands/
        子目录，实际 CLI 测试全部直接在 `test/cli/` 下（init.test.ts / status-rebuild.test.ts / task-run.test.ts /
        task-review.test.ts / plan.test.ts）。本任务在真实存在的 `test/cli/task-run.test.ts` 上修改（任务意图明显为
        「task-run 测试文件」，创建 test/cli/commands/ 副本会是重复且有害）。建议后续修正该 frontmatter 路径为
        test/cli/task-run.test.ts（TASK-035 的 allowed_paths 同此约定）。
next_action: review
---

# TASK-034 执行结果

## 1. 执行结论

**completed**。在 `src/cli/commands/task-run.ts`（TASK-026 现有 runTask 主体零改动）落地 SDK 接线 + §7 可观测性 + §9 SIGINT 中断，复用 TASK-031（provider-profile）/032（ClaudeSdkInvocationImpl）/030（sdk-client onMessage 回调）的已就位产物。10 项新增测试 + 既有 13 项全绿，全量 790 项回归全绿。

## 2. 实际改动

### 修改
- **`src/cli/commands/task-run.ts`**：
  - imports 增量：`appendFileSync`/`mkdirSync`（node:fs）、`dirname`（node:path）、`ClaudeSdkExecutor`/`ClaudeSdkInvocationImpl`/`ClaudeSdkInvocation`（infrastructure）、`composeProviderEnv`/`readProfileConfig`/`DEFAULT_CONFIG_PATH`（cli/config/provider-profile）、`SDKMessage`/`SDKResultMessage` 类型（@anthropic-ai/claude-agent-sdk，type-only，composition root 可知 SDK 类型）。
  - `TaskRunOutcome` 增可选 `cost?: CostSummary`（§7.3，DryRun 为 undefined）。
  - 新增 §7 可观测性段：`CostSummary` 接口 + `Observability` 接口 + `createObservability()`（onMessage 三合一：终端流式 renderMessage + 惰性日志 appendLog + result 消息 extractCost；stderr 日志；abortController wire SIGINT；close 移除监听）+ 渲染/摘要纯辅助（renderMessage/renderAssistantContent/renderUserContent/extractCost/summarizeToolInput/summarizeToolResult/truncate/safeJson）。
  - 新增 composition root 段：`InvocationFactory` 类型 + `AssembleExecutorInput`/`AssembledExecutor` 接口 + `assembleExecutor()`（dry-run 回退 / sdk+auto 读 profile 组装 env 构造 invocation + ClaudeSdkExecutor，非法 executorKind 抛错）+ `defaultInvocationFactory`（真实 ClaudeSdkInvocationImpl）+ `RunTaskWithAssemblyOptions` 接口 + `runTaskWithAssembly()`（装配 → runTask → cost 合并，finally close）。
  - `TaskRunCommandOptions` 增 `provider`/`model`/`executor`/`configPath` 四字段；`registerTaskRunCommand` 增 `--provider`/`--model`/`--executor`/`--config` 四选项 + `parseExecutorKind()` 校验；action 改调 `runTaskWithAssembly`；`printOutcome` 增 cost 行打印。
  - **`runTask()` 主体未改**（`options.executor ?? new DryRunLocalExecutor()` 保留作直接注入 / legacy 默认）。

### 既有测试适配（行为变化）
- **`test/cli/task-run.test.ts`** 两个既有 runCli 测试（reviewing 路径 / 依赖未完成）增 `--executor dry-run`：TASK-034 后 `caw task:run`（无 `--executor`）默认走 auto（读 `.caw/config.json`），临时测试仓库无配置文件 → ENOENT。显式 dry-run 绕过装配直测 runTask 编排本身（reviewing / 依赖检查），测试意图不变。

## 3. 验证结果

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 0 错误 |
| `npm test -- cli/task-run` | ✅ 23 passed（13 既有 + 10 新增）|
| `npm run lint` | ✅ 干净 |
| `npm test`（全量）| ✅ 790 passed / 32 files |

## 4. 验收逐条对照（任务 §11 / SPEC §14.3-4）

- ✅ `--executor dry-run` 回退 DryRun（assembleExecutor + runCli 双测覆盖）。
- ✅ token 缺失且未 dry-run 报错不静默（auto + env:{} → ProviderTokenMissingError）。
- ✅ SDK 注入路径：流式输出到终端（spyOnConsole 断言 Read + src/x.ts）、日志文件含逐消息记录（断言 assistant/result + turn）、TaskRunOutcome 含非空 cost（断言 totalCostUsd/inputTokens/numTurns/durationMs）。真实 API 验证留 TASK-035 CI（本任务用 fake invocation 驱动 onMessage）。
- ✅ typecheck 0 错误。

## 5. 红线守界

- 源码仅改 `allowed_paths` 内 `src/cli/commands/task-run.ts` + `test/cli/task-run.test.ts`（见 ISS-023 路径笔误说明）；`forbidden_paths`（core/application/infrastructure/task-review.ts/init.ts/provider-profile.ts）零改动——只经 import 消费（provider-profile 函数 / infrastructure ClaudeSdkInvocationImpl+ClaudeSdkExecutor / SDK 类型），不改其源码。
- `TaskExecutor` 契约 / `ClaudeSdkExecutor` 编排（claude-sdk-adapter.ts）/ sdk-client / invocation-impl 零改动（§7 不做什么）。
- 不新增 npm 依赖（复用 TASK-030 已装的 @anthropic-ai/claude-agent-sdk type-only）。
- fake 单测驱动 onMessage，零真实 API（§7 不做什么，真实 API 留 TASK-035）。

## 6. global_update_requests

- progress：TASK-034 完成条目（见 frontmatter）。
- decisions：DEC-035（装配策略）+ DEC-036（§7 可观测性 + §9 SIGINT）。
- issues：ISS-023（frontmatter allowed_paths test 路径笔误）。

## 7. 遗留 issue 与 next_action

- ISS-023（low）：frontmatter allowed_paths 路径笔误，建议后续修正（不影响本任务验收）。
- next_action: review（completed + review 合法组合，TASK-008 状态映射）。
