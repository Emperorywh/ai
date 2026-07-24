/*
 * 附件摘要契约：二进制和文本附件都按保存后的原始字节计算 SHA-256，
 * 同时记录规范媒体类型与字节长度，禁止任何隐式换行或文本归一化。
 */
import { z } from "zod";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import {
  canonicalSha256DigestSchema,
  defineCanonicalSchema,
  type CanonicalValue,
} from "./canonical-schema.js";
import { CanonicalViolationError } from "./errors.js";

/*
 * 媒体类型只允许小写 type/subtype 规范形式（RFC 2045 token），不记录参数。
 * 附件身份由原始字节决定，字符集等参数不参与内容相等性。
 */
const ATTACHMENT_MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

export const attachmentDigestSchema = defineCanonicalSchema(1, {
  mediaType: z.string().regex(ATTACHMENT_MEDIA_TYPE_PATTERN),
  byteLength: z.number().int().nonnegative(),
  contentHash: canonicalSha256DigestSchema,
});
export type AttachmentDigest = CanonicalValue<typeof attachmentDigestSchema>;

export function createAttachmentDigest(
  input: {
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  },
  canonicalHash: CanonicalHashService,
): AttachmentDigest {
  const digest: AttachmentDigest = {
    schemaVersion: attachmentDigestSchema.schemaVersion,
    mediaType: input.mediaType,
    byteLength: input.bytes.byteLength,
    contentHash: canonicalHash.digestBytes(input.bytes),
  };
  const validated = attachmentDigestSchema.schema.safeParse(digest);
  if (!validated.success) {
    throw new CanonicalViolationError(
      `附件摘要不符合契约：${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("；")}`,
    );
  }
  return validated.data;
}
