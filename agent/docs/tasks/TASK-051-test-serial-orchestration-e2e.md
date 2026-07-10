---
id: TASK-051
title: 完成串行 Orchestration 端到端与崩溃注入验收
status: draft
layer: test
depends_on:
  - TASK-050
allowed_paths:
  - test/application/orchestration
  - test/application/execution
  - test/infrastructure/run
  - test/infrastructure/process
  - test/infrastructure/git/worktree-adapter.test.ts
  - test/application/merge/recovery.test.ts
  - test/cli/orchestrate.test.ts
  - test/integration/serial-orchestration.test.ts
  - test/integration/claude-sdk-real-api.test.ts
  - src/application/orchestration
  - src/application/execution
  - src/infrastructure/run
  - src/infrastructure/process
  - src/cli/commands/orchestrate.ts
  - src/cli/observability/orchestration-observability.ts
forbidden_paths:
  - src/core/state-machine.ts
  - src/infrastructure/sdk/sdk-client.ts
  - src/infrastructure/mcp
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/recovery-reconciler.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/finalize-task.ts
    - src/infrastructure/run/run-journal-repo.ts
    - src/infrastructure/run/orchestration-lock.ts
    - src/infrastructure/process/verification-runner.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/orchestrate.ts
    - src/cli/observability/orchestration-observability.ts
    - test/integration/claude-sdk-real-api.test.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/application/orchestration/recovery-reconciler.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/finalize-task.ts
    - src/infrastructure/run/run-journal-repo.ts
    - src/infrastructure/run/orchestration-lock.ts
    - src/infrastructure/process/verification-runner.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/orchestrate.ts
    - src/cli/observability/orchestration-observability.ts
    - test/integration/claude-sdk-real-api.test.ts
workflow_outputs:
  result_file: docs/tasks/TASK-051-test-serial-orchestration-e2e.result.md
---

# TASK-051 完成串行 Orchestration 端到端与崩溃注入验收

## 1. 背景

无人值守编排的风险集中在跨层组合和异常时序。单元测试全部通过仍不足以证明不会重复合并、丢状态或错误批准。本任务只做完整验收和必要的缺陷修复，不新增产品能力。

## 2. 当前目标

- 建立真实临时 Git 仓库的多任务串行端到端测试。
- 覆盖 SPEC AC-001 至 AC-014。
- 对 result、review、rebase、ff、writeback、workflow commit、cleanup 各点注入崩溃并恢复。
- 验证严格 SDK Reviewer，不允许 LocalReviewer 降级。
- 补充有 key 运行、无 key 显式 skip 的最小真实 API 契约。
- 修复测试暴露的本功能范围内缺陷。

## 3. 所属层级

`test`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- 新增的 orchestration/execution/run/process/CLI 模块
- 现有 Git 与真实 API 测试

## 5. 修改范围

- Serial orchestration 全层测试。
- 测试暴露的本功能模块缺陷。
- 不扩大产品范围。

## 6. 禁止修改范围

- 不改状态机基本语义。
- 不改 SDK client API 契约。
- 不新增 MCP、UI 或并行调度。
- 不放宽断言以掩盖失败。

## 7. 不做什么

- 不把 fake 测试宣称为真实 API 成功。
- 不依赖测试执行顺序或本机全局 Git 配置。
- 不自动启动浏览器测试。

## 8. 架构约束

- 测试使用临时项目和临时 Git 仓库，结束后清理。
- SDK 生产路径默认 fake invocation；真实 API 仅受环境密钥控制。
- 崩溃注入点必须是显式 Port/fault hook，不用 sleep 猜时序。
- 修复代码仍需职责单一并添加必要的简体中文多行注释。

## 9. 数据流和状态流要求

测试必须验证每一步外部事实：任务 frontmatter、Run Journal、锁、worktree、branch、Git history、result/review、全局文档 receipt、SQLite 重建结果和最终工作区 clean。

## 10. 预期新增或修改文件

- 新增 `test/integration/serial-orchestration.test.ts`。
- 扩展各层测试与真实 API 契约。
- 仅在发现缺陷时修改已限定的功能模块。

## 11. 验收标准

- 三任务无依赖和有依赖两种端到端均一次命令完成。
- 仓库存在历史 draft 时，显式 tasks 范围之外的任务绝不被修改或执行。
- 严格证明执行/审查不并发且 session 独立。
- 自动返工、重试耗尽、needs-human、路径越界、验证失败、合并冲突全部覆盖。
- 六个崩溃点恢复后无重复 side effect。
- 并发启动仅一个实例获得锁。
- 成本门禁和 SIGINT 行为正确。
- 完成后 main clean、worktree 清理、文档与 Git 一致、索引可重建。
- `npm run typecheck`、`npm test`、`npm run lint` 全部通过。

## 12. 风险提示

端到端 Git 测试成本较高，应复用稳定夹具但不能共享可变仓库。Windows/CI 路径和进程行为差异必须覆盖，禁止用平台特判跳过核心验收。

## 13. 结束时必须产出

- `docs/tasks/TASK-051-test-serial-orchestration-e2e.result.md`
- 完整测试矩阵、真实 API skip/执行情况和剩余风险
- 最终全局进度、决策和问题更新建议
