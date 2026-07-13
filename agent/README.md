# CAW

一个标准文档驱动的 Claude Code 任务执行器。

CAW 不负责需求访谈和任务规划。初始化时会生成两份可交给任意 AI 工具使用的提示词；外部 AI 负责产出规格与任务文档，CAW 只负责按顺序执行任务并维护状态。

## 工作流

```text
caw init
  → 使用规格提示词生成 docs/SPEC.md
  → 使用任务提示词生成 docs/tasks/TASK-XXX.md
  → caw status
  → caw run
  → 重复 caw run，直到全部任务完成
```

运行时只保留三个命令：

- `caw init [targetDir]`：初始化事实文档和 AI 提示词；
- `caw status`：查看任务状态；
- `caw run`：执行第一个未完成任务。

## 运行要求

- Node.js 20 或更高版本；
- Claude Code Agent SDK 能够访问可用的模型提供方；
- 已正确配置 Anthropic 官方服务或兼容服务所需的地址、模型和令牌。

## 安装与构建

在 CAW 项目根目录执行：

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm link
```

## 初始化目标项目

进入需要开发的目标项目：

```powershell
cd C:\path\to\target-project
caw init .
```

初始化会创建：

```text
AGENTS.md
docs/SPEC.md
docs/PROGRESS.md
docs/tasks/
prompts/generate-specification.md
prompts/generate-tasks.md
```

已有文件不会被覆盖。

## 使用其他 AI 生成规格

打开 `prompts/generate-specification.md`，在末尾补充初始需求，然后把整份提示词交给你选择的 AI 工具。

提示词要求 AI 先进行逐轮需求访谈，信息充分后生成 `docs/SPEC.md` 的完整内容。具备文件访问能力的 AI 可以直接写入目标路径；否则把最终输出手动保存为 `docs/SPEC.md`。

该阶段只生成产品规格，不拆任务、不设计技术架构、不修改代码。

## 使用其他 AI 拆分任务

把 `prompts/generate-tasks.md` 交给 AI 工具，并让它读取或同时提供完整的 `docs/SPEC.md`。

AI 必须生成顺序编号的任务文件：

```text
docs/tasks/TASK-001.md
docs/tasks/TASK-002.md
...
```

每个任务使用统一协议：

```markdown
---
id: TASK-001
title: 任务标题
status: pending
---

# TASK-001 — 任务标题

## 需求

描述用户可观察的需求。

## 验收标准

- 可验证标准
```

任务只描述需求与验收标准，不指定文件路径、技术分层或实现方案。

CAW 在执行前会校验任务编号连续、文件名与 Frontmatter ID 一致、正文包含需求与至少一条验收标准。外部 AI 输出不符合协议时会直接报错，不会静默执行。

## 执行任务

准备好规格和任务文档后执行：

```powershell
caw status
caw run
```

每次 `caw run` 只处理第一个未完成任务。重复执行，直到 `caw status` 显示全部任务为 `completed`。

每个任务都会启动新的、不可恢复的 Claude Code 会话，并显式注入：

- `docs/SPEC.md`：总目标和完整规格；
- `docs/PROGRESS.md`：前序任务完成的能力和重要架构事实；
- `docs/tasks/TASK-XXX.md`：当前需求和验收标准。

Claude Code 不会修改这些工作流事实文档。任务完成或阻塞后，CAW 统一更新任务状态和 `docs/PROGRESS.md`。

## 状态语义

- `pending`：尚未执行；
- `running`：已经开始执行；
- `completed`：验收标准已满足，不再执行；
- `blocked`：本次没有可靠完成，下次 `caw run` 会重试。

严格顺序执行意味着前面的阻塞任务不会被后续任务绕过。

## 运行安全

`caw run` 使用 Claude Code 完整工具能力，并跳过交互式权限确认。首次运行应使用一次性目录或受 Git 管理的测试项目，并确认当前目录就是预期目标项目。

系统不会自动创建 Git 分支、提交、回滚，也不会在 SDK 异常后撤销已经产生的文件变更。
