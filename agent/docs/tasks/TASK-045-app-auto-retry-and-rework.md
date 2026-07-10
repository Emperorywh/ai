---
id: TASK-045
title: 接入自动返工、Attempt 与 worktree 重试策略
status: draft
layer: domain
depends_on:
  - TASK-044
allowed_paths:
  - src/application/orchestration/serial-task-orchestrator.ts
  - src/application/orchestration/run-policy.ts
  - src/application/execution/execute-task.ts
  - src/application/execution/review-task.ts
  - src/application/context-pack-generator.ts
  - src/application/ports.ts
  - src/core/schemas/result-schema.ts
  - src/core/schemas/review-schema.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/git/worktree-adapter.ts
  - test/application/orchestration/serial-task-orchestrator.test.ts
  - test/application/orchestration/run-policy.test.ts
  - test/application/execution/execute-task.test.ts
  - test/application/context-pack-generator.test.ts
  - test/core/schemas/result-schema.test.ts
  - test/core/schemas/review-schema.test.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
  - test/infrastructure/git/worktree-adapter.test.ts
forbidden_paths:
  - src/cli
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/infrastructure/sqlite
  - src/application/merge/section-writeback.ts
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- serial-task-orchestrator run-policy execute-task context-pack-generator worktree-adapter
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/run-policy.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/review-task.ts
    - src/application/context-pack-generator.ts
    - src/core/schemas/result-schema.ts
    - src/core/schemas/review-schema.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/git/worktree-adapter.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/run-policy.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/review-task.ts
    - src/application/context-pack-generator.ts
    - src/core/schemas/result-schema.ts
    - src/core/schemas/review-schema.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/git/worktree-adapter.ts
workflow_outputs:
  result_file: docs/tasks/TASK-045-app-auto-retry-and-rework.result.md
---

# TASK-045 接入自动返工、Attempt 与 worktree 重试策略

## 1. 背景

Happy-path Orchestrator 遇到 rejected/failed 即暂停，尚不能无人值守完成可自动修正的问题。本任务接入有界 Attempt、Reviewer 反馈和两种 worktree 重试语义。

## 2. 当前目标

- 对 rejected 和 `failed + retry` 实现有界自动重试。
- 正确定义首次 + N 次重试的 Attempt 计数。
- 为 result/review 增加并持久化 `run_id` 与 `attempt` 关联字段。
- 新 Attempt 使用全新 Executor 会话。
- 将最新 result、review、required changes、findings 和 Git diff 注入返工 Context Pack。
- 实现 `restart_on_retry` 为 false 的续修和 true 的干净重置。
- 重试耗尽后转 blocked 并暂停。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- SerialTaskOrchestrator、RunPolicy、Context Pack、WorktreeAdapter

## 5. 修改范围

- Orchestrator 重试分支。
- 返工 Context Pack。
- Result/Review 的 Run/Attempt 关联字段及 Executor 映射。
- Worktree reset 跨进程可恢复语义。
- Attempt/重试相关测试。

## 6. 禁止修改范围

- 不修改 CLI 或 SDK 内部 JSON/网络重试。
- 不实现 Git 完成提交、全局回写幂等或崩溃恢复。
- 不自动重试 needs-human、权限错误或合并冲突。

## 7. 不做什么

- 不复用旧聊天 session。
- 不无限重试。
- 不在 restart_on_retry 时丢失 Attempt 审计摘要。

## 8. 架构约束

- 任务级重试与 SDK 技术重试必须是两个显式层级。
- Worktree reset 基线不能只存在于进程内 Map；必须可由 Git/任务事实重建。
- 返工资料通过文件和 Context Pack 传递，不通过内存聊天历史。
- 所有可/不可重试分类必须集中在 RunPolicy。
- 复杂重试逻辑添加简体中文多行注释。

## 9. 数据流和状态流要求

`rejected/failed+retry → policy → attempt+1 → retain/reset worktree → refreshed retry context → ready/running → new Executor → Verify → new Reviewer`。超限则 `blocked + paused`。

## 10. 预期新增或修改文件

- 更新 SerialTaskOrchestrator、RunPolicy、ExecuteTask 和 Context Pack。
- 修正 WorktreeAdapter reset 的可恢复基线能力。
- 扩展相关测试矩阵。

## 11. 验收标准

- 第一次 rejected、第二次 approved 自动完成且无需人工。
- `max-task-retries=2` 最多产生 3 个 Attempt。
- Attempt 2 明确包含 Attempt 1 review required changes。
- 每份 result/review 可唯一追溯到 run id 和 Attempt。
- restart false 保留现有改动；restart true 回到正确最新基线。
- needs-human、权限不足、Schema 错误和冲突不重试。
- 重试耗尽保留 worktree、最后 result/review 和可行动暂停原因。
- 每个 Attempt 使用不同 SDK session id。

## 12. 风险提示

reset 到“create 时旧 main”会丢失前序任务的新基线；必须定义为当前任务可执行时记录的稳定 base，并支持恢复后重新解析，不能沿用仅内存 bases。

## 13. 结束时必须产出

- `docs/tasks/TASK-045-app-auto-retry-and-rework.result.md`
- 记录 Attempt、重试分类和 worktree 策略
- 提出必要的全局更新建议
