---
id: TASK-044
title: 实现串行 Orchestrator Happy Path
status: draft
layer: domain
depends_on:
  - TASK-043
allowed_paths:
  - src/application/orchestration/serial-task-orchestrator.ts
  - src/application/orchestration/index.ts
  - src/application/index.ts
  - test/application/orchestration/serial-task-orchestrator.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
  - src/application/execution
  - src/application/merge
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- serial-task-orchestrator
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/orchestration/task-selector.ts
    - src/application/orchestration/run-policy.ts
    - src/application/orchestration/ports.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/review-task.ts
    - src/application/execution/finalize-task.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/orchestration/task-selector.ts
    - src/application/orchestration/run-policy.ts
    - src/application/orchestration/ports.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/review-task.ts
    - src/application/execution/finalize-task.ts
workflow_outputs:
  result_file: docs/tasks/TASK-044-app-serial-orchestrator-happy-path.result.md
---

# TASK-044 实现串行 Orchestrator Happy Path

## 1. 背景

前置任务已提供可复用的执行、审查、完成用例，以及任务选择、Run Journal 和运行锁。本任务首次把它们组合为多个任务自动连续运行的 application 主循环。

## 2. 当前目标

- 新增 `SerialTaskOrchestrator`。
- 获取运行锁，创建 RunRecord 和任务范围快照。
- 按 Task Selector 逐个推进 draft/ready 任务。
- 自动调用 Execute、Verify、Review、Finalize 用例。
- 每个任务完成并持久化后继续下一个任务。
- 非 happy-path 状态结构化暂停，不实现自动重试。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- TASK-036 至 TASK-043 产出的 application 契约和用例

## 5. 修改范围

- SerialTaskOrchestrator application service。
- 使用 fake Ports 的多任务测试。

## 6. 禁止修改范围

- 不修改单任务用例、core 规则或基础设施。
- 不新增 CLI。
- 不实现自动返工、恢复和幂等回写。

## 7. 不做什么

- 不在 Orchestrator 内重写执行、审查、合并细节。
- 不并行任务。
- 不对 rejected/failed 自动重试；本任务先暂停。

## 8. 架构约束

- Orchestrator 只驱动显式状态和用例，不直接操作 fs、Git、SDK、子进程。
- 每轮重新经仓储读取任务权威状态。
- 同一时刻只能调用一个 Executor 或 Reviewer。
- 所有阶段结果使用判别联合，循环不得依赖异常消息文本分支。
- 主循环和阶段边界需简体中文多行注释。

## 9. 数据流和状态流要求

`Lock → RunRecord → ScopeSnapshot → Select → draft/ready → Execute → Verify → Review → Finalize → Journal checkpoint → Select next → completed`。任一步非成功均写 pause reason、释放锁并返回 paused outcome。

## 10. 预期新增或修改文件

- 新增 `src/application/orchestration/serial-task-orchestrator.ts`。
- 新增多任务 happy-path application 测试。

## 11. 验收标准

- 三个无依赖任务严格按 id 串行完成。
- 有依赖任务严格按拓扑顺序完成。
- 当前任务 Finalize 完成前不选择下一个任务。
- approve-plan 授权只在任务即将执行时推进 draft→ready。
- 每阶段更新 RunRecord 的 current task、状态和成本摘要。
- needs-human、rejected、failed、blocked、冲突均暂停且不启动后继。
- finally 保证锁释放。
- 全部测试只用 fake Ports，不调用真实 Git/SDK。

## 12. 风险提示

主循环不能持有任务对象作为长期缓存，否则前一任务完成后下一轮会看不到最新状态和 Context Pack。每个阶段应使用稳定 task id，并重新读取事实。

## 13. 结束时必须产出

- `docs/tasks/TASK-044-app-serial-orchestrator-happy-path.result.md`
- 记录 happy-path 状态序列和暂停边界
- 提出必要的全局更新建议
