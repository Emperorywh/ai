# Claude Task Orchestrator

基于 `@anthropic-ai/claude-agent-sdk` 的严格线性、单并发、可恢复 TASK 编排器。一次运行会自动加载任务目录中的全部 TASK，并按数字序号逐个执行，无需人工逐次向 Claude Code 投喂任务。

## 执行模型

```text
集中式编排目录
  + TASK 目录（唯一任务事实源）
  → 严格元数据校验与数字线性序列
  → 核验当前 HEAD 中的任务完成证据
  → 写入 Worker
  → 冻结完整项目候选
  → 只读 Reviewer
  → 原子 Git 提交
  → 前一 TASK 完成后开启下一 TASK
```

- 任务目录中的每个 `.md` 文件都会进入目录校验，不存在“文件已创建但未登记”的静默遗漏。
- TASK 的 YAML 前置元数据只包含 ID 和标题，完整需求与任务特有验收事实统一写入任务描述。
- Worker 可以修改项目内任意文件，系统不注入路径 Hook，也不执行预声明的外部命令门禁。
- 实现失败和审核意见默认持续进入新一轮 repair，不设置尝试次数、会话时长、轮数或预算上限；只有明确的人工作业阻塞或外部中断才停止当前循环。
- 写入 Worker 可自主使用完整 Claude Code 工具、终端、技能、项目 MCP 和子 Agent，并自行完成非浏览器验证。
- Agent 需要人工决策等真正阻塞会终止当前 TASK 和本次 Run，后续 TASK 保持 `pending`。
- 阻塞或失败 TASK 的候选会保存到持久 Git 引用并清理主工作区，不会越过当前任务继续执行。
- 每次状态转换、SDK 会话初始化、审核结果和候选归档都会落盘，进程中断后可精确恢复。
- 新 `run` 默认按任务契约、直接前驱提交和 Git 可达性复用连续完成前缀；`--fresh` 才会明确全量重跑。
- 编排器不启动浏览器或 UI 自动化。全部可运行任务结束后生成运行摘要和人工验收清单。

## 环境要求

- Node.js 20+
- pnpm
- Git，目标项目至少有一个提交
- Anthropic API 凭据

```powershell
$env:ANTHROPIC_API_KEY = "你的 API Key"
```

不要把密钥写入 TASK、`.env` 或仓库。

## 初始化

```powershell
pnpm install
pnpm build
pnpm start init .
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

系统固定使用 `sonnet/high` Worker、`sonnet/high` 只读 Reviewer 和 `task` Git 提交前缀。实现失败与审核意见持续进入 repair，直到通过、真正阻塞或收到外部中断；TASK 不能覆盖执行策略。

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
pnpm start validate

# 新建运行；核验并复用当前 HEAD 中仍然有效的 TASK 完成证据
pnpm start run

# 新建运行并明确放弃历史完成证据，全量重跑
pnpm start run --fresh

# 恢复最近或指定的 running 运行
pnpm start resume
pnpm start resume <run-id>

# supervisor 幂等入口：无状态时新建，running 时恢复，终态时返回
pnpm start continue

# 查看状态
pnpm start status
pnpm start status <run-id>
```

退出码：`0` 全部完成，`1` 存在失败或基础设施错误，`2` 存在人工阻塞，`130` 收到中断并保留可恢复状态。

控制台日志、`status` 输出和运行摘要统一使用北京时间，例如 `2026-07-15T03:28:40.710+08:00`。状态文件和 JSONL 事件仍保存 UTC 作为机器事实；新运行 ID 的时间段使用文件安全的北京时间格式，例如 `2026-07-15T03-28-40-710+08-00-xxxxxxxx`。

## 状态、审核与 Git

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

Worker 返回 `completed` 后，编排器捕获完整项目候选并保存稳定指纹。Reviewer 和提交阶段都必须看到同一候选；中途变化会显式阻塞，不能把未经当前审核的内容混入提交。

每个成功 TASK 产生独立提交，并包含：

- `Orchestrator-Run`
- `Orchestrator-Project`
- `Orchestrator-Task`
- `Orchestrator-Candidate`
- `Orchestrator-Task-Contract`
- `Orchestrator-Task-Predecessor`

默认 `run` 会按线性顺序读取当前 HEAD 的完成提交：任务契约指纹相同、直接前驱绑定的完成提交相同，且证据提交仍在当前分支祖先链中时，该 TASK 在新 Run 中记为 `completed/reused`。复用必须形成从首个 TASK 开始的连续前缀；任一任务正文或项目上下文变化后，该任务以及全部后继都会重新执行。每个 TASK 只核验当前祖先链中的最新完成证据，不会越过较新的异契约提交回退复用旧结果。

若现有代码已经满足 TASK，Worker 可以不产生 diff；编排器仍会执行独立审核，并以空提交保存新的完成证据。`--fresh` 不删除历史，只明确禁止本次 Run 复用它们。

阻塞/失败候选保存在 `refs/claude-task-orchestrator/quarantine/*`，归档后本次 Run 立即终止，所有后继保持 `pending`。Worker 虽拥有自主开发工具，但系统工作流仍明确禁止 push、merge、rebase、部署或浏览器测试；Reviewer 始终只读。

## 开发验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

自动化测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
