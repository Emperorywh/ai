---
id: TASK-047
title: 实现全局更新 request-id 幂等回写与 Result ID 回填
status: draft
layer: domain
depends_on:
  - TASK-046
allowed_paths:
  - src/core/schemas/result-schema.ts
  - src/core/schemas/decision-issue-schema.ts
  - src/core/index.ts
  - src/application/merge/section-writeback.ts
  - src/application/execution/finalize-task.ts
  - src/application/execution/execute-task.ts
  - src/infrastructure/fs/global-doc-repo.ts
  - src/infrastructure/fs/task-doc-repo.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - test/core/schemas/result-schema.test.ts
  - test/application/merge/section-writeback.test.ts
  - test/application/execution/finalize-task.test.ts
  - test/infrastructure/fs/global-doc-repo.test.ts
  - test/infrastructure/fs/task-doc-repo.test.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
  - test/infrastructure/sdk/claude-sdk-invocation-impl.test.ts
forbidden_paths:
  - src/cli
  - src/infrastructure/sdk/sdk-client.ts
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/infrastructure/git
  - src/infrastructure/sqlite
  - src/application/orchestration/serial-task-orchestrator.ts
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- result-schema section-writeback finalize-task global-doc-repo task-doc-repo
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/core/schemas/result-schema.ts
    - src/core/schemas/decision-issue-schema.ts
    - src/application/merge/section-writeback.ts
    - src/application/execution/finalize-task.ts
    - src/application/execution/execute-task.ts
    - src/infrastructure/fs/global-doc-repo.ts
    - src/infrastructure/fs/task-doc-repo.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  optional_doc_excerpts: []
  source_files:
    - src/core/schemas/result-schema.ts
    - src/application/merge/section-writeback.ts
    - src/application/execution/finalize-task.ts
    - src/application/execution/execute-task.ts
    - src/infrastructure/fs/global-doc-repo.ts
    - src/infrastructure/fs/task-doc-repo.ts
    - src/infrastructure/sdk/claude-sdk-adapter.ts
    - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
workflow_outputs:
  result_file: docs/tasks/TASK-047-app-idempotent-global-writeback.result.md
---

# TASK-047 实现全局更新 request-id 幂等回写与 Result ID 回填

## 1. 背景

当前 decisions/issues 可按 ID 去重，但 proposed ID 在回写时才分配且未回填 result；progress append 重放会重复。恢复功能上线前必须先让所有全局更新可确定性识别和重复执行无副作用。

## 2. 当前目标

- 为 progress/decision/issue update 定义稳定 request id。
- request id 由 run/task/attempt/type/index 确定性生成并通过 Schema 校验。
- 区分模型产出的无 ID proposal 与 Orchestrator 持久化的有 ID request，避免让模型伪造运行标识。
- 让 GlobalDocRepository 识别已应用 request，重复调用返回 already-applied。
- 确保 progress append 不重复、replace 可重放。
- 分配 DEC/ISS ID 后同时更新全局文档和当前 result。
- 将 replace 冲突作为结构化冲突交上层暂停，禁止忽略。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- result/decision/issue schemas
- section-writeback、FinalizeTask、GlobalDocRepository、TaskDocRepository

## 5. 修改范围

- Global update Schema。
- Section writeback 与 Finalize。
- ExecuteTask 对 proposal 的确定性 request 封装，以及 SDK proposal 映射。
- 全局文档和 result 仓储能力。
- 幂等与回填测试。

## 6. 禁止修改范围

- 不修改 CLI、SDK、Git 和 Orchestrator 循环。
- 不实现恢复判定。
- 不用 SQLite 保存幂等 receipt。

## 7. 不做什么

- 不通过正文内容模糊比较判断重复。
- 不静默覆盖语义冲突。
- 不保留无 request id 的 legacy update 结构。

## 8. 架构约束

- request id 的生成规则集中在 application/core 单一位置。
- infrastructure 只实现基于稳定 id 的文档变换。
- ID 分配和 result 回填属于同一 Finalize 事务步骤。
- 幂等 marker 必须机器可读且不破坏人工阅读。
- 复杂解析与重放逻辑添加简体中文多行注释。

## 9. 数据流和状态流要求

`Result proposals → assign request ids → read latest globals → detect receipt/conflict → apply once → assign DEC/ISS ids → write globals → backfill result → workflow-state commit`。

## 10. 预期新增或修改文件

- 更新 result/decision/issue Schema。
- 更新 section-writeback 与全局文档解析变换。
- 更新 Finalize 的 result 回填。
- 更新所有相关测试夹具。

## 11. 验收标准

- 同一 writeback 连续执行两次，第二次三类文档均无内容变化。
- progress append 不重复。
- decision/issue 不重复且分配 ID 稳定。
- result 中 proposal ID 与全局文档最终 ID 一致。
- 同 section 多 replace 返回冲突并阻止完成提交。
- 损坏/重复 request id 显式报错。
- 不依赖 SQLite 或内存 Set 保证跨进程幂等。

## 12. 风险提示

多份全局文档和 result 无法获得文件系统级跨文件事务。必须通过确定性 request id 和可重放步骤实现最终一致，不能假设连续 write 永不崩溃。

## 13. 结束时必须产出

- `docs/tasks/TASK-047-app-idempotent-global-writeback.result.md`
- 记录 request id、receipt 与 ID 回填规则
- 提出必要的全局更新建议
