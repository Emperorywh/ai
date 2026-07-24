---
id: TASK-011
title: 建立工作区保全与逐路径恢复协议
---

## 任务描述

### 可验证结果

等待输入、暂停和终态候选能够在可信 Git 基线上按确定性 archive/manifest/CAS 协议清理与恢复；任一路径、index 或基线出现第三值时，本次操作零新增写入并进入 workspace conflict。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.3、8.5～8.6、9.3、9.6～9.7、10.3、13、14.1、19、20.5 节。
- TASK-005 的 CandidateCapture/Manifest 和完整候选身份。
- TASK-006 的 process lease 与 suspension quiescence。
- TASK-010 的 request/Pause/resume stage。
- 当前 quarantine 只按 runId/taskId、恢复以 Git restore/索引归一化处理的现状。

### 输出

- 完整 GitWorkspaceIdentity、ActiveWorkspaceCheckpoint 和 durable workspace reservation 契约。
- WorkspacePreservationIntent、稳定 archiveId 和 awaiting/paused/blocked/failed purpose 生命周期。
- WorkspaceMutationManifest 的路径 from/to、index snapshot 和全量 preflight + 逐路径/index CAS。
- verification/reviewer/manual workspace lease 的 allocating/ready/releasing/released 恢复规则。
- restore→refreeze→checkpoint→consume 顺序与 workspace_conflict/reconcile 区分。
- 部分 clean/restore、第三值、崩溃重入和 Git 零写入自动化测试及 ADR。

### 实现约束

- GitWorkspaceIdentity 覆盖 HEAD、完整 index entries/stages/modes/blob IDs 及 worktree tracked/untracked/deleted/mode/content。
- `workspace_conflict` 必须 in_place，禁止 archive/clean/restore/checkout/reset/stash/ref/object/index 写。
- 多文件 mutation 前先 checkpoint manifest；全量 preflight 全部通过后才逐路径 CAS。
- preparing/archived/cleaning 状态恢复必须完成或安全回滚，不能提前暴露 pending request。
- archiveId 每次 preservation 唯一；旧引用在 stable identity checkpoint 后才消费。
- ready manual workspace 必须同 candidate；tracked/untracked/deleted 漂移使批准无效。
- lease 只按已记录绝对路径回收，禁止扫描宽泛临时目录猜测删除。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：可信基线上完成 prepare→archive→clean→pending 与 restore→refreeze→checkpoint→consume，并验证幂等重入。
3. 正常路径：验证 allocating/ready/releasing lease 在各崩溃窗口按记录路径恢复。
4. 异常路径：分别制造 HEAD、index、tracked/untracked/deleted/mode/content 漂移与 manifest 第三值，断言本次零新增 Git/文件写并转 workspace_conflict。
5. 恢复路径：覆盖部分路径已 clean/restore、index 已切换、answered request 遇冲突和 active process 未停止，验证不覆盖用户修改。

### 完成标准

- workspace identity、preservation、mutation CAS、reservation 和 lease 恢复均可执行验证。
- 全部自动化验证通过，request、CandidateIdentity 和 quiescence 规则保持一致。
- 不存在 HEAD-only 授权、宽泛目录清理、确定性 archiveId 复用、第三值覆盖或 workspace_conflict Git 写。
- 领域状态、应用恢复计划、Git provider、文件 mutation 和 lease 管理职责分离。
- 可创建独立 Git checkpoint，并为 commit transaction 与 v7 聚合提供完整 workspace 事实。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 v7 workspace preservation/lease/CAS 协议及测试，不改变当前 v6 quarantine 实现或前置交互/候选合同。
