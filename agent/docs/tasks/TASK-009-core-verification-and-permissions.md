---
id: TASK-009
title: Core 验证 allowlist 与权限解析
status: draft
layer: domain
depends_on:
  - TASK-002
allowed_paths:
  - src/core/rules/verification-rules.ts
  - src/core/rules/permission-rules.ts
  - src/core/index.ts
  - test/core/rules/verification-permission.test.ts
forbidden_paths:
  - src/application
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- core/rules
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#16-权限模型
    - Readme.md#68-testingmd
  source_files:
    - src/core/enums.ts
workflow_outputs:
  result_file: docs/tasks/TASK-009-core-verification-and-permissions.result.md
---

# TASK-009 Core 验证 allowlist 与权限解析

## 1. 背景

来自 PLAN P1。验证命令按 `layer` 裁剪（§16 验证 allowlist）与权限解析（deny 优先、allowed/forbidden 重叠检测）是执行期授权的核心规则，需纯函数实现。

## 2. 当前目标

- `verification-rules.ts`：`computeVerificationAllowlist({ taskLayer, testingCommands, taskVerification })`。项目级命令 = `layers` 未声明 ∪ `layers` 含本 layer；再与任务级 `verification` 取并集；同名命令任务级覆盖项目级。
- `permission-rules.ts`：`resolvePathScope(allowed, forbidden)` 检测重叠并告警/拒绝；`requiredExtraPermissions(command)` 推断命令所需额外能力（install/network/start_server/open_browser/delete/config）。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-009-core-verification-and-permissions.md
- Readme.md §16/§6.8

## 5. 修改范围

- `src/core/rules/verification-rules.ts`、`src/core/rules/permission-rules.ts`、`src/core/index.ts`、`test/core/rules/verification-permission.test.ts`

## 6. 禁止修改范围

- `core/enums.ts`、其他 core 文件、application/infrastructure/cli

## 7. 不做什么

- 不执行命令（application/infra 层）。
- 不实现 SDK 权限注入（TASK-022）。

## 8. 架构约束

- 纯函数。`forbidden ∩ allowed` 重叠时 **deny 优先**且返回「拒绝启动」结论（§16）。
- 验证 allowlist 内命令自动获得「仅限该命令行」的执行授权，无需额外 `run_commands`。

## 9. 数据流和状态流要求

输入：任务 frontmatter + TESTING.md 命令声明；输出：实际执行的命令序列 + 命令所需权限 + 路径作用域冲突报告。

## 10. 预期新增或修改文件

- `src/core/rules/verification-rules.ts`、`src/core/rules/permission-rules.ts`、`test/core/rules/verification-permission.test.ts`、`src/core/index.ts`

## 11. 验收标准

- `layers` 裁剪用例：未声明→全 layer 生效；声明→仅命中 layer。
- 任务级覆盖项目级同名命令有用例。
- 路径重叠 → deny 优先 + 拒绝启动有用例。
- `typecheck` 0 错误。

## 12. 风险提示

- 命令所需能力的推断是启发式（字符串匹配 npm install/network 等），需在注释中说明局限性，避免过度断言。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-009-core-verification-and-permissions.result.md
- `PROGRESS.md` 更新建议：Core 层全部完成（P1 收尾）
