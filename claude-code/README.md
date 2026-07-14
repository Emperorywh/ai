# Claude Task Orchestrator

基于 `@anthropic-ai/claude-agent-sdk` 的单并发、可恢复 TASK DAG 编排器。一次运行会自动加载任务目录中的全部 TASK，并持续执行所有当前可运行节点，无需逐个向 Claude Code 投喂任务。

## 执行模型

```text
Manifest 项目策略
  + TASK 目录（唯一任务事实源）
  → 严格元数据校验与稳定 DAG
  → 写入 Worker
  → 路径审计
  → 隔离 worktree 门禁
  → 只读 Reviewer
  → 原子 Git 提交
  → 下一可运行 TASK
```

- 任务目录中的每个 `.md` 文件都会进入目录校验，不存在“文件已创建但未登记”的静默遗漏。
- TASK 的 ID、标题、依赖、scope、门禁和验收项均位于同一文档的 YAML 前置元数据中。
- 门禁在 detached Git worktree 中执行，不能直接改写主候选。
- 门禁产生的 scope 内变化会记录具体文件、显式提升为候选，并自动进入 repair 后从第一道门禁重验。
- 实现、门禁失败和审核意见默认持续进入新一轮 repair，不设置尝试次数、会话时长、轮数或预算上限；只有明确的人工作业阻塞或外部中断才停止当前循环。
- 写入 Worker 可自主使用完整 Claude Code 工具、终端、技能、项目 MCP 和子 Agent，并自行完成非浏览器验证。
- 门禁越界、Agent 需要人工决策等真正阻塞会终止当前 TASK，但不会阻止独立 DAG 分支继续执行。
- 阻塞或失败 TASK 的候选会保存到持久 Git 引用并清理主工作区；其依赖子图标记为 `dependency_blocked`。
- 每次状态转换、SDK 会话初始化、门禁结果和候选归档都会落盘，进程中断后可精确恢复。
- 隔离 worktree 使用独立资源租约释放；Windows 文件占用会触发重试、文件系统兜底和 Git prune，不会覆盖已经完成的门禁结论或中断后续 TASK。
- 编排器不启动浏览器或 UI 自动化。全部可运行任务结束后生成运行摘要和人工验收清单。

## 环境要求

- Node.js 20+
- pnpm
- Git，目标项目至少有一个提交
- Anthropic API 凭据

```powershell
$env:ANTHROPIC_API_KEY = "你的 API Key"
```

不要把密钥写入 Manifest、TASK、`.env` 或仓库。

## 初始化

```powershell
pnpm install
pnpm build
pnpm start init .
```

初始化器增量创建：

- `orchestrator.yaml`
- `SPEC.md`
- `PLAN.md`
- `AGENTS.md`
- `tasks/TASK-001.md`

已有普通文件不会被覆盖；路径类型冲突会回滚本次新建文件。

## Manifest 版本 2

Manifest 只保存项目级策略，不再包含 `tasks:` 数组：

```yaml
version: 2

project:
  root: .
  spec: SPEC.md
  plan: PLAN.md
  contextFiles:
    - AGENTS.md

defaults:
  model: sonnet
  effort: high

review:
  enabled: true
  model: sonnet
  effort: high

git:
  commitMessagePrefix: task

taskCatalog:
  directory: tasks

verification:
  sharedPaths:
    - node_modules
```

`verification.sharedPaths` 用于把已安装依赖显式链接到隔离 worktree。路径必须位于项目内，并且不能覆盖 Git 文件。

默认配置让 Agent 持续执行到任务收敛。只有确实需要人为熔断时，才在 `defaults` 中显式配置 `maxAttempts`、`taskTimeoutMinutes`、`maxTurns`、`maxBudgetUsd`，或在 `review` 中配置对应审核上限；TASK 也可用 `maxAttempts`、`timeoutMinutes` 覆盖项目值。所有上限只要求为正数，不再附加编排器硬编码的最大值。

## TASK 文档

文件名必须严格等于 `<id>.md`，首个一级标题必须为 `# <id> — <title>`：

```markdown
---
id: TASK-002
title: 实现用户列表状态层
dependsOn:
  - TASK-001
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
---

# TASK-002 — 实现用户列表状态层

## 需求

……

## 验收标准

- ……
```

约束：

- `dependsOn` 必须显式声明，根任务使用 `[]`；缺失依赖、重复依赖、自依赖和环都会被拒绝。
- `scope.allow` 至少一项；`deny` 和受保护文档优先级更高。
- `gates` 使用 `command + args` 直接启动，不经过 shell。
- 资源上限全部可选；省略时实现与审核会持续循环，直到通过、真正阻塞或收到外部中断。
- `status` 不允许写在 TASK 中。运行状态只存在于状态库，避免静态文档和真实执行状态漂移。
- 所有 Markdown TASK 都会加载；未知字段、文件名/ID/标题不一致会在运行前失败。

## 命令

```powershell
# 只校验配置、完整任务目录、文档、路径和 DAG
pnpm start validate --manifest orchestrator.yaml

# 新建运行；要求整个 Git 仓库干净
pnpm start run --manifest orchestrator.yaml

# 恢复最近或指定的 running 运行
pnpm start resume --manifest orchestrator.yaml
pnpm start resume <run-id> --manifest orchestrator.yaml

# supervisor 幂等入口：无状态时新建，running 时恢复，终态时返回
pnpm start continue --manifest orchestrator.yaml

# 查看状态
pnpm start status --manifest orchestrator.yaml
pnpm start status <run-id> --manifest orchestrator.yaml
```

退出码：`0` 全部完成，`1` 存在失败或基础设施错误，`2` 存在人工阻塞，`130` 收到中断并保留可恢复状态。

## 状态、门禁与 Git

状态保存在 Git common directory：

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

每次门禁运行保存：

- 门禁前后候选指纹；
- 全部已执行命令的退出码、超时、stdout、stderr 和耗时；
- 门禁改变的具体候选文件；
- `passed/failed/mutated/boundary_violation` 结果。

门禁变化不会直接被当成已验证结果。scope 内变化提升后必须经过新的 repair 会话和完整门禁；越界变化只留在隔离 worktree，不会进入主候选。

每个成功 TASK 产生独立提交，并包含：

- `Orchestrator-Run`
- `Orchestrator-Task`
- `Orchestrator-Candidate`

阻塞/失败候选保存在 `refs/claude-task-orchestrator/quarantine/*`。Worker 虽拥有自主开发工具，但系统工作流仍明确禁止 push、merge、rebase、部署或浏览器测试；Reviewer 始终只读。

## 开发验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

自动化测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
