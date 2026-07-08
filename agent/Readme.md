
# 自研 Coding Agent 长任务工作流需求说明

## 1. 背景

在使用 Claude Code coding agent 执行复杂前端任务时，单个聊天上下文容易出现窗口耗尽、架构漂移、重复实现、隐式状态、临时补丁和任务失控等问题。

本工作流的核心思想是：**不要依赖长聊天上下文保存记忆，而是通过文件系统中的规格文档、架构文档、任务文档、执行结果和进度文档完成上下文接力。**

本需求文档用于指导自研 Coding Agent 或类 Claude Code 工作流系统的设计，使复杂开发任务可以被拆解、执行、审查、恢复和持续维护。

## 2. 目标

本工作流的目标是：

- 将模糊需求转化为结构化规格说明。
- 在编码前明确架构、数据流、状态流和模块边界。
- 将大型开发任务拆分为多个独立上下文可完成的任务。
- 保证每个任务不依赖历史聊天记录。
- 通过文档协议降低上下文污染和架构漂移。
- 提高代码的可维护性、可扩展性、可测试性和 AI 可理解性。
- 让人工验收、自动验证和后续接力都有明确依据。
- 支持未来自动化调度、权限控制、任务恢复和执行审计。

## 3. 适用范围

适用于：

- 前端应用开发。
- 复杂 UI/UX 实现。
- 多页面、多模块功能开发。
- 新系统从 0 到 1 构建。
- 不兼容 legacy、允许破坏式重构的项目。
- 需要多轮 agent 协作完成的长期任务。
- 需要高可维护性和清晰架构边界的项目。

不适用于：

- 极小型一次性修改。
- 无需架构设计的简单 bug 修复。
- 一次性脚本或静态文本生成。
- 没有长期维护价值的临时实验代码。

> **适用范围声明**：本工作流面向**绿地项目或允许破坏式重构的项目**（见第 4 节“不保留 legacy 兼容代码”原则）。对存量系统的渐进式改造，须先以独立任务完成 legacy 清退、或由项目显式放宽第 4 节该原则后，方可套用本工作流。

### 3.1 推荐技术栈

本工作流推荐采用以下技术栈实现：

```text
TypeScript + Node.js CLI
+ Claude Agent SDK
+ Markdown/YAML 文档协议
+ Zod Schema 校验
+ SQLite 状态索引
+ Git worktree 任务隔离
+ MCP 工具扩展
+ 后期 Tauri/React UI
```

各技术的职责边界如下：

- `TypeScript + Node.js CLI` 作为第一阶段主入口，负责任务初始化、文档生成、状态检查、任务执行、审查调度和本地命令编排。
- `Claude Agent SDK` 作为 agent 执行引擎适配层，负责调用模型、工具、权限、hooks、subagents 和 MCP 能力，不作为长期业务状态的唯一来源。
- `Markdown/YAML 文档协议` 作为长期上下文和任务协议的事实来源，其中 YAML frontmatter 面向机器解析，Markdown 正文面向人工和 agent 理解。
- `Zod Schema 校验` 用于校验任务 frontmatter、状态机流转、配置文件、Context Pack、权限声明和执行结果结构。
- `SQLite 状态索引` 用于查询、审计、恢复加速和任务依赖索引，不替代 Markdown/YAML 文档协议；必要时应能从文档重新构建索引。
- `Git worktree 任务隔离` 用于为每个独立任务创建隔离工作区和分支，降低并行执行、回滚、审查和冲突处理的复杂度。
- `MCP 工具扩展` 用于接入外部工具能力，例如浏览器、设计工具、文档系统、测试平台或项目管理系统，但不承载核心工作流领域逻辑。
- `Tauri/React UI` 作为后期可视化界面，只调用稳定的应用服务层，不直接操作核心领域模型、SQLite 或底层 agent SDK。

推荐的长期分层边界如下：

```text
core/
  workflow 模型、任务状态机、领域规则、Zod schema

application/
  规格生成、架构生成、计划拆分、Context Pack 生成、任务调度、审查调度

infrastructure/
  文件系统文档仓储、SQLite 索引仓储、Git worktree 适配器、Claude Agent SDK 适配器、MCP 适配器

cli/
  init、plan、task:create、task:run、task:review、status 等命令入口

ui/
  后期 Tauri/React 可视化界面
```

核心约束：

- `core` 不依赖 CLI、UI、SQLite、Git、MCP 或 Claude Agent SDK。
- `application` 编排用例流程，但不直接依赖具体基础设施实现。
- `infrastructure` 只实现外部系统适配，不反向承载业务规则。
- `cli` 和后期 `ui` 只作为交互入口，不拥有核心状态机和任务规则。
- agent 会话、SDK session 和模型上下文只作为执行过程材料，不能替代文档协议中的长期上下文。

角色与分层映射：

- `Workflow Orchestrator`、`Reviewer / Validator`、`Task Executor` 是领域角色（见第 5 节），由 `application` 层编排，`infrastructure` 层提供执行引擎、文件、Git、SQLite 等适配能力；本文档中“Orchestrator 负责”“由 application 层调度”指的是同一件事——该角色经 application 层用例实现。
- 角色之间只通过文档协议和状态机协作，不通过共享内存或聊天上下文。

状态索引（SQLite）与文档协议的关系：

- SQLite 仅作查询、审计、恢复加速和依赖索引的**派生存储**，文档协议（Markdown 正文 + YAML frontmatter）始终是唯一事实来源。
- 索引内容至少包括：任务 `id / title / status / layer / depends_on / allowed_paths / permissions`、决策 `id / scope / status`、问题 `id / severity / status / owner`、最近一次执行摘要（`execution_status / review_result / next_action`）和执行 commit 元信息。
- 写入时机：任务状态流转、合并回写、决策或问题变更时由 application 层**同步写入**索引；索引与文档不一致时以文档为准，可通过 `rebuild-index` 命令从文档全量重建。
- 写入容错：索引写入失败**不阻断**状态流转和合并，由 application 层记录告警日志后继续流程，后续通过 `rebuild-index` 从文档全量重建修复；正确性始终以文档协议为准，不依赖索引写入是否成功。
- 索引不参与状态机判定，状态机只读 frontmatter；任何“读状态”的判断都不得只依赖 SQLite。

### 3.2 并行执行与 worktree 合并策略

`Git worktree` 为每个处于 `running` 状态的任务创建独立工作区和分支（命名建议 `task/TASK-XXX`）。无论串行还是并行，每个 running 任务都使用独立 worktree，目的是统一执行、回滚、审查和冲突处理模型，infrastructure 层负责自动创建与回收，对上层透明；串行模式下 worktree 顺序复用、清理成本低，并行模式下 worktree 是隔离的硬性前提。默认执行模型为**串行**（见第 11 节流程）；只有当多个任务互无 `depends_on` 依赖、且 `allowed_paths` 不重叠时，才允许由 Orchestrator（经 application 层）调度并行执行。

并行与合并规则：

- 每个 worktree 基于任务启动时的主分支基线创建；合并流程顺序为：**先 rebase 到最新主分支**（rebase 会重写 commit hash），**rebase 完成后**由 Orchestrator 把 post-rebase 的执行 commit 元信息（`hash / message / author / 时间`，即主分支历史中实际存在的 commit hash）写入 `.result.md` 的 `execution_commits` 字段并落入 SQLite，**最后**以 fast-forward 合并方式回收到主分支，避免无意义的 merge commit。审计元信息必须在 rebase 之后、fast-forward 之前回填，确保记录的 `hash` 与主分支历史一致；rebase 前的旧 hash 一律丢弃，不作为审计依据。
- 合并顺序由 application 层按 `depends_on` 拓扑序决定，先合并被依赖方，再合并依赖方；任何任务都不得先于其依赖任务回收到主分支。
- 合并冲突由 **Orchestrator 负责协调**，不交给 Task Executor 自行解决；冲突无法自动消解时，将后合并的任务置为 `blocked`，并把冲突清单写入 `ISSUES.md`。
- `PROGRESS.md`、`DECISIONS.md`、`ISSUES.md`、任务 frontmatter 状态等**全局工作流状态只在主分支由 Orchestrator 维护**，worktree 中只读引用；Task Executor 完成后只把需要更新的内容写入 `.result.md` 的结构化字段，由 Orchestrator 在合并回主分支时统一回写到全局文档，避免多 worktree 并发写同一文件。
- 并行任务的全局文档一致性：Orchestrator 在调度并行任务时记录各自的主分支基线 commit，Executor 读到的全局文档以该基线为准；合并回写时 Orchestrator 按 `depends_on` 拓扑序**串行**处理，每次回写前基于最新主分支重读全局文档再合并 `global_update_requests`。回写采用**机器可判定的 section 级合并**：每条 `progress` 更新必须声明 `mode`（`replace` 整段替换目标 section / `append` 拼接到目标 section 末尾）和目标 `section`；`append` 按拓扑序拼接，不同 `section` 互不影响直接合并；多条 `replace` 命中同一 `section` 时按拓扑序后写者覆盖先写者，先写者落选并由 Orchestrator 将冲突项写入 `ISSUES.md`，视情况把后合并任务置为 `blocked`，后写者不得静默覆盖先写者。`decisions` / `issues` 更新按 Orchestrator 统一分配的 `id` 去重追加，不参与 section 合并。
- `.result.md` 是 Task Executor 的内置输出产物，默认允许写入，不需要出现在业务 `allowed_paths` 中；除 `.result.md` 外，Task Executor 不得直接修改任务定义、全局文档或其他工作流状态文件。
- 任务进入 `rejected` / `failed` 时，其 worktree 分支保留至该任务重新合并回主分支或人工确认放弃后，再由 infrastructure 层删除；`cancelled` 为终态，其 worktree 分支保留至人工确认放弃后删除。三类状态的分支都不会被自动清理。
- 合并操作必须**幂等可恢复**：Orchestrator 在 rebase、回填 `execution_commits`、fast-forward 合并、全局文档串行回写之间任一步崩溃时，恢复逻辑按 git 状态判定——用 `git branch --merged` 检查 worktree 分支是否已进入主分支：已进入则跳过合并、仅补做未完成的全局文档回写；未进入则丢弃上一次不完整的 rebase 中间态，从主分支最新基线重新 rebase。合并进度不写 SQLite，可从 git 状态加 frontmatter `status` 完全重建。

## 4. 核心原则

本节描述贯穿工作流的设计哲学与原则；具体到编码层的执行约束（不引入临时 patch、不写巨型函数、不跨层调用等）以 `AGENTS.md` 为唯一权威，本节不重复维护，仅在下述原则中点到为止。

所有实现必须遵循：

- 先理解架构，再开始编码。
- 先明确数据流和状态流，再实现 UI。
- 先定义模块边界，再拆分任务。
- 优先长期架构正确性，而不是短期完成速度。
- 不保留 legacy 兼容代码、deprecated 旧入口、灰度开关或隐式 fallback；网络重试、错误提示、环境能力检测等运行时容错必须作为显式错误处理或能力声明写入 `SPEC.md` / `ARCHITECTURE.md`，不得作为兼容旧系统的隐藏逻辑存在。
- 不通过临时 patch 解决结构性问题。
- 每个任务只负责一个清晰目标。
- 每个任务都必须显式声明修改范围和禁止修改范围。
- 每次修改后都要检查是否增加耦合、引入技术债或破坏架构一致性。
- 发现架构不合理时，优先重构，而不是继续堆逻辑。

## 5. 系统角色

### 5.1 Workflow Orchestrator

贯穿任务全生命周期：编码前负责规格、架构、计划与任务拆分，编码中负责调度与状态流转，编码后负责审查 gate 调度、合并、全局文档回写与失败恢复。

编码前职责包括：

- 访谈用户。
- 生成 `SPEC.md`。
- 生成 `ARCHITECTURE.md`。
- 对 `SPEC.md` 与 `ARCHITECTURE.md` 做生成后自动一致性校验（结构完整、字段合规、内部引用一致），再提交 Reviewer 独立审查；该自动校验不替代 Reviewer 的独立审查。
- 生成 `PLAN.md`。
- 拆分 `TASKS/`。
- 维护任务依赖关系。
- 生成每个任务的上下文包。
- 确保每个任务可以被独立上下文执行。

编码中与编码后职责包括：

- 将任务状态从 `ready` 置为 `running`；Task Executor 产出 `.result.md` 后，将状态置为 `reviewing`。
- 在 `no_review: true` 时跳过 Reviewer，由 Orchestrator 直接校验产物：通过则置 `done`，不通过则置 `blocked`（等待人工确认或扩权）或 `failed`（无法修复）。
- 按 Reviewer 的 `.review.md` 结论映射任务状态（见第 15 节）。
- 按第 3.2 节策略执行合并：拓扑序 rebase + fast-forward、回填 `execution_commits`、协调合并冲突、串行回写全局文档。
- 处理依赖级联：前置任务进入 `rejected` / `failed` / `blocked` 时，把所有后继任务（传递闭包）置为 `blocked`。
- 处理失败恢复：根据 `.result.md` 与人工确认，将任务置为 `failed` 或 `blocked`。

Workflow Orchestrator 不应直接完成所有开发，也不拥有规格、架构或任务结果的最终审查结论；它应优先建立清晰的文档协议、架构约束和任务边界，并把审查 gate 交给 Reviewer。

### 5.2 Task Executor

负责执行单个任务。

职责包括：

- 读取固定上下文文件。
- 理解当前任务。
- 复述任务目标、修改范围和架构边界。
- 只完成当前任务。
- 修改代码。
- 完成必要验证。
- 生成任务执行结果。
- 在 `.result.md` 中记录进度、决策和问题的更新建议。
- 结束当前上下文。

Task Executor 不应依赖历史聊天记录，也不应执行当前任务以外的后续任务；除当前任务 `.result.md` 外，不得直接更新 `PROGRESS.md`、`DECISIONS.md`、`ISSUES.md` 或任务 frontmatter 状态。

### 5.3 Reviewer / Validator

负责独立审查任务执行结果。

职责包括：

- 检查是否完成任务目标。
- 检查是否越过修改范围。
- 检查是否破坏架构边界。
- 检查是否引入重复逻辑、隐式状态或跨层耦合。
- 检查是否更新必要文档。
- 检查是否通过自动验证。
- 给出通过、驳回或需要人工确认的结论。

Reviewer 不应继续实现功能，只负责审查和反馈。

Reviewer 在任务拆分前还负责独立审查 `SPEC.md` 和 `ARCHITECTURE.md`，避免 Orchestrator 自审。只有 SPEC 与 ARCHITECTURE 通过 Reviewer 审查后，Orchestrator 才能进入生成 `PLAN.md` 与 `TASKS/` 阶段。

任务执行结果的审查结论由 Reviewer 写入独立的 `TASKS/TASK-XXX-xxx.review.md`（模板见第 15 节），不写入 `.result.md`；`.result.md` 只记录 Task Executor 的执行事实，审查结论与执行事实分别由不同角色拥有，互不覆写。当任务声明 `no_review: true` 时，Reviewer 不介入，由 Orchestrator 生成 `review_result: skipped` 的 `.review.md`。

## 6. 文档体系

完整工作流应产生以下文档：

```text
AGENTS.md
SPEC.md
ARCHITECTURE.md
PLAN.md
PROGRESS.md
DECISIONS.md
ISSUES.md
TESTING.md
TASKS/
  TASK-001-xxx.md
  TASK-001-xxx.result.md
  TASK-001-xxx.review.md
  TASK-002-xxx.md
  TASK-002-xxx.result.md
  TASK-002-xxx.review.md
```

### 6.1 AGENTS.md

定义 agent 的通用执行约束，例如：

- 使用简体中文回复。
- 复杂或非显而易见的逻辑必须添加简体中文注释；自解释的简单代码不强求注释，避免噪声。
- 不主动格式化无关代码。
- 不自动启动浏览器测试。
- 不引入临时 patch。
- 不写巨型函数或巨型组件。
- 不跨层调用。
- 不制造隐式状态。

`AGENTS.md` 是上述执行约束的**唯一权威来源**；第 13 节执行规则、第 18 节启动提示只引用 `AGENTS.md`，不重复维护约束副本，避免日后改一处漏一处。任务或工作流特有的增量约束（如修改范围、状态机相关规则）单独写在任务文件或对应章节中。`AGENTS.md` 为自由格式的约束文本，不强制 YAML frontmatter，也不参与 Zod Schema 校验；其内容变更由人工或 Orchestrator 在规格阶段维护。

### 6.2 SPEC.md

产品与功能规格文档，回答“要做什么”。

应包含：

- 项目背景。
- 产品目标。
- 非目标。
- 用户角色。
- 核心场景。
- 用户流程。
- 页面需求。
- 组件需求。
- 交互需求。
- 数据需求。
- 状态需求。
- 错误处理。
- 空状态。
- 加载状态。
- 边界情况。
- 可访问性要求。
- 验收标准。

### 6.3 ARCHITECTURE.md

架构约束文档，回答“应该如何组织系统”。

应包含：

- 技术栈。
- 目录结构。
- 分层设计。
- 模块边界。
- 数据模型。
- 状态管理策略。
- API / service 边界。
- UI 组件分层。
- 业务逻辑归属。
- 复用策略。
- 命名约定。
- 禁止跨层调用规则。
- 可测试性策略。
- 未来扩展点。

### 6.4 PLAN.md

阶段级开发计划，回答“按什么顺序做”。

推荐顺序：

1. 项目结构和基础约束。
2. 类型系统和领域模型。
3. 数据访问层。
4. 状态管理层。
5. 核心业务逻辑。
6. 基础 UI 组件。
7. 页面组合。
8. 边界状态。
9. 测试与验收。

`PLAN.md` 不应写成过细的任务清单，而应描述阶段、依赖关系和交付顺序。

### 6.5 PROGRESS.md

当前项目状态摘要，用于上下文恢复。

`PROGRESS.md` 只保留当前有效状态，不应变成完整历史垃圾场。

应包含：

- 当前完成到哪个任务。
- 当前系统可用能力。
- 当前架构状态。
- 后续任务必须知道的信息。
- 当前未解决问题摘要。
- 建议下一个任务。

完整历史应记录在各个 `TASK-XXX.result.md` 和 `DECISIONS.md` 中。

### 6.6 DECISIONS.md

记录重要架构决策。

每条决策应包含：

- 决策编号。
- 决策背景。
- 最终选择。
- 被放弃的方案。
- 影响范围。
- 后续约束。

为支持 Zod Schema 校验和 SQLite 重建索引，每条决策必须保留稳定机器字段，至少包括 `id`、`title`、`status`、`scope`、`created_from_task`、`decision`、`rationale` 和 `consequences`；这些字段应使用 YAML frontmatter、fenced YAML block 或统一 YAML 列表表达，纯 Markdown 标题不视为机器字段。Markdown 正文可以补充解释，但不得替代这些字段。该字段集与第 10 节 `global_update_requests.decisions` 提议项保持一致，Task Executor 提议时 `id` 留空，由 Orchestrator 回写时统一分配。`created_from_task` 在任务阶段填任务 `id`（如 `TASK-003`）；SPEC / ARCHITECTURE 阶段产生的决策无对应任务，填阶段标识 `SPEC` 或 `ARCHITECTURE`，Zod Schema 将其与任务 `id` 一并作为合法枚举值。

### 6.7 ISSUES.md

记录未解决问题、阻塞项和需要人工确认的事项。

每个问题应包含：

- 问题编号。
- 问题描述。
- 影响范围。
- 当前状态。
- 需要谁确认。
- 建议处理方式。

为支持 Zod Schema 校验和 SQLite 重建索引，每个问题必须保留稳定机器字段，至少包括 `id`、`title`、`status`、`severity`、`scope`、`created_from_task`、`owner` 和 `recommended_action`；这些字段应使用 YAML frontmatter、fenced YAML block 或统一 YAML 列表表达，纯 Markdown 标题不视为机器字段。Markdown 正文可以补充上下文，但不得替代这些字段。该字段集与第 10 节 `global_update_requests.issues` 提议项保持一致，Task Executor 提议时 `id` 留空，由 Orchestrator 回写时统一分配。`created_from_task` 在任务阶段填任务 `id`；SPEC / ARCHITECTURE 审查阶段产生的问题填 `SPEC` 或 `ARCHITECTURE`，与任务 `id` 一并作为 Zod Schema 合法枚举值。

### 6.8 TESTING.md

定义验证策略。

应包含：

- 类型检查命令。
- 单元测试命令。
- 构建检查命令。
- 人工验收步骤。
- 不自动执行的测试类型。
- 已知无法自动验证的项目。

为支持按 `layer` 裁剪验证范围（见第 16 节验证 allowlist），`TESTING.md` 中每条自动验证命令可选择性声明 `layers`（适用的 `layer` 枚举值列表，见第 9 节）；未声明 `layers` 的命令对所有任务生效。该声明使用 YAML frontmatter 或 fenced YAML block 表达。

## 7. 任务状态机

每个任务必须具有明确状态。

```text
draft       草稿，尚未准备执行
ready       已准备，可执行
running     正在执行
blocked     被阻塞，需要人工确认或前置任务
reviewing   等待审查
done        常态终态。已完成，满足 Reviewer 审查通过或免审校验；仅严重回归时例外重开（见下）
rejected    执行结果被驳回，需要返工
failed      执行失败且无法自动重试，等待人工介入、重开或取消
cancelled   任务被取消，不再执行
```

状态流转规则：

```text
draft     -> ready | cancelled
ready     -> running | draft | cancelled
running   -> reviewing | blocked | failed | cancelled
running   -> done                         # 仅当 no_review: true 且 Orchestrator 校验产物通过
reviewing -> done | rejected | blocked | cancelled
rejected  -> ready | cancelled
blocked   -> ready | failed | cancelled
failed    -> ready | cancelled            # 仅允许 Orchestrator 或人工确认后流转；需重新定义任务时先回 ready 再退 draft
done      -> blocked                      # 常态终态；仅 Orchestrator 或人工确认，用于 reopen 严重回归
```

禁止跳过 `reviewing` 直接进入 `done`，除非任务 frontmatter 声明 `no_review: true`；此时允许 `running -> done`，含义是**跳过 Reviewer 独立审查，但仍由 Orchestrator 校验 `.result.md`、验证结果和全局文档更新建议齐全**（见第 15 节），并非”自审通过”。若 `no_review: true` 任务在 `running` 阶段 Orchestrator 校验产物不通过，则**不进入 `done`**，改走 `running -> blocked`（等待人工确认或扩权）或 `running -> failed`（无法修复），由 Orchestrator 按 `.result.md` 的 `next_action` 决定。

补充说明：

- `ready -> draft`：任务定义本身有问题时，可退回 `draft` 重新定义。
- `rejected -> ready` 与 `blocked -> ready` 默认为**续跑语义**：保留已存在的 worktree 与已完成修改，Task Executor 在此基础上继续；若任务 frontmatter 声明 `restart_on_retry: true`，则重置 worktree 从干净状态重跑。worktree 的保留与重置由 infrastructure 层统一管理。`rejected -> cancelled` 用于放弃一个被反复驳回的任务，不必再经 `ready` 中转。
- `failed` 不是自动重试态，Task Executor 不得自行从 `failed` 继续执行；只有 Orchestrator 或人工确认失败处理方案后，才能将其重开为 `ready`（若问题出在任务定义本身，再由 `ready` 退回 `draft` 重新定义），或取消为 `cancelled`。
- `done` 在通常情况下视为终态；仅在事后发现严重回归且无法通过新任务修复时，才由 Orchestrator 或人工确认走 `done -> blocked` 重开，重开后按 `blocked -> ready` 续跑或重定义。一般性问题应优先新开任务处理，而不是 reopen 已完成任务。
- `cancelled` 为终态。进入 `failed` 或 `cancelled` 前必须按第 17 节要求记录失败或取消信息，并按第 3.2 节合并策略决定是否保留 worktree。
- 依赖级联（取**传递闭包**）：当 `TASK-A` 处于 `rejected` / `failed` / `blocked` 时，所有直接或间接 `depends_on` 到 `TASK-A` 的后继任务自动进入 `blocked`；后继任务只有在 `TASK-A` 到达 `done`、依赖被 Orchestrator 改写到替代任务，或人工取消该依赖后才能恢复。
- `no_review: true` 只表示任务不进入独立 Reviewer 审查，不表示跳过验证；该任务仍必须生成 `.result.md` 并记录自动验证或人工验收建议。

## 8. Context Pack 上下文包

每个 Task Executor 启动前必须获得一个上下文包。

上下文包不是固定塞入全部文档，而是由 Orchestrator 从以下候选来源中裁剪生成。实际注入内容以当前任务的 Context Pack 清单和任务文件“必读文件”为准。

```text
AGENTS.md
SPEC.md
ARCHITECTURE.md
PLAN.md
PROGRESS.md
DECISIONS.md
ISSUES.md
TESTING.md
TASKS/TASK-XXX-xxx.md
当前任务相关源码文件
```

每个 Context Pack 必须具备机器可读清单，**裁剪类文档以任务 frontmatter 的 `context_pack` 字段为唯一权威来源**；Orchestrator 在拆分任务时生成初始 `context_pack`，并在任务从 `ready` 转入 `running` 时依据已完成依赖任务的 `.result.md` 刷新 `source_files`（见下文裁剪规则）后回写 frontmatter；Task Executor 启动时只读取 frontmatter 的 `context_pack`，不接受其他来源的清单。必读核心文档（见下文裁剪规则）是硬性下限，与 `context_pack` 取**并集**生效，即 Task Executor 实际注入范围 = 必读核心 ∪ `required_docs` ∪ `optional_doc_excerpts` ∪ `source_files`；frontmatter 不得通过省略必读核心来缩小注入范围。`context_pack` 清单只声明**读取范围**，至少包含：

- `required_docs`：必须完整注入的文档。
- `optional_doc_excerpts`：按章节裁剪注入的文档片段。
- `source_files`：允许 Task Executor 阅读的源码文件。

任务唯一允许写入的结果文件由 `workflow_outputs.result_file`（见第 9 节模板）单独声明，不属于 `context_pack`——后者只管读、不管写。

上下文包的目标是让新的 agent 不依赖任何历史聊天记录，也能理解：

- 当前要做什么。
- 为什么要这样做。
- 属于哪一层。
- 能改哪里。
- 不能改哪里。
- 必须遵守哪些架构边界。
- 做完后要留下什么上下文。

上下文包裁剪规则：

- `AGENTS.md`、`ARCHITECTURE.md`、`PROGRESS.md`、当前任务文件为**必读核心**，任何任务都要带；当前任务文件是 Context Pack 的入口载体，本身不计入 `required_docs` 数组，但属于必读核心。
- `SPEC.md`、`PLAN.md`、`DECISIONS.md`、`ISSUES.md`、`TESTING.md` 为**按需引用**，由 Orchestrator 根据任务 `layer` 和 `allowed_paths` 选择与本任务相关的章节或全文注入，无关章节不注入，避免上下文污染。
- 源码文件由 Orchestrator 圈定，依据为 `allowed_paths`、`ARCHITECTURE.md` 模块边界，以及 `depends_on` 对应任务**已完成时**其 `.result.md` 的 `modified_files` / `created_files`。拆分阶段依赖尚未执行，先按依赖任务的 `allowed_paths` 预填 `source_files`；任务转入 `running` 前若依赖已完成，Orchestrator 用实际 `.result.md` 清单刷新该字段并回写 frontmatter，再启动 Executor；executor 不得自行扩展范围。

## 9. 任务文件模板

每个任务文件应使用以下模板。

```markdown
---
id: TASK-XXX
title: 任务名称
status: draft
layer: state
depends_on:
  - TASK-001
allowed_paths:
  - src/modules/example/state
forbidden_paths:
  - src/modules/example/ui
  - src/modules/example/api
permissions: []          # 需要授权的能力，取值见第 16 节，如 [delete_files, install_dependencies]
no_review: false         # true 表示允许 running -> done，跳过独立 Reviewer 审查
restart_on_retry: false  # true 表示 rejected/blocked 续跑时重置 worktree 重跑
verification:
  - npm run typecheck
  - npm test
context_pack:
  required_docs:
    - AGENTS.md
    - ARCHITECTURE.md
    - PROGRESS.md
  optional_doc_excerpts: []
  source_files: []
workflow_outputs:
  result_file: TASKS/TASK-XXX-xxx.result.md
---

# TASK-XXX 任务名称

## 1. 背景

说明该任务为什么存在，它来自 `PLAN.md` 中的哪个阶段。

## 2. 当前目标

说明本任务要完成什么。

## 3. 所属层级

`layer` 字段取以下枚举值（frontmatter 使用英文键）：

- `type` — 类型层
- `data` — 数据层
- `state` — 状态层
- `domain` — 业务逻辑层
- `ui` — UI 组件层
- `page` — 页面组合层
- `test` — 测试层

`layer` 用于 Context Pack 裁剪（见第 8 节）、Reviewer 分层审查（见第 15 节）和 SQLite 索引；它与 `PLAN.md` 的阶段（见第 6.4 节）是松散对应关系——一个 PLAN 阶段可能横跨多个 `layer`（如"类型系统和领域模型"阶段同时涉及 `type` 与 `domain`），一个 `layer` 也可能出现在多个阶段，不必一一对应。

## 4. 必读文件

- AGENTS.md
- ARCHITECTURE.md
- PROGRESS.md
- TASKS/TASK-XXX-xxx.md
- Orchestrator 在 `context_pack.optional_doc_excerpts` 中声明的 `SPEC.md` / `PLAN.md` / `DECISIONS.md` / `ISSUES.md` / `TESTING.md` 相关章节
- Orchestrator 在 `context_pack.source_files` 中明确列出的当前任务相关源码文件

## 5. 修改范围

说明允许修改的业务目录和源码文件。该范围不包含工作流全局文档；`.result.md` 由 `workflow_outputs.result_file` 单独声明。

## 6. 禁止修改范围

说明本任务不能修改的目录、文件或模块。

## 7. 不做什么

明确本任务不包含的内容，避免 agent 顺手实现后续任务。

## 8. 架构约束

说明本任务必须遵守的架构规则。

## 9. 数据流和状态流要求

说明本任务涉及的数据如何流动，状态由哪里拥有，哪里消费。

## 10. 预期新增或修改文件

列出预期文件清单。

## 11. 验收标准

说明完成后如何判断任务合格。

## 12. 风险提示

说明可能出现的风险、边界情况或容易误解的地方。

## 13. 结束时必须产出（Task Executor 负责）

- TASKS/TASK-XXX-xxx.result.md
- 在 `.result.md` 中写入 `PROGRESS.md` 更新建议
- 在 `.result.md` 中写入 `DECISIONS.md` 更新建议，如有新增架构决策
- 在 `.result.md` 中写入 `ISSUES.md` 更新建议，如有未解决问题

> 合并回主分支后，由 Orchestrator 统一回写 `PROGRESS.md`、`DECISIONS.md` 和 `ISSUES.md`，这是 Orchestrator 的后续动作，不属于 Task Executor 的产出。
```

## 10. 任务执行结果模板

每个任务完成、阻塞或失败后都必须生成对应的 `.result.md`。`.result.md` 的 YAML frontmatter 是机器解析事实来源，Markdown 正文是人工可读摘要；Zod Schema 和 SQLite 索引应优先读取 frontmatter。

```markdown
---
task_id: TASK-XXX
execution_status: completed # completed | blocked | failed
modified_files:
  - path/to/file-a.ts
created_files:
  - path/to/new-file.ts
deleted_files: []
execution_commits: []       # 由 Orchestrator 在合并前回填执行 commit 元信息（hash/message/author/time）
verification:
  - command: npm run typecheck
    result: passed           # passed | failed | skipped
    notes: ""
global_update_requests:
  progress: []
  decisions: []
  issues: []
next_action: review          # review | retry | needs-human | cancel
---

# TASK-XXX 执行结果

## 1. 执行结论

说明任务是否完成。

## 2. 完成内容

列出本次完成的主要内容。

## 3. 修改文件

- path/to/file-a.ts
- path/to/file-b.tsx

## 4. 新增文件

- path/to/new-file.ts

## 5. 删除文件

暂无。

## 6. 架构决策

说明本次新增或确认的架构决策。

## 7. 偏离计划

说明是否偏离原计划，以及原因。

## 8. 后续任务注意事项

说明后续任务必须知道的信息。

## 9. 未解决问题

说明遗留问题。

## 10. 验证结果

记录已执行的验证命令和结果。

## 11. 人工验收建议

说明人工应该重点检查什么。

## 12. 全局文档更新建议

列出建议由 Orchestrator 回写到 `PROGRESS.md`、`DECISIONS.md`、`ISSUES.md` 的内容；Task Executor 不直接修改这些全局文档。
```

`global_update_requests` 各子项的最小结构（Task Executor 提议时填写，`id` 留空由 Orchestrator 回写时统一分配）：

```yaml
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"      # 对应 PROGRESS.md 的章节
      mode: replace                      # replace（整段替换该 section）| append（拼接到该 section 末尾）
      content: "TASK-003 已完成状态层"
  decisions:
    - id: ""                             # 由 Orchestrator 分配，如 DEC-007
      title: "状态层改用 Zustand"
      status: accepted
      scope: state
      decision: "采用 Zustand 管理全局状态"
      rationale: "..."
      consequences: "..."
      created_from_task: TASK-003
  issues:
    - id: ""                             # 由 Orchestrator 分配，如 ISS-004
      title: "API 返回结构与 SPEC 不一致"
      status: open
      severity: high
      scope: api
      owner: ""
      recommended_action: "与后端对齐返回结构后再继续 TASK-005"
      created_from_task: TASK-003
```

`progress` 项必须为 `{ section, mode, content }`，`mode` 取 `replace`（整段替换目标 section）或 `append`（拼接到目标 section 末尾），合并规则见第 3.2 节 section 级合并；纯字符串片段按 `append` 处理。`decisions` / `issues` 项必须至少包含对应全局文档要求的机器字段（见 6.6 / 6.7），缺失必填字段时由 Orchestrator 在校验阶段驳回该次回写。

`execution_status` × `next_action` 到任务状态的映射由 Orchestrator 在读取 `.result.md` 后执行：

```text
completed + review        -> reviewing（no_review: true 且 Orchestrator 校验通过 -> done；校验不通过 -> blocked 或 failed，见下）
completed + needs-human   -> blocked
blocked   + needs-human   -> blocked
blocked   + retry         -> blocked（等待 Orchestrator/人工确认后 -> ready）
failed    + retry         -> failed（等待 Orchestrator/人工确认后 -> ready）
failed    + needs-human   -> failed
*         + cancel        -> cancelled（需 Orchestrator/人工确认）

非法组合（Zod Schema 校验阶段直接驳回，Task Executor 不得提交）：

- completed + retry（已完成无需重试）
- blocked   + review（被阻塞的不进入审查）
- failed    + review（失败的不进入审查）

`no_review: true` 校验不通过：`execution_status` 为 `completed` 但 Orchestrator 产物校验（`.result.md` 完整性、验证结果、全局更新建议）不通过时，按 `next_action` 走 `running -> blocked`（`needs-human`）或 `running -> failed`（无法修复），不得置 `done`。
```

`next_action` 是 Task Executor 的**建议**，最终状态流转由 Orchestrator 结合 Reviewer 结论（若有）和人工确认决定；Task Executor 不得自行修改任务 frontmatter 的 `status`。`retry` 不等于自动重跑——`failed` 任务的 `retry` 仍需人工确认后才能回到 `ready`（见第 7 节）。

## 11. 执行流程

完整流程分为 9 个阶段：

1. 需求访谈。
2. 生成 `SPEC.md`。
3. 生成 `ARCHITECTURE.md`。
4. Reviewer 独立审核规格与架构；**未通过则回到第 2/3 步由 Orchestrator 修订后重提**，Reviewer 驳回意见写入 `ISSUES.md`、修订记录写入 `DECISIONS.md`，直至通过才进入第 5 步。
5. 生成 `PLAN.md`。
6. 拆分 `TASKS/`，并为每个任务把 Context Pack 初始写入 frontmatter（`source_files` 按依赖 `allowed_paths` 预填，见第 8 节）。
7. 任务在依赖完成后转入 `running` 时，Orchestrator 先用已完成依赖的 `.result.md` 刷新该任务 `context_pack.source_files` 并回写 frontmatter，再启动独立上下文执行：Task Executor 完成后产出 `.result.md`，由 Orchestrator 将状态置为 `reviewing`（`no_review: true` 时跳过 Reviewer，由 Orchestrator 直接校验产物：通过置 `done`，不通过置 `blocked` 或 `failed`，见第 7 节）。
8. Reviewer 审查并产出 `.review.md`；Orchestrator 按第 15 节映射流转任务状态。
9. 验证、人工验收与合并回主分支（含全局文档回写，见第 3.2 节）。
10. 全部任务进入 `done` 后执行项目收尾：跑 `TESTING.md` 全量验证、把 `PROGRESS.md` 更新为终态快照（标注项目完成与当前可用能力全集）、归档或标记 `ISSUES.md` 遗留项，由 Orchestrator 或人工决定是否打 tag / 发版。

## 12. 编码前复述要求

Task Executor 在编码前必须复述：

- 当前任务目标。
- 当前任务属于哪一层。
- 准备新增或修改哪些模块。
- 明确不会修改哪些模块。
- 必须遵守的架构边界。
- 从 `PROGRESS.md` 继承到的上下文。
- 发现的风险或不确定点。
- 预计执行步骤。

如果发现当前任务与 `SPEC.md`、`ARCHITECTURE.md`、`PLAN.md` 或 `PROGRESS.md` 冲突，或发现需要越过 `forbidden_paths` 才能修复的架构问题，必须先指出冲突，并在 `.result.md` 中记录阻塞原因和全局文档更新建议；是否修改文档、扩权或重开任务由 Orchestrator 或用户确认，不应直接编码。

## 13. 执行规则

Task Executor 必须遵守：

- 通用编码约束（不引入临时 patch、不复制粘贴重复逻辑、不写巨型函数或组件、不制造隐式状态、不跨层调用、不主动格式化无关代码、简体中文注释规范等）以 `AGENTS.md` 为准，此处不重复。
- 只完成当前任务，不提前实现后续任务。
- 不破坏 `ARCHITECTURE.md` 中定义的模块边界。
- 发现架构不合理时：若修复在 `allowed_paths` 内，优先重构；若需要越过 `forbidden_paths`，**不得自行越界**，应在 `.result.md` 的 `global_update_requests.issues` 中写入更新建议并把 `next_action` 设为 `needs-human`，由 Orchestrator 将任务状态置为 `blocked` 并请求扩权，扩权后再继续。
- 不自动启动浏览器测试，除非用户明确要求。

## 14. 验证机制

每个任务都应包含自动验证和人工验收。

自动验证可以包括：

- 类型检查。
- 单元测试。
- 构建检查。
- 静态检查。

人工验收可以包括：

- 功能是否完成。
- UI 是否符合预期。
- 状态是否正确。
- 错误和空状态是否处理。
- 是否破坏架构边界。
- 是否引入重复逻辑。
- 是否增加不必要耦合。
- 是否降低 AI 可维护性。
- 是否需要补充测试。

浏览器测试默认由人工执行，agent 不应自动启动浏览器测试，除非用户明确要求。

## 15. Reviewer 审查清单

Reviewer 应检查：

- 当前任务目标是否完成。
- 是否修改了禁止修改范围。
- 是否提前实现后续任务。
- 是否违反分层设计。
- 是否存在跨层调用。
- 是否存在重复逻辑。
- 是否存在隐式状态。
- 是否存在巨型函数或巨型组件。
- 是否新增临时 patch。
- 是否在 `.result.md` 中提供必要的 `PROGRESS.md` 更新建议。
- 是否生成 `.result.md`。
- 是否在 `.result.md` 中记录必要架构决策更新建议。
- 是否在 `.result.md` 中记录未解决问题更新建议。
- 是否通过必要验证。

审查结果只能是：

```text
approved
rejected
needs-human-confirmation
```

审查结果到任务状态的映射必须固定：

- `approved` -> `done`
- `rejected` -> `rejected`
- `needs-human-confirmation` -> `blocked`

当任务声明 `no_review: true` 时，Reviewer 不介入，由 Orchestrator 生成 `review_result: skipped` 的 `.review.md`；此时 Orchestrator 仍必须检查 `.result.md`、验证结果和全局文档更新建议是否齐全，才能将任务置为 `done`；若检查不通过，则按第 7 节状态机走 `blocked` 或 `failed`，不得置为 `done`。

审查结论由 Reviewer 写入独立的 `TASKS/TASK-XXX-xxx.review.md`（不写入 `.result.md`），其模板如下：

```markdown
---
task_id: TASK-XXX
review_result: approved     # approved | rejected | needs-human-confirmation | skipped
reviewer: reviewer-agent
reviewed_at: 2026-07-07T00:00:00Z
required_changes: []        # rejected / needs-human-confirmation 时必须填写
findings: []                # 审查发现清单
---

# TASK-XXX 审查结论

## 1. 审查意见

## 2. 必须修改项（如有）

## 3. 建议修改项（如有）
```

## 16. 权限模型

自研 agent 系统应支持权限控制。

建议权限类型：

```text
read_files
write_files
run_commands
install_dependencies
modify_config
delete_files
start_dev_server
open_browser
network_access
```

默认策略：

- 允许读取项目文件。
- 允许修改当前任务 `allowed_paths` 范围内的文件。
- 允许写入当前任务 `workflow_outputs.result_file` 指定的 `.result.md`。
- 禁止修改 `forbidden_paths` 范围内的文件；`forbidden_paths` 与 `allowed_paths` 重叠时 **deny 优先**（`forbidden_paths` 生效），infrastructure 层在 Task Executor 启动前检测到两者重叠时告警并拒绝启动。
- 验证命令来源与优先级：项目级 `TESTING.md` 与任务级 frontmatter `verification` 共同构成**验证 allowlist**，取**并集**。`TESTING.md` 中每条自动验证命令可声明 `layers`（适用的 `layer` 枚举，见第 9 节；未声明表示对所有 layer 生效）；任务实际执行的项目级命令 = `layers` 未声明 ∪ `layers` 包含本任务 `layer`，再与任务级 `verification` 取并集，避免无关任务背上全量验证开销。同一命令在两处声明时以任务级为准。
- 验证 allowlist 内的命令执行时自动获得**仅限该具体命令行**的执行授权，无需在 `permissions` 中重复声明 `run_commands`；该命令对 `allowed_paths` 内文件的读写副作用同样自动允许。
- 验证命令若涉及 `allowed_paths` 之外的能力，仍需在 `permissions` 中显式声明对应能力：安装依赖 `install_dependencies`、联网 `network_access`、启动长期服务 `start_dev_server`、打开浏览器 `open_browser`、删除文件 `delete_files`、修改配置 `modify_config`。任务编写者应在 `verification` 旁注明每条命令所需的额外能力；若执行时检测到未声明的能力需求，命令因权限不足失败，Task Executor 应将 `execution_status` 标为 `blocked` 并在 `.result.md` 中说明，而不是自行扩权。
- `run_commands`（用于验证 allowlist 之外的任意命令）、`install_dependencies`、`modify_config`、`delete_files`、`start_dev_server`、`open_browser`、`network_access` 等能力默认禁用，必须在任务 frontmatter 的 `permissions` 字段中显式声明后才生效。
- 禁止自动启动浏览器测试，除非 `permissions` 含 `open_browser` 且用户明确要求。

`permissions` 字段在任务文件 frontmatter 中声明（见第 9 节模板），由 infrastructure 层在 Task Executor 启动前注入 agent 的权限边界。

## 17. 失败恢复机制

任务失败时必须将以下信息写入 `TASKS/TASK-XXX-xxx.result.md`（与正常完成的结果文件同路径，frontmatter 的 `execution_status` 标注为 `failed` 或 `blocked`），并在 `global_update_requests.issues` 中登记建议由 Orchestrator 回写到 `ISSUES.md` 的阻塞项：

- 失败发生在哪一步。
- 已完成哪些修改。
- 哪些文件被修改。
- 失败原因。
- 是否可以重试（对应 `restart_on_retry` 续跑/重置语义）。
- 是否需要人工确认。
- 是否需要回滚（按第 3.2 节 worktree 合并策略决定是否丢弃 worktree 分支）。
- 建议下一步处理方式，对应 `next_action`。

Task Executor 只记录失败事实和建议状态；任务状态由 Orchestrator 根据 `.result.md`、验证结果和人工确认置为 `failed`（无法自动重试）或 `blocked`（等待人工确认/前置任务）。失败任务不得直接标记为 `done`。

为避免人工确认点密集成为自动化瓶颈，系统应支持：批量确认（一次处理多个 `blocked` / `needs-human` 任务）、带超时的默认放行（超时未响应时按任务声明的默认 `next_action` 处理并记审计）、以及 `ISSUES.md` 阻塞项按 `severity` 与停留时长的升级提醒。具体策略由 `application` 层调度配置决定，本文档不强制。

## 18. 新上下文启动提示模板

```text
你现在是本项目的 Task Executor。

请严格读取并遵循当前任务 Context Pack 清单中的文件。以下文件为默认必读核心：

1. AGENTS.md
2. ARCHITECTURE.md
3. PROGRESS.md
4. TASKS/TASK-XXX-xxx.md

如 Context Pack 清单中包含 `SPEC.md`、`PLAN.md`、`DECISIONS.md`、`ISSUES.md`、`TESTING.md` 的相关章节或源码文件，也必须一并读取；未出现在清单中的文件不得自行扩展读取或修改。

执行规则：

- 本次上下文只执行 TASKS/TASK-XXX-xxx.md。
- 不执行后续任务。
- 不依赖历史聊天记录。
- 先复述你对当前任务的理解。
- 明确当前任务属于哪一层。
- 明确会修改哪些模块。
- 明确不会修改哪些模块。
- 明确必须遵守哪些架构边界。
- 如发现文档冲突、需求不清或架构问题，先指出问题，不要直接编码。
- 修改代码时遵守 AGENTS.md 中的全部约束（AGENTS.md 是编码约束唯一权威，此处不重复）。
- 完成、阻塞或失败后必须生成 TASKS/TASK-XXX-xxx.result.md；审查结论由 Reviewer / Orchestrator 写入 .review.md，不要写入 .result.md。
- 需要更新 PROGRESS.md、DECISIONS.md 或 ISSUES.md 时，只能在 .result.md 的 global_update_requests 中提出建议，由 Orchestrator 回写。
```

## 19. 成功标准

该工作流成功的标准是：

- 用户需求被完整规格化。
- 架构边界清晰。
- 数据流和状态流明确。
- 每个任务可以在独立上下文中执行。
- 每个任务不会依赖历史聊天上下文。
- 后续 agent 能通过文档恢复项目状态。
- 每个任务完成后都能留下可审查的执行结果。
- 架构决策可追踪。
- 未解决问题可追踪。
- 自动验证和人工验收都有依据。
- 代码结构长期可维护。
- 功能实现不会不断堆叠临时逻辑。

## 20. 核心结论

这套工作流的核心不是简单地把需求拆小，而是建立一套：

```text
规格文档
+ 架构约束
+ 任务上下文包
+ 执行结果
+ 进度摘要
+ 审查机制
```

每个任务都应该让 agent 清楚：

- 当前要做什么。
- 为什么这样做。
- 属于哪一层。
- 能改哪里。
- 不能改哪里。
- 不能破坏什么。
- 如何验证。
- 做完后要留下什么上下文。

最终目标是让 Coding Agent 的长任务执行从“依赖聊天记忆”转变为“依赖文档协议和可审查状态”，从而降低上下文丢失、架构漂移和长期维护成本。
