# Apex Coding Agent

`apex-coding-agent` 是基于 `@anthropic-ai/claude-agent-sdk` 的严格线性、单并发、可恢复 TASK 编排代理。一次运行会自动加载任务目录中的全部 TASK，并按数字序号逐个执行，无需人工逐次向 Claude Code 投喂任务。

## 执行模型

```text
集中式编排目录
  + TASK 目录（唯一任务事实源）
  → 严格元数据校验与数字线性序列
  → 核验当前 HEAD 中的任务完成证据
  → 编译确定性轻量项目清单
  → 写入 Worker
  → 持久化结构化验证证据
  → 冻结候选身份并按需生成紧凑 diff
  → 全新只读 Reviewer
  → 原子 Git 提交
  → 前一 TASK 完成后开启下一 TASK
```

- 任务目录中的每个 `.md` 文件都会进入目录校验，不存在“文件已创建但未登记”的静默遗漏。
- TASK 的 YAML 前置元数据只包含 ID 和标题，完整需求与任务特有验收事实统一写入任务描述。
- Worker 可以修改项目内任意文件；系统不注入路径白名单，但通过 `PreToolUse` 守卫拒绝 Git 历史改写、发布部署、浏览器和常驻服务。
- 实现失败和审核意见在固定资源预算内进入 repair；会话级轮数、费用、时长以及 TASK 级累计会话、轮数和费用都有明确上限，耗尽后转为人工阻塞。
- 写入 Worker 可自主使用完整 Claude Code 工具、终端、技能、项目 MCP 和子 Agent，并自行完成非浏览器验证。
- Worker 按“定向检查 → 稳定后一次全量检查”执行验证，并把实际命令、范围和结果保存为结构化证据；Reviewer 会独立评估证据覆盖度。
- 每个新 attempt 从 Claude 用户配置读取一次当前模型并持久化；SDK `system/init` 返回值必须与该请求快照完全一致，否则在工具执行前以不可重试错误终止。
- Agent 需要人工决策等真正阻塞会终止当前 TASK 和本次 Run，后续 TASK 保持 `pending`。
- 阻塞或失败 TASK 的候选会保存到持久 Git 引用并清理主工作区，不会越过当前任务继续执行。
- 每次状态转换、SDK 会话初始化、审核结果和候选归档都会落盘，进程中断后可精确恢复。
- 新 `run` 默认按任务契约、直接前驱提交和 Git 可达性复用连续完成前缀；`--fresh` 才会明确全量重跑。
- 编排器不启动浏览器或 UI 自动化。全部可运行任务结束后生成运行摘要和人工验收清单。

## 环境要求

- Node.js 20+
- pnpm
- Git，目标项目至少有一个提交
- 已能正常工作的 Claude Code 当前认证配置

```powershell
# 先用 CC Switch 选择 Claude Provider，再核验 Claude Code 当前状态
claude auth status
apex-coding-agent run
```

Apex 不提供独立登录、不读取 `cc-switch.db`、不保存 Token。CC Switch 切换后写入的 Claude Code
用户配置（默认 `~/.claude/settings.json`）是唯一认证入口；Apex 通过 Claude Agent SDK 的设置解析器
读取同一份认证环境、网关和模型映射。用户配置中的 `env` 与 Claude Code 一样覆盖启动终端的同名变量。

Reviewer 不加载项目/本地权限设置，只投影当前 Claude 用户配置中的连接字段，因此 CC Switch 认证可用性
不会破坏只读隔离。每个新 Agent 会话都会重新解析当前配置；切换 Provider 后，已运行的会话不变，
下一次 Worker/Reviewer 会话自动使用新 Provider。不要把密钥写入 TASK、项目 `.env` 或仓库。

## 安装全局命令

```powershell
# 从当前源码构建并安装
pnpm install
pnpm build
npm install --global .

# 确认全局入口及版本
apex-coding-agent --version
apex-coding-agent --help
```

包发布到 npm 后，可以在任意目录直接安装：

```powershell
npm install --global apex-coding-agent
```

维护者首次发布、后续版本发布、Security Key 2FA 配置和错误排查流程见 [npm 包发布手册](docs/NpmPublishing.md)。

## 初始化

在目标项目根目录执行：

```powershell
apex-coding-agent init .
```

初始化器只增量创建静态编排输入：

- `orchestration/SPEC.md`
- `orchestration/tasks/TASK-001.md`

`SPEC.md` 是唯一项目级上下文，规格、架构和执行约束都在其中维护。初始化器不创建 `PLAN.md`、`AGENTS.md` 或 `PROGRESS.md`；已有普通文件不会被覆盖，路径类型冲突会回滚本次新建文件。

## 固定项目约定

编排器不读取项目级配置文件，也不支持通过 CLI、环境变量或 TASK 覆盖系统策略。所有命令以当前工作目录为项目根，并固定加载唯一编排目录：

```text
<project-root>/
  orchestration/
    SPEC.md
    tasks/
      <task-id>.md
```

Worker 与只读 Reviewer 使用 CC Switch 写入 Claude 用户配置的当前模型，effort 固定为 `high`，Git 提交前缀固定为 `task`。Worker 单会话最多 80 轮、$6、45 分钟，Reviewer 单会话最多 30 轮、$2、15 分钟；每个 TASK 最多 8 个 Worker 会话、3 个 Reviewer 会话、累计 200 轮和 $15。新 attempt 会读取最新模型，恢复已有 attempt 则继续使用状态中保存的模型快照；TASK 不能覆盖这些执行策略。

## TASK 文档

`orchestration/tasks` 中的文件名必须严格等于 `<id>.md`，每个文件只采用以下结构：

```markdown
---
id: TASK-002
title: 实现用户列表
---

## 任务描述

这里是任务正文。
```

约束：

- ID 必须为 `TASK-数字` 且数字至少三位，例如 `TASK-001`；系统按数字值而非字符串或目录枚举顺序执行。
- 每个 TASK 的前驱由线性序列自动推导，不允许声明 `dependsOn`、`maxAttempts`、`timeoutMinutes` 或 `manualAcceptance`。
- 前一个 TASK 未完成时，下一个 TASK 永远不会启动；当前任务阻塞或失败会直接结束 Run。
- `status` 不允许写在 TASK 中。运行状态只存在于状态库，避免静态文档和真实执行状态漂移。
- `scope`、`gates`、`verification` 及其他未知字段会直接拒绝，不提供兼容或 fallback。
- 所有 Markdown TASK 都会加载；文件名/ID 不一致、数字序号重复、缺少任务描述或正文为空都会在运行前失败。

## 命令

```powershell
# 只校验唯一规格、完整任务目录、文档和线性顺序
apex-coding-agent validate

# 新建运行；核验并复用当前 HEAD 中仍然有效的 TASK 完成证据
apex-coding-agent run

# 新建运行并明确放弃历史完成证据，全量重跑
apex-coding-agent run --fresh

# 恢复最近或指定的 running 运行
apex-coding-agent resume
apex-coding-agent resume <run-id>

# supervisor 幂等入口：无状态时新建，running 时恢复，终态时返回
apex-coding-agent continue

# 查看状态
apex-coding-agent status
apex-coding-agent status <run-id>
```

退出码：`0` 全部完成，`1` 存在失败或基础设施错误，`2` 存在人工阻塞，`130` 收到中断并保留可恢复状态。

控制台日志、`status` 输出和运行摘要统一使用北京时间，例如 `2026-07-15T03:28:40.710+08:00`。状态文件和 JSONL 事件仍保存 UTC 作为机器事实；新运行 ID 的时间段使用文件安全的北京时间格式，例如 `2026-07-15T03-28-40-710+08-00-xxxxxxxx`。

## 状态、审核与 Git

状态保存在 Git common directory：

```text
.git/apex-coding-agent/<project-hash>/
  active.lock
  latest
  runs/<run-id>/
    state.json
    events.jsonl
    summary.md
    manual-acceptance.md
```

Worker 返回 `completed` 后，编排器捕获完整项目候选并保存稳定指纹。Reviewer 和提交阶段都必须看到同一候选；中途变化会显式阻塞，不能把未经当前审核的内容混入提交。

候选身份快照只保存路径、类型、模式和内容哈希；大体积 diff 只在 Reviewer 启动前按需生成一次，并使用紧凑上下文。普通 checkpoint、恢复判断和提交前校验不会反复拼接完整 diff。

每个成功 TASK 产生独立提交，并包含：

- `Apex-Coding-Agent-Run`
- `Apex-Coding-Agent-Project`
- `Apex-Coding-Agent-Task`
- `Apex-Coding-Agent-Candidate`
- `Apex-Coding-Agent-Task-Contract`
- `Apex-Coding-Agent-Task-Predecessor`

默认 `run` 会按线性顺序读取当前 HEAD 的完成提交：任务契约指纹相同、直接前驱绑定的完成提交相同，且证据提交仍在当前分支祖先链中时，该 TASK 在新 Run 中记为 `completed/reused`。复用必须形成从首个 TASK 开始的连续前缀；任一任务正文或项目上下文变化后，该任务以及全部后继都会重新执行。每个 TASK 只核验当前祖先链中的最新完成证据，不会越过较新的异契约提交回退复用旧结果。

若现有代码已经满足 TASK，Worker 可以不产生 diff；编排器仍会执行独立审核，并以空提交保存新的完成证据。`--fresh` 不删除历史，只明确禁止本次 Run 复用它们。

阻塞/失败候选保存在 `refs/apex-coding-agent/quarantine/*`，归档后本次 Run 立即终止，所有后继保持 `pending`。Git 基础设施按项目边界、候选存储、完成账本和隔离区拆分；Worker 的系统 Hook 明确禁止 push、commit、reset、checkout、merge、rebase、部署、浏览器测试及常驻服务，Reviewer 始终只读。

RunState v6 保存 Worker/Reviewer 每次尝试的请求模型、实际模型、耗时、轮数、费用、API 重试次数与等待时间、工具调用数和验证证据。`summary.md` 与终态事件只从这些持久化事实聚合，不解析可能被拼接或截断的控制台日志。

## 开发验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

自动化测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
