# Claude Task Orchestrator 源码功能说明

本文档描述固定项目契约与 RunState v5 的当前实现。系统不读取项目级配置文件，也不兼容 DAG TASK、额外 TASK 元数据或旧状态版本的数据。

## 1. 系统目标

编排器负责：

1. 从 TASK Markdown 目录加载完整任务集合；
2. 校验静态元数据并建立数字线性序列；
3. 只有前一任务完成后才单并发推进下一任务；
4. 为每个任务启动拥有完整 Claude Code 能力的自主 Worker；
5. 冻结 Worker 产出的完整项目候选；
6. 使用全新只读 Reviewer 审核候选；
7. 为每个完成任务创建原子 Git 提交；
8. 持久化 checkpoint，并支持精确恢复和跨 Run 进度复用。

编排器不提供 TASK 路径白名单，不注入 SDK 路径 Hook，也不运行预声明的外部验收命令。Worker 自行选择实现与非浏览器验证方式，独立 Reviewer 负责最终代码判断。

## 2. 分层与模块边界

### 2.1 领域层

- `domain/project.ts`：集中式编排目录、TASK 元数据与加载后契约。
- `domain/task-sequence.ts`：数字线性排序、序号唯一性和直接前驱推导。
- `domain/run-state.ts`：Run/TASK 状态、合法转换与状态 Schema。
- `domain/task-completion.ts`：任务契约指纹和直接前驱完成指纹。
- `domain/agent-result.ts`：Worker 与 Reviewer 的结构化结果协议。

领域层不读取文件、不执行 Git，也不依赖 Claude SDK。

### 2.2 应用层

- `application/queue-orchestrator.ts`：严格线性驱动器、checkpoint 与 Run 收敛。
- `application/task-execution-service.ts`：实现、审核、修复和提交阶段。
- `application/task-progress-reconciler.ts`：新 Run 的 Git 完成证据核验与复用计划。
- `application/orchestrator-policy.ts`：不可配置的 Worker、Reviewer 与 Git 执行策略。
- `application/prompt-builder.ts`：实现、修复、恢复和审核提示词。
- `application/agent-session-checkpoint.ts`：Claude session 初始化后的精确恢复点。
- `application/run-state-presentation.ts`：UTC 状态到北京时间 CLI 投影。

队列服务决定下一个 TASK；单任务服务只根据当前 TASK 状态推进一个阶段。两者不共享隐式可变状态。

### 2.3 端口层

- `ports/agent-executor.ts`：自主 Worker/只读 Reviewer 执行边界。
- `ports/workspace.ts`：候选捕获、归档、提交、历史证据和仓库身份。
- `ports/state-store.ts`：RunState 和运行产物。
- `ports/project-repository.ts`：加载唯一规格与完整 TASK 集合的边界。
- `ports/run-lock.ts`：项目级单实例锁。
- `ports/event-logger.ts`、`clock.ts`、`time-formatter.ts`：观察与时间边界。

端口中不存在路径边界或外部命令执行器。

### 2.4 基础设施层

- `infrastructure/claude/claude-agent-sdk-executor.ts`：Claude Agent SDK 消息流、结构化输出和中止。
- `infrastructure/git/git-workspace.ts`：候选指纹、隔离归档、原子提交和完成历史。
- `infrastructure/tasks/file-project-repository.ts`：唯一规格与 TASK Markdown 编译。
- `infrastructure/persistence/*`：原子文件状态库与独占锁。
- `infrastructure/logging/*`：控制台和 JSONL 事件。

`cli/composition-root.ts` 是具体实现的唯一装配位置。

## 3. 固定项目与执行契约

所有命令以当前工作目录为项目根，只加载以下集中式结构：

```text
<project-root>/
  orchestration/
    SPEC.md
    tasks/
      <task-id>.md
```

`orchestration/SPEC.md` 是唯一项目级上下文，统一承载规格、架构与执行约束。系统不读取 `PLAN.md`、`AGENTS.md`、`PROGRESS.md` 或任何项目级 YAML、JSON、环境变量、CLI 配置。Worker 固定使用 `sonnet/high`，Reviewer 固定使用全新 `sonnet/high` 只读会话，Git 提交前缀固定为 `task`。

项目结构约定集中在 `domain/project.ts`，执行策略集中在 `application/orchestrator-policy.ts`。初始化器和运行时分别复用这两个单一事实源，不在调用点散落路径或策略常量，也不提供旧根目录 fallback。

## 4. TASK 文档契约

TASK 文件名必须为 `<id>.md`，ID 必须采用 `TASK-数字` 且数字至少三位。TASK 文档只有以下结构：

```markdown
---
id: TASK-002
title: 实现用户列表
---

## 任务描述

这里是任务正文。
```

前置元数据只允许 `id` 和 `title`。`dependsOn`、`maxAttempts`、`timeoutMinutes`、`manualAcceptance`、`status`、`scope`、`gates` 以及其他未知字段都会被严格 Schema 拒绝。任务特有验收事实写入任务描述，通用验收和架构规则写入唯一 `SPEC.md`。

`orchestration/tasks` 是唯一任务事实源。仓储加载其中所有 Markdown 文件后按 ID 数字值排序，拒绝重复 ID 和重复数字序号，不存在配置索引与目录内容漂移的问题。

## 5. Run 启动与队列推进

`run` 调用 `QueueOrchestrator.start()`：

1. 创建北京时间 Run ID；
2. 取得项目级独占锁；
3. 要求 Git 工作区干净；
4. 读取仓库根、分支和 HEAD；
5. 使用项目仓储已经建立的线性 TASK 序列；
6. 核验当前 HEAD 中的完成证据；
7. 创建 RunState v5；
8. 写入启动 checkpoint；
9. 进入 `drive()` 循环。

`drive()` 每轮只推进一个显式事实：

1. 响应外部中断；
2. 归档当前 blocked/failed TASK 的候选；
3. 选择线性序列中的第一个未完成 TASK；
4. 如果该 TASK 已 blocked/failed，则立即结束 Run；
5. 校验此前全部 TASK 已 completed；
6. 调用 `TaskExecutionService.step()`；
7. 原子保存状态并写事件；
8. 重新根据最新状态选择。

队列不维护会漂移的可变游标。选择结果完全由稳定线性序列和持久化 RunState 推导，不能跳过当前任务扫描后继。

## 6. TASK 状态机

正常路径：

```text
pending
  → executing
  → reviewing
  → committing
  → completed
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
- `failed`：不可重试的执行或基础设施错误。

`blocked` 或 `failed` 出现后，当前 Run 立即结束，全部后继保持 `pending`。

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

系统始终使用全新只读 Claude 会话审核。Reviewer 接收项目上下文、当前 TASK 正文、实际变更文件和完整 diff，只能使用读取工具，不得修改文件或创建子 Agent。

审核结果：

- `approved` 且没有 critical/high/medium finding：进入提交；
- `rejected` 或存在实质 finding：携带审核反馈进入 repair；
- `blocked`：TASK 转为人工阻塞；
- 可重试基础设施错误：继续创建全新审核会话；不可重试错误：任务失败。

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
- `Orchestrator-Task-Predecessor`

无文件差异时仍创建空提交，完成事实不依赖 diff 是否非空。

## 10. 跨 Run 进度复用

新 Run 默认读取当前 HEAD 祖先链上的完成提交。TASK 只有同时满足以下条件才复用：

1. 从首个 TASK 到当前 TASK 的全部前序证据已经连续复用；
2. 当前 TASK 的最新完成证据存在；
3. TASK 契约指纹相同；
4. 直接前驱完成提交指纹相同。

任一任务正文或唯一 SPEC 变化都会在该位置断开复用前缀，该任务以及全部后继重新执行。完成契约版本为 v5，旧 DAG 结构产生的证据不会被复用。Reviewer 属于不可关闭的系统契约。

`--fresh` 只禁止本次 Run 复用，不删除历史。

## 11. Checkpoint 与恢复

每个状态转换都会写入 `state.json` 和 `events.jsonl`。Claude session 初始化后立即保存 session ID，因此进程中断时可以判断：

- 会话尚未初始化：创建全新会话；
- 会话已经初始化：使用 SDK `resume` 精确恢复；
- 正在审核：启动全新只读审核；
- 正在提交：通过精确 trailer 查找可能已经成功的提交。

恢复要求项目内容哈希、项目根、仓库根、分支和预期 HEAD 与快照一致，不允许把旧 checkpoint 混入变化后的执行契约。

## 12. 阻塞候选隔离

blocked/failed TASK 的未提交候选会写入确定性的 `refs/claude-task-orchestrator/quarantine/*`，随后清理主工作区并结束 Run。失败现场仍能审计和恢复，后继 TASK 不发生状态转换并保持 `pending`。

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
3. TASK 只有在此前全部 TASK completed 后才能运行；
4. Worker 拥有完整项目修改能力，不存在 TASK 路径白名单；
5. 编排器不运行预声明外部命令；
6. Reviewer 始终只读且使用全新会话；
7. Reviewer 与提交必须绑定同一候选 fingerprint；
8. 原子提交不能夹带父仓库兄弟目录变化；
9. 任务完成证据必须绑定契约和直接前驱提交；
10. 项目级配置文件不进入运行数据流，旧 RunState 不进入兼容路径。

## 15. 自动化验证

测试覆盖：

- 集中式目录加载、旧路径拒绝、配置文件忽略和 TASK 严格解析；
- 数字线性序列、阻塞即停和单并发；
- Worker 完整工具能力且不注入路径 Hook；
- 实现、审核、repair、阻塞和恢复状态流；
- 候选 fingerprint、原子提交、空提交和 quarantine；
- 连续前缀复用与后继失效传播；
- 状态原子写入、锁和北京时间展示。

测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
