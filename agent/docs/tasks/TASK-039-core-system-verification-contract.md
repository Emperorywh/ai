---
id: TASK-039
title: 定义系统验证记录与验证 Application 用例
status: draft
layer: domain
depends_on:
  - TASK-038
allowed_paths:
  - src/core/schemas/result-schema.ts
  - src/core/rules/verification-rules.ts
  - src/core/rules/permission-rules.ts
  - src/core/index.ts
  - src/application/execution/verify-task.ts
  - src/application/execution/ports.ts
  - src/application/execution/index.ts
  - src/application/index.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - test/core/schemas/result-schema.test.ts
  - test/core/rules/verification-permission.test.ts
  - test/application/execution/verify-task.test.ts
  - test/application/state-orchestrator.test.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
  - test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/infrastructure/git
  - src/infrastructure/sqlite
  - src/infrastructure/mcp
  - src/cli/commands
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- result-schema verification-permission verify-task state-orchestrator
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/core/schemas/result-schema.ts
    - src/core/rules/verification-rules.ts
    - src/core/rules/permission-rules.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/ports.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  optional_doc_excerpts: []
  source_files:
    - src/core/schemas/result-schema.ts
    - src/core/rules/verification-rules.ts
    - src/core/rules/permission-rules.ts
    - src/application/execution/execute-task.ts
    - src/application/execution/ports.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
workflow_outputs:
  result_file: docs/tasks/TASK-039-core-system-verification-contract.result.md
---

# TASK-039 定义系统验证记录与验证 Application 用例

## 1. 背景

当前 result 的 verification 主要来自模型自报，`validateCommandPermissions` 也未进入 task-run 主链。无人值守系统不能在模型声称通过时直接合并，必须建立系统执行验证的领域契约。

## 2. 当前目标

- 扩展验证记录以表达来源、真实退出码、耗时和输出摘要。
- 定义 `VerificationRunnerPort`，不包含 shell 或 Node 进程实现细节。
- 新增 `VerifyTaskUseCase`，计算 allowlist、校验 requires_permissions 并顺序调用 Runner。
- 规定系统结果覆盖同命令模型自报结果。
- 明确 no_review 任务只有系统必需验证全部通过才能完成。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- result schema、verification rules、permission rules
- TASK-037 产出的执行用例

## 5. 修改范围

- Core 验证记录和纯规则。
- Application verification port/use case。
- 受验证记录类型变化影响的 SDK 报告映射。
- 受类型变化影响的测试夹具。

## 6. 禁止修改范围

- 不实现子进程命令执行。
- 不修改 Git、SQLite、MCP 或 CLI command。
- 不实现串行循环。

## 7. 不做什么

- 不执行真实 npm/test 命令作为业务功能；TASK 自身的验收命令除外。
- 不做路径越界 Git diff 检查，留给 TASK-040。
- 不改变 provider 或 SDK 会话。

## 8. 架构约束

- Core 只描述验证数据与纯规则。
- Application 只依赖 `VerificationRunnerPort`。
- 命令身份仍以完整 command 字符串为准。
- 权限缺失必须返回结构化 blocked/needs-human 结果，不能静默跳过。
- Schema 变更按新系统处理，不保留 legacy 双结构。
- 复杂规则添加简体中文多行注释。

## 9. 数据流和状态流要求

`Testing declarations + task verification → allowlist → permission validation → runner result → normalized verification records → result writeback`。任何 required command failed 时，完成门禁必须拒绝 done。

## 10. 预期新增或修改文件

- 扩展 `ResultVerificationSchema`。
- 新增 `verify-task.ts` 和 `VerificationRunnerPort`。
- 更新受影响测试数据。

## 11. 验收标准

- fake Runner 可覆盖 passed/failed/skipped、退出码和超时。
- requires_permissions 缺失时 Runner 不被调用。
- 验证严格串行且顺序确定。
- 同名系统记录覆盖模型自报记录，未执行命令不能伪装 passed。
- no_review 接受规则不再把任意 skipped 当作通过。
- 类型检查和全部受影响测试通过。

## 12. 风险提示

ResultVerification 类型变化会影响大量测试夹具。应使用明确的新结构一次迁移，不能通过 `as unknown` 或宽泛 optional 隐藏缺失字段。

## 13. 结束时必须产出

- `docs/tasks/TASK-039-core-system-verification-contract.result.md`
- 记录 Result Schema 的破坏式变化和调用方迁移情况
- 提出必要的全局更新建议
