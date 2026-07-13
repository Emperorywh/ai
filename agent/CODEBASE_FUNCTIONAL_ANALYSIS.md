# 当前代码库功能与架构分析

> 分析日期：2026-07-13  
> 分析依据：`src/**/*.ts`、`test/**/*.ts`、`package.json`、`tsconfig.json`、`vitest.config.ts` 以及实际验证结果。  
> 排除范围：分析过程中未读取仓库内任何既有 Markdown 文档，包括 `docs/`、`AGENTS.md`、`Readme.md`。本文中的功能结论只以当前代码和测试为依据。

## 1. 项目定位

这是一个名为 `caw` 的 Node.js/TypeScript 命令行系统，用于管理长周期 Coding Agent 任务。

它采用“结构化文档 + Git worktree + Agent SDK + 审查 + 线性合并”的工作方式：

1. 用带 YAML frontmatter 的任务文档描述任务、权限、依赖、验证命令和上下文范围。
2. 每个执行中的任务使用独立 Git worktree 和 `task/TASK-XXX` 分支。
3. Task Executor 可以使用 Claude Agent SDK 执行任务，也可以显式使用 dry-run 执行器联调流程。
4. 普通任务执行完成后进入独立 Reviewer 审查；`no_review` 任务可以跳过 Reviewer。
5. 只有状态到达 `done` 的任务才会 rebase 到主分支并 fast-forward 合并。
6. 任务结果中的进度、决策、问题更新请求在合并后写回全局文档。
7. SQLite 只保存可重建索引，不是任务状态的事实来源。

当前系统不是一个完整的“自动多任务 Orchestrator 产品”。代码已经实现了很多编排原语和单任务用例，但 CLI 目前主要提供单任务执行与审查入口；并行调度、恢复、真实系统验证、硬权限审计等部分能力尚未默认接入 CLI。

## 2. 技术栈与运行形态

| 类别 | 当前实现 |
| --- | --- |
| 运行时 | Node.js 20 及以上 |
| 语言与模块 | TypeScript、严格模式、ESM、NodeNext |
| CLI | Commander |
| 数据校验 | Zod |
| 文档协议 | Markdown 正文 + YAML frontmatter |
| YAML | `yaml` |
| 派生索引 | SQLite，`better-sqlite3` |
| Agent 执行 | `@anthropic-ai/claude-agent-sdk` |
| Provider SDK | `@anthropic-ai/sdk` |
| MCP | 已声明 MCP SDK 依赖，但当前自有 MCP 适配器仍是未连接骨架 |
| 版本控制隔离 | 系统 Git + worktree + task 分支 |
| 测试 | Vitest |

编译产物的 CLI 入口是 `dist/cli/index.js`，命令名为 `caw`。

## 3. 总体分层与依赖方向

代码分为四层：

```text
cli
 ├─ 解析命令和配置
 ├─ 创建具体基础设施实例
 └─ 串联 application 用例
          │
          ▼
application
 ├─ 单任务执行、验证、审查、完成用例
 ├─ 状态编排、Context Pack、规划、调度
 └─ 只通过 Port 表达外部能力
          │
          ▼
core
 ├─ 枚举与 Zod Schema
 ├─ 状态机
 ├─ 依赖、权限、验证和状态映射规则
 └─ 不依赖其他业务层

infrastructure
 ├─ 文件系统、Git、SQLite、子进程
 ├─ Claude Agent SDK、MCP
 └─ 实现 application 定义的 Port
```

代码中的主要依赖关系符合：

```text
cli → application → core
cli → infrastructure → core
infrastructure → application/ports
```

`application` 没有直接导入具体基础设施实现。CLI 是 composition root，负责把 `TaskDocRepository`、`WorktreeAdapter`、SDK Executor、Reviewer 等实例注入用例。

## 4. 状态、数据与事实来源

### 4.1 事实来源

系统有三类不同性质的状态来源：

| 数据 | 权威来源 | 说明 |
| --- | --- | --- |
| 任务定义与当前状态 | 任务文件 frontmatter | 状态机和 CLI `status` 都直接读取它 |
| 执行事实 | `.result.md` frontmatter | 记录执行状态、文件变更、验证结果、更新请求等 |
| 审查事实 | `.review.md` frontmatter | 与执行结果分离，记录 Reviewer 结论 |
| 合并进度 | Git 分支与提交关系 | 恢复逻辑使用分支是否已进入 main 判断进度 |
| 查询索引 | SQLite | 派生数据，可从文档全量重建，不参与状态判定 |

### 4.2 任务状态机

任务共有 9 个状态：

- `draft`
- `ready`
- `running`
- `blocked`
- `reviewing`
- `done`
- `rejected`
- `failed`
- `cancelled`

主要流转为：

```text
draft ──→ ready ──→ running ──→ reviewing ──→ done
  │         │          │              ├──────→ rejected ──→ ready
  │         │          │              ├──────→ blocked  ──→ ready
  │         │          ├──────→ blocked
  │         │          ├──────→ failed ──→ ready（需确认）
  │         │          └──────→ done（仅 no_review）
  │         │
  └─────────┴────────────────────────────────────→ cancelled

done ──→ blocked（需确认，用于严重回归或合并冲突）
```

额外约束：

- `running → done` 只有 `no_review: true` 才允许。
- `failed → ready/cancelled` 需要显式确认。
- `done → blocked` 需要显式确认。
- `cancelled` 是终态。
- 所有自流转都非法。

### 4.3 执行结果映射

`.result.md` 使用两个字段决定目标状态：

- `execution_status`：`completed | blocked | failed`
- `next_action`：`review | retry | needs-human | cancel`

核心映射：

| 组合 | 目标状态 |
| --- | --- |
| `completed + review` | 普通任务到 `reviewing` |
| `completed + review` 且 `no_review` 校验通过 | `done` |
| `completed + review` 且 `no_review` 校验失败 | `blocked` |
| `completed + needs-human` | `blocked` |
| `blocked + needs-human/retry` | 保持 `blocked` |
| `failed + needs-human/retry` | 保持 `failed` |
| 任意执行状态 + `cancel` | `cancelled` |

明确拒绝的组合包括：

- `completed + retry`
- `blocked + review`
- `failed + review`

## 5. 结构化文档模型

### 5.1 任务 frontmatter

任务模型包含：

- `id`、`title`、`status`、`layer`
- `depends_on`
- `allowed_paths`、`forbidden_paths`
- `permissions`
- `no_review`、`restart_on_retry`
- `verification`
- `context_pack`
- `workflow_outputs.result_file`

`layer` 支持：`type | data | state | domain | ui | page | test`。

权限支持：

- `read_files`
- `write_files`
- `run_commands`
- `install_dependencies`
- `modify_config`
- `delete_files`
- `start_dev_server`
- `open_browser`
- `network_access`

### 5.2 执行结果 frontmatter

执行结果包含：

- 任务 id 和执行状态
- 修改、新建、删除的文件清单
- 合并后回填的执行 commit 元信息
- 模型或系统验证记录
- `progress/decisions/issues` 三类全局更新请求
- 建议下一步

系统验证记录支持额外事实字段：

- `source: model | system`
- `exit_code`
- `duration_ms`
- `output_summary`

### 5.3 审查 frontmatter

审查结果包含：

- `review_result`：`approved | rejected | needs-human-confirmation | skipped`
- `reviewer`
- `reviewed_at`
- `required_changes`
- `findings`

`skipped` 只用于 `no_review` 任务的 Orchestrator 占位，不由 SDK Reviewer 正常产出。

### 5.4 决策与问题

决策支持 `proposed | accepted | superseded`；问题支持 `open | resolved` 和四级严重度。

Executor 提交全局更新请求时可以把决策或问题 id 留空，回写阶段再分配 `DEC-XXX` 或 `ISS-XXX`。

## 6. 当前 CLI 功能

### 6.1 `caw init [targetDir]`

功能：

- 初始化任务工作流所需目录和模板文件。
- 初始化 `.caw/config.json` Provider Profile。
- 已存在文件一律跳过，不覆盖，因而可重复执行。

当前会生成 10 个文件，包括工作流文档模板、任务目录占位文件和 Provider 配置。

### 6.2 `caw plan --from <file>`

功能：

- 从用户提供的 YAML/JSON 计划定义生成阶段计划和任务文件。
- 校验任务 id、layer、权限、依赖图和路径冲突。
- 所有新任务固定生成为 `draft`。
- 依赖任务的 `allowed_paths` 可用于预填后继任务的 `source_files`。

限制：

- 这不是 AI 自动规划功能。
- 调用方必须在 `--from` 文件中显式提供 `title`、`phases` 和完整 `tasks`。
- 标准模式必须显式传 `--reviewed`；否则只能通过 `sourceSpec` 走自举模式。
- 路径冲突只提示 warning，不阻止生成，后续默认串行处理。

### 6.3 `caw task:create`

功能：

- 增量创建单个任务文件。
- 自动派生或校验英文 slug。
- 自动生成结果文件路径。
- 生成 13 节任务正文骨架。
- 初始状态固定为 `draft`。

当前没有单独的 CLI 命令把 `draft` 置为 `ready`。实际使用者需要通过外部编排或直接修改合法 frontmatter 完成该步骤，否则 `task:run` 会拒绝执行。

### 6.4 `caw status`

功能：

- 从任务文档列出任务 id、状态、layer、执行摘要和标题。
- 支持 `--status`、`--layer` 过滤。
- 执行摘要来自 `.result.md` 和可选 `.review.md`。

该命令明确不依赖 SQLite，因此索引缺失时仍可工作。

### 6.5 `caw rebuild-index`

功能：

- 清空 SQLite 四张索引表。
- 从任务、结果、审查、决策和问题文档全量重建索引。
- 在单事务内执行，失败整体回滚。
- 输出 tasks、executions、decisions、issues 行数。

这是破坏性重建命令，但只破坏派生索引，不改权威文档。

### 6.6 `caw task:run <taskId>`

单任务执行链如下：

1. 从主工作区读取任务，要求状态为 `ready`。
2. 检查全部依赖任务已为 `done`。
3. 读取依赖任务实际产物并刷新 Context Pack。
4. 检查 `allowed_paths` 与 `forbidden_paths` 是否重叠。
5. 计算验证命令 allowlist。
6. 将任务从 `ready` 置为 `running`。
7. 创建 `.worktrees/<TASK-ID>` 和 `task/<TASK-ID>` 分支。
8. 恢复或安装 worktree 的 `node_modules`。
9. 启动 Executor，并在 worktree 中生成 `.result.md`。
10. 根据结果把主工作区任务状态映射为 `reviewing/done/blocked/failed`。
11. 只有 `done` 才进入 rebase、审计回填、fast-forward 和全局文档回写。

Executor 选择：

- `--executor sdk`：明确使用 Claude Agent SDK，配置或 token 缺失直接失败。
- `--executor dry-run`：不调用模型，只生成合法占位结果。
- 不传 `--executor`：当前实际行为仍会走 SDK 装配；token 缺失会报错，不会自动切换 dry-run。

普通任务执行成功后停在 `reviewing`，不会在 `task:run` 中合并。`no_review` 任务可直接进入 `done` 并合并。

### 6.7 `caw task:review <taskId>`

单任务审查链如下：

1. 要求主工作区任务状态为 `reviewing`。
2. 从任务 worktree 读取 `.result.md`。
3. 普通任务调用 Reviewer；`no_review` 任务生成 `skipped` 占位审查。
4. 把 `.review.md` 写回主工作区。
5. 映射为 `done/rejected/blocked`。
6. 只有 `done` 才调用共享 Finalize 用例合并。

Reviewer 选择：

- `--reviewer sdk`：明确使用 SDK，配置或 token 缺失直接失败。
- `--reviewer local`：使用本地 Reviewer。
- 不传 `--reviewer`：先尝试 SDK；装配失败时警告并自动回退本地 Reviewer。

本地 Reviewer 不检查改动，固定返回 `approved`。因此自动回退路径会让任务进入 `done` 并触发合并。这是当前代码的真实行为，不等价于独立真实审查。

## 7. Context Pack

Context Pack 是 Executor 的显式读取清单，包含：

- `required_docs`
- `optional_doc_excerpts`
- `source_files`

代码会无条件把三个固定核心文档和当前任务文件加入 `required_docs`。如果依赖任务已经全部完成，后继任务的 `source_files` 会被依赖结果中的 `modified_files + created_files` 替换；只要有任一依赖未完成，则保留规划阶段预填值。

SDK 接入只把文件清单放入 prompt，不会在宿主进程提前读取并把文件全文塞进 prompt；模型在 worktree 中自行使用工具读取。

## 8. 权限与路径控制

### 8.1 已实现规则

- `allowed_paths` 与 `forbidden_paths` 重叠时 deny 优先，任务在创建 worktree 前被拒绝。
- 路径比较按路径段处理，避免把 `src/foo` 误判为 `src/foo-bar` 的祖先。
- 执行后路径审计支持目录、文件和 `*`、`**`、`?` glob。
- Git 变更枚举支持 tracked、staged、unstaged、untracked、deleted 和 rename/copy。
- 命中 forbidden 或不在 allowed 内会产生结构化违规和问题提议。
- 验证命令的 `requires_permissions` 必须被任务 permissions 覆盖。

### 8.2 当前实际执行边界

Claude SDK 会话使用 `bypassPermissions`，并允许危险跳过权限检查。任务路径和能力主要以 system prompt 软约束注入，没有 SDK tool hook 级硬拦截。

虽然代码已经实现执行后 Git 路径审计，但 CLI 命令的默认装配没有传入 `WorkspaceInspectionPort`。因此用户直接运行 `caw task:run` 时，默认不会执行该硬审计；只有通过编程接口显式注入后才会生效。

## 9. 验证系统

验证命令来自两个来源：

1. 项目级验证命令声明，按任务 layer 裁剪。
2. 任务 frontmatter 的 `verification`。

合并规则：

- 两者取并集并按命令字符串去重。
- 同名命令由任务级声明决定来源标记。
- 项目级声明的 `requires_permissions` 不会因任务级覆盖而丢失。

真实系统验证用例支持：

- 权限不足时不调用 Runner，直接返回 `blocked + needs-human`。
- 严格按 allowlist 顺序串行执行。
- 记录真实退出码、耗时、stdout/stderr 摘要。
- 系统结果覆盖同名模型自报结果。
- 任意 failed、skipped 或未执行命令都不通过完成门禁。
- 单命令默认超时 5 分钟。
- stdout/stderr 分别限制为 16 KB，最终摘要限制为 4096 字符。
- Windows 超时通过 `taskkill /T /F` 清理进程树。

当前 CLI 默认没有注入 `ProcessVerificationRunner`，所以直接运行 `caw task:run` 时不会自动执行这套真实系统验证。默认状态映射主要依赖 Executor 写入的模型自报 verification。

另一个现实边界是：即使调用方为普通任务注入了系统 Runner，系统验证失败后该任务当前仍可进入 `reviewing`，而不是直接阻止审查；只有 `no_review` 任务会被系统验证门禁直接挡在 `blocked`。最终是否能被 Reviewer 批准取决于 Reviewer 实现。

## 10. Claude Agent SDK 集成

### 10.1 Provider Profile

初始化配置预置：

- `anthropic`
- `glm`

配置保存 endpoint、token 环境变量名、三档模型映射和附加环境变量，不保存明文 token。

官方端点使用 `ANTHROPIC_API_KEY`；第三方兼容端点使用 `ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_BASE_URL`。配置还会注入三档默认模型变量。

### 10.2 Executor 会话

SDK Executor 会：

- 使用 Claude Code preset system prompt。
- 注入 Context Pack 清单、权限边界和结构化结果契约。
- 让模型在输出末尾生成 `result-frontmatter` fenced JSON。
- 对 JSON 提取或 Schema 校验失败进行最多 2 次重试。
- 对网络、限流、5xx 做最多 3 次指数退避重试。
- 对鉴权错误立即失败，不重试。
- 对 SIGINT/abort 降级为 `blocked + needs-human`，保留 worktree。
- 把模型自报验证统一标记为 `source=model`。

SDK 没有配置 `maxTurns`，也没有工具级 `canUseTool` 拦截；边界依赖 prompt 和可选的执行后审计。

### 10.3 Reviewer 会话

Reviewer 使用独立 SDK 会话，不复用 Executor 对话历史。模型被要求读取 `.result.md`、Git 状态和实际 diff，并输出 `review-frontmatter` JSON。

Reviewer 的 JSON 重试、网络重试、鉴权失败和中断处理与 Executor 类似，但所有降级都返回 `needs-human-confirmation`，不会伪造 `approved`。

### 10.4 可观测性

SDK 路径支持：

- assistant 文本、工具调用和工具结果的终端流式摘要。
- 完整 SDK 消息与 stderr 日志，写入 `.caw/logs/<task>-<timestamp>.log`。
- cost、token、轮次和持续时间统计。
- SIGINT 转为 `AbortController.abort()`。

## 11. Git worktree 与合并

### 11.1 Worktree 生命周期

- 分支名：`task/TASK-XXX`
- 目录：默认 `.worktrees/TASK-XXX`
- 创建时记录基线 commit。
- `reset` 可以把 worktree 回到创建基线并清理未跟踪文件。
- `remove` 可以删除 worktree 和任务分支。

但是当前 `task:run/task:review` 主链没有调用 `reset`、`retain` 或 `remove`。`restart_on_retry` 字段目前只被保存，没有接入执行用例；任务重跑时仍会再次尝试创建同名分支和 worktree。完成后 worktree 也不会自动回收。

### 11.2 合并流程

`done` 后的共享 Finalize 用例执行：

1. 将任务分支 rebase 到最新 main。
2. 检测冲突；冲突时 abort rebase，不破坏 main。
3. 在 audit commit 前采集实现 commit。
4. 把 post-rebase commit 元信息回填到 `.result.md`。
5. 为审计结果创建独立 commit。
6. 使用 `update-ref` fast-forward main，不产生 merge commit。
7. 回写全局文档。
8. 将结果文件从 main 检出到主工作区。

发生合并冲突时：

- 任务从 `done` 回到 `blocked`。
- 冲突文件写入一个高严重度问题。
- worktree 保留供人工处理。

### 11.3 合并恢复

代码实现了 `recoverMerge`：

- 分支已进入 main：跳过重复合并，只补全局回写。
- 分支未进入 main：先清理残留 rebase，再重新合并。
- 再次冲突：返回结构化冲突，不写全局文档。

当前没有 CLI 命令暴露该恢复功能。恢复时 progress 的 `append` 更新也没有内容级去重，多次调用可能重复追加。

## 12. 全局文档回写

执行结果可以请求三类更新：

### 12.1 Progress

- `replace`：替换目标 Markdown section 内容。
- `append`：追加到目标 section 末尾。
- section 不存在时新建。
- section 边界按标题层级定位，不会被子标题提前截断。

同一批次对同一 section 有多个 `replace` 时，后写者获胜，前写者被记录为冲突结果。

当前 Finalize 用例调用回写函数后忽略返回的 `progress_conflicts`，没有把这些冲突进一步写入问题或改变任务状态。

### 12.2 Decisions 与 Issues

- 使用 fenced YAML block 解析。
- 空 id 由顺序分配器分配。
- 同 id 更新，未知 id 追加。
- 决策和问题分别生成 `DEC-XXX`、`ISS-XXX`。

## 13. 调度与依赖

已实现的纯计算能力包括：

- Kahn 拓扑排序。
- 环形依赖检测和闭合环路径。
- 合并顺序计算，保证先处理被依赖任务。
- 按拓扑层和路径不重叠做保守并行分组。
- 失败族状态的传递后继计算。
- 后继任务 blocked 级联尝试。

当前 CLI 只执行用户指定的单个任务，没有“读取全部 ready 任务并自动拓扑调度”的命令。`cascadeIfBlocked` 也没有接入 `task:run/task:review` 主链，因此 CLI 中一个任务被阻塞、失败或驳回后，不会自动把所有后继任务写成 blocked。

## 14. SQLite 索引

SQLite 有四张业务索引表：

- `tasks`
- `decisions`
- `issues`
- `executions`

迁移由 `schema_migrations` 管理，目前 schema 版本为 1。

索引仓储支持：

- 各类记录 upsert。
- 按 status/layer 查询任务。
- 查询最近一次执行摘要。
- 从权威文档原子重建。
- 日常 upsert 失败只告警，不阻断主流程。

当前 CLI 只在 `rebuild-index` 中创建和写入索引；任务运行、审查、合并时没有增量同步 SQLite，`status` 也不读取 SQLite。

## 15. MCP 能力

当前 MCP 模块实现：

- stdio/http/sse 配置 Schema。
- Server 注册、覆盖注册、注销和列表。
- 从原始配置创建注册表。
- 统一 `callTool` 接口和明确错误类型。

当前没有实现任何 transport 连接。调用未注册 server 会报“未注册”；调用已注册 server 也会报“连接未配置”。因此 MCP 目前只是可扩展骨架，不具备真实工具调用能力，也没有接入 CLI 或 Agent 执行主链。

## 16. 测试与当前健康状态

本次实际执行结果：

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| Vitest 测试文件 | 40 个 `*.test.ts` 文件 |
| Vitest 报告的测试套件统计 | 272 个通过，0 失败 |
| Vitest 用例统计 | 919 个，共 917 通过、0 失败、2 跳过 |

2 个跳过项是依赖真实 Anthropic/GLM 密钥的外部 API 测试；其余 core、application、infrastructure、CLI 和 Git 临时仓库集成测试均通过。

测试覆盖的主要行为包括：

- 状态机完整矩阵和上下文门禁。
- Schema 正反例。
- 依赖级联、拓扑排序、并行检测。
- Context Pack 刷新。
- 单任务执行、验证、审查和完成链。
- 路径审计与真实子进程验证。
- Git worktree、rebase、fast-forward、冲突和恢复。
- 全局文档 section 合并和 id 分配。
- SQLite 迁移、查询、容错写入和全量重建。
- Claude SDK 选项、JSON 提取、重试、降级、cost 和中断。
- CLI 命令退出码及临时 Git 项目端到端行为。

## 17. 当前能力分级

### 17.1 已实现且 CLI 可直接使用

- 项目骨架初始化。
- 从显式计划定义生成任务。
- 单任务增量创建。
- 文档权威的状态查询。
- SQLite 全量重建。
- 单任务 Claude SDK 或 dry-run 执行。
- 单任务 SDK、本地或 no-review 审查。
- `done` 任务的 rebase、审计回填、fast-forward 和全局回写。
- SDK 日志、流式摘要、cost 与中断处理。

### 17.2 已实现但 CLI 默认未接线

- Git 实际变更路径审计。
- 真实系统验证 Runner 和完成门禁。
- 多任务拓扑/并行调度。
- 失败依赖的 blocked 级联。
- 合并崩溃恢复。
- worktree reset/remove 与 `restart_on_retry`。
- SQLite 增量同步和索引查询加速。

### 17.3 当前仅为骨架

- MCP transport 和真实工具调用。

## 18. 关键使用风险与架构缺口

以下不是根据旧文档推测，而是从当前调用关系和测试直接得到：

1. **任务无法完全通过 CLI 从 draft 推进到 ready**：缺少对应命令或完整 Orchestrator。
2. **默认 CLI 不启用执行后路径审计**：SDK 又处于 bypass 权限模式，因此默认路径限制主要是软约束。
3. **默认 CLI 不启用真实系统验证**：模型自报验证仍可能影响状态判断。
4. **普通任务的系统验证失败不会直接阻止进入 reviewing**：如果 Reviewer 仍批准，当前 Finalize 没有再次检查验证门禁。
5. **Reviewer 自动回退会固定批准**：缺 SDK 配置时默认 `task:review` 可能把未真实审查的任务合并。
6. **失败/驳回/阻塞不会在 CLI 主链自动级联后继任务**：级联逻辑只存在于 application API。
7. **重试字段未接线**：`restart_on_retry` 不会触发 worktree reset，同名分支/worktree 可能让重跑失败。
8. **worktree 没有自动回收**：完成任务也会留下 worktree 和任务分支。
9. **恢复能力没有 CLI 入口**：崩溃后只能由代码调用方自行装配 `recoverMerge`。
10. **Progress replace 冲突未被 Finalize 消费**：冲突结果会被忽略。
11. **SQLite 只支持手动全量重建**：当前主流程没有增量维护。
12. **MCP 尚不可调用**：只有配置和注册骨架。
13. **`plan` 不执行智能拆分**：任务列表必须由外部完整提供。

## 19. 结论

当前代码已经形成了较清晰的领域层、用例层和适配层，单任务的执行、审查、Git 线性合并、全局文档回写和 SDK 容错链具有较高的模块化程度，且测试覆盖广。

系统当前最准确的产品形态是：

> 一个以结构化文档为权威状态、以 Git worktree 隔离任务、支持 Claude Agent SDK 的单任务工作流 CLI，以及一组尚待统一 Orchestrator 接线的调度、验证、权限、恢复和索引能力。

如果要把它提升为完整的自动化长任务系统，下一阶段的重点不是继续增加新适配器，而是补齐统一 Orchestrator 和 CLI 接线：显式的 ready/重试入口、默认硬路径审计、默认系统验证门禁、审查降级安全策略、依赖级联、恢复命令、worktree 生命周期和索引增量同步。
