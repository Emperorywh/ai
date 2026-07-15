# Claude Task Orchestrator 源码功能说明

本文档描述 Manifest v3 与 RunState v3 的当前实现。系统是全新契约，不兼容包含 `scope`、`gates`、`verification` 或旧状态版本的数据。

## 1. 系统目标

编排器负责：

1. 从 TASK Markdown 目录加载完整任务集合；
2. 校验静态元数据与依赖 DAG；
3. 按稳定拓扑顺序单并发推进任务；
4. 为每个任务启动拥有完整 Claude Code 能力的自主 Worker；
5. 冻结 Worker 产出的完整项目候选；
6. 可选地使用全新只读 Reviewer 审核候选；
7. 为每个完成任务创建原子 Git 提交；
8. 持久化 checkpoint，并支持精确恢复和跨 Run 进度复用。

编排器不提供 TASK 路径白名单，不注入 SDK 路径 Hook，也不运行预声明的外部验收命令。Worker 自行选择实现与非浏览器验证方式，独立 Reviewer 负责最终代码判断。

## 2. 分层与模块边界

### 2.1 领域层

- `domain/manifest.ts`：Manifest v3、TASK 元数据与加载后契约。
- `domain/dag.ts`：依赖合法性和稳定拓扑排序。
- `domain/run-state.ts`：Run/TASK 状态、合法转换与状态 Schema。
- `domain/task-completion.ts`：任务契约指纹和依赖完成指纹。
- `domain/agent-result.ts`：Worker 与 Reviewer 的结构化结果协议。

领域层不读取文件、不执行 Git，也不依赖 Claude SDK。

### 2.2 应用层

- `application/queue-orchestrator.ts`：单并发 DAG 驱动器、checkpoint 与 Run 收敛。
- `application/task-execution-service.ts`：实现、审核、修复和提交阶段。
- `application/task-progress-reconciler.ts`：新 Run 的 Git 完成证据核验与复用计划。
- `application/prompt-builder.ts`：实现、修复、恢复和审核提示词。
- `application/agent-session-checkpoint.ts`：Claude session 初始化后的精确恢复点。
- `application/run-state-presentation.ts`：UTC 状态到北京时间 CLI 投影。

队列服务决定下一个 TASK；单任务服务只根据当前 TASK 状态推进一个阶段。两者不共享隐式可变状态。

### 2.3 端口层

- `ports/agent-executor.ts`：自主 Worker/只读 Reviewer 执行边界。
- `ports/workspace.ts`：候选捕获、归档、提交、历史证据和仓库身份。
- `ports/state-store.ts`：RunState 和运行产物。
- `ports/run-lock.ts`：项目级单实例锁。
- `ports/event-logger.ts`、`clock.ts`、`time-formatter.ts`：观察与时间边界。

端口中不存在路径边界或外部命令执行器。

### 2.4 基础设施层

- `infrastructure/claude/claude-agent-sdk-executor.ts`：Claude Agent SDK 消息流、结构化输出、中止和资源熔断。
- `infrastructure/git/git-workspace.ts`：候选指纹、隔离归档、原子提交和完成历史。
- `infrastructure/tasks/yaml-manifest-repository.ts`：Manifest 与 TASK Markdown 编译。
- `infrastructure/persistence/*`：原子文件状态库与独占锁。
- `infrastructure/logging/*`：控制台和 JSONL 事件。

`cli/composition-root.ts` 是具体实现的唯一装配位置。

## 3. Manifest v3

Manifest 只保存项目级策略：

```yaml
version: 3
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
```

资源熔断字段全部可选：

- `defaults.maxAttempts`
- `defaults.taskTimeoutMinutes`
- `defaults.maxTurns`
- `defaults.maxBudgetUsd`
- `review.maxAttempts`
- `review.maxTurns`
- `review.maxBudgetUsd`

省略时不注入隐藏默认限制，Agent 持续工作到结构化终态或外部中断。

## 4. TASK 文档契约

TASK 文件名必须为 `<id>.md`，首个一级标题必须为 `# <id> — <title>`。

```yaml
---
id: TASK-002
title: 实现用户列表状态层
dependsOn:
  - TASK-001
maxAttempts: 5
timeoutMinutes: 60
manualAcceptance:
  - 在浏览器中验收全部页面状态
---
```

`maxAttempts` 和 `timeoutMinutes` 可以省略。`status`、`scope`、`gates` 以及其他未知字段会被严格 Schema 拒绝。

TASK 目录是唯一任务事实源。仓储加载所有 Markdown 文件后再执行 DAG 校验，不存在 Manifest 列表与目录内容漂移的问题。

## 5. Run 启动与队列推进

`run` 调用 `QueueOrchestrator.start()`：

1. 创建北京时间 Run ID；
2. 取得项目级独占锁；
3. 要求 Git 工作区干净；
4. 读取仓库根、分支和 HEAD；
5. 对 TASK 做稳定拓扑排序；
6. 核验当前 HEAD 中的完成证据；
7. 创建 RunState v3；
8. 写入启动 checkpoint；
9. 进入 `drive()` 循环。

`drive()` 每轮只推进一个显式事实：

1. 响应外部中断；
2. 归档下一个 blocked/failed 候选；
3. 传播下一个依赖阻塞；
4. 优先恢复正在执行、审核或提交的 TASK；
5. 否则选择第一个依赖全部完成的 pending/retry_pending TASK；
6. 调用 `TaskExecutionService.step()`；
7. 原子保存状态并写事件；
8. 重新根据最新状态选择。

队列不维护会漂移的可变游标。选择结果完全由稳定拓扑序和持久化 RunState 推导。

## 6. TASK 状态机

正常路径：

```text
pending
  → executing
  → reviewing（审核开启）
  → committing
  → completed
```

审核关闭时：

```text
executing → committing
```

修复路径：

```text
executing/reviewing
  → retry_pending
  → executing
```

终态：

- `completed`：候选已提交并写入完成证据；
- `blocked`：需要外部信息或人工决策；
- `failed`：不可重试或达到显式上限；
- `dependency_blocked`：直接或传递依赖未完成。

## 7. 自主 Worker

写入 Worker 使用 Claude Code 完整工具预设，并设置：

- `permissionMode: bypassPermissions`
- `allowDangerouslySkipPermissions: true`
- `skills: all`
- `settingSources: user, project, local`
- 项目和本机 MCP 可用
- 子 Agent 可用

执行器不传递文件工具 Hook。TASK 提示词也不包含允许/禁止路径和外部验收命令清单。

提示词仍要求 Worker 只完成当前 TASK，不主动执行 Git 历史操作、部署、浏览器、UI 自动化、开发服务器或 watch 进程。这些是任务职责说明，不是路径能力裁剪。

Worker 必须返回：

```json
{
  "status": "completed | blocked | failed",
  "summary": "...",
  "blockingQuestions": [],
  "notes": []
}
```

结构由 JSON Schema 和 Zod 同时约束，应用层不从自由文本猜测状态。

## 8. 候选冻结与独立审核

Worker 返回 `completed` 后，应用层立即调用 `Workspace.captureCandidate()`：

- 收集项目根内全部 tracked/untracked 变化；
- 对路径、文件类型、模式和内容哈希做稳定排序；
- 计算候选 fingerprint；
- 生成 Reviewer 使用的 Git diff；
- 将 fingerprint 写入 TASK 状态。

审核开启时，使用全新只读 Claude 会话。Reviewer 接收项目上下文、当前 TASK 正文、实际变更文件和完整 diff，只能使用读取工具，不得修改文件或创建子 Agent。

审核结果：

- `approved` 且没有 critical/high/medium finding：进入提交；
- `rejected` 或存在实质 finding：携带审核反馈进入 repair；
- `blocked`：TASK 转为人工阻塞；
- 基础设施错误：按显式审核上限重试或失败。

审核前和提交前都重新捕获候选并比对 fingerprint。任何中途变化都会阻止继续，保证 Reviewer 与 Git 提交绑定同一文件树。

## 9. Git 提交与完成证据

每个完成 TASK 产生独立提交。提交前验证：

- 当前 HEAD 等于 RunState 的 `expectedHead`；
- 父仓库中的项目外目录没有变化；
- 当前候选 fingerprint 等于冻结值。

提交 trailer：

- `Orchestrator-Run`
- `Orchestrator-Project`
- `Orchestrator-Task`
- `Orchestrator-Candidate`
- `Orchestrator-Task-Contract`
- `Orchestrator-Task-Dependencies`

无文件差异时仍创建空提交，完成事实不依赖 diff 是否非空。

## 10. 跨 Run 进度复用

新 Run 默认读取当前 HEAD 祖先链上的完成提交。TASK 只有同时满足以下条件才复用：

1. 最新完成证据存在；
2. TASK 契约指纹相同；
3. 所有直接依赖均已复用；
4. 依赖完成提交指纹相同。

任务正文、人工验收、项目上下文或审核开关变化会使完成证据失效。模型、effort、预算、超时和重试次数只影响执行资源，不改变完成定义。

`--fresh` 只禁止本次 Run 复用，不删除历史。

## 11. Checkpoint 与恢复

每个状态转换都会写入 `state.json` 和 `events.jsonl`。Claude session 初始化后立即保存 session ID，因此进程中断时可以判断：

- 会话尚未初始化：创建全新会话；
- 会话已经初始化：使用 SDK `resume` 精确恢复；
- 正在审核：启动全新只读审核；
- 正在提交：通过精确 trailer 查找可能已经成功的提交。

恢复要求 Manifest 内容哈希、项目根、仓库根、分支和预期 HEAD 与快照一致，不允许把旧 checkpoint 混入变化后的执行契约。

## 12. 阻塞候选隔离

blocked/failed TASK 的未提交候选会写入确定性的 `refs/claude-task-orchestrator/quarantine/*`，随后清理主工作区。这样独立 DAG 分支可以继续执行，失败现场仍能审计和恢复。

依赖该 TASK 的 pending 节点按拓扑顺序转为 `dependency_blocked`，无依赖的其他分支继续运行到全局收敛。

## 13. 状态存储与时间

状态目录位于 Git common directory：

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

状态和事件保存 UTC。CLI、控制台日志、运行摘要和 Run ID 使用固定北京时间投影。

## 14. 关键不变量

1. 同一项目同一时刻只有一个编排器实例；
2. 同一时刻只推进一个 TASK；
3. TASK 只有在直接依赖全部 completed 后才能运行；
4. Worker 拥有完整项目修改能力，不存在 TASK 路径白名单；
5. 编排器不运行预声明外部命令；
6. Reviewer 始终只读且使用全新会话；
7. Reviewer 与提交必须绑定同一候选 fingerprint；
8. 原子提交不能夹带父仓库兄弟目录变化；
9. 任务完成证据必须绑定契约和直接依赖提交；
10. 旧 Manifest 和旧 RunState 不进入兼容路径。

## 15. 自动化验证

测试覆盖：

- Manifest v3 严格解析并拒绝旧字段；
- 稳定 DAG、依赖传播和单并发；
- Worker 完整工具能力且不注入路径 Hook；
- 实现、审核、repair、阻塞和恢复状态流；
- 候选 fingerprint、原子提交、空提交和 quarantine；
- 完成证据复用与下游失效传播；
- 状态原子写入、锁和北京时间展示。

测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
