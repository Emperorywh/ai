---
spec_id: SPEC_orchestrator-hard-gates-and-recovery
title: 统一串行 Orchestrator、客观事实门禁与可恢复任务生命周期
status: active
created: 2026-07-13
owner: Orchestrator
supersedes: SPEC_claude-sdk-integration
---

# SPEC — 统一串行 Orchestrator、客观事实门禁与可恢复任务生命周期

> 本规格是下一阶段功能迭代的权威需求。它建立在现有 Claude Agent SDK、任务状态机、
> worktree、路径审计、系统验证、Reviewer、rebase/fast-forward 和全局文档回写能力之上，
> 目标是把这些已经存在但分散或未默认接线的能力收敛为一个安全、可恢复、可自动运行的
> 串行 Orchestrator。
>
> 这是新系统的破坏式升级：不兼容旧命令行为，不保留 legacy、fallback、deprecated 或
> 双轨编排逻辑。实现完成后只能存在一条任务生命周期主链。

---

## 0. 决策摘要

本规格确立以下不可被实现细节绕过的架构决策：

1. **模型负责语义，系统负责客观事实。** 模型可以提出执行结论、摘要、决策和问题建议；
   Git 变更、命令退出码、耗时、日志、路径越界和 commit 必须由系统采集。
2. **先取得证据，再改变状态。** Executor 返回不等于任务完成；必须经过路径审计和系统验证门禁。
3. **所有门禁失败均 fail closed。** 任何证据缺失、验证失败、路径越界、Reviewer 不可用或
   合并冲突都不得进入合并。
4. **Reviewer 不能覆盖客观门禁。** Reviewer 只审查目标完成度、代码质量和架构一致性；
   不能把系统验证失败或路径越界改判为通过。
5. **单一 Orchestrator 拥有生命周期。** CLI 只解析参数和装配 Port，不再分别持有执行、审查、
   完成或恢复流程。
6. **恢复必须幂等。** 任一步骤崩溃后可根据任务文档、结果文档、审查文档和 Git 状态恢复，
   不重复合并、不重复追加全局更新、不伪造已完成步骤。
7. **依赖阻塞是派生可执行性，不污染任务自身状态。** 上游失败会使后继不可运行，但不盲目
   把所有后继 frontmatter 改成 `blocked`；上游恢复后可执行性自动重新计算。
8. **不以 SQLite 作为判定依据。** SQLite 仍是可重建索引，Orchestrator 不依赖它决定状态和恢复。

---

## 1. 当前代码基线

当前系统已经具备以下可复用能力：

- Claude Agent SDK 自主 Executor 和独立 Reviewer。
- Provider Profile、Anthropic/GLM 环境组装、流式日志、cost/usage 和 SIGINT 中断。
- 任务、结果、审查、决策和问题 Schema。
- 任务状态机、执行结果映射、依赖图和拓扑排序。
- 单任务 Execute、Verify、Review、Finalize application 用例。
- Git worktree 创建、重置、删除、rebase、fast-forward、commit 采集和冲突探测。
- Git 实际变更文件枚举与路径越界审计。
- 真实子进程 Verification Runner。
- 全局文档 section 回写、决策/问题 id 分配。
- 合并崩溃恢复原语。

当前缺口：

- CLI 默认没有注入路径审计与真实系统验证。
- 普通任务系统验证失败后仍可能进入 Reviewer。
- Reviewer 自动降级到固定 `approved` 的 LocalReviewer。
- 缺少完整的串行多任务 Orchestrator。
- 缺少 `draft → ready`、重试、取消和恢复的完整 CLI 操作。
- `restart_on_retry`、worktree reset/remove 尚未进入主链。
- 依赖失败后的不可执行性没有进入统一调度。
- progress 冲突返回值未被 Finalize 消费，append 恢复可能重复。
- 当前执行、审查和完成入口存在多条可组合路径，无法保证所有调用方都经过同一门禁。

---

## 2. 目标

### 2.1 P0 必须完成

1. 新增统一串行 Orchestrator，支持指定单任务和自动选择全部可运行任务。
2. 把路径审计与系统验证改为强制门禁，不允许调用方省略。
3. 普通任务和 `no_review` 任务使用同一客观门禁。
4. Reviewer 不可用时 fail closed，不再自动批准。
5. 明确模型报告与系统证据的数据所有权和 Schema。
6. 接通任务 ready、retry、cancel、recover 操作。
7. 接通 `restart_on_retry`、worktree 复用/重置和完成后清理。
8. 接通依赖可执行性计算，阻止上游未完成或失败时运行后继。
9. 使合并与全局回写从任意崩溃点可幂等恢复。
10. 删除旧的重复 CLI 编排和可选门禁路径。

### 2.2 P1 后续增强

- SQLite 增量同步和查询加速。
- 可配置的任务成本、轮次和墙钟策略。
- 多任务并行执行。
- 更丰富的 Reviewer 规则引擎。
- Provider 能力探测和模型映射校验。

P1 不得阻塞 P0，也不得在 P0 中提前实现。

---

## 3. 非目标

- 不实现 UI。
- 不实现 MCP transport 或工具接入。
- 不实现多任务并行；第一版严格串行。
- 不实现 SDK 会话断点续跑；恢复以新会话重新进入当前阶段。
- 不保留旧 `task:run`、`task:review` 的行为兼容层。
- 不允许通过配置关闭路径审计或系统验证。
- 不允许以日志替代门禁。
- 不允许模型自报结果覆盖系统证据。
- 不把 SQLite、进程内 Map 或隐藏临时文件作为任务状态事实来源。

---

## 4. 用户入口

实现完成后 CLI 只保留以下生命周期入口：

### 4.1 `caw task:ready <taskId>`

用途：人工确认任务定义已经完整，把 `draft` 转为 `ready`。

规则：

- 任务必须处于 `draft`。
- Task Schema、依赖存在性、依赖无环、路径作用域和验证命令配置必须校验通过。
- 必须输出任务、依赖、写入路径和验证命令摘要，供人工确认。
- 不创建 worktree，不启动 Executor。

### 4.2 `caw run [taskId]`

用途：运行完整生命周期。

- 指定 `taskId`：只运行该任务的完整生命周期。
- 未指定 `taskId`：读取全部任务，按拓扑顺序串行运行当前可执行的 `ready` 任务。
- 自动模式一次只运行一个任务；一个任务完成、阻塞、失败或驳回后再重新计算后续可执行集合。
- 某一任务业务失败时，继续运行与其无依赖关系的其他 runnable 任务；Git 仓库损坏、配置非法、
  任务图非法等全局错误则立即停止本轮 Orchestrator。
- 指定任务不可执行时返回非零退出码和 eligibility 原因，不创建或修改 worktree。
- 不可执行任务必须输出结构化原因，不能静默跳过。

### 4.3 `caw task:retry <taskId>`

用途：经人工确认后重新运行 `blocked/rejected/failed` 任务。

规则：

- `restart_on_retry: true`：把既有 worktree 重置到当前 main 干净基线，再开始新 attempt。
- `restart_on_retry: false`：复用既有 worktree 和改动，但必须重新执行路径审计、系统验证和 Reviewer。
- 每次 retry 生成新的 `run_id` 和递增 `attempt`。
- 上一次结果和审查文档保留审计信息，不允许用覆盖方式丢失历史 attempt。

### 4.4 `caw task:cancel <taskId> --confirmed`

用途：人工确认取消任务。

规则：

- 必须显式 `--confirmed`。
- 取消后不自动删除 worktree；输出下一步清理建议。
- 清理由独立、显式策略决定，避免误删人工待取回改动。

### 4.5 `caw recover [taskId]`

用途：恢复进程崩溃、中断或合并中断的任务。

- 指定任务时恢复该任务。
- 未指定时扫描 `running/reviewing/done` 与现存 worktree，报告并恢复可判定项。
- 无法唯一判定时进入 `blocked + needs-human`，不得猜测。

旧 `caw task:run` 和 `caw task:review` 在新入口完成后删除，不保留转发层。

---

## 5. 数据所有权

### 5.1 所有权表

| 数据 | 唯一所有者 | 模型是否可提供 |
| --- | --- | --- |
| 实际修改、新建、删除文件 | Git/WorkspaceInspectionPort | 只能提供自报副本，不能作为事实 |
| 路径是否越界 | PathAudit | 否 |
| 验证命令、退出码、耗时、输出 | VerificationRunnerPort | 只能提供执行过程说明 |
| Executor 技术终止信息 | SDK Session | 否 |
| 任务执行状态 | Orchestrator | 只能建议 |
| 审查结论 | Reviewer | 是，但不能覆盖系统门禁 |
| 合并 commit | GitMergePort | 否 |
| 全局更新建议 | Executor/Reviewer | 是 |
| 决策和问题最终 id | Orchestrator | 否 |
| 任务 frontmatter 状态 | StateOrchestrator | 否 |

### 5.2 Result Schema 重构

现有 Result Schema 混合模型自报和系统事实，下一版必须破坏式重构为显式来源：

```yaml
task_id: TASK-001
run_id: RUN-<uuid>
attempt: 1

executor_report:
  outcome: completed | blocked | failed
  proposed_next_action: review | retry | needs-human | cancel
  summary: "..."
  reported_files:
    modified: []
    created: []
    deleted: []

observed_changes:
  modified: []
  created: []
  deleted: []

verification:
  - command: npm run typecheck
    result: passed | failed | skipped
    exit_code: 0
    duration_ms: 100
    output_summary: "..."

gates:
  path_scope: passed | blocked
  verification: passed | blocked

execution_status: completed | blocked | failed
next_action: review | retry | needs-human | cancel
execution_commits: []
global_update_requests:
  progress: []
  decisions: []
  issues: []
```

规则：

- `executor_report` 是模型报告，保留但不作为客观事实。
- `observed_changes` 只能由 Git 构造。
- `verification` 只能由系统 Runner 构造，不再接受 `source: model` 作为最终记录。
- `execution_status` 和 `next_action` 由 Orchestrator 根据 Executor 报告与门禁共同生成。
- 模型报告与系统观察不一致时，保留差异并提出问题；系统观察获胜。
- `execution_commits` 仍在 rebase 后、fast-forward 前由 Git 回填。

### 5.3 Attempt 历史

- 每次执行都有唯一 `run_id` 和递增 `attempt`。
- 任务 frontmatter 新增当前 attempt 摘要，但不内嵌完整历史。
- 每个 attempt 使用独立结果和审查审计记录，命名必须包含 `run_id` 或 attempt，禁止覆盖旧结果。
- `workflow_outputs` 必须能确定当前结果文件和历史结果目录，不能依赖文件名猜测。

具体文件命名由实现任务固定，但 Schema 和仓储必须先于 CLI 改造完成。

---

## 6. 统一生命周期

### 6.1 主流程

```text
读取任务与依赖
  → 计算可执行性
  → 准备 attempt/worktree
  → ready → running
  → Executor
  → Git 实际变更采集
  → 路径审计
  → 系统验证
  → Orchestrator 生成最终 result
  → 客观门禁
      ├─ 失败 → blocked/failed → 保留 worktree → 记录问题
      └─ 通过
          ├─ no_review → done
          └─ reviewing → Reviewer
                         ├─ approved → done
                         ├─ rejected → rejected
                         └─ needs-human → blocked
  → done → Finalize
            ├─ 成功 → 全局回写 → 同步主工作区 → 清理 worktree
            └─ 冲突 → blocked → 记录问题 → 保留 worktree
```

### 6.2 强制顺序

以下顺序不可配置、不可跳过：

1. Executor 返回。
2. Git 枚举实际变更。
3. 路径审计。
4. Verification Runner 执行最终 allowlist。
5. Orchestrator 写系统结果。
6. 门禁通过后才允许 Reviewer。
7. Reviewer 通过后才允许 Finalize。
8. Finalize 成功后才允许清理 worktree。

任何调用方都不能直接调用 Finalize 绕过上述阶段。Finalize 输入必须携带不可伪造的
`GateReceipt`，由 application 内部类型构造器在门禁通过时创建，不接受 CLI 自行拼对象。

### 6.3 GateReceipt

```ts
interface GateReceipt {
  readonly taskId: TaskId
  readonly runId: RunId
  readonly pathAudit: 'passed'
  readonly verification: 'passed'
  readonly review: 'approved' | 'skipped'
}
```

- 构造函数不导出到 CLI。
- FinalizeTaskUseCase 必须要求 `GateReceipt`。
- `skipped` 只允许 `no_review: true` 且其余客观门禁通过。
- receipt 不持久化为授权 token；恢复时必须重新从权威文档和 Git 证据重建并校验。

---

## 7. 可执行性与依赖

任务自身生命周期状态和依赖可执行性必须分开：

```text
TaskStatus: draft | ready | running | reviewing | done | rejected | blocked | failed | cancelled

TaskEligibility:
  runnable
  waiting-dependency
  dependency-blocked
  terminal
```

规则：

- 只有 `status=ready && eligibility=runnable` 可以启动。
- 任一依赖不是 `done` 时不可运行。
- 依赖为 `draft/ready/running/reviewing` 时是 `waiting-dependency`。
- 依赖为 `blocked/rejected/failed/cancelled` 时是 `dependency-blocked`。
- eligibility 每次从任务图和权威 frontmatter 重新计算，不写入任务状态，不制造缓存状态。
- 上游恢复为 `done` 后，后继自动重新计算为 runnable，无需反向批量改写状态。
- 依赖不存在或存在环时整个调度调用失败，并给出结构化诊断。

现有 `cascadeIfBlocked` 的“批量改写后继状态”逻辑不再作为主流程规则；由 eligibility 计算取代，
避免 ready/draft 后继的非法状态转换和恢复时的隐式旧状态。

---

## 8. 路径门禁

### 8.1 启动前

- `allowed_paths` 与 `forbidden_paths` 重叠时拒绝启动。
- 空 `allowed_paths` 表示任务不得修改业务文件，但仍允许系统声明的结果文件。
- 所有路径在进入领域规则前统一规范化为相对仓库根的正斜杠路径。
- 禁止绝对路径和逃逸仓库根的 `..`。

### 8.2 Executor 返回后

- 必须用 Git 枚举 tracked、staged、unstaged、untracked、deleted、rename/copy。
- 结果和审查审计文件必须通过系统内置 allowlist 排除，不要求任务重复声明。
- forbidden 优先。
- 任一越界产生 `blocked + needs-human` 和结构化 Issue。
- 不自动删除、不自动回滚越界文件，保留 worktree 供人工确认。
- Reviewer 不得在路径门禁失败后运行。

`WorkspaceInspectionPort` 从可选依赖改为必填 Port；删除所有 `undefined → 跳过审计` 分支。

---

## 9. 系统验证门禁

### 9.1 命令来源

- 项目级验证命令统一放在 `docs/TESTING.md` frontmatter 的 `verification_commands` 字段，
  使用 Zod Schema 读取；删除扫描正文 fenced YAML 的旧解析器。
- 初始化模板必须直接生成如下可解析结构，禁止模板写 bullet、解析器读取另一种格式：

```yaml
---
verification_commands:
  - id: typecheck
    command: npm run typecheck
    layers: [type, data, state, domain, page, test]
    requires_permissions: []
  - id: unit-test
    command: npm test
    layers: [type, data, state, domain, page, test]
    requires_permissions: []
---
```

- 任务级 verification 与项目级命令按现有 layer 裁剪和并集规则合并。
- 每条命令必须有稳定 identity，不再只依赖未经规范化的命令字符串。

### 9.2 执行规则

- `VerificationRunnerPort` 为 Orchestrator 必填 Port。
- 所有 allowlist 命令严格串行执行。
- 权限不足时 Runner 不执行，门禁 blocked。
- failed、skipped、超时、spawn 失败或无记录都视为门禁失败。
- 空 allowlist 合法通过，但结果必须明确记录“无验证命令”，不能伪造 passed 命令。
- 普通任务和 `no_review` 任务使用完全相同的验证门禁。
- Reviewer 不能覆盖验证门禁。

### 9.3 执行策略

P0 沿用当前单命令超时与输出限制，但配置必须集中为 `ExecutionPolicy`：

```ts
interface ExecutionPolicy {
  readonly verificationTimeoutMs: number
  readonly maxOutputBytes: number
}
```

禁止把默认值散落在 CLI、application 和 infrastructure 多处。P1 再增加任务级 cost、turn 和
墙钟限制。

---

## 10. Reviewer 安全策略

- `ClaudeSdkReviewer` 是默认真实 Reviewer。
- SDK 配置、token、网络或模型错误时返回 `needs-human-confirmation`。
- 禁止自动回退为 `approved`。
- `LocalReviewer` 如保留，只能执行确定性规则并返回证据；没有规则能力时必须返回
  `needs-human-confirmation`。
- 如果需要开发联调自动批准，必须使用测试 fake，不得在生产 CLI 暴露隐式 fallback。
- `--reviewer local` 不得意味着自动批准。
- Reviewer 只在 path 和 verification 门禁均通过时启动。
- Reviewer 的 `approved` 只决定代码/架构审查通过，不改变客观门禁事实。

---

## 11. Worktree 与重试

### 11.1 Worktree 状态

Worktree Adapter 必须支持显式状态：

- `absent`
- `present-clean`
- `present-dirty`
- `rebase-in-progress`
- `merged`

Orchestrator 通过 Port 查询，不通过目录存在性猜测。

### 11.2 首次运行

- 创建 `task/<taskId>` 分支和独立 worktree。
- 创建失败必须区分同名分支已存在、worktree 已存在和 Git 环境错误。
- 不允许用删除重建作为隐式兜底。

### 11.3 Retry

- `restart_on_retry: true`：清理残留 rebase，以最新 main 为新基线重建干净 worktree。
- `restart_on_retry: false`：附着既有 worktree，保留人工或上次模型改动。
- 两种模式都必须新建 attempt，并重新执行完整门禁。
- 继续模式不得复用旧 verification 或旧 GateReceipt。

### 11.4 清理

- 只有 Finalize、全局回写和主工作区同步全部成功后，才自动删除 worktree 和任务分支。
- `blocked/rejected/failed/cancelled` 默认保留。
- 清理失败不回滚已成功合并，但必须记录 warning 和可执行的人工清理命令。

---

## 12. 恢复

恢复必须覆盖以下崩溃点：

| 观察状态 | 恢复动作 |
| --- | --- |
| `running`，无结果，worktree 存在 | 根据 retry 策略重新启动 Executor |
| Executor 结果存在，系统证据缺失 | 重新执行 Git 审计和系统验证 |
| 门禁通过，任务仍 `running` | 重放状态映射 |
| `reviewing`，无 review | 重新启动独立 Reviewer |
| review approved，状态未到 done | 重放审查映射 |
| `done`，分支未进 main | 清理残留 rebase并重新 Finalize |
| 分支已进 main，全局回写不确定 | 幂等重放全局回写和主工作区同步 |
| rebase 冲突 | abort 中间态，置 blocked，保留 worktree |

恢复规则：

- 每一步必须先检查权威事实，再决定是否执行。
- 不允许以“上次函数调用成功”作为恢复依据。
- 同一恢复命令重复执行不得产生新 commit、重复 Issue 或重复 progress append。
- 无法判断的状态必须停止并请求人工确认。

---

## 13. 全局回写幂等性

每条全局更新请求新增稳定 `operation_id`：

```text
<taskId>:<runId>:progress:<index>
<taskId>:<runId>:decision:<index>
<taskId>:<runId>:issue:<index>
```

规则：

- 同一 operation 重放只生效一次。
- progress append 必须能识别已应用 operation，禁止恢复时重复追加。
- progress replace 冲突必须被 Orchestrator 消费：产生 Issue，并根据冲突影响把任务置 blocked
  或明确记录后写覆盖裁定。
- 决策和问题 id 分配结果必须回填 attempt 审计记录。
- GlobalDocRepository 只负责纯变换；operation 去重和冲突裁定由 application 层负责。
- 不允许 CLI 忽略 `progress_conflicts` 返回值。

---

## 14. 模块边界

### 14.1 Core

负责：

- 新 Result/Attempt/Gate Schema。
- TaskEligibility 纯规则。
- 客观门禁组合规则。
- 状态机必要调整。

禁止：

- Git、文件系统、SQLite、SDK 或 CLI 依赖。

### 14.2 Application

新增建议模块：

```text
src/application/orchestration/
  orchestrator.ts
  task-selector.ts
  task-lifecycle.ts
  task-eligibility.ts
  recovery.ts
  outcomes.ts

src/application/execution/
  evidence-collector.ts
  gate-evaluator.ts
  result-builder.ts
```

负责：

- 唯一生命周期编排。
- 证据组合和门禁。
- Reviewer、Finalize 和恢复调用顺序。
- 结构化 outcome。

禁止：

- 直接 import infrastructure 实现。
- Shell、Git 命令或文件路径 I/O。

### 14.3 Infrastructure

负责：

- Git、worktree、子进程验证、SDK、文件系统和 SQLite 的 Port 实现。
- 提供事实，不决定业务状态。

### 14.4 CLI

负责：

- 参数解析。
- 配置读取。
- 实例化 Port 和 Orchestrator。
- 展示结构化结果。

禁止：

- 状态映射。
- 门禁判断。
- 合并冲突裁定。
- Retry/Recovery 业务循环。
- 为测试或缺配置创建自动批准 fallback。

---

## 15. Port 调整

以下 Port 在 Orchestrator 构造时为必填：

- `TaskDocRepositoryPort`
- `WorktreePort`
- `WorkspaceInspectionPort`
- `TaskExecutorPort`
- `VerificationRunnerPort`
- `TaskReviewerPort`
- `GitMergePort`
- `GlobalDocRepositoryPort`
- `IdAllocator`

新增或扩展：

```ts
interface WorktreePort {
  inspect(taskId: TaskId): WorktreeState
  create(mainRef: string, taskId: TaskId): string
  attach(taskId: TaskId): string
  rebuild(mainRef: string, taskId: TaskId): string
  remove(taskId: TaskId): void
}
```

旧的可选 `workspaceInspector?`、`verificationRunner?` 删除。禁止通过可选依赖表达安全能力开关。

---

## 16. 结构化结果

`caw run` 返回/打印的 Orchestrator outcome 至少包含：

```ts
interface OrchestrationOutcome {
  readonly runId: RunId
  readonly tasks: readonly TaskLifecycleOutcome[]
  readonly stoppedBecause?: string
}

interface TaskLifecycleOutcome {
  readonly taskId: TaskId
  readonly attempt: number
  readonly initialStatus: TaskStatus
  readonly finalStatus: TaskStatus
  readonly eligibility: TaskEligibility
  readonly executor: string | null
  readonly reviewer: string | null
  readonly gates: {
    readonly pathScope: 'passed' | 'blocked' | 'not-run'
    readonly verification: 'passed' | 'blocked' | 'not-run'
    readonly review: 'approved' | 'rejected' | 'needs-human' | 'skipped' | 'not-run'
  }
  readonly merged: boolean
  readonly recovered: boolean
  readonly conflicts: readonly string[]
  readonly issues: readonly string[]
}
```

CLI 输出可以简化，但 application 必须返回完整结构，测试不得靠解析 console 文本判断结果。

---

## 17. 验收标准

### 17.1 状态与入口

1. `task:ready` 是 `draft → ready` 的唯一 CLI 入口，非法状态返回非零退出码。
2. `caw run TASK-001` 一次调用完成 execute → audit → verify → review → finalize 全链。
3. `caw run` 无 taskId 时按拓扑顺序串行运行所有当前 runnable 任务。
4. 旧 `task:run`、`task:review` 命令和重复编排代码被删除。

### 17.2 客观门禁

5. CLI 默认真实注入 WorkspaceInspection 和 VerificationRunner，不存在跳过门禁路径。
6. 路径越界时任务变为 blocked，Reviewer 和 Finalize 均不被调用。
7. 模型自报 passed、系统验证 failed 时，以系统 failed 为准。
8. 普通任务和 `no_review` 任务验证失败都必须 blocked。
9. allowlist 任一 failed、skipped、未执行、超时或权限不足都不得合并。
10. Finalize 无有效 GateReceipt 时不能调用成功。

### 17.3 Reviewer

11. SDK Reviewer 装配失败时任务进入 blocked/needs-human，不自动 approved。
12. LocalReviewer 无确定性证据时不能返回 approved。
13. Reviewer approved 不能覆盖路径或验证门禁失败。

### 17.4 Retry 与恢复

14. `restart_on_retry=true` 使用最新 main 重建干净 worktree。
15. `restart_on_retry=false` 复用既有改动，但重跑全部门禁。
16. 同一任务多次 attempt 保留独立结果和审查历史。
17. `recover` 覆盖 §12 表中全部崩溃点。
18. 同一恢复操作执行两次不重复合并、不重复 progress append、不重复创建 Issue。

### 17.5 依赖与清理

19. 上游未完成时后继 eligibility 为 waiting-dependency。
20. 上游 blocked/rejected/failed/cancelled 时后继为 dependency-blocked。
21. 上游恢复 done 后后继无需状态改写即可重新变为 runnable。
22. Finalize 全部成功后自动清理 worktree；未完成任务保留 worktree。

### 17.6 全局回写

23. progress replace 冲突被 Orchestrator 消费并产生结构化结果，不被忽略。
24. 每条全局更新 operation 重放只生效一次。
25. 分配后的 DEC/ISS id 回填 attempt 审计记录。

### 17.7 工程质量

26. `npm run typecheck`、`npm test`、`npm run lint` 全部通过。
27. application 不直接 import infrastructure 实现，新增依赖边界测试。
28. CLI 文件不存在任务生命周期业务循环。
29. fake Ports 覆盖每个门禁和恢复分支；Git 临时仓库测试覆盖真实 worktree/rebase/恢复。
30. 不自动启动浏览器测试。

---

## 18. 任务拆分建议

按依赖顺序拆分，单任务不得跨越多个目标：

1. **领域模型重构**：RunId、Attempt、Result Schema、Gate、Eligibility。
2. **仓储与文件命名**：多 attempt 结果/审查历史，旧单文件协议直接替换。
3. **Worktree Port 重构**：inspect/attach/rebuild/remove。
4. **证据与门禁用例**：EvidenceCollector、GateEvaluator、ResultBuilder。
5. **Reviewer 失败关闭**：删除自动批准 fallback。
6. **单任务生命周期用例**：完整 execute→finalize 主链。
7. **串行任务选择器**：拓扑顺序和 eligibility。
8. **Retry 用例**：restart/continue 两条显式路径。
9. **Recovery 用例**：覆盖各崩溃点和幂等重放。
10. **全局回写 operation id**：append 去重与冲突消费。
11. **CLI 收敛**：新增 ready/run/retry/cancel/recover，删除旧入口。
12. **端到端验证**：fake agent + 真实临时 Git 仓库。

每项完成后都要检查是否出现第二套状态映射、第二套门禁、CLI 业务循环或隐式恢复状态；发现时优先重构，不继续叠加。

---

## 19. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Result Schema 破坏式变化 | 现有测试和仓储大量变化 | 按新系统要求直接替换，先改 core 和仓储，再改用例；不保留兼容解析 |
| 多 attempt 文件增加复杂度 | 路由与恢复容易隐式化 | workflow_outputs 显式声明当前/历史路径，仓储提供窄接口，CLI 不猜文件名 |
| 强门禁增加执行耗时 | 每个任务需重复验证 | 正确性优先；P1 再做安全缓存，P0 不跳过 |
| Retry 复用脏 worktree | 旧改动污染新 attempt | continue 模式显式选择并重新审计；restart 模式重建 |
| 自动清理误删改动 | 数据损失 | 只清理完整 Finalize 成功任务；其他状态默认保留 |
| 恢复重放重复写全局文档 | 进度和问题重复 | operation_id + application 幂等去重 |
| Reviewer/Provider 不可用 | 流程停滞 | fail closed 为 needs-human，保留 worktree和完整证据 |

---

## 20. 完成定义

本规格完成的标志不是“新增 Orchestrator 类”，而是以下事实同时成立：

- 用户通过一个 `caw run` 入口即可完成单任务或串行多任务生命周期。
- 任何任务都无法绕过路径、验证和审查门禁进入合并。
- 技术降级不会自动批准。
- Retry、Recover 和全局回写可重复执行且无重复副作用。
- 任务依赖可执行性由图实时推导，不依赖批量状态修补。
- worktree 从创建到清理有完整、显式、可测试的生命周期。
- CLI 只做 composition root，application 拥有唯一业务流程。

满足以上条件后，系统才具备继续实现并行调度、MCP 或 UI 的可靠基础。
