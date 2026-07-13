# 项目源码功能与架构说明

## 1. 项目定位

CAW 是一个标准 Markdown 文档驱动的 Claude Code 任务执行器。

需求访谈和任务规划不属于 CAW 运行时能力。`caw init` 生成两份跨 AI 工具提示词，用户可以选择任意 AI 工具生成规格和任务；CAW 从标准文件读取事实，并为每个任务启动新的 Claude Code 会话。

```text
caw init
  → 外部 AI 根据提示词生成 SPEC
  → 外部 AI 根据提示词生成 TASK 文档
  → caw run 自动顺序执行全部任务
  → 每个任务结束后更新状态和 PROGRESS
```

## 2. 用户功能

### 2.1 `caw init [targetDir]`

初始化以下内容：

- `AGENTS.md`：目标项目的执行约束；
- `docs/SPEC.md`：产品规格占位文档；
- `docs/PROGRESS.md`：执行进度占位文档；
- `docs/tasks/`：顺序任务目录；
- `prompts/generate-specification.md`：规格访谈提示词；
- `prompts/generate-tasks.md`：任务拆分提示词。

已存在文件不会被覆盖。目标目录不存在时会递归创建。

### 2.2 规格生成提示词

规格提示词要求外部 AI：

- 逐轮进行深度需求访谈；
- 每轮只提出一个信息增益最高的问题；
- 覆盖目标、用户、范围、非目标、流程、业务规则、状态、异常、边界和验收标准；
- 不设计技术架构或拆分任务；
- 最终交付 `docs/SPEC.md` 的完整 Markdown 内容。

提示词本身不依赖 Claude Agent SDK，可以在任意能够处理自然语言的 AI 工具中使用。

### 2.3 任务生成提示词

任务提示词要求外部 AI：

- 只消费完整规格；
- 生成可顺序执行、职责单一的最小任务；
- 任务只包含用户可观察需求和验收标准；
- 从 `TASK-001` 开始连续编号；
- 每个文件使用统一 YAML Frontmatter 和 Markdown 正文协议；
- 重新生成任务集合时清理旧任务并重置进度。

### 2.4 `caw status`

直接扫描 `docs/tasks/TASK-数字.md`，按编号排序并输出 ID、状态和标题。该命令不调用模型。

### 2.5 `caw run`

一次命令顺序执行所有未完成任务，每个任务仍由单任务用例独立处理：

1. 校验任务集合并选择第一个未完成任务；
2. 读取并校验 `docs/SPEC.md` 和 `docs/PROGRESS.md`；
3. 将任务状态写为 `running`，再重新读取持久化后的任务；
4. 启动新的 Claude Code 任务会话；
5. 注入规格、历史进度和当前任务；
6. 消费 SDK 消息流并显示工具活动；
7. 校验结构化执行报告；
8. 更新任务状态和进度历史；
9. 报告为 `completed` 时创建全新会话执行下一任务，全部完成或当前任务 `blocked` 时停止。

`pending`、`running`、`blocked` 都会被重新选择。严格顺序执行不会绕过前面的阻塞任务。

## 3. 事实来源与状态

工作流没有数据库、缓存和隐藏任务索引。事实来源只有：

- `docs/SPEC.md`；
- `docs/tasks/TASK-XXX.md`；
- `docs/PROGRESS.md`。

任务有四种状态：

| 状态 | 含义 | 下次是否执行 |
| --- | --- | --- |
| `pending` | 尚未执行 | 是 |
| `running` | 已开始但没有可靠结论 | 是 |
| `completed` | 已满足验收标准 | 否 |
| `blocked` | 本次无法可靠完成 | 是 |

任务 Frontmatter 保存 ID、标题和状态，正文只保存需求与验收标准。状态更新不会改写任务正文。

外部任务进入用例前会统一校验三位连续编号、文件名与 Frontmatter ID 一致、正文段落顺序以及至少一条验收标准。

## 4. 分层架构

### 4.1 核心层

`src/core/workflow.ts` 定义：

- 任务状态和元数据；
- 任务记录；
- 任务执行报告；
- Zod 运行时 Schema；
- Claude SDK 结构化输出 JSON Schema。

核心层不再包含访谈回复、任务草稿或规划输出模型。

### 4.2 应用层

`TaskExecutionAgentPort` 只表达执行一个任务的 AI 能力。

`TaskWorkflowRepositoryPort` 只暴露任务运行需要的规格读取、任务状态和进度能力。初始化提示词不进入应用层端口。

`ExecuteNextTaskUseCase` 负责任务选择、状态流转、上下文装配、异常转阻塞事实以及进度更新。

`ExecuteWorkflowUseCase` 负责顺序等待和循环调度。它只在任务完成后继续，遇到阻塞立即停止，避免同一次命令无限重试。

### 4.3 基础设施层

`FileWorkflowRepository` 负责工作流文件读写。

`workflow-initialization.ts` 集中维护初始化文件、占位文档和两份提示词，使提示词内容设计与文件写入职责分离。

`task-document.ts` 负责外部任务文档协议校验，文件仓储不解释正文结构。

`ClaudeCodeTaskAgent` 只负责 Claude Agent SDK 任务执行，不包含访谈、规划或会话类型分支。

### 4.4 CLI 层

CLI 只注册 `init`、`run`、`status`。`composition.ts` 创建真实文件仓储和 Claude Code 任务适配器。

## 5. Claude Agent SDK 执行契约

每次任务执行调用新的 `query()`，不设置 `resume` 或 `continue`，并设置 `persistSession: false`。当前查询消息流结束后才会启动下一查询，因此“结束任务、清空上下文、开始下一任务”通过丢弃旧会话并创建新会话实现。

主要 Options：

- `cwd` 固定为目标项目根目录；
- 使用 Claude Code 默认系统提示词并追加工作流约束；
- 使用 JSON Schema 结构化输出；
- 加载 `user`、`project`、`local` 设置来源；
- 使用 `bypassPermissions`；
- 允许跳过权限检查；
- 不设置工具白名单、最大轮次、预算或超时；
- 通过 `AbortController` 响应 `SIGINT`。

最终报告只能是 `completed` 或 `blocked`，并携带摘要、后续任务事实、变更文件、验证记录和阻塞原因。SDK 成功结果仍要经过 Zod 校验。

SDK 异常会转换成本地阻塞报告并写入状态和进度，然后重新抛出，使 CLI 非零退出。已经产生的代码修改不会回滚。

## 6. 当前架构特征

### 优点

- 规格与任务生成工具完全解耦；
- Claude SDK 适配器只有任务执行职责；
- 应用层不依赖 SDK 或文件系统；
- 跨任务上下文全部显式保存在 Markdown 文档中；
- 没有 legacy、fallback、deprecated 或迁移分支；
- 提示词明确输出协议，外部 AI 工具可以替换。

### 已知边界

- 执行会话拥有完整工具能力且跳过权限确认；
- 没有并发锁，两个 `run` 可能选择同一个任务；
- 状态和进度写入不是事务操作；
- 完成结论主要依赖模型结构化自报，没有独立验收执行器；
- 没有依赖图、并行执行、Git 管理或自动回滚；
- 外部 AI 必须遵守提示词中的任务文件协议，否则仓储会拒绝非法 Frontmatter。

## 7. 测试边界

自动测试覆盖：

- 初始化事实文档和两份提示词；
- 读取外部 AI 生成的标准任务；
- 拒绝编号、元数据或正文结构不合法的外部任务；
- 更新状态时保留任务正文；
- 只执行首个未完成任务；
- 完成后自动执行下一任务，阻塞后立即停止；
- 显式注入规格、进度和当前任务；
- SDK 异常转为阻塞状态；
- Claude SDK 使用完整执行权限和不可恢复会话配置。

测试不调用真实模型，也不启动浏览器。
