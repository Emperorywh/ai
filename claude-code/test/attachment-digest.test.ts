/*
 * 附件摘要契约测试锁定原始字节语义：
 * 二进制和文本附件都按保存后的原始字节计算摘要，禁止隐式换行或文本归一化。
 */
import { describe, expect, it } from "vitest";
import {
  attachmentDigestSchema,
  createAttachmentDigest,
} from "../src/domain/attachment-digest.js";
import { CanonicalViolationError } from "../src/domain/errors.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

const canonicalHash = new NodeCanonicalHashService();

describe("createAttachmentDigest", () => {
  it("按原始字节计算摘要、长度和媒体类型", () => {
    const bytes = new TextEncoder().encode("abc");
    const digest = createAttachmentDigest(
      { mediaType: "text/plain", bytes },
      canonicalHash,
    );

    expect(digest).toEqual({
      schemaVersion: 1,
      mediaType: "text/plain",
      byteLength: 3,
      contentHash:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("文本附件不做隐式 CRLF 归一化", () => {
    const crlf = createAttachmentDigest(
      { mediaType: "text/plain", bytes: new TextEncoder().encode("a\r\nb") },
      canonicalHash,
    );
    const lf = createAttachmentDigest(
      { mediaType: "text/plain", bytes: new TextEncoder().encode("a\nb") },
      canonicalHash,
    );

    expect(crlf.contentHash).not.toBe(lf.contentHash);
    expect(crlf.byteLength).toBe(4);
    expect(lf.byteLength).toBe(3);
  });

  it("二进制附件字节逐位参与摘要", () => {
    const base = createAttachmentDigest(
      { mediaType: "application/octet-stream", bytes: new Uint8Array([0, 1, 2]) },
      canonicalHash,
    );
    const changed = createAttachmentDigest(
      { mediaType: "application/octet-stream", bytes: new Uint8Array([0, 1, 3]) },
      canonicalHash,
    );

    expect(changed.contentHash).not.toBe(base.contentHash);
    expect(changed.byteLength).toBe(3);
  });

  it("拒绝非规范媒体类型", () => {
    const bytes = new Uint8Array(0);

    for (const mediaType of [
      "",
      "text",
      "TEXT/PLAIN",
      "text/",
      "/plain",
      "text /plain",
      "text/plain; charset=utf-8",
    ]) {
      expect(() =>
        createAttachmentDigest({ mediaType, bytes }, canonicalHash)
      ).toThrow(CanonicalViolationError);
    }
  });

  it("附件摘要自身可作为规范对象签发摘要，未知字段被拒绝", () => {
    const digest = createAttachmentDigest(
      { mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
      canonicalHash,
    );
    const manifestHash = canonicalHash.digestStructured(
      attachmentDigestSchema,
      digest,
    );

    expect(manifestHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(() =>
      canonicalHash.digestStructured(attachmentDigestSchema, {
        ...digest,
        extra: true,
      })
    ).toThrow(CanonicalViolationError);
  });
});
