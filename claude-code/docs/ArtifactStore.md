# 内容寻址证据存储

本文是 TASK-004 的架构契约：不可变证据只有一个存储端口、一种引用形态、一条落盘路径和一套显式错误分类。实施规格见 `SupervisedExecutionLoopSpec.md` 第 5.2、8.4、10.2、14.4、17.1、17.2 与 20.5 节。

## 1. 端口与分层

`ports/artifact-store.ts` 的 `ArtifactStore` 是证据存储的唯一端口；`infrastructure/persistence/file-artifact-store.ts` 的 `FileArtifactStore` 是唯一生产实现，由组合根装配在产品状态目录下的 `artifacts/` 子根（Git common dir 内的项目作用域，与状态快照同级但相互隔离）。

分层规则：

- 领域层只定义引用契约（`domain/artifact-ref.ts` 的 `ArtifactRef`、`ArtifactReceiptKey`、namespace/键白名单）和错误分类（`domain/errors.ts`）；
- 应用层只依赖 `ArtifactRef`/receipt 键和 `ArtifactStore` 端口，不接触文件系统类型；
- 文件系统、路径解析和原子写原语全部留在基础设施实现。

存储位于产品状态目录：不写入项目工作树、不默认随 `git clone` 传播、本机找不到时没有任何静默联网补取的 fallback。未来如需远程 CAS，必须作为另一个显式 `ArtifactStore` 实现并把 store identity 写入 Run contract。

## 2. 引用形态

`ArtifactRef` 与 TASK-001 的附件摘要共享同一 strict Schema（`{schemaVersion, mediaType, byteLength, contentHash}`）：引用身份完全由保存后原始字节决定，不含路径、时间戳或任何可变元数据。结构化 artifact 的 `contentHash` 恒等于 `CanonicalHashService.digestStructured`（见 `CanonicalHashing.md`），因为存储写入的字节就来自同一规范管道 `encodeStructured`；附件与大输出按原始字节保存，禁止隐式换行或文本归一化。

## 3. 磁盘布局与落盘语义

```text
<产品状态目录>/artifacts/
  objects/<sha256-hex>            # 内容寻址对象：结构化 artifact、附件、大输出
  receipts/<namespace>/<key>      # deterministic receipt：稳定协议键定位的结构化事实
  .tmp-<pid>-<n>                  # 写入中途的临时文件（仅存在于对应父目录）
```

写入路径固定为：

1. 计算内容摘要；目标路径已存在时逐字节比对：相同则幂等返回，不同则失败（见错误分类），绝不覆盖；
2. 不存在时写同目录 `.tmp-` 临时文件，`fsync` 后 atomic rename 到目标路径；
3. rename 后重读目标并逐字节比对，兜底并发写同一身份的窗口，保证至少一方收到冲突而非静默成功；
4. 最后尽力同步父目录目录项；Windows 不允许用户态目录 `fsync`，仅在该平台明确拒绝（`EPERM` 等）时跳过，文件本身已在 rename 前 `fsync`。

崩溃只能留下 `.tmp-` 孤儿临时文件：它们不匹配任何对象名或合法 receipt 键，存在性检查、读取和后续写入都视其为不存在，清理留给后续 GC TASK。

## 4. 幂等与冲突规则

- 同 hash 重复写入：逐字节校验一致后幂等返回同一引用，磁盘只保留一个对象；
- 同 hash 不同内容：先按路径名重算已落盘字节——重算与路径摘要不符为内容损坏，相符但与新字节不同为 hash 碰撞，两者都以 `ArtifactIntegrityError` fail closed，不做自动修复；
- deterministic receipt：同键同内容幂等成功，同键不同内容以 `ArtifactConflictError`（协议冲突）拒绝，原内容保持可读。

## 5. deterministic receipt 定位规则

receipt 只按 `{namespace, key}` 定位：namespace 是协议域白名单名（如 `worker-turn-report`），key 是宿主从当前协议身份推导的确定性 ID（如 `reportId = SHA-256(runId‖scopeId‖sessionId‖turnId‖"report:1")`）。端口不存在任何枚举、扫描或按前缀匹配 receipt 的方法；恢复流程只能读取当前协议对象推导出的精确键。磁盘上内容合法但键不可推导的孤立 receipt 永远不会被接纳为业务事实。

## 6. “artifact 先落盘、状态后引用”边界

`application/artifact-reference-guard.ts` 的 `ArtifactReferenceGuard` 是状态引用前的唯一放行证明：

- `requireReadable(ref)`：内容已持久化且逐字节重算匹配（长度 + SHA-256）；
- `requireReceipt(key, schema, expected)`：按精确协议键读取 receipt，重算引用与状态中记录的 `ArtifactRef` 逐字段一致，并以 strict Schema 返回解析值。

`has`/`hasReceipt` 只表达存在性，绝不表达可接受性；调用方不得凭存在性把引用写入 RunState。ArtifactStore 是不可变事实存储，不持有任何可变状态，因而不可能成为第二个 Run 状态源；可变交互状态的唯一归宿仍是 `RunCheckpointWriter`。

## 7. 错误分类

| 错误 | 语义 |
| --- | --- |
| `CanonicalViolationError` | 引用形状非法（摘要格式、长度、媒体类型违反 strict Schema） |
| `ArtifactNamespaceError` | namespace、receipt 键非法或解析路径越出存储根 |
| `ArtifactNotFoundError` | 引用或 receipt 键对应的内容尚未持久化 |
| `ArtifactIntegrityError` | 已落盘字节长度/摘要重算不匹配、同 hash 不同内容、结构化字节不符合 UTF-8 JSON 或 strict Schema |
| `ArtifactConflictError` | 同一 receipt 键写入不同内容（协议冲突） |
| `InfrastructureError` | 文件系统本身的读写失败 |

## 8. 显式不做的事

- 不删除 artifact、不实现 GC 或宽泛目录清理（保留与可达性由后续 TASK 以显式 `ArtifactReachabilityScanner` 引入）；
- 不提供可变更新、追加或覆盖原语；
- 不把展示产物（如终态 Markdown）当作证据，本存储只保存内容寻址的不可变事实；
- 不联网、不迁移旧产物、不兼容第二套寻址或编码入口。
