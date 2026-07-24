---
id: TASK-004
title: 建立不可变内容寻址证据存储
---

## 任务描述

### 可验证结果

系统能够把协议正文、命令输出、人工附件和结构化 manifest 作为不可变内容寻址 artifact 原子保存，并在状态引用前证明内容已持久化且可按摘要重读。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.2、8.4、10.2、14.4、17.1、17.2 和 20.5 节。
- TASK-001 的规范编码与附件哈希。
- TASK-002/003 的合同 projection、合同身份和宿主策略摘要。
- 当前状态存储只支持按名称写展示产物，没有内容寻址证据根。

### 输出

- repository/project scoped 的内容寻址 artifact 写入、读取、存在性和完整性校验能力。
- 结构化对象、原始附件、大输出和 deterministic receipt 的统一不可变存储契约。
- `fsync + atomic rename` 写入语义，以及“artifact 先落盘、状态后引用”的应用边界。
- 同 hash 重复写入的逐字节幂等校验与碰撞/内容不一致拒绝。
- 安全项目命名空间、错误分类、自动化测试和必要架构文档；GC 删除留给后续 TASK。

### 实现约束

- ArtifactStore 是不可变事实存储，不得成为第二个可变 Run 状态源。
- 结构化 artifact 必须使用 TASK-001 的唯一规范编码；附件按原始字节保存。
- RunState 不得引用尚未持久化或重算不匹配的 artifact。
- deterministic receipt 只能按稳定协议对象定位，不得扫描宽泛目录并自动接纳孤立结果。
- 存储位于产品状态目录，不写项目工作树，不默认随 clone 传播，也不静默联网补取。
- 文件系统实现留在基础设施，领域/应用只依赖 hash/ref 和最小端口。
- 本 TASK 不删除 artifact，不实现宽泛目录清理。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：写入结构化 artifact、文本和二进制附件，验证重复 put 幂等、读取字节相同、摘要与元数据可重算。
3. 正常路径：验证状态引用只能指向已经持久化且 strict 校验通过的内容。
4. 异常路径：模拟原子替换前崩溃、截断文件、同 hash 不同内容、非法 namespace 和路径越界，验证不会产生可接受引用。
5. 异常路径：验证孤立 receipt/artifact 不会被目录扫描提升为当前业务事实。

### 完成标准

- 内容寻址写入、读取、完整性校验和原子落盘语义均可自动复现。
- 全部自动化验证通过，前置哈希与合同校验未被破坏。
- 不存在可变交互数据库、普通路径冒充证据、静默联网 fallback 或宽泛删除逻辑。
- 存储端口职责单一，分层依赖方向清晰。
- 可创建独立 Git checkpoint，并为候选 manifest 提供可靠 artifact 基础。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除内容寻址 artifact 能力及其测试/文档，不回退规范哈希、项目合同或当前状态文件存储。
