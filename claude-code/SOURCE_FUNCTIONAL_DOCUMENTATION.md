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
- `domain/task-completion.ts`：直接前驱完成指纹的规范投影。
- `domain/project-contract.ts`：SPEC/TASK 契约投影与项目源集合投影，全部经唯一规范哈希入口计算。
- `domain/acceptance-contract.ts`：requirements、evidence policy、支持平台矩阵与四类验收 criterion 的 strict 领域契约；规范 criterion key、执行描述安全形状与悬空稳定 ID 都在这里 fail closed。
- `domain/requirement-coverage.ts`：requirement→criterion 覆盖判定；criterion 必须满足 evidencePolicy 的 kind、platform、responseSchema、requiredEvidence 最低强度才计入覆盖，mandatory requirement 缺 integration 覆盖时项目在 Agent 启动前被拒绝。
- `domain/host-execution-policy.ts`：产品级只读 HostExecutionPolicySnapshot 的 strict 契约、内部完整性与规范哈希；项目只能引用其中已有的稳定 ID。
- `domain/host-capability-validation.ts`：Run 创建前的三态校验，区分 valid、unsupported_contract（合同非法）与 configuration_missing（宿主缺能力），诊断是结构化事实，不生成人工替代请求。
- `domain/canonical-json.ts`、`domain/canonical-schema.ts`、`domain/canonical-text.ts`、`domain/canonical-paths.ts`：JCS 规范编码、版本化 strict Schema、源文本 LF 归一化与 Git 路径校验。
- `domain/attachment-digest.ts`：附件原始字节摘要契约。
- `domain/agent-result.ts`：Worker、Reviewer、验证证据和 Agent 遥测的结构化协议。

领域层不读取文件、不执行 Git，也不依赖 Claude SDK。

### 2.2 应用层

- `queue-orchestrator.ts`：严格线性驱动器，只选择当前位置并推进一个 checkpoint；基础设施中断保留最近可恢复状态，不进入 TASK 失败预算。
- `task-execution-service.ts`：根据持久化状态分派单一阶段。
- `implementation-stage.ts`：Worker 新建、恢复、repair、资源收敛与候选冻结。
- `review-stage.ts`：全新只读 Reviewer、审核尝试历史和修复反馈。
- `commit-stage.ts`：候选、契约、前驱与 Git 完成证据的原子提交。
- `workspace-baseline-resolver.ts`：仓库身份、分支和项目树不变快进的统一基线判定。
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

- `agent-executor.ts`：自主 Worker 与只读 Reviewer 执行边界，包括 attempt 模型握手和资源上限。
- `agent-model-resolver.ts`：应用层读取当前 Claude 用户模型的最小端口，不暴露 Provider 设置与凭据。
- `execution-guard.ts`：SDK 无关的工具调用允许/拒绝协议。
- `project-context-provider.ts`：确定性项目导航清单编译边界。
- `workspace.ts`：拆分为仓库身份、控制路径、历史检查、候选存储、隔离区、提交器、提交恢复和完成账本端口；`Workspace` 只是默认聚合门面。
- `state-store.ts`、`project-repository.ts`、`run-lock.ts`：状态、静态项目输入与单实例锁。
- `event-logger.ts`、`clock.ts`、`time-formatter.ts`：观察与时间边界。

### 2.4 基础设施层

- `claude-user-settings-source.ts`：通过 Claude SDK 读取 Claude Code 当前用户级/托管级设置；CC Switch 是该用户配置的上游写入者，系统不读取其内部数据库。
- `claude-connection-settings-resolver.ts`：从用户设置中投影认证、代理和模型连接环境。
- `claude-model-resolver.ts`：从同一用户设置源按 Claude Code 优先级投影 attempt 使用的显式模型。
- `claude-agent-options-builder.ts`：工具能力、Reviewer 连接配置注入与权限隔离、Draft-07 输出和 Hook 选项翻译。
- `claude-agent-sdk-executor.ts`：SDK 消息流、模型握手、结构化输出、认证失败分类、遥测与中止映射。
- `console-claude-message-observer.ts`：带北京时间的实时消息、后台任务状态与重复状态折叠。
- `git-command-runner.ts`：唯一 Git 子进程入口。
- `git-project-boundary.ts`：子项目 pathspec、仓库身份、清洁度与安全清理。
- `git-candidate-store.ts`：候选指纹、审核投影与提交。
- `git-task-completion-ledger.ts`：精确 trailer 完成历史。
- `git-candidate-quarantine.ts`：终态候选的可重入归档。
- `git-workspace.ts`：以上 Git 组件的薄门面。
- `file-project-repository.ts`：唯一规格与 TASK Markdown 编译，SPEC 固定章节与 TASK 验收契约的 YAML 解析和合同身份接线。
- `markdown-contract-section.ts`：Markdown 固定章节提取边界，只识别围栏外精确标题行与唯一 yaml 代码块。
- `node-canonical-hash-service.ts`：唯一规范哈希实现（strict Schema + JCS + SHA-256）。
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

`SPEC.md` 是唯一用户维护的项目级执行契约。系统不读取额外项目级 YAML/JSON 配置，也不允许 TASK、项目配置或 CLI 覆盖模型、资源和 Git 策略；模型只来自 Claude 用户配置这一运行时事实源。除自由正文外，`SPEC.md` 必须包含三个固定章节，每个章节只携带一个 ```yaml 代码块：`## 需求契约`（requirements 及各自最低证据强度 evidencePolicy）、`## 支持平台矩阵`（supportedPlatformMatrix，声明稳定 platformId、OS、架构、runtime/toolchain、包管理器和换行策略，允许显式空数组）和 `## 集成验收契约`（与 TASK 验收契约同构的 integration criteria）。每条 mandatory requirement 必须至少被一条满足 evidencePolicy 最低强度的 integration criterion 覆盖，缺失或弱证据都会在加载时拒绝项目；command 引用的宿主稳定 ID 由产品级只读 HostExecutionPolicySnapshot 提供，Run 创建前的三态校验区分合同非法与宿主 capability 缺失（见 `docs/HostExecutionPolicy.md`）。

固定策略：

| 会话 | 模型 / effort | 最大轮数 | 最大费用 | 最大时长 |
|---|---|---:|---:|---:|
| Worker | `Claude 用户当前模型/high` | 80 | $6 | 45 分钟 |
| Reviewer | `Claude 用户当前模型/high` | 30 | $2 | 15 分钟 |

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

正文必须在固定章节 `### 验收契约` 中携带唯一的 ```yaml 代码块，声明非空 `criteria` 数组。criterion 只允许 `command`、`static`、`human`、`external` 四类：command 使用结构化的 `package_script`/`argv` 执行描述（不接受 raw shell，参数逐项传递且不得包含 shell 拼接语义，引用的 package manager、executable、env/dependency profile 和 platform 只是宿主稳定 ID）；human/external 必须包含 procedure、结构化 expected、非空 requiredEvidence 和版本化 responseSchema。每条 criterion 通过 `requirementRefs` 引用存在的 SPEC requirement，规范键为 `task:<TASK-ID>/<criterion-id>` 或 `integration/<criterion-id>`。缺少验收章节、未知 kind、未知字段、重复规范键、空描述、非法执行描述或悬空稳定 ID 都会在 Agent 启动前拒绝整个项目，不存在旧正文推测、自动补全或宽松 fallback。

源文本先经 UTF-8、BOM 与 NUL 校验，再统一做 CRLF/CR → LF 归一化；其他正文字符逐字节保留。全部项目与契约摘要都由唯一 `CanonicalHashService` 计算：版本化 strict Schema + JCS + SHA-256，不存在第二套算法或旧算法 fallback。Git 路径在加载时校验 NFC、规范化/大小写折叠碰撞和平台可表示性。详见 `docs/CanonicalHashing.md`。

## 5. 队列与职责化阶段

`QueueOrchestrator.start()`：

1. 创建北京时间 Run ID并取得 Git worktree 共享锁；
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

`candidate_pending` 将 Worker 结构化结果与 Git 候选捕获分为两个 checkpoint。它既承载已完成实现，也承载等待独立 Reviewer 复核的 Worker 阻塞报告；进程在二者之间中断时不会重新运行已经完成的 Agent 会话。

Worker 的首次 `blocked` 声明不会直接产生 TASK 终态。应用层持久化摘要与 blockingQuestions、冻结当前候选并启动全新只读 Reviewer：阻塞不成立或仍有项目内可执行工作时进入 repair；只有 Reviewer 确认缺少真实外部信息、凭据或不可逆决策后才进入 `blocked`。`blocked` 或 `failed` 终态出现后，当前候选先进入隔离区，Run 随即结束，全部后继保持 `pending`。

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

## 8. 模型快照与遥测

SDK `system/init` 是会话可信边界。执行器在任何工具结果被接受前核验：

- 请求模型；
- `system/init.model` 实际模型；
- 初始化 session ID。

每个新 attempt 从 Claude 用户配置读取一次显式模型并先行持久化：`env.ANTHROPIC_MODEL` 优先于顶层 `model`，两者都缺失时拒绝创建 attempt，不使用 SDK 隐式默认模型。恢复已有 attempt 不重新解析。`system/init.model` 必须精确等于该 attempt 的请求模型，不一致返回不可重试 `model_mismatch`，关闭 Query，并将请求/实际模型保存到 attempt。

每次 Worker 与 Reviewer attempt 保存：会话 ID、请求/实际模型、开始/结束时间、结果、摘要、费用、轮数、持续时间、API 重试次数、重试等待时间、去重工具调用数；Worker 额外保存验证证据。终态事件与摘要只从这些事实聚合，不解析控制台日志。

## 9. 候选与独立审核

候选身份只包含稳定排序的路径、类型、模式和内容哈希。普通指纹捕获不生成 diff。

Reviewer 启动前才组合：

- 当前候选身份；
- 实际变更文件；
- `--unified=8` 的紧凑 tracked diff；
- 有界的 untracked 文件预览；
- Worker 结构化验证证据。

“实际变更文件”就是已冻结并经过指纹校验的完整候选，覆盖 tracked、untracked 和 deleted 文件；审核通过后提交阶段会原子提交同一候选。因此提交前 `git status` 中的 `??` 只是新增文件的正常状态，不能被 Reviewer 当作 checkpoint 范围不确定。

Reviewer 使用 `Read/Glob/Grep`、`dontAsk`、空 MCP、空 skills、空 setting sources。每次审核都创建全新 session，不继承 Worker、项目设置或用户权限设置；基础设施通过 Claude SDK 重新解析当前用户级/托管级配置，并投影连接环境与认证辅助命令。该读取路径与 CC Switch 切换后 Claude Code 使用的实时配置一致，不访问 `cc-switch.db`，也不在 Apex 中维护凭据副本。令牌通过合并后的子进程环境传递，不进入命令行参数；用户设置环境覆盖宿主终端同名变量，认证/网关连接和工具权限保持解耦。

审核通过且没有 critical/high/medium finding 才进入提交；拒绝或实质 finding 进入 repair，即使模型把带实质 finding 的结果误标为 blocked，应用层也以 finding 为准进入 repair。Worker 阻塞审计不是完成候选审核，因此 Reviewer 的 approved 会被应用层归一化为 rejected，只有 blocked 才能确认真实阻塞。只有正确性依赖项目内无法推导的外部信息、凭据或不可逆产品决策时才允许进入 blocked；明确契约偏差必须形成 finding，可逆实现选择必须由 Reviewer 直接批准或拒绝。会话已建立后的可恢复 Agent 错误按 Reviewer 预算新建会话重试；会话初始化前的子进程启动故障属于 Run 基础设施中断，保留 `running` 状态且不消耗 Reviewer/Worker 预算；认证失败属于需要修复外部配置的不可重试错误并立即终止。

## 10. Git 候选、账本与隔离区

Git 基础设施分为：

- `GitProjectBoundary`：路径坐标系、项目外改动、清洁度和安全清理；
- `GitCandidateStore`：候选身份、审核材料和原子提交；
- `GitTaskCompletionLedger`：完成 trailer 读取与提交崩溃恢复；
- `GitCandidateQuarantine`：阻塞/失败候选归档；
- `GitCommandRunner`：统一进程超时和错误映射。

提交前验证 HEAD、项目外改动和冻结指纹。同一 worktree 的兄弟项目共享进程锁；RunState 仍按项目隔离。若锁外操作使 HEAD 沿祖先链前移，但前后两个端点的当前项目树完全一致，应用层会先 checkpoint 新 expected HEAD 再提交；分叉、回退或项目内变化继续拒绝。每个完成 TASK 创建独立提交并写入：

- `Apex-Coding-Agent-Run`
- `Apex-Coding-Agent-Project`
- `Apex-Coding-Agent-Task`
- `Apex-Coding-Agent-Candidate`
- `Apex-Coding-Agent-Task-Contract`
- `Apex-Coding-Agent-Task-Predecessor`

无文件差异时仍创建空提交。阻塞/失败候选保存到确定性 `refs/apex-coding-agent/quarantine/*` 后清理主工作区；归档逻辑可重入。Reviewer 阻塞的 Run 被显式 `resume` 时，系统先拒绝覆盖其他工作区改动，再从隔离提交恢复当前项目的索引与工作树以覆盖新增/删除文件，并把索引归一化到 HEAD。恢复内容来自受状态引用约束的 Git 提交；考虑 Git clean/smudge 过滤器可能规范化工作树字节，系统会重新冻结恢复后的候选指纹，checkpoint 为 `reviewing` 后再消费旧引用。若恢复与 checkpoint 之间中断，旧引用仍保留用于重试。经 Reviewer 确认的 Worker 阻塞同样属于该恢复路径。旧版“Worker 直接 blocked”只有在归档明确为空、无候选指纹且工作区完全干净时才迁移为 candidate_pending 阻塞审计；任何未提交候选证据都会拒绝兼容猜测。资源耗尽和失败终态不会走该路径。

## 11. 跨 Run 复用与恢复

新 Run 只复用当前 HEAD 祖先链上满足以下条件的连续前缀：

1. 当前 TASK 最新完成证据存在；
2. TASK 契约指纹相同；
3. 直接前驱完成提交指纹相同；
4. 此前所有 TASK 已连续复用。

`--fresh` 只禁止本次复用，不删除历史。

完成契约以版本化规范投影经唯一规范哈希入口计算（TASK/SPEC 契约投影当前为 `schemaVersion: 2`，绑定完整规范化正文与解析后的结构化验收契约）；旧执行模型产生的契约哈希不会被当前系统复用，也没有迁移或降级分支。

恢复前统一核验项目哈希、项目根、RunState 语义、仓库根、分支与 HEAD。Worker init 已落盘时使用 SDK resume；未 init 时替换 sessionId 并复用同一 attempt，基础设施启动故障不会制造 repair 历史；Reviewer 崩溃后结束旧尝试并创建全新只读会话。HEAD 变化只接受两条可推导路径：精确 trailer 证明的“任务提交成功、状态未落盘”，或旧 HEAD 为当前 HEAD 祖先且当前项目端点树完全一致的项目外快进；后者必须先更新 checkpoint 才能继续。

## 12. RunState v6 与关键不变量

RunState v6 不迁移旧状态。每次 checkpoint 和 resume 都调用同一语义校验器，保证：

1. 状态 TASK 集合与当前任务目录完全一致；
2. completed 任务形成从根开始的连续前缀；
3. 同一时刻至多一个活动 TASK；
4. Worker/Reviewer 尝试编号连续，结束时间与结果成对，历史项全部结束；
5. resolved model 必须有 session init 证据；
6. candidate_pending 必须有 completed Worker 尝试，或有 blocked Worker 尝试及其待审计结构化报告；
7. reviewing/committing 必须有候选指纹；
8. committing 必须有 approved Reviewer 尝试；
9. completed TASK 必须有 commit 与完成证据；
10. Run 终态必须与 TASK 终态一致。

状态和 JSONL 事件保存 UTC；CLI、控制台和 Markdown 产物使用北京时间投影。

## 13. 自动化验证

自动化测试覆盖：

- 严格项目加载、线性序列与完成前缀复用；
- Worker/Reviewer/repair/resume/candidate_pending/commit 状态流；
- Worker blocked 报告的候选冻结、独立审计、错误 approved 归一化与真实阻塞确认；
- CC Switch 模型解析、attempt 模型不匹配、结构化输出、API 重试和工具调用遥测；
- PreToolUse 守卫的允许与拒绝矩阵；
- 项目上下文稳定排序、忽略策略和脚本发现；
- RunState 跨字段语义不变量；
- Git 指纹、紧凑审核材料、空提交、父仓库边界和隔离区；
- checkpoint、锁、摘要指标与北京时间展示。

测试使用 Fake Agent 或临时 Git 仓库，不调用真实 Claude，也不启动浏览器。
