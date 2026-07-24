/*
 * 规范 Unicode 边界只接受完整 Unicode 标量序列。
 * JavaScript 字符串允许孤立 UTF-16 代理项，但 TextEncoder 会把它们静默替换为 U+FFFD；
 * 所有进入规范 JSON、UTF-8 文本或 Git 路径的字符串都必须先经过本模块校验。
 */
import { CanonicalViolationError } from "./errors.js";

export function assertUnicodeScalarText(text: string, label: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalViolationError(`${label} 包含孤立高位代理`);
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalViolationError(`${label} 包含孤立低位代理`);
    }
  }
}
