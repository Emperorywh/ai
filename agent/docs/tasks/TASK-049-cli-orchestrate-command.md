---
id: TASK-049
title: 实现 caw orchestrate CLI 与严格 SDK Composition Root
status: draft
layer: page
depends_on:
  - TASK-048
allowed_paths:
  - src/cli/framework.ts
  - src/cli/commands/orchestrate.ts
  - src/cli/composition/orchestration-runtime.ts
  - src/cli/config/provider-profile.ts
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
  - test/cli/orchestrate.test.ts
  - test/cli/config/provider-profile.test.ts
  - test/cli/task-run.test.ts
  - test/cli/task-review.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure/sdk/claude-sdk-invocation-impl.ts
  - src/infrastructure/sdk/claude-sdk-reviewer.ts
  - src/infrastructure/git
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/orchestrate provider-profile task-run task-review
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/cli/framework.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/cli/config/provider-profile.ts
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/infrastructure/index.ts
  optional_doc_excerpts: []
  source_files:
    - src/cli/framework.ts
    - src/cli/commands/task-run.ts
    - src/cli/commands/task-review.ts
    - src/cli/config/provider-profile.ts
    - src/application/orchestration/serial-task-orchestrator.ts
    - src/infrastructure/index.ts
workflow_outputs:
  result_file: docs/tasks/TASK-049-cli-orchestrate-command.result.md
---

# TASK-049 实现 caw orchestrate CLI 与严格 SDK Composition Root

## 1. 背景

Application 已具备串行运行和恢复能力，但尚无用户入口。新命令必须是薄 composition root，并且与现有 task:review 的自动 LocalReviewer 降级严格区分。

## 2. 当前目标

- 注册 `caw orchestrate`。
- 实现 SPEC 中 project-root、main-ref、tasks/all-pending、approve-plan、provider、model、max retries、max cost、resume 和 preview 参数。
- 装配真实 SDK Executor/Reviewer、仓储、Git、验证 Runner、Journal 和锁。
- provider/token 缺失时在任何状态变化前失败。
- preview 仅输出范围、拓扑顺序和预计动作，无副作用。
- 将 application outcome 映射为统一退出码。

## 3. 所属层级

`page`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- framework、task-run/task-review composition、provider profile
- SerialTaskOrchestrator 与 infrastructure exports

## 5. 修改范围

- 新 CLI command。
- Orchestration composition root。
- 必要的 provider/SDK 装配复用重构。
- CLI 测试。

## 6. 禁止修改范围

- 不修改 application 业务规则、SDK 会话和 Git 实现。
- 不把恢复或选择逻辑复制到 CLI。
- 不实现可观测性增强，留给 TASK-050。

## 7. 不做什么

- 不允许 `--executor dry-run`。
- 不允许 `--reviewer local`。
- 不在 SDK 装配失败时静默回退。
- 不自动读取或执行当前运行快照之外的新任务。

## 8. 架构约束

- CLI 只解析、装配、调用、展示。
- Provider env 构建只能使用共享 composition helper，避免 task-run/review/orchestrate 三套逻辑。
- 所有选项先完整校验，再 acquire lock 或改任务状态。
- preview 使用同一 Task Selector，但禁止注入可变基础设施。
- 装配边界需简体中文多行注释。

## 9. 数据流和状态流要求

`argv → validated options → provider preflight → ports/adapters → preview or orchestrator start/resume → structured outcome → exit code`。

## 10. 预期新增或修改文件

- 新增 `src/cli/commands/orchestrate.ts`。
- 新增 `src/cli/composition/orchestration-runtime.ts`。
- 注册到 framework。
- 新增 CLI 正反测试。

## 11. 验收标准

- `caw --help` 显示 orchestrate。
- preview 不创建 Journal/lock/worktree，不调用 SDK，不改任务。
- 首次运行缺少 `--tasks`/`--all-pending` 或二者同时出现时，在运行前失败。
- `--tasks TASK-036..TASK-051` 正确展开并持久化为范围快照。
- approve-plan 缺失且仅有 draft 时返回 paused/可行动提示。
- token/config 缺失返回 1，且没有 LocalReviewer approved 产物。
- resume 可选择唯一 active run，多个 active 时要求显式 run id。
- resume 拒绝新的 tasks/all-pending 选择，必须沿用原快照。
- completed=0、paused=2、internal failure=3、SIGINT=130。
- 非法参数在运行前失败。

## 12. 风险提示

不能直接复用 `assembleReviewer` 的 auto 模式，因为它会在 token 缺失时回退 LocalReviewer 并固定批准。Orchestrate 必须使用严格装配路径。

## 13. 结束时必须产出

- `docs/tasks/TASK-049-cli-orchestrate-command.result.md`
- 记录完整 CLI 契约和装配差异
- 提出必要的全局更新建议
