/*
 * 源文本规范化测试锁定唯一允许的换行归一化与 fail-closed 拒绝面。
 * BOM、NUL 和非法 UTF-8 必须在进入证据链前被拒绝，其他正文字符逐字节保留。
 */
import { describe, expect, it } from "vitest";
import { decodeCanonicalSourceText } from "../src/domain/canonical-text.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("decodeCanonicalSourceText", () => {
  it("LF、CRLF 和 CR 源文本归一化为相同内容", () => {
    const lf = decodeCanonicalSourceText(utf8("第一行\n第二行\n"), "SPEC");
    const crlf = decodeCanonicalSourceText(utf8("第一行\r\n第二行\r\n"), "SPEC");
    const cr = decodeCanonicalSourceText(utf8("第一行\r第二行\r"), "SPEC");

    expect(lf).toBe("第一行\n第二行\n");
    expect(crlf).toBe(lf);
    expect(cr).toBe(lf);
  });

  it("除换行外的正文字符逐字节保留", () => {
    const text = "制表符\t保留\u00a0与 emoji 😀 和结尾空格  \n\n多一空行\n";

    expect(decodeCanonicalSourceText(utf8(text), "SPEC")).toBe(text);
  });

  it("拒绝 UTF-8 BOM", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);

    expect(() => decodeCanonicalSourceText(bom, "SPEC")).toThrow("BOM");
  });

  it("拒绝 NUL 字符", () => {
    const withNul = new Uint8Array([0x61, 0x00, 0x62]);

    expect(() => decodeCanonicalSourceText(withNul, "SPEC")).toThrow("NUL");
  });

  it("拒绝非法 UTF-8 字节序列", () => {
    const invalid = new Uint8Array([0x61, 0xff, 0x62]);
    const overlong = new Uint8Array([0xc0, 0xaf]);
    const surrogate = new Uint8Array([0xed, 0xa0, 0x80]);
    const beyondRange = new Uint8Array([0xf5, 0x80, 0x80, 0x80]);

    for (const bytes of [invalid, overlong, surrogate, beyondRange]) {
      expect(() => decodeCanonicalSourceText(bytes, "SPEC")).toThrow(
        "不是合法 UTF-8",
      );
    }
  });

  it("空字节序列归一化为空文本，空文件语义由加载层拒绝", () => {
    expect(decodeCanonicalSourceText(new Uint8Array(0), "SPEC")).toBe("");
  });
});
