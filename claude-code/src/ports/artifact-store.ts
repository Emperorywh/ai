/*
 * ArtifactStore 是不可变内容寻址证据存储的唯一端口（SupervisedExecutionLoopSpec 第 17.1 节）。
 * 它只承诺四件事：写入已 fsync 并原子落盘、读取逐字节重算校验、同 hash 重复写入幂等、
 * 同 hash/同 receipt 键不同内容 fail closed。
 *
 * 端口刻意不提供任何枚举、扫描、删除或覆盖能力：
 * 不存在“扫描宽泛目录并自动接纳孤立结果”的通道，GC 与可达性由后续 TASK 以显式实现引入。
 * 领域与应用层只依赖 ArtifactRef/receipt 键与本端口，不依赖文件系统类型。
 */
import type {
  ArtifactReceiptKey,
  ArtifactRef,
} from "../domain/artifact-ref.js";
import type { CanonicalSchema } from "../domain/canonical-schema.js";

export interface ArtifactBytesInput {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ArtifactReceipt<T> {
  readonly ref: ArtifactRef;
  readonly value: T;
}

export interface ArtifactStore {
  /*
   * 结构化对象必须经 CanonicalHashService 的唯一规范管道编码后落盘，
   * 因此 digestBytes(读回字节) 与 digestStructured(原对象) 恒等于返回引用的 contentHash。
   */
  putStructured<T>(
    schema: CanonicalSchema<T>,
    value: unknown,
  ): Promise<ArtifactRef>;

  /* 附件与大输出按原始字节保存，不做任何隐式换行或文本归一化。 */
  putBytes(input: ArtifactBytesInput): Promise<ArtifactRef>;

  /*
   * 读取即完整性校验：字节长度或 SHA-256 重算不匹配时拒绝返回内容。
   * has 只表达存在性，绝不表达可接受性；状态引用前必须经过 read/verify 级别的证明。
   */
  read(ref: ArtifactRef): Promise<Uint8Array>;
  readStructured<T>(
    schema: CanonicalSchema<T>,
    ref: ArtifactRef,
  ): Promise<T>;
  has(ref: ArtifactRef): Promise<boolean>;
  verify(ref: ArtifactRef): Promise<void>;

  /*
   * deterministic receipt 是以稳定协议键定位的不可变结构化事实：
   * 同键同内容重试幂等成功，同键不同内容以 ArtifactConflictError 拒绝。
   * 恢复方只能按协议推导出的精确键读取，端口不存在列举 receipt 的方法。
   */
  putStructuredReceipt<T>(
    key: ArtifactReceiptKey,
    schema: CanonicalSchema<T>,
    value: unknown,
  ): Promise<ArtifactRef>;
  readReceipt<T>(
    key: ArtifactReceiptKey,
    schema: CanonicalSchema<T>,
  ): Promise<ArtifactReceipt<T>>;
  hasReceipt(key: ArtifactReceiptKey): Promise<boolean>;
}
