---
id: TASK-017
title: 证明完成证据可达且可安全保留
---

## 任务描述

### 可验证结果

CompletionEvidenceBundle 能从 RunState、当前 HEAD 有效 v7 certificate chain、archive、workspace lease 和 deterministic receipt 建立完整可达图；GC 不删除任何可达证据，证据缺失后的旧提交安全拒绝复用。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 14.2～14.4、17.1.1、17.4、19、20.5、20.6 和 21 阶段 0 第 6 项。
- TASK-004 的 immutable artifact store。
- TASK-005 的 CandidateManifest。
- TASK-009 的 TASK/Integration certificate、matrix 和 bundle manifest。
- TASK-010/011 的 request/archive/lease/receipt 引用。
- TASK-013 的 artifact roots/finalization 状态。

### 输出

- 从全部可解析 RunState、final manifest、当前 HEAD 有效 certificate chain、archive refs、active leases/receipts 重建 mark set。
- bundle 根递归读取、strict 校验、规范 hash 重算和缺失子 artifact 拒绝。
- 仅删除超过 grace period、无 active receipt、扫描期间仍不在 mark set 的 orphan 的 GC 规则。
- 新 clone、状态目录丢失、项目移动或 evidence prune 后拒绝复用旧完成提交。
- 破坏性 prune 的影响清单/明确确认契约，以及 finalization manifest 幂等恢复证明。
- artifact 生命周期阶段 0 ADR。

### 实现约束

- reachability index 只作可重建缓存，不得成为完成状态第二事实源。
- 默认不删除 HEAD 可达证书、非终态 Run、completed final manifest、active archive/receipt/lease artifacts。
- GC 只在精确项目 namespace 和 GC lock 内运行，禁止扫描父目录或按文件名猜资产。
- certificate 存在但任一 bundle 子 artifact 缺失等同证据不完整。
- Git trailer hash 只作完整性绑定，不表示 artifact 随 clone 传播。
- finalization 展示文件只是 manifest 投影，不能反向成为事实源；恢复不重跑业务。
- 不提供本机缺失后静默联网 fallback。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：构造完整 TASK/Integration bundle，验证所有 roots 重建同一 mark set。
3. 正常路径：orphan 只有不在 mark set、无 receipt、超过 grace 且持 GC lock 时才删除。
4. 异常路径：逐项删除/篡改子 artifact、certificate chain、archive/lease/receipt，验证拒绝复用且其他可达对象不被删。
5. 恢复路径：模拟 final artifact 已写未 manifest、manifest 已写未 completed，验证幂等补齐而不重跑业务。

### 完成标准

- artifact reachability、bundle integrity、GC retention 和 missing-evidence refusal 均有可执行证明。
- 全部自动化验证通过，hash、CandidateManifest、certificate、RunState 和 active refs 一致。
- 没有 trailer-only reuse、reachability 第二状态源、宽泛删除、静默远程 fallback 或展示文件反向导入。
- artifact store、scanner、certificate validator、Git history 与 finalizer 职责分离。
- 可创建独立 Git checkpoint；完成所有不依赖实际宿主 Sandbox/平台选择的阶段 0 结果。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 evidence reachability、GC/finalization conformance 和 ADR，不删除此前 artifact、candidate、certificate 或 v7 状态契约。
