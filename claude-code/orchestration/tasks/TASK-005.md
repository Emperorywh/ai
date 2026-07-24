---
id: TASK-005
title: 形成可重建的候选内容身份
---

## 任务描述

### 可验证结果

任一冻结候选都具有可读取的规范 manifest、稳定 CandidateIdentity 和 projected tree；系统可从 baseline tree 与内容 artifact 确定性重建同一候选，而不是只保存不可逆摘要。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.3、8.5、9.3、10.3、14.2、20.3、20.5 和 21 阶段 0 第 2 项。
- TASK-001 的规范编码与路径规则。
- TASK-004 的不可变内容寻址存储。
- 当前候选指纹已覆盖 tracked、untracked、deleted、模式和内容哈希，但没有规范 manifest/projected tree。

### 输出

- CandidateManifest、CandidateIdentity、CandidateCapture 的 strict 契约和相等性规则。
- 捕获新增、修改、删除、可执行位、符号链接及其内容 artifact 的能力。
- 使用产品私有临时 index 从 expected baseline 物化 projected tree，并反向校验 manifest、fingerprint 和 tree OID。
- DraftFingerprint 与可进入 Verification/Review/Acceptance/Commit 的正式身份边界。
- 临时 Git 仓库 conformance tests，覆盖空候选及 SHA-1/SHA-256 对象格式。
- 说明候选、manifest 与 Git 对象唯一数据流的必要 ADR。

### 实现约束

- CandidateIdentity 只包含 scope、baseline tree OID、manifest 规范 SHA-256 和 projected tree OID；时间与 expected HEAD 不参与内容相等性。
- CandidateManifest 是重建候选的唯一规范输入，条目按经校验的仓库相对 POSIX 路径字节序排列。
- 文件与符号链接内容先进入 artifact store；manifest 只引用可重算 hash。
- tree OID 使用仓库当前对象格式的完整值，禁止截断或混用算法。
- 临时 index 与 Git 对象操作封装在 Git 基础设施，领域/应用不执行 Git 命令。
- 指纹、tree 或内容 artifact 任一不一致都拒绝冻结；不得从摘要猜测文件内容。
- 保留现有 Git 锁、项目边界和 candidate_pending 崩溃边界。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：在临时 Git 仓库覆盖新增、修改、删除、可执行位、符号链接和空候选，验证 manifest 重建同一 projected tree。
3. 正常路径：在可用的 SHA-1/SHA-256 仓库验证完整 OID、fingerprint 和重建结果。
4. 异常路径：篡改 manifest、内容 artifact、路径顺序、文件模式、baseline 或 projected tree，验证冻结失败。
5. 恢复路径：验证 capturedAt/expectedHead 变化不影响身份，内容变化则产生新身份。

### 完成标准

- 每个正式 CandidateIdentity 都能读取 manifest、重算 fingerprint 并从 baseline 重建 tree。
- 全部自动化验证通过，现有候选覆盖和 Git 项目边界保持或增强。
- 不存在仅摘要候选、从工作树临时猜测提交内容或多套候选相等性。
- Git 基础设施、应用协调和领域身份边界清晰。
- 可创建独立 Git checkpoint，并为会话与证据模型提供统一候选身份。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 manifest 驱动的候选身份/物化能力，不移除 artifact store，也不破坏当前 v6 指纹、隔离或提交。
