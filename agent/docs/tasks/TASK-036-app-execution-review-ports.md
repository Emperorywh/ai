---
id: TASK-036
title: 将 Executor 与 Reviewer 契约收敛到 Application Ports
status: draft
layer: domain
depends_on: []
allowed_paths:
  - src/application/ports.ts
  - src/application/execution/ports.ts
  - src/application/index.ts
  - src/infrastructure/sdk/executor-contract.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/infrastructure/index.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - test/application/execution/ports.test.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
  - test/infrastructure/sdk/claude-sdk-reviewer.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core/state-machine.ts
  - src/application/merge
  - src/infrastructure/git
  - src/infrastructure/sqlite
  - docs/SPEC_serial-task-orchestration.md
permissions:
  - delete_files
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- claude-sdk-adapter claude-sdk-reviewer task-run task-review
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/ports.ts
    - src/infrastructure/sdk/executor-contract.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-reviewer.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/ports.ts
    - src/infrastructure/sdk/executor-contract.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-reviewer.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
workflow_outputs:
  result_file: docs/tasks/TASK-036-app-execution-review-ports.result.md
---

# TASK-036 将 Executor 与 Reviewer 契约收敛到 Application Ports

## 1. 背景

当前 TaskExecutor 契约定义在 infrastructure，Reviewer 契约定义在 CLI，SDK Reviewer 又维护一套结构对齐类型。串行 Orchestrator 若直接复用这些类型，会迫使 application 反向依赖 infrastructure 或把业务循环继续堆在 CLI。

## 2. 当前目标

- 在 application 层建立 `TaskExecutorPort` 与 `TaskReviewerPort` 的单一契约。
- 将 Execute/Review 输入输出、权限边界和启动提示所需类型放到正确层级。
- 让 Claude SDK 实现通过结构类型满足 Ports。
- 更新现有 CLI 接线，保持 `task:run`、`task:review` 行为不变。
- 删除不再需要的重复契约，不保留 legacy re-export 或 deprecated 入口。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- 本任务 frontmatter 中的 source_files

## 5. 修改范围

- Application execution/review ports 与导出。
- SDK Executor/Reviewer 对新 Ports 的适配。
- CLI composition root 的类型引用。
- 直接受影响的契约测试。

## 6. 禁止修改范围

- 不修改状态机、结果映射和依赖规则。
- 不修改 Git 合并、SQLite 或全局文档回写。
- 不实现串行循环。

## 7. 不做什么

- 不新增 `caw orchestrate`。
- 不改变 provider、重试、成本或 Reviewer 降级策略。
- 不引入 Run Journal、验证运行器或运行锁。

## 8. 架构约束

- 依赖方向必须保持 `cli → application ← infrastructure`。
- application port 不得出现 Claude SDK 专属类型。
- Executor/Reviewer 输入输出必须各有唯一来源，禁止复制结构类型维持“碰巧兼容”。
- 新增和迁移的非显而易见逻辑必须带简体中文多行注释。

## 9. 数据流和状态流要求

CLI 继续负责实例化 Claude SDK 实现，然后仅以 application port 交给用例。此任务不得改变任务状态流，也不得增加任何运行期隐式状态。

## 10. 预期新增或修改文件

- 新增 `src/application/execution/ports.ts`。
- 修改 application/infrastructure/CLI 的相关导入与导出。
- 旧 `executor-contract.ts` 若已无职责应删除；不得保留转发兼容层。

## 11. 验收标准

- application 不 import infrastructure 或 CLI。
- infrastructure 不 import CLI Reviewer 契约。
- Executor 与 Reviewer 契约均只有一个定义位置。
- `task:run` 与 `task:review` 现有测试语义全部保持。
- TypeScript 编译能够证明 SDK 实现满足 Ports。
- 无 unused legacy 类型或重复接口。

## 12. 风险提示

这是跨层类型迁移任务，最容易出现循环依赖或“临时 re-export”。应一次完成所有调用点迁移，不能留下两套契约。

## 13. 结束时必须产出

- `docs/tasks/TASK-036-app-execution-review-ports.result.md`
- 记录删除/迁移的契约及所有受影响调用点
- 提出必要的全局进度、决策和问题更新建议
