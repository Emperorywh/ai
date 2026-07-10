---
id: TASK-042
title: 实现原子 Run Journal 仓储与 Orchestrator 运行锁
status: draft
layer: data
depends_on:
  - TASK-041
allowed_paths:
  - src/infrastructure/run/run-journal-repo.ts
  - src/infrastructure/run/orchestration-lock.ts
  - src/infrastructure/run/index.ts
  - src/infrastructure/index.ts
  - test/infrastructure/run/run-journal-repo.test.ts
  - test/infrastructure/run/orchestration-lock.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/cli
  - src/infrastructure/git
  - src/infrastructure/sdk
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- run-journal-repo orchestration-lock
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/core/schemas/run-schema.ts
    - src/application/orchestration/ports.ts
    - src/infrastructure/fs/frontmatter-parser.ts
  optional_doc_excerpts: []
  source_files:
    - src/core/schemas/run-schema.ts
    - src/application/orchestration/ports.ts
    - src/infrastructure/fs/frontmatter-parser.ts
workflow_outputs:
  result_file: docs/tasks/TASK-042-infra-run-journal-and-lock.result.md
---

# TASK-042 实现原子 Run Journal 仓储与 Orchestrator 运行锁

## 1. 背景

Run Journal 和单实例锁是无人值守运行的持久化安全绳。本任务只实现基础设施原语，不混入任务选择或恢复策略。

## 2. 当前目标

- 在 `.caw/runs/<run-id>.json` 实现 RunJournalPort。
- 使用临时文件、关闭句柄和同目录原子 rename 更新记录。
- 创建、读取、更新、列举和查找 active run 时均进行 Schema 校验。
- 实现 `.caw/orchestrator.lock` 的原子 acquire/release/inspect。
- 锁记录 PID、run id、项目路径和启动时间，并显式报告活跃/疑似失效状态。

## 3. 所属层级

`data`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- Run Schema 和 orchestration Ports

## 5. 修改范围

- Infrastructure run journal 仓储。
- Infrastructure orchestration lock。
- 相应导出和测试。

## 6. 禁止修改范围

- 不修改 core/application/CLI。
- 不做任务状态流转。
- 不自动删除疑似失效锁。

## 7. 不做什么

- 不实现 `--resume`。
- 不把 Run Journal 写入 SQLite。
- 不存储 SDK 消息正文或 token。

## 8. 架构约束

- 适配器必须结构性满足 TASK-041 Ports。
- 更新失败不得破坏上一个合法记录。
- lock release 必须校验所有权，不能删除其他进程的锁。
- 所有路径使用项目根显式解析，避免依赖 process.cwd 隐式状态。
- 原子性与失效判断逻辑需简体中文多行注释。

## 9. 数据流和状态流要求

`Application RunRecord → schema validate → temp write → atomic rename`。锁由顶层用例在运行开始获取、finally 释放；本层只提供原语，不决定是否接管失效锁。

## 10. 预期新增或修改文件

- 新增 `src/infrastructure/run/run-journal-repo.ts`。
- 新增 `src/infrastructure/run/orchestration-lock.ts`。
- 新增对应测试。

## 11. 验收标准

- 首次 create、重复读取和 update 均返回通过 Schema 的数据。
- 模拟 rename 前失败时旧记录保持完整。
- 损坏 JSON、Schema 非法和多个 active run 显式报错。
- 两个进程/实例竞争锁时仅一个成功。
- 非所有者 release 被拒绝。
- 活跃锁和疑似失效锁可区分且不被静默清理。
- 临时文件在成功后清理。

## 12. 风险提示

Windows 文件 rename、PID 复用和进程存活检测存在平台差异。锁状态应表达“不确定”，不能把探测失败等价为失效。

## 13. 结束时必须产出

- `docs/tasks/TASK-042-infra-run-journal-and-lock.result.md`
- 记录原子写和锁所有权语义
- 提出必要的全局更新建议
