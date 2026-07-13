# Claude Task Orchestrator

一个基于 `@anthropic-ai/claude-agent-sdk` 的单并发 TypeScript 编排器。它把已经审核过的 SPEC、PLAN 和 TASK 清单变成一条可恢复的无人值守队列：一个命令会持续执行所有任务，不需要人工清空上下文并逐个投喂 TASK。

## 核心执行模型

```text
Manifest 校验与稳定拓扑排序
  → TASK 写入 Worker（全新会话）
  → 路径审计
  → 外部确定性门禁
  → 候选内容指纹
  → 只读 Reviewer（全新会话）
  → 原子 Git 提交
  → 下一个 TASK
```

- 整个项目只有一个队列驱动器和一个项目独占锁，任意时刻最多运行一个 Agent。
- 门禁失败或 Reviewer 拒绝时，会用全新修复会话重试当前 TASK，不污染下游任务上下文。
- SDK/API 临时中断只恢复已确认初始化的同一会话；尚未初始化的会话会换新 UUID。
- 每个状态转换和 SDK `init` 都会落盘。进程或机器中断后使用 `resume` 继续。
- `blocked`、重试耗尽、路径越界和配置漂移都会停止整条队列，不会静默跳过。
- 编排器不会启动浏览器或 UI 自动化。全部 TASK 完成后会生成人工验收清单。

## 环境要求

- Node.js 20+
- pnpm
- Git，且目标项目必须至少有一个提交
- Anthropic API 凭据，例如：

```powershell
$env:ANTHROPIC_API_KEY = "你的 API Key"
```

请使用 Agent SDK 支持的 API 凭据，不要把密钥写入 Manifest、TASK、`.env` 或仓库。

## 安装与初始化

```powershell
pnpm install
pnpm build
pnpm start init .
```

`init` 会生成：

- `orchestrator.yaml`
- `SPEC.md`
- `PLAN.md`
- `AGENTS.md`
- `tasks/TASK-001.md`

它不会覆盖已有文件；初始化任一文件失败时会回滚本次已创建的文件。

## Manifest

最小示例：

```yaml
version: 1

project:
  root: .
  spec: SPEC.md
  plan: PLAN.md
  contextFiles:
    - AGENTS.md

defaults:
  maxAttempts: 3
  taskTimeoutMinutes: 45
  maxTurns: 80
  maxBudgetUsd: 8
  model: sonnet
  effort: high

review:
  enabled: true
  maxAttempts: 2
  model: sonnet
  effort: high
  maxTurns: 30
  maxBudgetUsd: 2

git:
  commitMessagePrefix: task

tasks:
  - id: TASK-001
    title: 实现用户列表状态层
    file: tasks/TASK-001.md
    dependsOn: []
    scope:
      allow:
        - src/features/users/**
        - test/users/**
      deny:
        - src/app/router.ts
        - .env*
    gates:
      - name: typecheck
        command: pnpm
        args: [typecheck]
        timeoutMinutes: 10
      - name: unit-test
        command: pnpm
        args: [test, --, test/users]
        timeoutMinutes: 15
    manualAcceptance:
      - 在浏览器中检查加载、空数据、错误和成功状态
```

约束说明：

- `dependsOn` 构成 DAG；重复 ID、缺失依赖、自依赖和环都会在启动前拒绝。
- `defaults.maxAttempts` 限制写入/修复会话总数，`review.maxAttempts` 限制独立审核会话总数。
- `scope.allow` 至少一项，使用 glob；`deny` 和受保护文档优先级更高。
- Manifest、SPEC、PLAN、共享上下文和全部 TASK 正文都是受保护文件，Worker 无法修改。
- `gates` 使用 `command + args` 直接启动，不经过 shell，也不能写成串联命令。
- 门禁必须是验证命令。若它改变了 Git 候选内容，当前 TASK 会停止，避免提交未经完整门禁验证的版本。
- Worker 的工具集合固定为 `Read/Glob/Grep/Edit/Write`，不开放 Bash、子 Agent、MCP、网络、Skills 或项目 hooks。依赖安装、代码生成等变更应在启动队列前准备并提交，或拆成受人工控制的前置步骤。

## 命令

```powershell
# 只校验配置、文档、路径和 DAG，不调用 Claude
pnpm start validate --manifest orchestrator.yaml

# 新建运行；要求整个 Git 仓库干净
pnpm start run --manifest orchestrator.yaml

# 推荐交给 supervisor 的幂等入口：首次新建、中断后恢复、终态不重跑
pnpm start continue --manifest orchestrator.yaml

# 恢复最近一次运行
pnpm start resume --manifest orchestrator.yaml

# 恢复指定运行
pnpm start resume <run-id> --manifest orchestrator.yaml

# 查看最近或指定运行的完整状态
pnpm start status --manifest orchestrator.yaml
pnpm start status <run-id> --manifest orchestrator.yaml
```

退出码：`0` 表示全部完成，`1` 表示失败或基础设施错误，`2` 表示需要人工决策，`130` 表示收到中断信号且保留了可恢复运行。

按一次 `Ctrl+C` 或发送 `SIGTERM` 会中止当前 Agent/门禁进程树、保存 checkpoint 并释放锁。再次启动时执行 `resume`，不要执行新的 `run`。

## 状态、恢复与 Git

运行状态不写入业务工作区，而是存放在 Git common directory：

```text
.git/claude-task-orchestrator/<project-hash>/
  active.lock
  latest
  runs/<run-id>/
    state.json
    events.jsonl
    summary.md
    manual-acceptance.md
```

恢复前会重新校验以下事实：

- Manifest、SPEC、PLAN、共享上下文和 TASK 内容哈希没有变化。
- 仓库身份和分支没有变化。
- 当前 HEAD 等于上一个预期提交。
- 唯一例外是“Git 提交成功但状态尚未落盘”的崩溃窗口；此时只接受 parent、run、task 和候选指纹全部精确匹配的 HEAD 提交。

每个 TASK 自动产生一个独立提交，并包含 `Orchestrator-Run`、`Orchestrator-Task` 和 `Orchestrator-Candidate` trailer。编排器不执行 push、merge、rebase、reset 或部署。

## 无人值守建议

1. 先完成访谈、SPEC 审核、PLAN 和 TASK 拆分。
2. 保证每个 TASK 有窄而完整的 `scope.allow`、明确依赖和确定性门禁。
3. 提交全部规格与任务文档，确认整个父 Git 仓库干净。
4. 设置预算与超时后只启动一次 `run`。
5. 让进程在终端复用器、服务管理器或 CI runner 中持续运行；外层可始终调用幂等的 `continue`，它不会在已有终态后偷偷新建运行。
6. 最终阅读 `summary.md`，按 `manual-acceptance.md` 人工测试界面。

不要让多个外层守护进程同时启动同一项目。项目锁会拒绝并发实例，但单一 supervisor 的重启策略更容易审计。

## 开发验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

自动化测试全部使用 Fake Agent 或临时本地 Git 仓库，不调用真实 Claude，也不启动浏览器。
