---
id: TASK-033
title: SDK 版 Reviewer 实现
status: draft
layer: data
depends_on:
  - TASK-027
  - TASK-030
  - TASK-031
allowed_paths:
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/infrastructure/index.ts
  - test/infrastructure/sdk/claude-sdk-reviewer.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
  - src/cli/commands/task-review.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/sdk-client.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- infrastructure/sdk/claude-sdk-reviewer
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - docs/SPEC_claude-sdk-integration.md#5-审查模型taskreview-侧
  source_files:
    - src/cli/commands/task-review.ts
    - src/infrastructure/sdk/sdk-client.ts
    - src/core/schemas/review-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-033-infra-sdk-reviewer.result.md
---

# TASK-033 SDK 版 Reviewer 实现

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0，SPEC §5。`task:review` 用独立 `Reviewer` 契约（`task-review.ts`，非 `TaskExecutor`）。当前 `LocalReviewer` 兜底（确定性 `approved`）。本任务新增 SDK 版 Reviewer，独立会话审查。

## 2. 当前目标

- **`claude-sdk-reviewer.ts`**：实现 `Reviewer` 接口（`task-review.ts`），`review(ReviewInput) → ReviewOutcome`。
- **独立 SDK 会话**（与执行会话分离，§5）：以 `input.result`（`.result.md` frontmatter）+ worktree 实际改动（模型用 Read/Bash/diff 自读）为审查对象。
- prompt 要求模型对照 §15 审查清单产出 JSON → `ReviewOutcome`（`review_result`: approved/rejected/needs-human-confirmation + `required_changes` + `findings`）。
- **JSON parse 重试降级**同 §4.3：失败重试 N 次，耗尽降级 `needs-human-confirmation`（**不伪造 approved**），`findings` 记 parse 错。
- 经 sdk-client（030）+ provider 配置（031，构造注入）。

## 3. 所属层级

`data`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§5/§15）、docs/tasks/TASK-033-infra-sdk-reviewer.md
- `src/cli/commands/task-review.ts`（`Reviewer`/`ReviewInput`/`ReviewOutcome`）、`src/core/schemas/review-schema.ts`、`src/infrastructure/sdk/sdk-client.ts`

## 5. 修改范围

- `src/infrastructure/sdk/claude-sdk-reviewer.ts`（新）、`src/infrastructure/index.ts`（追加导出）、`test/infrastructure/sdk/claude-sdk-reviewer.test.ts`（新）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/cli`、`src/cli/commands/task-review.ts`（接口不改，装配在 TASK-035）、`claude-sdk-adapter.ts`、`sdk-client.ts`

## 7. 不做什么

- 不改 `Reviewer` 接口 / `ReviewInput` / `ReviewOutcome`（SPEC §3）。
- 不与执行会话共享历史（独立会话，职责分离）。
- `skipped` 仍由 Orchestrator 为 `no_review` 任务生成，不经 Reviewer。
- 不做 CLI 接线（TASK-035）、不实际调真实 API（fake 单测）。

## 8. 架构约束

- 实现 `Reviewer` 接口，被 `task-review.ts`（TASK-035 在 `:200` 装配处）注入。
- **provider 配置经构造注入**（同 TASK-032 模式）；`LocalReviewer` 保留作兜底（SDK 未配置/key 缺失）。
- query options：`cwd`=worktree、`systemPrompt.append`=审查清单+产出 JSON 指令、`permissionMode='bypassPermissions'`。

## 9. 数据流和状态流要求

构造（provider/sdkClient）+ `review(ReviewInput)` → 装 query → sdk-client query → 模型审查（Read/diff worktree）→ JSON 提取/safeParse/重试降级 → `ReviewOutcome`。

## 10. 预期新增或修改文件

- `src/infrastructure/sdk/claude-sdk-reviewer.ts`、`test/infrastructure/sdk/claude-sdk-reviewer.test.ts`、`src/infrastructure/index.ts`

## 11. 验收标准（fake 单测）

- 正常：模型产合法 JSON → `ReviewOutcome`（`review_result` ∈ 合法枚举）。
- parse 失败重试 N 次。
- 耗尽降级 `needs-human-confirmation`（`findings` 记 parse 错，不伪造 approved）。
- 零真实 API；`typecheck` 0 错误。

## 12. 风险提示

- R-JSON：审查结论谎报——降级 `needs-human` 而非伪造 `approved`。
- 审查与执行职责分离——不共享对话历史（§5）。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-033-infra-sdk-reviewer.result.md
- `DECISIONS.md` 更新建议：SDK 版 Reviewer 设计
