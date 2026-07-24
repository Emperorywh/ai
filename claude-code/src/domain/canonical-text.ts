/*
 * SPEC/TASK 源文本进入证据链前的唯一规范化边界。
 * 只允许 CRLF/CR 到 LF 的换行归一化；BOM、NUL 和非法 UTF-8 在进入证据链前 fail closed，
 * 其他正文字符逐字节保留，保证同一语义文本在任何受支持平台上得到相同 source hash。
 */
import { CanonicalViolationError } from "./errors.js";

const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf] as const;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const NUL_CHARACTER = String.fromCharCode(0);

export function decodeCanonicalSourceText(
  bytes: Uint8Array,
  label: string,
): string {
  if (startsWithBom(bytes)) {
    throw new CanonicalViolationError(`${label} 不允许携带 UTF-8 BOM`);
  }
  let text: string;
  try {
    text = strictUtf8Decoder.decode(bytes);
  } catch {
    throw new CanonicalViolationError(`${label} 不是合法 UTF-8 文本`);
  }
  if (text.includes(NUL_CHARACTER)) {
    throw new CanonicalViolationError(`${label} 包含 NUL 字符`);
  }
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function startsWithBom(bytes: Uint8Array): boolean {
  return UTF8_BOM_BYTES.every((byte, index) => bytes[index] === byte);
}
