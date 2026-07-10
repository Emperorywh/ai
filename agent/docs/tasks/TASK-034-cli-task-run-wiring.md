---
id: TASK-034
title: task:run CLI 接线 + 可观测性
status: draft
layer: page
depends_on:
  - TASK-026
  - TASK-031
  - TASK-032
allowed_paths:
  - src/cli/commands/task-run.ts
  - test/cli/commands/task-run.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
  - src/cli/commands/task-review.ts
  - src/cli/commands/init.ts
  - src/cli/config/provider-profile.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/commands/task-run
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - docs/SPEC_claude-sdk-integration.md#7-可观测性f5全自主方案的安全绳
  source_files:
    - src/cli/commands/task-run.ts
    - src/cli/config/provider-profile.ts
    - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
workflow_outputs:
  result_file: docs/tasks/TASK-034-cli-task-run-wiring.result.md
---

# TASK-034 task:run CLI 接线 + 可观测性

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0，SPEC §7/§13.2。`task-run.ts`（TASK-026）当前 `:161 options.executor ?? new DryRunLocalExecutor()`，CLI action（`:689`）未传 executor → 默认 DryRun。本任务接线：按 profile 装配真实 invocation 注入 `ClaudeSdkExecutor` + 可观测性（§7）。

## 2. 当前目标

- **装配**（`:161`）：profile token 就位 → 构造 `ClaudeSdkInvocationImpl`（注入 031 的 env/model + 030 sdk-client）→ `ClaudeSdkExecutor(invocation)`；`--executor dry-run` 显式回退 DryRun；token 缺失且未 dry-run 时报错不静默。
- **命令选项**（`TaskRunCommandOptions :669` + `registerTaskRunCommand :679`）：增 `--provider` / `--model` / `--executor`。
- **可观测性**（§7）：
  - 实时流式输出（sdk-client 流式回调驱动终端：工具调用名+路径/命令摘要+结果状态）。
  - 完整日志文件（`.worktrees/<task>/.caw/logs/` 或 `<root>/.caw/logs/`，逐消息+时间戳+轮次+token）。
  - cost/usage 摘要（result 的 `total_cost_usd`/`usage`/`num_turns`/`duration_ms`）。
- **`TaskRunOutcome`**（`:86`）增 cost/usage/轮次/duration 字段；`printOutcome` 打印摘要。
- **启动校验**：`system init` 消息确认 env 注入的 provider/model 生效。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§7/§12/§13.2）、docs/tasks/TASK-034-cli-task-run-wiring.md
- `src/cli/commands/task-run.ts`、`src/cli/config/provider-profile.ts`、`src/infrastructure/sdk/claude-sdk-invocation-impl.ts`

## 5. 修改范围

- `src/cli/commands/task-run.ts`、`test/cli/commands/task-run.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`、`task-review.ts`、`init.ts`、`provider-profile.ts`、`sdk-client.ts`、`invocation-impl.ts`

## 7. 不做什么

- 不改 `TaskExecutor` 契约 / `ClaudeSdkExecutor` 编排（infrastructure 不改）。
- 不做权限拦截（F3）、不设执行墙钟上限（F4）；传输超时由 profile `extraEnv`（`API_TIMEOUT_MS`）控制，非本任务。
- 不做 reviewer 接线（TASK-035）。
- 不调真实 API（本任务用 fake invocation 验装配与 outcome 字段；真实 API 在 TASK-035 CI）。

## 8. 架构约束

- **composition root** 职责：读 profile（031）→ 组装 env → 构造 invocation（032）→ 注入 `ClaudeSdkExecutor`。
- 流式/日志/cost 经 sdk-client 的回调采集。
- 日志路径与 worktree 一致（worktree 内 `.caw/logs/`）。

## 9. 数据流和状态流要求

CLI 解析 `--provider`/`--model`/`--executor` → 031 读 profile 组装 env → 构造 invocation + `ClaudeSdkExecutor` → `execute` → 流式实时输出 + 日志落盘 + cost 摘要 → `TaskRunOutcome`。

## 10. 预期新增或修改文件

- `src/cli/commands/task-run.ts`、`test/cli/commands/task-run.test.ts`

## 11. 验收标准（SPEC §14-3/4）

- `--executor dry-run` 回退 DryRun。
- token 缺失且未 dry-run 时报错不静默。
- SDK 注入路径：流式输出到终端、日志文件含逐消息记录、`TaskRunOutcome` 含非空 cost/usage 字段（真实 API 验证留 TASK-035；本任务用 fake invocation 验装配与 outcome 字段）。
- `typecheck` 0 错误。

## 12. 风险提示

- R-COST：每轮打印 token/cost 供人工介入（§7 软观测）。
- 流式/日志经 sdk-client 回调——确保回调契约与 TASK-030 一致。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-034-cli-task-run-wiring.result.md
- `DECISIONS.md` 更新建议：task:run 装配策略 + 可观测性实现
