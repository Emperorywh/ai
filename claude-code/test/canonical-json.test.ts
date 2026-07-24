/*
 * 规范 JSON 编码测试锁定 JCS 字节稳定性与 fail-closed 拒绝面。
 * 任何会被宽松 JSON 序列化静默改写的输入都必须被明确拒绝。
 */
import { describe, expect, it } from "vitest";
import {
  encodeCanonicalJson,
  encodeCanonicalUtf8,
} from "../src/domain/canonical-json.js";

describe("encodeCanonicalJson", () => {
  it("对象键按 UTF-16 码元序排列，与声明顺序无关", () => {
    const left = encodeCanonicalJson({ b: 1, a: "x", c: [true, null] });
    const right = encodeCanonicalJson({ c: [true, null], a: "x", b: 1 });

    expect(left).toBe('{"a":"x","b":1,"c":[true,null]}');
    expect(right).toBe(left);
  });

  it("同一领域对象重复编码得到逐字节相同结果", () => {
    const value = {
      schemaVersion: 1,
      body: "任务正文与标点。",
      entries: [{ path: "a/b.md", sourceHash: "f".repeat(64) }],
    };

    expect(encodeCanonicalJson(value)).toBe(encodeCanonicalJson(value));
  });

  it("数组保持领域规定顺序，不为稳定而排序", () => {
    expect(encodeCanonicalJson([2, 1])).not.toBe(encodeCanonicalJson([1, 2]));
  });

  it("数字按 ECMAScript Number::toString 序列化", () => {
    expect(encodeCanonicalJson(0)).toBe("0");
    expect(encodeCanonicalJson(-0)).toBe("0");
    expect(encodeCanonicalJson(1.5)).toBe("1.5");
    expect(encodeCanonicalJson(1e21)).toBe("1e+21");
  });

  it("字符串按 JSON 最小转义，非 ASCII 字符保持原样", () => {
    expect(encodeCanonicalJson('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(encodeCanonicalJson("中文与 é")).toBe('"中文与 é"');
  });

  it("拒绝非有限数字，禁止静默写成 null", () => {
    expect(() => encodeCanonicalJson(Number.NaN)).toThrow("非有限数字");
    expect(() => encodeCanonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      "非有限数字",
    );
    expect(() => encodeCanonicalJson({ a: Number.NEGATIVE_INFINITY })).toThrow(
      "非有限数字",
    );
  });

  it("拒绝孤立代理对，禁止编码时静默替换", () => {
    const loneHigh = `a${String.fromCharCode(0xd800)}b`;
    const loneLow = `a${String.fromCharCode(0xdc00)}b`;
    const validPair = `a${String.fromCharCode(0xd83d, 0xde00)}b`;

    expect(() => encodeCanonicalJson(loneHigh)).toThrow("孤立高位代理");
    expect(() => encodeCanonicalJson(loneLow)).toThrow("孤立低位代理");
    expect(() => encodeCanonicalJson({ [loneHigh]: 1 })).toThrow("孤立高位代理");
    expect(encodeCanonicalJson(validPair)).toBe(JSON.stringify(validPair));
  });

  it("拒绝非 NFC 对象键，规范键必须唯一", () => {
    const nfdKey = `e${String.fromCharCode(0x301)}`;
    const nfcKey = String.fromCharCode(0xe9);

    expect(nfdKey).not.toBe(nfcKey);
    expect(() => encodeCanonicalJson({ [nfdKey]: 1 })).toThrow(
      "不是 NFC 规范形式",
    );
    expect(encodeCanonicalJson({ [nfcKey]: 1 })).toBe(`{"${nfcKey}":1}`);
  });

  it("拒绝 undefined、函数、Symbol 和 BigInt，禁止静默丢字段", () => {
    expect(() => encodeCanonicalJson({ a: undefined })).toThrow(
      "无法确定的值类型",
    );
    expect(() => encodeCanonicalJson({ a: () => 1 })).toThrow(
      "无法确定的值类型",
    );
    expect(() => encodeCanonicalJson(Symbol("k"))).toThrow(
      "无法确定的值类型",
    );
    expect(() => encodeCanonicalJson(10n)).toThrow("无法确定的值类型");
  });

  it("拒绝非纯对象、toJSON 与符号键，禁止自定义序列化", () => {
    class Custom {
      public readonly a = 1;
    }
    expect(() => encodeCanonicalJson(new Custom())).toThrow("纯对象");
    expect(() => encodeCanonicalJson(new Date(0))).toThrow("纯对象");
    expect(() =>
      encodeCanonicalJson({ toJSON: () => ({}), a: 1 })
    ).toThrow("toJSON");
    expect(() =>
      encodeCanonicalJson({ [Symbol("s")]: 1, a: 1 })
    ).toThrow("符号键");
  });

  it("拒绝稀疏数组和循环引用", () => {
    const sparse = new Array<unknown>(2);
    expect(() => encodeCanonicalJson(sparse)).toThrow("稀疏数组");

    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => encodeCanonicalJson(cyclic)).toThrow("循环引用");

    const cyclicArray: unknown[] = [1];
    cyclicArray.push(cyclicArray);
    expect(() => encodeCanonicalJson(cyclicArray)).toThrow("循环引用");
  });
});

describe("encodeCanonicalUtf8", () => {
  it("输出 UTF-8 字节且不附加 BOM", () => {
    const bytes = encodeCanonicalUtf8("é\n");

    expect([...bytes]).toEqual([0xc3, 0xa9, 0x0a]);
  });

  it("拒绝孤立代理对", () => {
    const lone = `a${String.fromCharCode(0xd800)}`;
    expect(() => encodeCanonicalUtf8(lone)).toThrow("孤立高位代理");
  });
});
