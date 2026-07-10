# SPEC — 多任务串行自动连续运行

## 0. 文档信息

- 状态：Draft
- 功能名称：Serial Task Orchestration
- CLI 命令：`caw orchestrate`
- 目标版本：下一主版本
- 兼容性：新功能按新系统设计，不兼容旧的运行记录和未完成 worktree
- 事实来源：任务 frontmatter、执行/审查产物与 Git 状态；SQLite 仍为可重建派生索引

## 1. 背景

当前系统已经能够完成单个任务的独立执行、独立审查、Git worktree 隔离、结果落盘、状态流转、rebase、fast-forward 和全局文档回写。

但是，用户仍需在每个任务结束后守在电脑前，手动完成以下操作：

1. 找出下一个可执行任务。
2. 将任务从 `draft` 调整为 `ready`。
3. 运行 `caw task:run TASK-XXX`。
4. 等待执行完成。
5. 运行 `caw task:review TASK-XXX`。
6. 等待审查和合并完成。
7. 对下一个任务重复以上操作。

长任务的主要时间消耗来自模型执行、验证和审查。人工重复触发下一任务既浪费时间，也使夜间或离席运行无法实现。

本功能需要在保留“每个任务都是独立上下文”的前提下，让多个任务按照依赖顺序自动、串行、连续执行，直到全部完成，或遇到真正需要人工决策的情况才暂停。

## 2. 产品目标

### 2.1 核心目标

用户在确认任务拆分后，只需执行一次命令：

```bash
caw orchestrate --tasks TASK-036..TASK-051 --approve-plan
```

系统随后必须自动完成：

```text
选择任务
→ 创建独立执行上下文
→ 执行
→ 验证
→ 创建独立审查上下文
→ 审查
→ 必要时返工
→ 合并
→ 回写工作流状态
→ 继续下一个任务
```

### 2.2 成功标准

满足以下条件即视为功能成功：

1. 对一组依赖关系合法的任务，用户只需启动一次命令，系统即可连续完成全部任务。
2. 任意时刻最多只有一个任务执行或审查，不产生任务级并行。
3. 每次任务执行、返工和审查均使用新的 Claude SDK 会话，不复用历史对话。
4. 前一任务完成并合并后，后一任务自动获得最新主分支、最新依赖产物和最新 Context Pack。
5. 正常路径不需要用户手动运行 `task:run` 或 `task:review`。
6. 遇到 `needs-human`、不可恢复错误、重试耗尽、验证失败或合并冲突时，系统保存现场并暂停。
7. 进程中断后可以恢复，不重复合并、不重复追加全局记录、不丢失已完成进度。
8. 整批任务结束后输出可审计的运行摘要、成本摘要和人工待办清单。

## 3. 范围

### 3.1 本期范围

- 对已经存在于 `docs/tasks/` 的任务进行串行自动执行。
- 任务依赖图校验与拓扑排序。
- 经一次显式授权后自动完成 `draft → ready`。
- 自动执行任务。
- 自动运行系统验证命令。
- 自动启动独立 Reviewer。
- 自动处理可重试的 `rejected` 和 `failed + retry`。
- 自动完成成功任务的 rebase、审计回填、fast-forward、全局文档回写与 worktree 清理。
- 自动暂停和恢复。
- 运行锁、运行记录、日志、成本统计和最终摘要。

### 3.2 不在本期范围

- 需求访谈与 AskUserQuestion 自动化。
- 根据需求自动生成 SPEC。
- 自动审核 SPEC。
- 根据 SPEC 自动生成 PLAN。
- 根据 PLAN 由 AI 自动拆分 TASK。
- 多任务并行执行。
- 自动解决 Git 合并冲突。
- 自动替用户做产品决策或架构取舍。
- 自动启动浏览器进行 UI 测试。
- 跨机器分布式调度。
- 常驻云端服务或 Web 管理后台。

## 4. 术语

- **运行（Run）**：一次 `caw orchestrate` 启动后形成的完整批次。
- **任务尝试（Attempt）**：某个任务的一次独立执行会话及其对应审查。
- **执行会话**：Claude SDK 为 Task Executor 创建的一次全新 query 会话。
- **审查会话**：Claude SDK 为 Reviewer 创建的一次全新 query 会话，与执行会话完全独立。
- **暂停（Paused）**：运行仍可恢复，但需要人工处理或确认。
- **恢复（Resume）**：根据任务文档、运行记录和 Git 状态继续未完成运行。
- **工作流状态提交**：专门提交任务 status、review、全局文档和运行审计信息的 Git commit。

## 5. 用户故事

### US-001 一次启动连续执行

作为用户，我希望在确认任务拆分后只运行一次命令，让系统连续执行所有任务，从而不必守在电脑前逐个触发。

### US-002 每个任务保持独立上下文

作为用户，我希望每个任务和每次审查都使用全新上下文，以避免长任务耗尽单一上下文窗口。

### US-003 自动审查与返工

作为用户，我希望任务完成后自动进入独立审查；若被驳回，系统在限制次数内自动启动新的返工上下文。

### US-004 需要人工时才暂停

作为用户，我希望系统只在需求不清、权限不足、验证失败、合并冲突或重试耗尽时通知我处理。

### US-005 中断后继续

作为用户，我希望电脑重启或进程异常退出后，可以从最近的可靠状态继续，而不必重跑已完成任务。

### US-006 可审计

作为用户，我希望知道每个任务执行了几次、花费多少、通过了哪些验证、为何暂停，以及哪些 commit 来自实际实现。

## 6. CLI 规格

### 6.1 新命令

```bash
caw orchestrate [options]
```

### 6.2 选项

| 选项 | 必填 | 默认值 | 语义 |
|---|---:|---|---|
| `--project-root <dir>` | 否 | 当前目录 | 项目根目录 |
| `--main-ref <ref>` | 否 | `main` | 目标主分支 |
| `--tasks <selector>` | 首次运行条件必填 | 无 | 显式任务范围；支持逗号分隔 ID 与闭区间，例如 `TASK-036..TASK-051` |
| `--all-pending` | 首次运行条件必填 | false | 显式选择全部非终态任务；与 `--tasks` 互斥 |
| `--approve-plan` | 条件必填 | false | 一次性授权本次运行自动将选中的 `draft` 任务转为 `ready` |
| `--provider <name>` | 否 | 配置中的默认 provider | 执行和审查使用的 provider profile |
| `--model <name>` | 否 | provider 默认映射 | 覆盖执行模型；Reviewer 默认使用同一模型，后续可独立配置 |
| `--max-task-retries <n>` | 否 | `2` | 每个任务除首次外允许的最大自动重试次数 |
| `--max-cost-usd <amount>` | 否 | 不限制 | 运行级成本上限；达到后在任务边界暂停 |
| `--resume [runId]` | 否 | 无 | 恢复指定运行；省略 runId 时恢复唯一的未完成运行 |
| `--preview` | 否 | false | 仅输出计划顺序、依赖和预计动作，不改状态、不创建 worktree、不调用模型 |

### 6.3 禁止的隐式降级

无人值守命令必须使用真实 SDK Executor 和真实 SDK Reviewer：

- 不提供 `--executor dry-run`。
- 不允许自动回退 `DryRunLocalExecutor`。
- 不允许自动回退 `LocalReviewer`。
- provider 配置或 token 缺失时必须在启动前失败。
- `no_review: true` 是任务级显式声明，不等价于 Reviewer 装配失败后的降级。

### 6.4 示例

预览：

```bash
caw orchestrate --tasks TASK-036..TASK-051 --preview
```

首次启动：

```bash
caw orchestrate \
  --tasks TASK-036..TASK-051 \
  --approve-plan \
  --provider anthropic \
  --max-task-retries 2 \
  --max-cost-usd 50
```

恢复：

```bash
caw orchestrate --resume RUN-20260710-001
```

## 7. 启动前校验

`caw orchestrate` 在任何状态变更、worktree 创建或模型调用之前，必须完成全部预检。

### FR-001 项目结构校验

- 项目根必须存在。
- `docs/tasks/` 必须存在。
- provider 配置必须可读且通过 Schema。
- 对应 token 环境变量必须存在。
- Git 仓库和目标主分支必须存在。
- 主工作区必须处于可安全编排的状态。

若主工作区存在与工作流无关的未提交改动，必须拒绝启动并列出文件，不能自动覆盖、stash 或丢弃用户改动。

### FR-002 任务文档校验

必须读取并校验本次范围内所有任务：

- id 唯一且格式合法。
- frontmatter 通过 Task Schema。
- 所有 `depends_on` 指向存在的任务。
- 不存在自依赖或依赖环。
- result/review 路径与任务 id、slug 一致。
- `allowed_paths` 与 `forbidden_paths` 不重叠。
- 验证命令声明合法。

任何失败都必须在调用模型前终止。

### FR-003 运行范围快照

首次启动必须显式传入 `--tasks` 或 `--all-pending`，不得默认选择仓库内全部非终态任务。完成范围解析后，必须对任务范围和顺序建立快照：

- `--tasks` 中的 ID/区间必须展开、去重并逐一验证存在性。
- `--tasks` 与 `--all-pending` 互斥；二者都缺失时拒绝启动。
- `done` 和 `cancelled` 不进入待执行序列。
- 其余任务按依赖拓扑排序。
- 同一拓扑层按任务 id 数值升序确定顺序。
- 运行开始后新增的任务不得自动加入当前运行，避免隐式扩大范围。
- 新增任务由下一次运行处理。
- 选中任务依赖范围外任务时，范围外依赖必须已经 `done`；否则启动前拒绝并列出依赖。
- `--resume` 必须复用 Run Journal 中的范围快照，不接受新的 `--tasks` 或 `--all-pending`。

### FR-004 计划批准

- 已处于 `ready` 的任务可在不带 `--approve-plan` 时执行。
- 自动推进 `draft → ready` 必须由本次运行显式携带 `--approve-plan` 授权。
- 授权必须写入运行记录，恢复时不得重复询问。
- 自动推进发生在任务即将执行且全部依赖已 `done` 时，不提前批量修改所有 draft。

## 8. 串行调度规则

### FR-005 串行不变量

任意时刻必须满足：

- 最多一个 Task Executor 会话处于运行状态。
- 最多一个 Reviewer 会话处于运行状态。
- Executor 与 Reviewer 不得并发。
- 不得在当前任务完成状态提交前启动下一个任务。
- 当前任务合并和全局回写完成前，后继任务不可执行。

### FR-006 下一个任务选择

系统每轮必须重新读取权威状态，并选择拓扑序中第一个满足以下条件的任务：

1. 位于运行范围快照中。
2. 当前状态为 `ready`，或已由 `--approve-plan` 授权、可从 `draft` 转为 `ready`。
3. 所有依赖均为 `done`。
4. 当前没有未解决的运行级暂停原因。
5. 未超过该任务重试上限。

不得仅依赖 SQLite 判断任务状态。

### FR-007 无可运行任务

如果仍有未终结任务但不存在可运行任务，系统必须：

- 计算并输出每个任务不能运行的具体原因。
- 将运行置为 `paused`。
- 不进行轮询空转。
- 给出明确恢复命令。

## 9. 单任务自动流水线

### FR-008 执行准备

选中任务后，系统必须：

1. 重新读取任务和依赖结果。
2. 用依赖任务实际 `modified_files + created_files` 刷新 source files。
3. 重新计算 Context Pack。
4. 校验验证命令需要的权限。
5. 将任务合法地转为 `running`。
6. 创建或恢复该任务的 worktree。
7. 确保 worktree 基线包含最新 main 的所有已完成任务。

### FR-009 独立执行上下文

每次 Attempt 必须创建全新 SDK query：

- 不传 `resume`、`continue` 或历史 session id。
- 不共享前一次任务的聊天消息。
- 不共享前一次 Attempt 的聊天消息。
- 仅通过任务文件、Context Pack、最新 result/review、Git diff 和全局状态传递事实。
- SDK 工作目录必须是当前任务 worktree。

### FR-010 执行产物

执行结束必须生成合法 `.result.md`，并额外满足：

- `task_id` 必须与当前任务完全相同。
- `execution_status × next_action` 组合合法。
- 文件清单中的路径必须属于当前 worktree。
- 声明的文件改动必须与 Git 状态核对。
- `execution_commits` 在合并前保持为空。
- result 必须包含 `run_id` 和 `attempt`，用于恢复和审计。

模型未生成 result、result 非法或 task id 不一致时，不得继续审查或合并。

## 10. 验证规则

### FR-011 系统执行验证

验证不能只依赖模型自报。Executor 完成后，Orchestrator 必须在 worktree 内独立执行最终 allowlist：

1. 由项目级验证声明按 layer 裁剪。
2. 与任务级 verification 合并去重。
3. 校验每条命令的 `requires_permissions` 被任务权限覆盖。
4. 按确定顺序逐条执行并记录真实退出码、stdout/stderr 摘要和耗时。
5. 将系统验证结果写回 result，覆盖同名的模型自报结果。

### FR-012 验证失败

- 任一必需验证命令失败时，不得合并。
- 普通任务仍可进入 Reviewer，由 Reviewer判断是 `rejected` 还是 `needs-human-confirmation`。
- `no_review` 任务必须全部必需验证通过才能进入 `done`。
- `skipped` 只有在命令声明明确不适用于当前任务时才合法；不能用 `skipped` 规避失败。
- 需要浏览器或其他未授权人工能力的验证必须暂停为 `needs-human`，不得自动启动浏览器。

## 11. 自动审查

### FR-013 Reviewer 启动条件

当任务执行结果映射为 `reviewing` 时，Orchestrator 必须立即启动独立 SDK Reviewer，无需用户再次执行命令。

Reviewer 必须：

- 使用全新 SDK 会话。
- 读取任务文件、当前 result、实际 Git diff、验证结果和允许/禁止范围。
- 不共享 Executor 对话历史。
- 输出合法 `.review.md`。
- 不允许由本地固定结果替代真实审查。

### FR-014 审查映射

| 审查结论 | 自动动作 |
|---|---|
| `approved` | 进入合并和完成流水线 |
| `rejected` | 记录 required changes，进入自动返工判断 |
| `needs-human-confirmation` | 保存现场并暂停 |
| `skipped` | 仅允许任务显式 `no_review: true`，且由 Orchestrator 生成 |

### FR-015 审查降级

Reviewer 的鉴权错误、网络重试耗尽、JSON 解析失败、SDK 错误或中断必须映射为 `needs-human-confirmation`，不得自动批准。

## 12. 自动重试与返工

### FR-016 Attempt 计数

- 每个任务首次执行为 Attempt 1。
- 每次新的 Executor 会话使 Attempt 加一。
- Reviewer 重试 JSON 输出不增加任务 Attempt。
- Attempt 和累计成本必须写入运行记录。
- `--max-task-retries 2` 表示最多执行 3 次：首次 1 次 + 重试 2 次。

### FR-017 可自动重试场景

以下场景可以在预算内自动重试：

- Review 结果为 `rejected`。
- result 为 `failed + retry`。
- 明确分类为暂时性网络故障且 SDK 内部重试已耗尽，但任务级策略仍允许再尝试。

以下场景不得自动重试：

- `next_action = needs-human`。
- 权限不足或路径范围冲突。
- 任务定义、依赖图或 Schema 非法。
- 合并冲突。
- Reviewer 要求人类产品或架构决策。
- 成本上限已达到。

### FR-018 返工上下文

审查被拒绝后的新 Attempt 必须注入：

- 原任务文件。
- 最新 result。
- 最新 review。
- Reviewer 的 `required_changes` 和 findings。
- 当前 worktree 的 Git diff。
- 依赖任务最终产物。

不得通过复用旧聊天上下文完成返工。

### FR-019 worktree 重试策略

- `restart_on_retry: false`：保留 worktree 已有改动，在同一 worktree 中创建新执行会话继续修正。
- `restart_on_retry: true`：在归档 Attempt 摘要后，将 worktree 重置到最新可执行基线，再创建新执行会话。
- 任一策略都必须保留运行记录，不得让 Attempt 历史不可追踪。

重试耗尽后，任务进入 `blocked`，运行进入 `paused`，原因必须包含最后一次 result、review 和验证摘要。

## 13. 合并与完成

### FR-020 合并前置条件

任务只有同时满足以下条件才可合并：

- 状态映射目标为 `done`。
- 普通任务 Reviewer 为 `approved`。
- `no_review` 任务通过 Orchestrator 全部验证。
- result 和 review Schema 合法且 task id 一致。
- 实际改动未越过 allowed paths，未命中 forbidden paths。
- 所有依赖仍为 `done`。

### FR-021 实现合并

合并必须按以下顺序执行：

1. worktree 分支 rebase 到最新 main。
2. 检测冲突。
3. 采集 post-rebase 的实现 commit。
4. 回填 result 的 `execution_commits`。
5. 创建独立 audit commit。
6. fast-forward main，不产生 merge commit。

冲突时必须 abort/clean rebase、保留 worktree、将任务置为 `blocked` 并暂停运行。

### FR-022 工作流状态提交

实现分支 fast-forward 后，系统必须在 main 上创建独立 workflow-state commit，至少包含：

- 任务 frontmatter 最终状态。
- `.review.md`。
- 分配完成 ID 的 `.result.md`。
- PROGRESS、DECISIONS、ISSUES 更新。
- 当前运行记录更新。

不得只修改主工作区而不提交这些工作流事实。完成后主工作区必须干净。

### FR-023 worktree 清理

- 成功完成并提交全部状态后，自动删除任务 worktree 和已合并分支。
- `rejected`、`blocked`、`failed`、中断和合并冲突必须保留 worktree。
- 清理必须幂等，重复调用不能失败。

## 14. 全局文档回写

### FR-024 串行回写

全局文档只能由 Orchestrator 在 main 上串行回写，不允许 Task Executor 直接修改。

### FR-025 ID 分配与回填

- proposed decision/issue 的空 ID 由单一分配器生成。
- 分配结果必须同时写入全局文档和当前 result。
- 决策、问题和 progress 更新必须携带稳定 `request_id`。
- `request_id` 由 `run_id + task_id + attempt + 类型 + 数组序号` 确定性生成。

### FR-026 幂等回写

重复恢复或重复调用回写时：

- 相同 `request_id` 的 progress append 不得重复追加。
- 相同 decision/issue ID 不得重复创建。
- 已应用请求必须返回 `already-applied`，不能再次修改正文。
- 同 section 多个 replace 的冲突必须转为 `needs-human` 或显式 issue，不能被 CLI 忽略。

## 15. 运行记录与状态

### 15.1 运行状态

运行状态为：

- `created`
- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

### FR-027 运行记录

每次运行必须创建显式记录：

```text
.caw/runs/<run-id>.json
```

至少包含：

```yaml
run_id: RUN-20260710-001
status: running
mode: serial
main_ref: main
approved_plan: true
task_order: [TASK-001, TASK-002]
current_task: TASK-001
started_at: ISO8601
updated_at: ISO8601
max_task_retries: 2
max_cost_usd: 50
total_cost_usd: 0
attempts:
  TASK-001:
    count: 1
    last_execution_status: completed
    last_review_result: approved
pause_reason: null
```

运行记录是显式检查点和审计摘要，但不取代任务 frontmatter 与 Git 的权威状态。记录丢失时，系统应能根据任务文档和 Git 重建主要进度。

### FR-028 原子写入

运行记录必须使用“写临时文件 → fsync/close → 原子 rename”更新，避免进程崩溃留下半个 JSON。

### FR-029 运行锁

同一项目同一时间只允许一个 Orchestrator：

- 使用原子创建的 `.caw/orchestrator.lock`。
- 锁包含 PID、run id、启动时间和项目路径。
- 活跃锁存在时拒绝启动第二个运行。
- 发现失效锁时必须先做恢复审计，再由 `--resume` 接管。
- 不得静默删除无法确认是否失效的锁。

## 16. 中断与恢复

### FR-030 SIGINT

收到第一次 SIGINT 时必须：

1. 调用当前 SDK 会话的 AbortController。
2. 停止选择新任务。
3. 保留 worktree。
4. 把运行置为 `paused`。
5. 写入中断原因和恢复命令。
6. 移除进程监听并退出。

不得 reset、删除 worktree 或自动回滚模型已经产生的文件。

### FR-031 恢复判定

`--resume` 必须在采取动作前，综合检查：

- task frontmatter status。
- result/review 是否存在且合法。
- worktree 和任务分支是否存在。
- Git 是否处于 rebase 中间态。
- 分支是否已经进入 main。
- audit commit 是否存在。
- 全局更新 request id 是否已应用。
- workflow-state commit 是否存在。

### FR-032 恢复动作

| 观测状态 | 恢复动作 |
|---|---|
| `running` 且无合法 result | 保留/重置 worktree 后开启新 Attempt |
| `running` 且有合法 result | 从结果映射和系统验证继续 |
| `reviewing` 且无 review | 启动新的 Reviewer 会话 |
| `reviewing` 且有合法 review | 应用 review 映射 |
| 分支未进 main且存在 rebase 中间态 | abort/clean 后重新 rebase |
| 分支已进 main但未回写全局文档 | 跳过合并，仅补幂等回写 |
| 全局文档已回写但未提交状态 | 创建 workflow-state commit |
| 状态提交完成但 worktree 未清理 | 仅补清理 |

恢复过程不得依赖人工猜测“上次执行到哪一步”。

### FR-033 恢复幂等性

对同一个恢复命令连续执行两次，第二次必须成为无副作用操作：

- 不重复模型执行，除非第一次没有产出可信 result。
- 不重复 Reviewer，除非第一次没有产出可信 review。
- 不重复合并。
- 不重复 audit commit。
- 不重复全局 append。
- 不重复状态提交。
- 不因 worktree 已删除而失败。

## 17. 暂停与人工介入

### FR-034 暂停条件

以下任一条件必须暂停当前运行：

- result 或 review 建议 `needs-human`。
- 任务定义或依赖图在运行期间发生不兼容变化。
- 权限不足。
- 必需验证失败且 Reviewer 无法给出可自动返工方案。
- Reviewer 返回 `needs-human-confirmation`。
- 自动重试耗尽。
- Git 合并冲突。
- 全局文档 replace 冲突。
- provider 鉴权失败。
- 成本达到上限。
- 恢复时发现无法唯一判定的状态。

### FR-035 暂停输出

暂停时必须输出并记录：

- run id。
- 当前任务和 Attempt。
- 已完成任务数/总任务数。
- 暂停类别。
- 直接证据和相关文件路径。
- worktree 路径。
- 推荐人工动作。
- 明确恢复命令。

不得只输出“执行失败”之类无法行动的泛化信息。

## 18. 可观测性与成本

### FR-036 实时输出

终端必须显示：

- 当前运行和任务进度。
- 当前阶段：准备、执行、验证、审查、返工、合并、回写、清理。
- SDK 工具调用摘要。
- 每个验证命令结果。
- 每次会话成本和累计成本。

### FR-037 日志

每个 Run、Task、Attempt、角色必须可区分：

```text
.caw/logs/<run-id>/<task-id>/attempt-<n>-executor.log
.caw/logs/<run-id>/<task-id>/attempt-<n>-reviewer.log
```

日志不得记录 provider token 或其他敏感环境变量。

### FR-038 最终摘要

运行完成时必须输出：

- run id 和总耗时。
- 完成、取消、跳过的任务数。
- 每个任务 Attempt 数。
- 每个任务 execution commits。
- 验证通过情况。
- 执行与审查成本、累计 token。
- 新增决策和问题 ID。
- 未解决问题。
- 是否仍有未纳入本次范围的新任务。

## 19. 安全与权限

### FR-039 权限执行

- 路径重叠必须在模型启动前拒绝。
- verification command 的权限必须由系统校验。
- 任务的路径限制不能只作为提示词；执行后必须用 Git diff 再校验一次。
- 发现越界改动必须暂停，不能自动删除或静默忽略。
- 自动化不得扩展任务 permissions。
- 需要安装依赖、联网、删除文件等能力时必须已有显式声明。

### FR-040 人工决策边界

Orchestrator 不得自动决定：

- 新的产品需求。
- 架构方向变更。
- 扩大 allowed paths。
- 增加高风险权限。
- 接受未通过的验证。
- 自动解决内容语义冲突。

这些情况必须形成结构化 issue 并暂停。

## 20. 架构要求

### 20.1 分层

实现必须保持依赖方向：

```text
cli → application → core ← infrastructure
```

### 20.2 模块边界

不得把完整循环直接写入 CLI command。建议新增：

```text
src/application/orchestration/
  serial-task-orchestrator.ts
  task-selector.ts
  run-policy.ts
  recovery-reconciler.ts
  workflow-finalizer.ts

src/application/execution/
  execute-task.ts
  verify-task.ts
  review-task.ts

src/infrastructure/run/
  run-journal-repo.ts
  orchestration-lock.ts
```

### 20.3 Ports

application 层必须通过窄接口依赖外部能力，至少新增或重构：

- `TaskExecutorPort`
- `TaskReviewerPort`
- `RunJournalPort`
- `OrchestrationLockPort`
- `VerificationRunnerPort`

当前位于 infrastructure/CLI 的 Executor、Reviewer 契约应移动到 application ports；Claude SDK 和本地进程只提供实现。

### 20.4 复用与重构

在实现 Orchestrator 前，必须先抽取 `task:run` 和 `task:review` 中重复的：

- 合并包装。
- 合并冲突登记。
- 主工作区同步。
- 全局文档回写。
- provider/observability 组装。

不得复制现有命令逻辑形成第三套实现。

### 20.5 状态归属

- 任务状态：任务 frontmatter。
- 实现合并状态：Git。
- 当前 result/review：对应文档。
- 运行检查点：Run Journal。
- 查询索引：SQLite，可重建，不参与状态判定。
- SDK session：临时外部状态，不得作为恢复的唯一依据。

## 21. 错误与退出码

| 退出码 | 含义 |
|---:|---|
| `0` | 本次范围全部完成，或 preview 成功 |
| `1` | 启动前配置/Schema/环境错误，运行未开始 |
| `2` | 运行已暂停，需要人工处理，可恢复 |
| `3` | 运行发生内部不可恢复错误 |
| `130` | 用户 SIGINT，中断现场已保存，可恢复 |

命令业务错误必须走统一 stderr 格式；暂停不是“成功完成”，不得返回 0。

## 22. 非功能需求

### NFR-001 可恢复性

所有跨文件、Git 和外部会话的步骤都必须有明确检查点和重放策略。

### NFR-002 确定性

相同任务集合和状态下，任务选择顺序必须确定，不依赖文件系统遍历顺序。

### NFR-003 可测试性

任务执行器、Reviewer、Git、验证进程、时间、ID、锁、Run Journal 和 sleep 必须可注入 fake。

### NFR-004 可维护性

Orchestrator 只负责状态驱动，不直接实现 Git、文件系统、SDK、验证解析或文档合并细节。

### NFR-005 性能

串行模式不追求并行吞吐；应避免每轮重复安装依赖和无必要的全仓库扫描。

### NFR-006 敏感信息

token 不得进入配置明文、日志、result、review、Run Journal 或 Git commit。

## 23. 验收标准

### AC-001 三任务无依赖串行执行

给定三个 `draft` 任务，执行一次 `caw orchestrate --tasks TASK-001,TASK-002,TASK-003 --approve-plan` 后：

- 三个任务依次执行，不并发。
- 每个任务自动审查。
- 三个任务最终均为 `done`。
- main 历史包含每个任务的实现 commit、audit commit 和工作流状态提交。
- 无需人工运行 `task:run` 或 `task:review`。

### AC-002 依赖顺序

给定 `TASK-003 depends_on TASK-001,TASK-002`，即使文件顺序相反，也必须先完成 001、002，再执行 003。

### AC-003 独立上下文

三个任务及其 Reviewer 必须产生六个不同 SDK session；任一 session 不使用 resume/continue。

### AC-004 自动返工

Reviewer 第一次返回 rejected、第二次 approved 时：

- 自动创建 Attempt 2。
- Attempt 2 获得上一 review 的 required changes。
- 用户无需介入。
- 最终只合并通过审查的实现。

### AC-005 重试耗尽

Reviewer 连续 rejected 超过上限时：

- 任务为 `blocked`。
- 运行状态为 `paused`。
- worktree 保留。
- 输出最后 review 和恢复指令。

### AC-006 needs-human

Executor 或 Reviewer 返回 needs-human 时，必须立即暂停，不启动后继任务。

### AC-007 合并冲突

rebase 冲突时：

- main 不被破坏。
- rebase 中间态被清理。
- worktree 保留。
- 任务 blocked。
- 冲突文件进入 issue 和暂停摘要。

### AC-008 崩溃恢复

分别在以下位置模拟崩溃并执行 `--resume`：

- result 写入后。
- review 写入后。
- rebase 后。
- fast-forward 后。
- 全局文档回写后。
- workflow-state commit 后。

恢复后必须最终完成，且没有重复 commit、重复 decision/issue 或重复 progress append。

### AC-009 禁止本地审查降级

删除 provider token 后启动 orchestrate，必须在模型调用前退出且无任务状态变化；不得产生 approved review。

### AC-010 系统验证

模型自报验证通过、但真实命令退出码非 0 时，系统必须以真实结果为准并禁止合并。

### AC-011 路径越界

模型修改 forbidden path 时，即使审查模型返回 approved，也必须暂停且禁止合并。

### AC-012 运行锁

第一个 Orchestrator 正在运行时，第二个实例必须拒绝启动，不能同时修改状态。

### AC-013 成本上限

累计成本达到上限后，当前已完成任务保持完成，系统在下一个任务启动前暂停。

### AC-014 完成后工作区一致

运行全部完成后：

- 主工作区干净。
- 不存在已完成任务的残留 worktree。
- 任务文档状态与 Git 历史一致。
- SQLite 可从文档重建出相同最终状态。

## 24. 测试要求

### 24.1 Core

- 状态迁移矩阵。
- Attempt 和重试策略。
- task selector 的拓扑与确定性。
- 成本上限判断。
- 暂停原因映射。

### 24.2 Application

- 完整串行 happy path。
- rejected 自动返工。
- failed+retry。
- needs-human 暂停。
- 无可运行任务诊断。
- Run Journal 检查点。
- 各崩溃点恢复。
- 幂等重放。

### 24.3 Infrastructure

- 原子 Run Journal 写入。
- 运行锁与失效锁。
- 验证命令真实退出码采集。
- Git workflow-state commit。
- request_id 幂等回写。
- worktree 清理幂等。

### 24.4 CLI

- preview 无副作用。
- tasks/all-pending 显式范围与互斥校验。
- approve-plan 授权。
- resume。
- 退出码。
- provider/token 启动前失败。
- SIGINT。
- 最终摘要。

### 24.5 真实 API 契约

有密钥时，使用最小固定任务验证：

- Executor 和 Reviewer 均建立独立真实会话。
- result/review 通过 Schema。
- 不断言模型具体自然语言文本。
- 记录实际模型名和成本。

无密钥时必须显式 skip，不能把 fake 测试描述为真实 API 通过。

## 25. 实施顺序

本功能拆分为以下 16 个任务。每个任务只完成一个清晰目标，并按依赖顺序交付：

| Task | 目标 | 交付里程碑 |
|---|---|---|
| TASK-036 | 将 Executor/Reviewer 契约收敛到 Application Ports | 正确依赖方向 |
| TASK-037 | 从 task-run 抽取单任务执行用例 | 可复用 ExecuteTask |
| TASK-038 | 抽取单任务审查与共享完成用例 | 可复用 Review/Finalize |
| TASK-039 | 定义系统验证记录、Port 与 Application 用例 | 系统验证领域契约 |
| TASK-040 | 实现真实验证 Runner 与路径越界审计 | 真实验证门禁 |
| TASK-041 | 定义 Run Journal Schema 与运行状态 Ports | 显式运行状态 |
| TASK-042 | 实现原子 Run Journal 仓储和运行锁 | 持久检查点与单实例 |
| TASK-043 | 实现 Task Selector 与 Run Policy | 确定性选择和策略 |
| TASK-044 | 实现 SerialTaskOrchestrator happy path | 多任务连续运行 MVP |
| TASK-045 | 接入自动返工、Attempt 和 worktree 重试 | 有界自动修正 |
| TASK-046 | 实现 workflow-state commit 与成功清理 | Git/文档状态闭环 |
| TASK-047 | 实现 request-id 幂等回写与 Result ID 回填 | 可安全重放回写 |
| TASK-048 | 实现 RecoveryReconciler 与幂等恢复 | 崩溃后继续 |
| TASK-049 | 实现 `caw orchestrate` CLI 与严格 SDK 装配 | 用户可用入口 |
| TASK-050 | 接入可观测性、成本门禁、SIGINT 和摘要 | 长时运行安全绳 |
| TASK-051 | 完成端到端、崩溃注入和真实 API 验收 | 完整规格交付 |

依赖链为：

```text
TASK-036 → TASK-037 → TASK-038 → TASK-039
         → TASK-040 → TASK-041 → TASK-042 → TASK-043
         → TASK-044 → TASK-045 → TASK-046 → TASK-047
         → TASK-048 → TASK-049 → TASK-050 → TASK-051
```

TASK-044 完成后形成 application 层可连续运行的 happy-path MVP；TASK-049 完成后形成可由用户启动的 CLI MVP；TASK-051 完成后才达到本规格要求的可靠无人值守版本。

## 26. 最终产品行为

用户完成任务拆分并确认计划后，运行：

```bash
caw orchestrate --tasks TASK-036..TASK-051 --approve-plan
```

在正常情况下，系统必须持续运行直至所有范围内任务完成。用户不需要守在电脑前，不需要逐个创建新上下文，也不需要手动衔接执行、审查和合并。

系统只有在遇到无法安全自动决定的事项时才暂停，并且必须保存完整现场、说明具体原因、给出明确的人工处理建议和恢复命令。
