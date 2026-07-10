---
id: TASK-040
title: 实现系统验证 Runner 与工作区路径越界审计
status: draft
layer: data
depends_on:
  - TASK-039
allowed_paths:
  - src/application/execution/execute-task.ts
  - src/application/execution/verify-task.ts
  - src/application/execution/path-audit.ts
  - src/application/execution/ports.ts
  - src/infrastructure/process/verification-runner.ts
  - src/infrastructure/git/worktree-adapter.ts
  - src/infrastructure/index.ts
  - src/cli/commands/task-run.ts
  - test/application/execution/path-audit.test.ts
  - test/infrastructure/process/verification-runner.test.ts
  - test/infrastructure/git/worktree-adapter.test.ts
  - test/cli/task-run.test.ts
forbidden_paths:
  - src/core/state-machine.ts
  - src/application/merge
  - src/infrastructure/sdk
  - src/infrastructure/sqlite
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- verification-runner path-audit worktree-adapter task-run
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/execution/execute-task.ts
    - src/application/execution/verify-task.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/task-run.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/execution/execute-task.ts
    - src/application/execution/verify-task.ts
    - src/infrastructure/git/worktree-adapter.ts
    - src/cli/commands/task-run.ts
workflow_outputs:
  result_file: docs/tasks/TASK-040-infra-verification-and-path-audit.result.md
---

# TASK-040 实现系统验证 Runner 与工作区路径越界审计

## 1. 背景

TASK-039 只定义验证领域契约。要让无人值守流程可信，还需要在 worktree 中真实运行命令，并在执行后用 Git 状态复核模型是否修改了允许范围之外的文件。

## 2. 当前目标

- 实现基于子进程的 `VerificationRunnerPort`。
- 采集退出码、耗时、受控 stdout/stderr 摘要和启动错误。
- 实现工作区变更文件枚举，覆盖 tracked、staged、unstaged 和 untracked 文件。
- 新增路径审计用例，校验实际变更均在 allowed paths 且不命中 forbidden paths。
- 将系统验证和路径审计接入单任务执行用例与现有 task-run。

## 3. 所属层级

`data`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- TASK-039 产出的验证契约
- WorktreeAdapter 与 task-run 源码

## 5. 修改范围

- Infrastructure 子进程验证适配器。
- Git 工作区检查原语。
- Application 路径审计和执行接线。
- 相关基础设施、application、CLI 测试。

## 6. 禁止修改范围

- 不修改状态机或合并顺序。
- 不修改 SDK Prompt、provider 或 SQLite。
- 不实现批量 Orchestrator。

## 7. 不做什么

- 不自动删除越界文件。
- 不自动扩展 allowed paths 或 permissions。
- 不启动浏览器或开发服务器。
- 不并行执行验证命令。

## 8. 架构约束

- 命令执行细节必须封装在 infrastructure，application 只消费 Port。
- 输出必须设上限，避免超大日志进入内存和 result。
- 路径规范化必须兼容 Windows/POSIX，按路径段而非裸字符串前缀比较。
- 越界结果必须结构化返回，不能只打印 warning。
- 非显而易见逻辑添加简体中文多行注释。

## 9. 数据流和状态流要求

Executor 返回后先枚举实际变更，再运行系统验证，二者结果写回 result。路径越界或权限不足直接进入 needs-human 门禁；验证失败交 Reviewer 或 no_review 门禁处理。

## 10. 预期新增或修改文件

- 新增 `src/infrastructure/process/verification-runner.ts`。
- 新增 `src/application/execution/path-audit.ts`。
- 扩展 Git/Workspace inspection port 与适配器。
- 更新 execute-task 和 task-run 接线。

## 11. 验收标准

- 真实命令的退出码与输出摘要正确写入验证记录。
- spawn 失败、非零退出和中断均显式返回。
- changed-files 能识别四类 Git 工作区状态。
- allowed 祖先目录、具体文件和 glob 行为有正反测试。
- forbidden 优先，任一命中都阻止完成。
- 模型自报 passed、真实命令 failed 时以系统结果为准。
- 不自动运行浏览器测试。

## 12. 风险提示

命令字符串跨平台执行和进程中断容易产生僵尸进程；必须明确 shell、cwd、环境继承、终止和输出截断语义。

## 13. 结束时必须产出

- `docs/tasks/TASK-040-infra-verification-and-path-audit.result.md`
- 记录验证执行与路径审计的能力边界
- 提出必要的全局更新建议
