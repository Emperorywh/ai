# Apex Coding Agent 源码功能说明

本文描述 `apex-coding-agent` 当前的固定项目契约与 RunState v6。系统是全新架构：不兼容 DAG TASK、额外 TASK 元数据、旧状态版本或旧产品命名空间数据，也不保留灰度、fallback 与 deprecated 分支。

## 1. 系统目标

编排器负责：

1. 从集中式 Markdown 目录加载完整 TASK 集合并建立数字线性序列；
2. 核验当前 Git HEAD 中可复用的连续完成前缀；
3. 为当前 TASK 编译确定性轻量项目导航清单；
4. 启动拥有完整 Claude Code 开发能力的自主 Worker；
5. 持久化模型、费用、轮数、重试、工具调用和结构化验证证据；
6. 冻结候选身份，并按需生成一次紧凑审核 diff；
7. 使用全新、隔离、只读 Reviewer 审核候选；
8. 创建绑定 TASK 契约、前驱证据与候选指纹的原子提交；
9. 在每个事实边界保存 checkpoint，并支持进程崩溃后的精确恢复。

编排器不运行浏览器、UI 自动化、开发服务器或 watch 进程。UI 验收始终保留在终态人工清单中。

## 2. 分层与模块边界

### 2.1 领域层

- `domain/project.ts`：集中式编排目录、TASK 元数据与加载后契约。
- `domain/project-context.ts`：轻量项目清单、包管理器与脚本事实。
- `domain/task-sequence.ts`：数字线性排序、序号唯一性和直接前驱推导。
- `domain/run-state.ts`：RunState v6、TASK 状态和合法转换。
- `domain/run-state-invariants.ts`：TASK 集合、线性前缀、尝试时间线、候选与审核的跨字段语义校验。
- `domain/task-completion.ts`：任务契约指纹和直接前驱完成指纹。
- `domain/agent-result.ts`：Worker、Reviewer、验证证据和 Agent 遥测的结构化协议。

领域层不读取文件、不执行 Git，也不依赖 Claude SDK。

### 2.2 应用层

- `queue-orchestrator.ts`：严格线性驱动器，只选择当前位置并推进一个 checkpoint。
- `task-execution-service.ts`：根据持久化状态分派单一阶段。
- `implementation-stage.ts`：Worker 新建、恢复、repair、资源收敛与候选冻结。
- `review-stage.ts`：全新只读 Reviewer、审核尝试历史和修复反馈。
- `commit-stage.ts`：候选、契约、前驱与 Git 完成证据的原子提交。
- `task-resource-budget.ts`：从持久化尝试历史计算 TASK 累计资源上限。
- `worker-execution-guard.ts`：不可逆工具与命令策略。
- `terminal-candidate-service.ts`：blocked/failed 队首候选的唯一归档入口。
- `run-resume-validator.ts`：项目、状态和 Git 恢复兼容性。
- `run-finalizer.ts`：无 I/O 的线性 Run 终态归约。
- `run-checkpoint-writer.ts`：语义校验、状态保存和事件日志的唯一写边界。
- `run-artifact-writer.ts`：人工验收清单与运行摘要投影。
- `run-metrics.ts`：从 RunState 聚合统一可观测指标。
- `task-progress-reconciler.ts`：跨 Run 完成证据核验与复用计划。
- `prompt-builder.ts`：项目清单、验证协议、实现、恢复、修复和审核提示词。

各阶段不共享隐式可变状态。应用服务只依赖实际使用的最小端口。

### 2.3 端口层

- `agent-executor.ts`：自主 Worker 与只读 Reviewer 执行边界，包括固定模型握手和资源上限。
- `execution-guard.ts`：SDK 无关的工具调用允许/拒绝协议。
- `project-context-provider.ts`：确定性项目导航清单编译边界。
- `workspace.ts`：拆分为仓库身份、候选存储、隔离区、提交器、提交恢复和完成账本端口；`Workspace` 只是默认聚合门面。
- `state-store.ts`、`project-repository.ts`、`run-lock.ts`：状态、静态项目输入与单实例锁。
- `event-logger.ts`、`clock.ts`、`time-formatter.ts`：观察与时间边界。

### 2.4 基础设施层

- `claude-agent-options-builder.ts`：工具能力、Reviewer 隔离、Draft-07 输出和 Hook 选项翻译。
- `claude-agent-sdk-executor.ts`：SDK 消息流、模型握手、结构化输出、遥测与中止映射。
- `console-claude-message-observer.ts`：带北京时间的实时消息、后台任务状态与重复状态折叠。
- `git-command-runner.ts`：唯一 Git 子进程入口。
- `git-project-boundary.ts`：子项目 pathspec、仓库身份、清洁度与安全清理。
- `git-candidate-store.ts`：候选指纹、审核投影与提交。
- `git-task-completion-ledger.ts`：精确 trailer 完成历史。
- `git-candidate-quarantine.ts`：终态候选的可重入归档。
- `git-workspace.ts`：以上 Git 组件的薄门面。
- `file-project-repository.ts`：唯一规格与 TASK Markdown 编译。
- `file-project-context-provider.ts`：有界、稳定排序的项目文件树和 package scripts 编译。
- `persistence/*`、`logging/*`：原子状态库、锁和事件日志。

`cli/composition-root.ts` 是具体实现的唯一装配位置。

## 3. 固定项目与执行策略

运行时只加载：

```text
<project-root>/
  orchestration/
    SPEC.md
    tasks/
      <task-id>.md
```

`SPEC.md` 是唯一用户维护的项目级执行契约。系统不读取额外项目级 YAML/JSON 配置，也不允许 TASK、CLI 或环境变量覆盖模型、资源和 Git 策略。

固定策略：

| 会话 | 模型 / effort | 最大轮数 | 最大费用 | 最大时长 |
|---|---|---:|---:|---:|
| Worker | `claude-sonnet-5/high` | 80 | $6 | 45 分钟 |
| Reviewer | `claude-sonnet-5/high` | 30 | $2 | 15 分钟 |

每个 TASK 累计最多 8 个 Worker 会话、3 个 Reviewer 会话、200 轮和 $15。资源耗尽转为 `blocked`，不会无限 repair。

## 4. TASK 文档契约

TASK 文件名必须等于 `<id>.md`，ID 必须是至少三位数字的 `TASK-数字`：

```markdown
---
id: TASK-002
title: 实现用户列表
---

## 任务描述

这里是任务正文。
```

前置元数据只允许 `id` 和 `title`。`dependsOn`、资源限制、状态、路径范围、外部门禁及其他未知字段都会被严格拒绝。目录中的全部 Markdown 都会加载并按数字值排序，不存在配置索引与目录内容漂移。

## 5. 队列与职责化阶段

`QueueOrchestrator.start()`：

1. 创建北京时间 Run ID并取得项目锁；
2. 要求整个仓库干净并记录仓库根、分支与 HEAD；
3. 核验当前 HEAD 的连续任务完成证据；
4. 创建 RunState v6并写启动 checkpoint；
5. 每轮从状态推导第一个未完成 TASK，只推进一个阶段。

正常状态流：

```text
pending
  → executing
  → candidate_pending
  → reviewing
  → committing
  → completed
```

修复状态流：

```text
executing/reviewing
  → retry_pending
  → executing
```

`candidate_pending` 将 Worker 结构化终态与 Git 候选捕获分为两个 checkpoint。进程在二者之间中断时不会重新运行已经完成的 Agent 会话。

`blocked` 或 `failed` 出现后，当前候选先进入隔离区，Run 随即结束，全部后继保持 `pending`。

## 6. Worker 能力与系统守卫

Worker 使用完整 Claude Code 工具预设：

- `permissionMode: bypassPermissions`
- `allowDangerouslySkipPermissions: true`
- `skills: all`
- `settingSources: user, project, local`
- 项目/本机 MCP 与子 Agent 可用

系统不限制 Worker 只能修改某些路径，但通过 `PreToolUse` Hook 拒绝：

- Git commit、push、reset、checkout、restore、merge、rebase、stash、tag 等历史或工作区控制操作；
- npm、容器、云平台和 GitHub CLI 的发布部署操作；
- 浏览器、Playwright、Cypress、Selenium 等 UI 自动化；
- dev、preview、serve、start 等常驻服务。

守卫定义在应用层稳定端口上，SDK Hook 输出只存在于基础设施适配器中。

## 7. 确定性项目上下文与验证协议

每次 Worker/Reviewer 会话启动前，`FileProjectContextProvider` 编译当前工作区：

- 最多两级目录展开、最多 300 项的稳定排序文件树；
- 忽略依赖、构建产物、缓存和虚拟环境目录的内部内容；
- 识别 lockfile 对应的包管理器；
- 读取并稳定排序 `package.json` scripts；
- 生成内容指纹。

清单只用于导航，不复制源码正文。无效 `package.json` 会形成显式上下文诊断并交给 Agent 修复，不会让导航编译器提前中断候选审核。Agent 仍按需读取变更文件与直接依赖。

Worker 验证协议要求：仅在必要时执行一次基线；修改期间优先定向检查；实现稳定后执行一次适用的全量非交互检查；代码未变化时不重复相同全量命令。

Worker 结构化结果：

```json
{
  "status": "completed | blocked | failed",
  "summary": "...",
  "blockingQuestions": [],
  "notes": [],
  "verifications": [
    {
      "scope": "targeted | full",
      "command": "pnpm test",
      "status": "passed | failed",
      "summary": "82 项测试通过"
    }
  ]
}
```

`verifications` 只记录实际执行的命令和真实结果，并进入 RunState 与 Reviewer 上下文。

## 8. 固定模型与遥测

SDK `system/init` 是会话可信边界。执行器在任何工具结果被接受前核验：

- 请求模型；
- `system/init.model` 实际模型；
- 初始化 session ID。

实际模型必须精确等于 `claude-sonnet-5`。不一致返回不可重试 `model_mismatch`，关闭 Query，并将请求/实际模型保存到 attempt。

每次 Worker 与 Reviewer attempt 保存：会话 ID、请求/实际模型、开始/结束时间、结果、摘要、费用、轮数、持续时间、API 重试次数、重试等待时间、去重工具调用数；Worker 额外保存验证证据。终态事件与摘要只从这些事实聚合，不解析控制台日志。

## 9. 候选与独立审核

候选身份只包含稳定排序的路径、类型、模式和内容哈希。普通指纹捕获不生成 diff。

Reviewer 启动前才组合：

- 当前候选身份；
- 实际变更文件；
- `--unified=8` 的紧凑 tracked diff；
- 有界的 untracked 文件预览；
- Worker 结构化验证证据。

Reviewer 使用 `Read/Glob/Grep`、`dontAsk`、空 MCP、空 skills、空 setting sources。每次审核都创建全新 session，不继承 Worker 或用户设置。

审核通过且没有 critical/high/medium finding 才进入提交；拒绝或实质 finding 进入 repair；人工决策进入 blocked；基础设施错误在 Reviewer 预算内新建会话重试。

## 10. Git 候选、账本与隔离区

Git 基础设施分为：

- `GitProjectBoundary`：路径坐标系、项目外改动、清洁度和安全清理；
- `GitCandidateStore`：候选身份、审核材料和原子提交；
- `GitTaskCompletionLedger`：完成 trailer 读取与提交崩溃恢复；
- `GitCandidateQuarantine`：阻塞/失败候选归档；
- `GitCommandRunner`：统一进程超时和错误映射。

提交前验证 HEAD、项目外改动和冻结指纹。每个完成 TASK 创建独立提交并写入：

- `Apex-Coding-Agent-Run`
- `Apex-Coding-Agent-Project`
- `Apex-Coding-Agent-Task`
- `Apex-Coding-Agent-Candidate`
- `Apex-Coding-Agent-Task-Contract`
- `Apex-Coding-Agent-Task-Predecessor`

无文件差异时仍创建空提交。阻塞/失败候选保存到确定性 `refs/apex-coding-agent/quarantine/*` 后清理主工作区；归档逻辑可重入。

## 11. 跨 Run 复用与恢复

新 Run 只复用当前 HEAD 祖先链上满足以下条件的连续前缀：

1. 当前 TASK 最新完成证据存在；
2. TASK 契约指纹相同；
3. 直接前驱完成提交指纹相同；
4. 此前所有 TASK 已连续复用。

`--fresh` 只禁止本次复用，不删除历史。

完成契约版本为 v6；旧执行模型产生的契约哈希不会被当前系统复用，也没有迁移或降级分支。

恢复前统一核验项目哈希、项目根、RunState 语义、仓库根、分支与 HEAD。Worker init 已落盘时使用 SDK resume；未 init 时创建新会话；Reviewer 崩溃后结束旧尝试并创建全新只读会话；committing 的 HEAD 变化只接受精确 trailer 证明的“提交成功、状态未落盘”窗口。

## 12. RunState v6 与关键不变量

RunState v6 不迁移旧状态。每次 checkpoint 和 resume 都调用同一语义校验器，保证：

1. 状态 TASK 集合与当前任务目录完全一致；
2. completed 任务形成从根开始的连续前缀；
3. 同一时刻至多一个活动 TASK；
4. Worker/Reviewer 尝试编号连续，结束时间与结果成对，历史项全部结束；
5. resolved model 必须有 session init 证据；
6. candidate_pending 必须有 completed Worker 尝试；
7. reviewing/committing 必须有候选指纹；
8. committing 必须有 approved Reviewer 尝试；
9. completed TASK 必须有 commit 与完成证据；
10. Run 终态必须与 TASK 终态一致。

状态和 JSONL 事件保存 UTC；CLI、控制台和 Markdown 产物使用北京时间投影。

## 13. 自动化验证

自动化测试覆盖：

- 严格项目加载、线性序列与完成前缀复用；
- Worker/Reviewer/repair/resume/candidate_pending/commit 状态流；
- 固定模型不匹配、结构化输出、API 重试和工具调用遥测；
- PreToolUse 守卫的允许与拒绝矩阵；
- 项目上下文稳定排序、忽略策略和脚本发现；
- RunState 跨字段语义不变量；
- Git 指纹、紧凑审核材料、空提交、父仓库边界和隔离区；
- checkpoint、锁、摘要指标与北京时间展示。

测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
