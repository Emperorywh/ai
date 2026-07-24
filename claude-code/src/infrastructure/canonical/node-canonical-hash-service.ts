/*
 * NodeCanonicalHashService 是 CanonicalHashService 的唯一生产实现。
 * 管道固定为：版本化 strict Schema 校验 → 字段保留守卫 → JCS 规范编码 → UTF-8（无 BOM）→ SHA-256 小写十六进制。
 * 摘要算法不存在备选实现或旧算法 fallback；协议变更只能通过 schemaVersion 显式升级。
 */
import { createHash } from "node:crypto";
import {
  encodeCanonicalJson,
  encodeCanonicalUtf8,
} from "../../domain/canonical-json.js";
import {
  assertSchemaPreservesValue,
  type CanonicalSchema,
} from "../../domain/canonical-schema.js";
import { CanonicalViolationError } from "../../domain/errors.js";
import type { CanonicalHashService } from "../../ports/canonical-hash.js";

export class NodeCanonicalHashService implements CanonicalHashService {
  public digestStructured<T>(
    schema: CanonicalSchema<T>,
    value: unknown,
  ): string {
    const parsed = schema.schema.safeParse(value);
    if (!parsed.success) {
      throw new CanonicalViolationError(
        `规范 Schema 校验失败：${describeIssues(parsed.error.issues)}`,
      );
    }
    assertSchemaPreservesValue(value, parsed.data);
    return this.digestBytes(encodeCanonicalUtf8(encodeCanonicalJson(parsed.data)));
  }

  public digestBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }
}

function describeIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("；");
}
