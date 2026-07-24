/*
 * 规范哈希服务测试锁定唯一入口的管道语义：
 * 版本化 strict Schema → 字段保留守卫 → JCS → UTF-8 → SHA-256 小写十六进制。
 * 调用方不能绕过 Schema 对任意对象签发摘要，也不存在删字段后继续的通道。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCanonicalSchema } from "../src/domain/canonical-schema.js";
import { CanonicalViolationError } from "../src/domain/errors.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

const demoSchema = defineCanonicalSchema(1, {
  a: z.number(),
  b: z.string(),
});

describe("NodeCanonicalHashService.digestStructured", () => {
  it("与手工 JCS + SHA-256 重算结果一致", () => {
    const digest = new NodeCanonicalHashService().digestStructured(demoSchema, {
      schemaVersion: 1,
      a: 1,
      b: "x",
    });
    const expected = createHash("sha256")
      .update('{"a":1,"b":"x","schemaVersion":1}', "utf8")
      .digest("hex");

    expect(digest).toBe(expected);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("相同对象重复摘要逐字节相同，键声明顺序不影响结果", () => {
    const service = new NodeCanonicalHashService();
    const first = service.digestStructured(demoSchema, {
      schemaVersion: 1,
      a: 1,
      b: "x",
    });
    const second = service.digestStructured(demoSchema, {
      b: "x",
      schemaVersion: 1,
      a: 1,
    });

    expect(second).toBe(first);
  });

  it("任一结构化字段的有效变化都会改变摘要", () => {
    const service = new NodeCanonicalHashService();
    const base = service.digestStructured(demoSchema, {
      schemaVersion: 1,
      a: 1,
      b: "x",
    });

    expect(
      service.digestStructured(demoSchema, { schemaVersion: 1, a: 2, b: "x" }),
    ).not.toBe(base);
    expect(
      service.digestStructured(demoSchema, { schemaVersion: 1, a: 1, b: "y" }),
    ).not.toBe(base);
  });

  it("拒绝未知字段、缺失字段、错误类型和版本漂移", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      service.digestStructured(demoSchema, {
        schemaVersion: 1,
        a: 1,
        b: "x",
        extra: true,
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(demoSchema, { schemaVersion: 1, a: 1 })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(demoSchema, {
        schemaVersion: 1,
        a: "1",
        b: "x",
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(demoSchema, {
        schemaVersion: 2,
        a: 1,
        b: "x",
      })
    ).toThrow(CanonicalViolationError);
  });

  it("拒绝非有限数字和非法 Unicode，不允许清洗后继续", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      service.digestStructured(demoSchema, {
        schemaVersion: 1,
        a: Number.POSITIVE_INFINITY,
        b: "x",
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(demoSchema, {
        schemaVersion: 1,
        a: 1,
        b: `x${String.fromCharCode(0xd800)}`,
      })
    ).toThrow(CanonicalViolationError);
  });

  /*
   * 即使调用方伪造一个非 strict 的 Schema 包装，字段保留守卫也会拒绝
   * “Schema 吞掉未知字段后继续哈希”的绕过路径。
   */
  it("拒绝会静默丢弃字段的非 strict Schema", () => {
    const service = new NodeCanonicalHashService();
    const forged = {
      schemaVersion: 1,
      schema: z.object({ a: z.number() }),
    } as unknown as Parameters<NodeCanonicalHashService["digestStructured"]>[0];

    expect(() =>
      service.digestStructured(forged, { schemaVersion: 1, a: 1, extra: "x" })
    ).toThrow("静默丢弃了字段");
  });

  it("数组保持领域规定顺序", () => {
    const arraySchema = defineCanonicalSchema(1, {
      items: z.array(z.number()),
    });
    const service = new NodeCanonicalHashService();

    expect(
      service.digestStructured(arraySchema, {
        schemaVersion: 1,
        items: [2, 1],
      }),
    ).not.toBe(
      service.digestStructured(arraySchema, {
        schemaVersion: 1,
        items: [1, 2],
      }),
    );
  });
});

describe("NodeCanonicalHashService.digestBytes", () => {
  it("与 SHA-256 已知答案一致", () => {
    const service = new NodeCanonicalHashService();

    expect(service.digestBytes(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(service.digestBytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("原始字节不做任何隐式换行归一化", () => {
    const service = new NodeCanonicalHashService();
    const crlf = new TextEncoder().encode("a\r\nb");
    const lf = new TextEncoder().encode("a\nb");

    expect(service.digestBytes(crlf)).not.toBe(service.digestBytes(lf));
  });
});

describe("defineCanonicalSchema", () => {
  it("拒绝非正整数版本与重复 schemaVersion 声明", () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(() => defineCanonicalSchema(version, {})).toThrow(
        CanonicalViolationError,
      );
    }
    expect(() =>
      defineCanonicalSchema(1, { schemaVersion: z.number() })
    ).toThrow("不允许重复声明 schemaVersion");
  });
});
