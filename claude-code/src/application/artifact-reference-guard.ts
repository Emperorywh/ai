/*
 * ArtifactReferenceGuard 是“artifact 先落盘、状态后引用”的应用边界（SupervisedExecutionLoopSpec 5.2/17.1）。
 * RunState 只允许引用两类已证明事实：
 *   1. put 返回后仍通过 verify 重算校验的 ArtifactRef；
 *   2. 按稳定协议键读取、且重算引用与状态中记录值完全一致的 deterministic receipt。
 * 任何未持久化、截断、腐化或与记录不符的引用都在此 fail closed，不会进入 checkpoint。
 */
import {
  artifactRefSchema,
  type ArtifactReceiptKey,
  type ArtifactRef,
} from "../domain/artifact-ref.js";
import {
  ArtifactIntegrityError,
  CanonicalViolationError,
} from "../domain/errors.js";
import type { CanonicalSchema } from "../domain/canonical-schema.js";
import type { ArtifactStore } from "../ports/artifact-store.js";

export class ArtifactReferenceGuard {
  public constructor(private readonly store: ArtifactStore) {}

  /* 状态引用前的唯一放行证明：内容已持久化且逐字节重算匹配。 */
  public async requireReadable(ref: ArtifactRef): Promise<void> {
    await this.store.verify(ref);
  }

  /*
   * receipt 恢复只接受协议推导的精确键，并强制重算引用与状态记录逐字段一致；
   * 孤立 receipt 因为键不可由当前协议身份推导，永远不会走到这里。
   */
  public async requireReceipt<T>(
    key: ArtifactReceiptKey,
    schema: CanonicalSchema<T>,
    expected: ArtifactRef,
  ): Promise<T> {
    const parsed = artifactRefSchema.schema.safeParse(expected);
    if (!parsed.success) {
      throw new CanonicalViolationError(
        `非法 receipt 状态记录引用：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("；")}`,
      );
    }
    const expectedRef = parsed.data;
    const receipt = await this.store.readReceipt(key, schema);
    if (
      receipt.ref.contentHash !== expectedRef.contentHash
      || receipt.ref.byteLength !== expectedRef.byteLength
      || receipt.ref.mediaType !== expectedRef.mediaType
    ) {
      throw new ArtifactIntegrityError(
        `receipt 与状态记录不符：${key.namespace}/${key.key} 重算为 ${receipt.ref.contentHash}，状态记录为 ${expectedRef.contentHash}`,
      );
    }
    return receipt.value;
  }
}
