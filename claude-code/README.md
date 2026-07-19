# Apex Coding Agent

`apex-coding-agent` 是一个面向现有 Git 项目的无人值守编码任务编排器。

你只需要准备一份项目规格 `SPEC.md` 和一组按编号排列的 TASK 文档。Apex 会调用 Claude Code 逐个完成任务：先由可写 Worker 实现和验证，再由全新的只读 Reviewer 独立审核；审核通过后，Apex 会为该 TASK 创建独立 Git 提交，然后继续下一个任务。

它不是另一个聊天窗口，也不是只执行一次提示词的脚本。它主要解决的是：**如何让一组已经写清楚的编码任务，按照固定顺序、安全地长时间自动执行，并且能够审核、提交、追踪和恢复。**

## 先看一个完整流程

```text
orchestration/SPEC.md
orchestration/tasks/*.md
          │
          ▼
严格校验并按 TASK 数字编号排序
          │
          ▼
可写 Worker 阅读规格、任务和项目代码，完成实现与非浏览器验证
          │
          ▼
冻结本次代码候选及其内容指纹
          │
          ▼
全新只读 Reviewer 独立检查代码、diff 和验证证据
          │
          ├─ 发现问题 → 将审核意见交回 Worker 修复 → 再次审核
          ├─ 需要人工决策 → 停止当前 Run，后续 TASK 保持 pending
          └─ 审核通过 → 为当前 TASK 创建 Git 提交 → 执行下一个 TASK
```

Apex 在任意时刻只处理一个 TASK。前一个任务没有完成并提交，后一个任务绝不会开始。

## 它适合什么场景

适合：

- 已有代码仓库，需要连续实现一组边界清楚的功能任务；
- 希望 Agent 自动读代码、修改代码、运行测试、修复审核问题并提交结果；
- 任务可能运行较久，需要在终端中断、进程异常或机器重启后继续；
- 希望每个任务都有独立提交、结构化验证记录和独立 Reviewer；
- 希望后续运行自动复用当前分支中仍然有效的已完成任务。

不适合：

- 只有一句模糊想法，希望 Agent 一边开发一边替你决定产品方向；
- 需要多个任务并行执行，或需要 DAG、条件分支和自定义依赖关系；
- 目标目录不是 Git 仓库，或不希望 Agent 自动创建提交；
- 必须由 Agent 启动浏览器、开发服务器或 UI 自动化完成验收；
- 不信任仓库中的 Claude 配置、MCP、技能或脚本。

## 快速开始

### 1. 准备环境

运行 Apex 需要：

- Node.js 20 或更高版本；
- Git；
- 目标项目至少已有一个 Git 提交；
- 整个 Git 仓库没有未提交改动，包括父仓库中的兄弟目录；
- Claude Code 已完成认证，并在用户配置中明确选择了模型。

先确认 Claude Code 当前认证可用：

```powershell
claude auth status
```

如果使用 CC Switch，请先在 CC Switch 中选择可用的 Provider 和模型。Apex 不提供独立登录、不读取 `cc-switch.db`，也不保存 Token；它通过 Claude Agent SDK 读取 Claude Code 当前用户配置。

模型必须在 Claude 用户配置中显式存在。读取优先级为：

1. `env.ANTHROPIC_MODEL`
2. 顶层 `model`

如果两者都不存在，Apex 会拒绝创建不可审计的 Agent 会话。

### 2. 安装命令行工具

从 npm 全局安装：

```powershell
npm install --global apex-coding-agent
apex-coding-agent --version
apex-coding-agent --help
```

如果你正在开发当前源码仓库，可从源码构建并安装：

```powershell
pnpm install
pnpm build
npm install --global .
```

不要在 Apex Run 仍在执行时升级或重新全局安装 Apex。应先让当前进程结束或中断到 checkpoint，升级完成并确认版本后，再执行 `apex-coding-agent resume`。

### 3. 在目标项目中初始化编排文档

进入目标项目根目录，然后执行：

```powershell
apex-coding-agent init .
```

初始化器只会补齐以下两个文件：

```text
orchestration/
  SPEC.md
  tasks/
    TASK-001.md
```

已有普通文件不会被覆盖。初始化器也不会创建 `PLAN.md`、`PROGRESS.md`、`AGENTS.md` 或额外配置文件。

### 4. 编写项目规格

`orchestration/SPEC.md` 是所有 TASK 共享的唯一项目级执行上下文。建议至少写清楚：

- 系统目标和非目标；
- 关键业务规则；
- 架构边界与依赖方向；
- 核心数据流和状态流；
- 安全、一致性和兼容性要求；
- 项目统一的验证命令或验收标准；
- 明确禁止 Agent 自行扩展的范围。

SPEC 应描述“最终必须满足什么”，不必提前指定每个函数、类名或待修改文件。Worker 会在执行 TASK 时读取当前代码，自行选择合理的实现位置。

### 5. 编写 TASK

每个 TASK 都是 `orchestration/tasks` 下的一个 Markdown 文件，格式必须严格如下：

```markdown
---
id: TASK-001
title: 实现用户列表查询
---

## 任务描述

实现用户列表查询能力。

要求：

- 支持按用户名关键字筛选；
- 返回结果保持稳定排序；
- 未认证请求沿用现有鉴权错误格式；
- 补充适用的自动化测试，并运行项目现有全量检查。
```

TASK 的规则：

- 文件名必须与 ID 完全一致，例如 `TASK-001.md`；
- ID 必须符合 `TASK-数字`，数字至少三位，例如 `TASK-001`、`TASK-010`；
- TASK 按数字值排序，不要求编号连续；
- YAML 前置元数据只允许 `id` 和 `title`；
- 正文必须以 `## 任务描述` 开始，并且不能为空；
- 目录中的所有 `.md` 文件都会被加载；任意一个文档无效都会阻止运行，不存在额外任务索引；
- 不要添加 `status`、`dependsOn`、`scope`、`gates`、`verification`、`maxAttempts`、`timeoutMinutes` 或其他字段；
- 前驱关系由数字顺序自动确定，不需要维护额外任务索引；
- 任务中可以写任务特有的验收事实，但不能覆盖 Apex 的模型、预算、审核或 Git 策略。

需要更多任务时，直接新增文件即可：

```text
orchestration/tasks/
  TASK-001.md
  TASK-002.md
  TASK-010.md
```

### 6. 校验并运行

先检查文档和任务顺序：

```powershell
apex-coding-agent validate
```

校验通过后，确认整个仓库干净，再启动运行：

```powershell
git status --short
apex-coding-agent run
```

运行期间，终端会实时显示当前 TASK、Worker/Reviewer 会话、Claude 文本、工具调用、重试、费用和阶段变化。

### 7. 查看结果并人工验收

成功的 TASK 会产生一个独立提交，标题类似：

```text
task: TASK-001 实现用户列表查询
```

运行结束后可以查看：

```powershell
apex-coding-agent status
git log --oneline
```

CLI 会打印状态目录和生成的验收产物路径。重点检查：

- `summary.md`：Run 状态、会话数、轮数、费用、耗时、重试、工具调用和模型握手；
- `manual-acceptance.md`：全部已完成 TASK 的人工验收清单；
- Git 提交：实际代码、测试和提交范围是否符合预期。

Apex 不运行浏览器或 UI 自动化，因此界面、交互和视觉结果必须由人手动验收。

## 常用命令

| 命令 | 作用 |
|---|---|
| `apex-coding-agent init .` | 增量创建 SPEC 和第一个 TASK 模板 |
| `apex-coding-agent validate` | 校验 SPEC、完整 TASK 目录、文档格式和数字顺序，不执行 Agent |
| `apex-coding-agent run` | 创建新 Run，并复用当前 HEAD 中仍有效的连续完成前缀 |
| `apex-coding-agent run --fresh` | 创建新 Run，但本次不复用历史完成证据，所有 TASK 重新执行 |
| `apex-coding-agent resume` | 读取 `latest` 指向的 Run；恢复 `running` 状态，或安全重开由 Reviewer 返回 `blocked` 的隔离候选 |
| `apex-coding-agent resume <run-id>` | 读取指定 Run；恢复 `running` 状态，或安全重开由 Reviewer 返回 `blocked` 的隔离候选 |
| `apex-coding-agent continue` | 没有状态时新建、运行中时恢复、最新状态已终结时直接返回 |
| `apex-coding-agent status` | 以 JSON 查看最近 Run 的持久化状态 |
| `apex-coding-agent status <run-id>` | 查看指定 Run |

`continue` 适合作为外部 supervisor 或定时调度的幂等入口。它不会在一个已经终结的 Run 上自动创建新 Run；需要新一轮执行时请显式使用 `run`。

`resume` 省略 Run ID 时不会向前搜索其他状态，只读取 `latest`。Reviewer 返回 `blocked` 时，Apex 会先确认工作区没有其他改动，从 quarantine 引用恢复候选并重新冻结恢复后的指纹，再用新的只读 Reviewer 会话继续审核；Worker 阻塞、资源耗尽、失败和已完成 Run 仍保持终态。如需恢复其他 Run，请显式传入它的 Run ID。

退出码：

| 退出码 | 含义 |
|---:|---|
| `0` | 命令成功；对于 `run`、`resume`、`continue`，表示返回的 Run 已完成 |
| `1` | Run 失败，或命令遇到配置、基础设施等错误 |
| `2` | 返回的 Run 存在需要人工处理的阻塞 |
| `130` | 活动 Run 收到中断信号，并保留了可恢复状态 |

`init`、`validate` 和 `status` 是管理命令：命令本身成功时返回 `0`。因此 `status` 即使展示的是一个历史 `failed` Run，也仍然会返回 `0`。

## TASK 在运行中会经历什么

正常状态流：

```text
pending
  → executing
  → candidate_pending
  → reviewing
  → committing
  → completed
```

如果 Worker 实现失败、验证仍失败，或 Reviewer 发现 `critical`、`high`、`medium` 问题，会进入修复流程：

```text
executing / reviewing
  → retry_pending
  → executing
```

终态含义：

| 状态 | 含义 |
|---|---|
| `completed` | 审核通过并已创建任务提交 |
| `blocked` | 缺少外部信息、需要人工决策，或 TASK 资源预算耗尽 |
| `failed` | 发生不可重试错误，例如认证失败、模型握手不一致或不可恢复的 Agent 错误 |
| `pending` | 任务尚未开放，通常是前驱任务尚未完成 |

当前 TASK 一旦 `blocked` 或 `failed`，本次 Run 会立即终止，后续 TASK 保持 `pending`，不会跳过失败继续执行。

Reviewer 产生的 `blocked` 是可显式重开的审核终态：修复审核策略或补齐外部事实后执行 `resume`，系统会恢复隔离候选并继续审核。Worker 自身报告的阻塞以及资源预算耗尽不会被自动重开。

## 中断、恢复和重新运行

### 安全中断

第一次按 `Ctrl+C` 时，Apex 会请求当前阶段停止并保存 checkpoint。之后执行：

```powershell
apex-coding-agent resume
```

如果 Claude Code 子进程在会话初始化前启动失败，Apex 会把它视为基础设施中断：Run 保持 `running`，不会制造一次修复记录，也不会消耗 TASK 会话预算。修复本机环境后直接 `resume` 即可。

### 什么情况下不能 resume

恢复要求原 Run 的项目事实和 Git 基线仍然可信。以下变化通常会拒绝恢复：

- 修改了 `orchestration/SPEC.md` 或任意 TASK；
- 切换了 Git 分支；
- 当前项目内容相对记录的 HEAD 已变化；
- Git 历史发生回退或分叉；
- 当前状态文件损坏或不是 RunState v6。

如果你有意修改了 SPEC 或 TASK，应创建新 Run：

```powershell
apex-coding-agent run
```

### 默认复用与全量重跑

普通 `run` 会读取当前分支祖先链中的 Apex 完成提交，并尝试复用从第一个 TASK 开始的连续完成前缀。只有同时满足以下条件才会复用：

- 当前 TASK 的标题、正文和共享 SPEC 形成的契约指纹没有变化；
- 它绑定的直接前驱完成提交没有变化；
- 完成证据仍在当前 HEAD 的祖先链中；
- 之前的所有 TASK 都已连续复用。

任一 TASK 契约变化后，该任务及全部后继都会重新执行。新增一个排在末尾的 TASK 时，前面仍有效的任务可以直接复用。

`run --fresh` 只表示本次不复用历史证据，不会删除旧提交或旧 Run。即使现有代码已经满足任务，Apex 仍会审核并创建一个允许为空的完成证据提交。

## Worker、Reviewer 与安全边界

### Worker

Worker 是可写的 Claude Code 会话，拥有完整开发工具、终端、技能、用户/项目/本地设置、MCP 和子 Agent 能力。它可以在当前项目内自主查找和修改所需文件，也可以运行适用的非交互验证命令。

系统通过 `PreToolUse` 守卫拒绝：

- `commit`、`push`、`reset`、`checkout`、`merge`、`rebase`、`stash` 等 Git 写操作；
- npm、云平台、容器和 GitHub CLI 的发布或部署操作；
- Playwright、Cypress、Selenium、Puppeteer 和浏览器工具；
- `dev`、`preview`、`serve`、`start` 等常驻服务。

Worker 使用 `bypassPermissions`，Apex 本身也不会注入文件路径白名单；任务提示词要求 Worker 留在当前 TASK 和项目边界内，最终 Git 提交则只接受当前项目范围。请只在可信仓库和可信宿主环境中运行 Apex，并提前检查 Claude 配置、技能和 MCP 是否可能访问外部系统或敏感数据。不要把密钥写进 SPEC、TASK、项目 `.env` 或仓库。

### Reviewer

Reviewer 每次都是全新的只读会话，只提供 `Read`、`Glob`、`Grep`：

- 不继承 Worker 会话；
- 不加载项目或本地 Claude 设置；
- 不加载技能、MCP 或子 Agent；
- 只读取候选 diff、变更文件、相关代码和 Worker 的验证证据；
- “实际变更文件”是已冻结的完整候选，包含 tracked、untracked 和 deleted 文件；审核通过后由 Apex 原子提交，提交前的 `??` 不表示新增文件会漏出 checkpoint；
- 只有不存在 `critical`、`high`、`medium` 问题时才允许提交；可修复问题进入 repair，明确契约偏差不能转成人工确认问题；
- 仅当正确性依赖项目内无法推导的外部信息、凭据或不可逆产品决策时才进入 `blocked`，可逆实现选择必须由 Reviewer 依据现有契约批准或拒绝。

Reviewer 会读取 Claude 用户配置中的认证、代理和网关连接字段，以便继续使用 CC Switch 当前 Provider，但这些连接设置不会扩大 Reviewer 的工具权限。

### Git 行为

- 新 Run 启动前要求整个仓库干净；
- 每个 TASK 审核通过后由 Apex 创建一个独立提交；
- Apex 不会自动 push；
- 自动提交使用 `--no-verify` 和 `--no-gpg-sign`，不会执行本地提交钩子或 GPG 签名；
- 提交只包含当前项目范围，不会夹带父仓库兄弟目录的改动；
- 候选冻结后如果文件内容变化，Reviewer 或提交阶段会拒绝继续；
- 同一 Git worktree 同时只允许一个 Apex Run 操作共享的 HEAD、索引和文件树。

如果当前 TASK 最终阻塞或失败，未提交候选会被保存到 `refs/apex-coding-agent/quarantine/*`，然后从主工作区清理。可在 `status` 的 `candidateArchive.reference` 中找到引用，并使用下面的命令检查归档内容：

```powershell
git show <candidateArchive.reference>
```

## 资源限制

这些限制由 Apex 固定，不能通过 TASK、CLI 或项目配置覆盖：

| 范围 | 模型 / effort | 最大轮数 | 最大费用 | 最大时长 |
|---|---|---:|---:|---:|
| 单次 Worker 会话 | Claude 用户当前模型 / `high` | 80 | $6 | 45 分钟 |
| 单次 Reviewer 会话 | Claude 用户当前模型 / `high` | 30 | $2 | 15 分钟 |

每个 TASK 累计最多：

- 8 个 Worker 会话；
- 3 个 Reviewer 会话；
- 200 轮；
- $15。

达到 TASK 累计上限后会转为 `blocked`，交由人工处理，而不是无限修复。

每个新 attempt 都会重新读取一次 Claude 用户配置中的当前模型，并把请求模型写入状态。Claude SDK 返回 `system/init` 后，Apex 会核验实际模型是否完全一致；不一致时会在接受工具结果前终止。恢复同一个 attempt 时继续使用原模型快照，不受之后切换 Provider 的影响。

## 状态和运行产物

状态不会写入目标项目文件树，而是保存在 Git 管理目录中。普通单 worktree 仓库通常类似：

```text
.git/apex-coding-agent/
  active.lock
  <project-hash>/
    latest
    runs/
      <run-id>/
        state.json
        events.jsonl
        summary.md
        manual-acceptance.md
```

更准确地说：

- 状态位于 `<git-common-dir>/apex-coding-agent/<project-hash>/`；
- 进程锁位于当前 worktree 的 `<git-dir>/apex-coding-agent/active.lock`；
- 同一仓库中的兄弟项目拥有不同状态目录，但共享同一个 worktree 锁；
- linked worktree 使用自己的锁，可以在不共享 HEAD、索引和文件树时独立运行。

`state.json` 和 `events.jsonl` 以 UTC 保存机器事实；终端日志、`status` 投影、Run ID 和 Markdown 产物使用北京时间（UTC+08:00）。

## 常见问题

### 启动时报“整个 Git 仓库必须干净”

在仓库顶层执行 `git status --short`。Apex 检查的是整个仓库，不只是当前子项目。请先提交、暂存到其他安全位置或自行处理已有改动，再启动新 Run。

### 提示 Claude 用户配置缺少模型

先通过 CC Switch 选择模型，或在 Claude Code 用户配置中明确设置 `env.ANTHROPIC_MODEL` 或顶层 `model`。Apex 不使用 SDK 的隐式默认模型。

### 认证失败后为什么没有自动反复重试

认证失败需要修复外部配置，重复创建相同会话没有意义，因此会作为不可重试错误终止。先运行 `claude auth status` 并修复认证，再根据状态创建新 Run 或恢复仍为 `running` 的 Run。

### 为什么修改 TASK 后不能 resume

`resume` 只能继续同一份已冻结的项目输入。修改规格或任务意味着执行契约已经改变，应使用 `run` 创建新状态，并让系统重新核验哪些旧任务仍可复用。

### 为什么没有代码变化也产生提交

如果现有代码已经满足 TASK，Worker 可以不修改文件。Apex 仍会执行独立审核，并创建空提交保存该任务在当前契约和前驱下已经完成的 Git 证据。

### 为什么不自动测试页面

Apex 明确禁止浏览器、UI 自动化和常驻开发服务器。Worker 负责可运行的非浏览器检查，界面与交互统一写入 `manual-acceptance.md` 由人工验证。

### 命令结束了，但状态仍是 running

通常表示收到了安全中断，或 Claude Code 子进程在初始化前发生基础设施故障。先修复终端中显示的问题，再运行 `apex-coding-agent resume`。

## 本项目开发

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

自动化测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。

更完整的内部状态机、模块边界和持久化协议见 [源码功能说明](SOURCE_FUNCTIONAL_DOCUMENTATION.md)。维护者发布 npm 包时请参阅 [npm 包发布手册](docs/NpmPublishing.md)。
