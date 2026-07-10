---
id: TASK-048
title: 实现 Orchestration Recovery Reconciler 与幂等恢复
status: draft
layer: domain
depends_on:
  - TASK-047
allowed_paths:
  - src/application/orchestration/recovery-reconciler.ts
  - src/application/orchestration/serial-task-orchestrator.ts
  - src/application/orchestration/ports.ts
  - src/application/orchestration/index.ts
  - src/application/merge/recovery.ts
  - src/application/index.ts
  - test/application/orchestration/recovery-reconciler.test.ts
  - test/application/orchestration/serial-task-orchestrator.test.ts
  - test/application/merge/recovery.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
  - src/infrastructure/sdk
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- recovery-reconciler serial-task-orchestrator merge/recovery
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/ports.ts
    - src/application/merge/recovery.ts
    - src/application/execution/finalize-task.ts
    - src/core/schemas/run-schema.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/ports.ts
    - src/application/merge/recovery.ts
    - src/application/execution/finalize-task.ts
    - src/core/schemas/run-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-048-app-orchestration-recovery.result.md
---

# TASK-048 实现 Orchestration Recovery Reconciler 与幂等恢复

## 1. 背景

现有 recoverMerge 只覆盖单任务合并阶段，且尚未接入批量运行。完整无人值守恢复必须同时协调 task status、result/review、Run Journal、worktree、分支、audit commit、全局 request receipt 和 workflow-state commit。

## 2. 当前目标

- 新增 `RecoveryReconciler`，从权威事实推导当前任务真实阶段。
- 覆盖执行、审查、rebase、fast-forward、回写、状态提交和清理后的崩溃点。
- 复用并必要时重构现有 recoverMerge，不复制 Git 恢复逻辑。
- 将 `--resume` 所需 application 入口接入 SerialTaskOrchestrator。
- 对无法唯一判断的状态返回 needs-human pause，不猜测。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- SerialTaskOrchestrator、Run Journal Ports、FinalizeTask、merge/recovery

## 5. 修改范围

- Application RecoveryReconciler。
- SerialTaskOrchestrator resume 路径。
- 现有 merge recovery 的复用性重构。
- 崩溃点和二次恢复测试。

## 6. 禁止修改范围

- 不新增 CLI 参数。
- 不修改 SDK、Schema、Git 适配器具体命令。
- 不引入新的外部进度数据库。

## 7. 不做什么

- 不自动解决语义冲突。
- 不把缺失 result 一律视为重跑许可。
- 不静默删除锁、worktree 或未知分支。

## 8. 架构约束

- 恢复是“观察事实 → 推导动作”，不得依赖上次进程内变量。
- 每个恢复动作必须可重复执行。
- Git 判断经 Port，文档判断经仓储，Journal 只提供检查点。
- 不以错误消息字符串识别阶段。
- 崩溃矩阵和推导顺序需简体中文多行注释。

## 9. 数据流和状态流要求

`RunRecord + TaskDoc + Result/Review + Git facts + receipts → RecoveryPhase → skip/retry-review/retry-merge/replay-writeback/commit/cleanup/pause`。执行动作后重新观察，直至达到稳定状态。

## 10. 预期新增或修改文件

- 新增 `src/application/orchestration/recovery-reconciler.ts`。
- 更新 SerialTaskOrchestrator resume 入口。
- 重构 `application/merge/recovery.ts` 以复用。
- 新增崩溃注入测试。

## 11. 验收标准

- result 写入后崩溃可从验证/状态映射继续。
- review 写入后崩溃不重复 Reviewer。
- rebase 中断会 clean 后重做。
- branch 已进 main 时不重复合并。
- 全局更新已应用时不重复 append。
- workflow-state commit 已存在时只补清理。
- 同一 resume 连续执行两次，第二次无副作用。
- 状态矛盾时暂停并列出全部证据。

## 12. 风险提示

恢复动作顺序若依赖 Journal 而不核对 Git/文档，会在写记录前崩溃时误判。必须以外部事实优先，Journal 用于缩小检查范围和生成审计说明。

## 13. 结束时必须产出

- `docs/tasks/TASK-048-app-orchestration-recovery.result.md`
- 记录恢复判定表、崩溃点和幂等证明
- 提出必要的全局更新建议
