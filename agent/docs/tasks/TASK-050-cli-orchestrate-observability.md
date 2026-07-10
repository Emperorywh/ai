---
id: TASK-050
title: 接入运行级可观测性、成本门禁、SIGINT 与最终摘要
status: draft
layer: page
depends_on:
  - TASK-049
allowed_paths:
  - src/application/orchestration/serial-task-orchestrator.ts
  - src/application/orchestration/ports.ts
  - src/cli/commands/orchestrate.ts
  - src/cli/composition/orchestration-runtime.ts
  - src/cli/observability/orchestration-observability.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - test/application/orchestration/serial-task-orchestrator.test.ts
  - test/cli/orchestrate.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core/state-machine.ts
  - src/infrastructure/git
  - src/infrastructure/sqlite
  - src/infrastructure/fs
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- serial-task-orchestrator cli/orchestrate task-run task-review
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/cli/commands/orchestrate.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/ports.ts
  optional_doc_excerpts: []
  source_files:
    - src/cli/commands/orchestrate.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-050-cli-orchestrate-observability.result.md
---

# TASK-050 接入运行级可观测性、成本门禁、SIGINT 与最终摘要

## 1. 背景

连续运行可能持续很久。用户不守在终端时仍需要知道当前阶段、每次会话成本、暂停原因和恢复方式。现有 task-run 可观测性是单任务级，需提升为 Run/Task/Attempt/Role 分层事件模型。

## 2. 当前目标

- 定义并接入 OrchestrationEventSink。
- 按 run/task/attempt/executor|reviewer 组织日志。
- 实时显示准备、执行、验证、审查、返工、合并、回写和清理阶段。
- 汇总单会话和运行累计 cost/token/turn/duration。
- 在任务边界执行 max-cost 门禁。
- 接入 SIGINT：中断当前 SDK、暂停、保存 Journal、保留 worktree、退出 130。
- 输出 completed/paused 最终摘要和明确恢复命令。

## 3. 所属层级

`page`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- orchestrate CLI、SerialTaskOrchestrator、现有 task-run observability

## 5. 修改范围

- Application orchestration 事件 Port 和事件发射点。
- CLI observability 实现与共享 SDK message 渲染。
- orchestrate、task-run、task-review 的可复用接线。
- 相关测试。

## 6. 禁止修改范围

- 不改变状态机、Git、文档仓储或 SQLite。
- 不增加新业务状态。
- 不实现通知平台集成。

## 7. 不做什么

- 不把 token、完整 env 或敏感输入写入日志。
- 不在达到成本上限时强杀正在提交状态的任务。
- 不自动启动浏览器或 UI。

## 8. 架构约束

- Application 只发送结构化事件，不调用 console 或文件日志。
- CLI EventSink 负责渲染和落日志。
- 现有 SDK message 解析应抽取复用，不复制。
- SIGINT listener 必须 finally 移除，避免泄漏。
- 事件和中断顺序需简体中文多行注释。

## 9. 数据流和状态流要求

`Application stage events + SDK messages + verification events → EventSink → terminal/log/cost accumulator → Run Journal summary`。SIGINT 触发 abort 后等待当前用例形成可恢复结果，再停止选择新任务。

## 10. 预期新增或修改文件

- 新增 `orchestration-observability.ts`。
- 扩展 orchestration event port 和 Orchestrator 事件。
- 重构 task-run/task-review 现有 observability helper。
- 更新 CLI 测试。

## 11. 验收标准

- 日志路径含 run/task/attempt/role，且多 Attempt 不覆盖。
- 终端能看到任务序号、总数和当前阶段。
- result 消息成本正确累计，Reviewer 成本不遗漏。
- 达到 max cost 后在下一任务前 paused，不破坏已完成任务。
- SIGINT 后 Journal 为 paused、worktree 保留、锁释放、退出 130。
- 日志无 provider token。
- 最终摘要包含 commits、验证、Attempt、成本、决策、问题和恢复命令。

## 12. 风险提示

SIGINT 期间可能正在 Git 提交或全局回写。不得简单在 signal handler 内直接 process.exit；应发出中断意图，由当前阶段在安全检查点完成或交给 RecoveryReconciler。

## 13. 结束时必须产出

- `docs/tasks/TASK-050-cli-orchestrate-observability.result.md`
- 记录事件模型、成本统计和中断语义
- 提出必要的全局更新建议
