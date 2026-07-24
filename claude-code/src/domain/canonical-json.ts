/*
 * 规范 JSON 编码遵循 JSON Canonicalization Scheme（RFC 8785）：
 * 对象键按 UTF-16 码元序排列，数字按 ECMAScript Number::toString 序列化，字符串最小转义。
 * 与宽松 JSON 序列化不同，这里对任何会被静默改写的输入 fail closed：
 * 非有限数字、孤立代理对、非纯对象、toJSON、符号键、稀疏数组、循环引用和 undefined 一律拒绝。
 * 编码输出固定为 UTF-8、无 BOM，不附加平台换行。
 */
import { CanonicalViolationError } from "./errors.js";

export function encodeCanonicalJson(value: unknown): string {
  return serializeValue(value, new Set());
}

/*
 * UTF-8 编码是规范摘要前的最后一步，TextEncoder 不附加 BOM。
 * 孤立代理对会被 UTF-8 编码静默替换为 U+FFFD，因此这里同样拒绝。
 */
export function encodeCanonicalUtf8(text: string): Uint8Array {
  assertNoLoneSurrogates(text, "规范文本");
  return new TextEncoder().encode(text);
}

function serializeValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalViolationError(
          `规范 JSON 拒绝非有限数字：${String(value)}`,
        );
      }
      return JSON.stringify(value);
    }
    case "string": {
      assertNoLoneSurrogates(value, "规范 JSON 字符串");
      return JSON.stringify(value);
    }
    case "object":
      return serializeObject(value, ancestors);
    default:
      throw new CanonicalViolationError(
        `规范 JSON 拒绝无法确定的值类型：${typeof value}`,
      );
  }
}

function serializeObject(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) {
    throw new CanonicalViolationError("规范 JSON 拒绝循环引用");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return serializeArray(value, ancestors);
    }
    return serializeRecord(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/*
 * 稀疏数组在宽松 JSON 中会被填 null，属于静默改写；数组顺序保持领域规定顺序，绝不排序。
 */
function serializeArray(value: unknown[], ancestors: Set<object>): string {
  if (Object.keys(value).length !== value.length) {
    throw new CanonicalViolationError("规范 JSON 拒绝稀疏数组");
  }
  const elements = value.map((element) => serializeValue(element, ancestors));
  return `[${elements.join(",")}]`;
}

/*
 * 对象键必须已经是 Unicode NFC 规范形式，保证规范键唯一且不受平台文本归一化影响。
 * 键排序使用默认字典序，与 RFC 8785 要求的 UTF-16 码元序一致。
 */
function serializeRecord(value: object, ancestors: Set<object>): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalViolationError("规范 JSON 只接受纯对象字面量");
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    throw new CanonicalViolationError("规范 JSON 拒绝 toJSON 自定义序列化");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalViolationError("规范 JSON 拒绝符号键");
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => {
    assertNoLoneSurrogates(key, "规范 JSON 对象键");
    if (key.normalize("NFC") !== key) {
      throw new CanonicalViolationError(`规范 JSON 对象键不是 NFC 规范形式：${key}`);
    }
    const property = `${JSON.stringify(key)}:${serializeValue(
      (value as Record<string, unknown>)[key],
      ancestors,
    )}`;
    return property;
  });
  return `{${entries.join(",")}}`;
}

function assertNoLoneSurrogates(text: string, label: string): void {
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
