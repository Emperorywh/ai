---
id: TASK-012
title: 建立分阶段原子提交与恢复契约
---

## 任务描述

### 可验证结果

TASK/Integration 提交能够以判别明确的 transaction phase 表达 tree、commit object、ref CAS 和主 index CAS；每个崩溃窗口可先只读识别精确提交事实，再在完整写前 guard 下幂等推进。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.3、14.2～14.3、19、20.5 和 21 节。
- TASK-005 的 CandidateCapture/Manifest/projected tree。
- TASK-009 的 completion certificate/evidence bundle。
- TASK-011 的 GitWorkspaceIdentity、workspace conflict 和 CAS 规则。
- 当前提交阶段使用旧 `git add`→`git commit` 两步实现的现状。

### 输出

- preparing/tree_ready/commit_object_ready/ref_updated/index_normalized/completed 的 commit transaction 判别联合。
- 冻结 commit envelope、临时 index identity、pre-commit workspace 和 target index fingerprint。
- 只读 recovery inspection、合法 endpoint 与 exact commit workspace conflict 分类。
- 从 CandidateManifest 构建 tree、commit-tree、target ref CAS 和主 index CAS 的原子协议。
- TASK/Integration trailer 与 certificate/bundle/manifest hash 绑定及精确 commit recovery。
- 每个提交崩溃窗口、外部 ref/index/worktree 竞争和主 index 无 staging 中间态的测试/ADR。

### 实现约束

- phase 必需事实由判别联合编码，禁止依靠可选字段猜测状态。
- inspect 严格只读，不授予写权限；每次 advance 都重新采集 symbolic HEAD、target ref、HEAD、index、worktree 和 candidate guard。
- tree/object 只使用产品私有临时 index 与已校验 CandidateManifest/content artifact，不能临时读取变化中的主工作树猜候选。
- target ref 与主 index 分别执行 CAS；外部第三值、分支切换或 worktree 漂移时零 Git 写。
- 主 index 在 ref 前进前保持原状，任何时刻不得暴露“产品已暂存但未提交”。
- 提交结果不确定先 recovery，不能重跑 Worker/Verification/Reviewer。
- 旧 trailer、缺 artifact 或非连续 v7 parent chain 不得复用。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：在临时 Git 仓库按所有 phase 推进提交，验证 commit tree、parent、trailers、certificate 和主 index/worktree 一致。
3. 恢复路径：覆盖临时 index/tree/object/ref/index checkpoint 前后崩溃，验证只读识别后幂等完成且不重复提交。
4. 冲突路径：在 object 前、ref CAS 前和 ref 后分别切换 symbolic HEAD、推进 ref、修改 worktree/index，断言零覆盖并转 workspace conflict。
5. 安全路径：记录主 index 字节/语义，验证 ref 前无 staging 中间态，index CAS 对原值/目标值幂等，对第三值零写入。

### 完成标准

- commit transaction、endpoint、guard、CAS 和 recovery 契约均有可执行证明。
- 全部自动化验证通过，CandidateManifest、certificate、workspace identity 和 evidence bundle 完整绑定。
- 不存在主 index `git add`→commit 路径、隐式 phase、非 CAS ref/index 覆盖或不确定提交重跑业务。
- 证书校验、应用事务协调与 Git object/ref/index 基础设施职责清晰。
- 可创建独立 Git checkpoint，并为完整 RunState 聚合提供提交恢复状态。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 v7 transaction/recovery 契约和 conformance，不回退前置候选、证书、workspace 协议，也不改变当前 v6 提交实现。
