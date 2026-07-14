# Claude Task Orchestrator 源码功能说明

本文描述版本 2 的当前架构和不变量。系统是全新契约，不兼容版本 1 Manifest、旧状态文件或 `tasks:` 数组。

## 1. 目标

一次命令完成以下闭环：

1. 从 TASK 目录加载全部任务；
2. 校验静态元数据、路径边界和 DAG；
3. 逐个执行当前可运行节点；
4. 在隔离环境执行确定性门禁；
5. 自动修复可恢复问题；
6. 提交成功任务；
7. 隔离阻塞任务并继续独立 DAG 分支；
8. 没有可运行节点后生成完整运行结果。

## 2. 分层与模块边界

### 2.1 领域层

- `domain/manifest.ts`：项目策略、TASK 元数据和加载结果的唯一类型契约。
- `domain/dag.ts`：重复 ID、依赖合法性、环检测和稳定拓扑排序。
- `domain/run-state.ts`：TASK/Run 状态、合法转换和状态 Schema。
- `domain/agent-result.ts`：Worker 与 Reviewer 的结构化输出契约。
- `domain/errors.ts`：配置、基础设施和状态转换错误。

领域层不读取文件、不执行进程、不操作 Git，也不依赖 Claude SDK。

### 2.2 应用层

- `application/queue-orchestrator.ts`：选择可运行 DAG 节点、持久化 checkpoint、传播依赖阻塞和结束 Run。
- `application/task-execution-service.ts`：推进单个 TASK 的一个阶段。
- `application/prompt-builder.ts`：集中组装 Worker/Reviewer 提示词。
- `application/agent-session-checkpoint.ts`：SDK 会话初始化和尝试状态落盘。

队列不解析 Markdown、不拼接 Git 命令、不执行门禁子进程。单任务服务不决定下一个 TASK。

### 2.3 端口层

- `ports/agent-executor.ts`
- `ports/workspace.ts`
- `ports/gate-runner.ts`
- `ports/state-store.ts`
- `ports/run-lock.ts`
- `ports/event-logger.ts`
- `ports/manifest-repository.ts`
- `ports/clock.ts`

隔离验证、候选归档和提交都是 `Workspace` 的显式能力，不通过应用层魔法命令实现。

### 2.4 基础设施层

- `infrastructure/tasks/yaml-manifest-repository.ts`：编译 Manifest 与 TASK 目录。
- `infrastructure/git/git-workspace.ts`：候选指纹、验证 worktree、候选归档和提交。
- `infrastructure/git/verification-worktree-lease.ts`：隔离 worktree 的幂等释放、Windows 重试兜底与诊断。
- `infrastructure/process/node-gate-runner.ts`：结构化运行门禁进程。
- `infrastructure/claude/*`：Claude Agent SDK 适配与工具边界。
- `infrastructure/persistence/*`：状态、事件、产物和运行锁。

### 2.5 组合根与 CLI

- `cli/composition-root.ts` 是唯一依赖装配位置。
- `cli/index.ts` 只解析命令、处理中断、打印结果并映射退出码。
- `cli/sample-project-writer.ts` 生成可被生产仓储直接加载的版本 2 骨架。

## 3. 单一任务事实源

Manifest 只声明：

- 项目根和上下文文件；
- Worker 模型、推理强度和可选资源上限；
- Reviewer 策略；
- Git 提交前缀；
- TASK 目录；
- 隔离验证共享路径。

TASK 目录中的每个 `.md` 都必须包含严格 YAML 前置元数据：

- `id`
- `title`
- `dependsOn`
- `scope`
- `gates`
- 可选的任务级资源上限
- `manualAcceptance`

仓储按文件名稳定排序后加载全部 Markdown，并执行：

1. 未知字段检查；
2. 文件名必须为 `<id>.md`；
3. 首个 H1 必须为 `# <id> — <title>`；
4. 路径不得逃逸项目根；
5. ID 和依赖合法性检查；
6. DAG 环检测；
7. Manifest、上下文与所有 TASK 的整体内容哈希。

静态 TASK 不允许包含 `status`。运行状态只写入状态库。

## 4. TASK 状态流

```text
pending
  → executing
  → gating
  → reviewing（可关闭）
  → committing
  → completed

executing/gating/reviewing
  → retry_pending
  → executing

任意活动阶段
  → blocked | failed

pending
  → dependency_blocked
```

终态：

- `completed`：门禁、审核和提交完成；
- `blocked`：需要人工决策或触发不可自动接受的安全边界；
- `failed`：不可重试错误，或用户显式配置的尝试上限耗尽；
- `dependency_blocked`：至少一个依赖未完成，因此不会被释放。

终态 TASK 不再转换状态。候选归档等附加事实通过受限字段替换函数写入，不伪造状态转换。

## 5. DAG 调度

队列始终单并发，但不再把单个 TASK 的失败提升为立即停止整个 Run。

每轮按以下顺序处理：

1. 若收到中断，保存最近 checkpoint 并返回 `running`；
2. 若存在尚未归档候选的 blocked/failed TASK，先归档并清理主工作区；
3. 将依赖 blocked/failed/dependency_blocked 的 pending TASK 标记为 `dependency_blocked`；
4. 优先恢复已处于 executing/gating/reviewing/committing 的 TASK；
5. 否则选择拓扑顺序中第一个依赖全部 completed 的 pending/retry_pending TASK；
6. 没有可运行节点时结束 Run。

Run 终态：

- 全部 TASK completed：`completed`；
- 至少一个 TASK failed：`failed`；
- 否则存在 blocked/dependency_blocked：`blocked`。

独立分支会尽可能完成，只有依赖子图被阻止。

## 6. 隔离门禁

### 6.1 候选快照

候选由项目内所有 tracked 变化和非忽略 untracked 文件组成。每个文件记录：

- 项目相对路径；
- `file/symlink/deleted` 类型；
- 文件 mode；
- 内容 SHA-256。

总体 fingerprint 由稳定排序的结构化记录生成，不依赖暂存区状态或 diff 文本。

### 6.2 验证 worktree

门禁前创建 detached Git worktree：

1. 从当前 HEAD 检出基础树；
2. 把主工作区候选覆盖到验证项目根；
3. 链接 Manifest 显式声明的 `verification.sharedPaths`；
4. 确认隔离候选 fingerprint 与主候选一致；
5. 在隔离项目根运行全部门禁；
6. 捕获结果、scope 审计和门禁后候选；
7. 在 `finally` 中移除 worktree。

门禁无法直接改变主候选。

释放由独立 `VerificationWorktreeLease` 管理：优先执行 `git worktree remove --force`；失败后使用带重试的文件系统删除，再执行 `git worktree prune --expire now`。释放结果为 `released/deferred`，`deferred` 只作为事件诊断持久化，不能覆盖已经得到的门禁结论或阻止队列继续。

### 6.3 门禁结果

每次 GateRun 持久化：

- 序号和开始/结束时间；
- 前后 fingerprint；
- 每条命令的完整结构化结果；
- 变化文件；
- `passed/failed/mutated/boundary_violation`。

处理规则：

- `passed`：候选不变且全部命令成功，进入 Reviewer/commit；
- `failed`：候选不变但命令失败，进入 repair；
- `mutated`：变化全部在 scope 内，显式提升为新候选，进入 repair 并重新执行完整门禁；
- `boundary_violation`：不提升变化，TASK blocked。

提升不等于验收。任何提升后的候选都必须重新通过全部门禁和 Reviewer。

## 7. 阻塞候选归档

blocked/failed TASK 不能把脏工作区留给独立任务。

`GitWorkspace.quarantineCandidate` 使用临时 Git index：

1. 以 HEAD 初始化临时 index；
2. 将项目候选写入临时 tree；
3. 创建带父提交的归档 commit；
4. 写入 `refs/claude-task-orchestrator/quarantine/<hash>`；
5. 精确恢复项目 tracked 文件并删除候选 untracked 文件；
6. 断言整个仓库干净。

状态保存归档 ref、文件列表和时间。候选不会丢失，也不会污染后续独立 TASK。

## 8. Worker 与 Reviewer

写入 Worker 使用 Claude Code 完整工具预设和 `bypassPermissions`，加载 user/project/local 设置、全部可发现技能及已配置 MCP，可以自主使用终端和子 Agent。系统提示只保留工作流边界：聚焦当前 TASK，不启动浏览器，不 push 或部署。

文件工具调用仍经过 projectRoot、allow、deny、protectedPaths hook；终端产生的所有文件变化还会在进入门禁前由 `Workspace.auditChanges` 统一审计。越界候选不会进入门禁或提交，而是转为 blocked 并归档。这样“开发能力”与“候选准入”分层，不用削减 Agent 工具来实现 Git 安全。

Reviewer 是全新只读会话，只开放读取工具。它接收：

- SPEC、PLAN、项目策略与 TASK 正文；
- 最后一次通过门禁的结构化结果；
- 实际变化文件；
- 与 fingerprint 对应的 Git diff。

critical/high/medium finding 会触发 repair。

实现失败、门禁失败和审核发现默认无限循环到收敛。`maxAttempts`、`taskTimeoutMinutes/timeoutMinutes`、`maxTurns`、`maxBudgetUsd` 以及审核对应字段都是显式熔断选项；省略时 SDK 不接收这些限制，本地也不创建会话计时器。外部 `AbortSignal` 始终有效，确保用户仍可中断并恢复。

## 9. Git 提交与恢复

提交前必须同时满足：

- 当前 HEAD 等于状态中的 `expectedHead`；
- 项目外没有变化；
- scope 审计通过；
- 当前 fingerprint 等于门禁通过 fingerprint。

成功提交包含精确 trailer：

- `Orchestrator-Run`
- `Orchestrator-Task`
- `Orchestrator-Candidate`

每个 TASK 提交后更新 `expectedHead`。恢复时仅允许当前 HEAD 等于 expectedHead，或精确匹配“提交完成但状态尚未落盘”的唯一崩溃窗口。

## 10. 持久化与中断

状态目录位于 Git common directory：

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

以下时刻保存 checkpoint：

- Run 创建和恢复；
- TASK 每次状态推进；
- SDK session init；
- GateRun 完成；
- 候选归档；
- 依赖阻塞传播；
- Run 终态。

一次 `Ctrl+C`/`SIGTERM` 中止当前 Agent 或门禁进程树并保留 `running` 状态；下次使用 `resume`。第二次中断立即退出。

## 11. 安全不变量

1. 新运行前整个 Git 仓库必须干净。
2. Manifest、上下文和全部 TASK 都是受保护文件。
3. 候选进入门禁和提交前必须满足 allow，且不能命中 deny/protected。
4. 门禁不在主候选上执行。
5. 门禁产生的新候选必须完整重验。
6. Reviewer 只能读取。
7. 提交只包含当前项目候选。
8. 阻塞候选先归档再释放其他 DAG 分支。
9. Worker 工作流明确禁止 push、merge、rebase、reset 分支历史、部署或启动浏览器。
10. 编排器门禁进程参数保持结构化，不通过 shell 拼接。

## 12. 测试证据

测试分为：

- 任务目录与 Manifest 严格解析；
- DAG 合法性和稳定顺序；
- TASK/Run 状态转换；
- 隔离 worktree、副作用提升和释放；
- worktree 释放延后时保留门禁结论并继续后续 TASK；
- 默认超过三轮仍持续 repair，以及显式资源上限透传；
- 终态候选 Git ref 归档与主工作区清理；
- blocked 分支隔离、依赖阻塞和独立分支继续；
- 门禁进程、SDK 工具边界、持久化和锁；
- 原子提交 trailer 和崩溃恢复。

标准验证命令：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
