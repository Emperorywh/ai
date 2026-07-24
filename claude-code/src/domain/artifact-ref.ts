/*
 * ArtifactRef 是内容寻址证据存储的唯一引用形态，与附件摘要共享同一契约形状：
 * 引用身份完全由保存后原始字节的 mediaType、byteLength 和 SHA-256 决定，不含任何路径或可变元数据。
 * 状态只能保存该不可变引用；引用成立的前提是对应字节已持久化且重算匹配。
 */
import {
  attachmentDigestSchema,
  createAttachmentDigest,
  type AttachmentDigest,
} from "./attachment-digest.js";
import { ArtifactNamespaceError } from "./errors.js";

export const artifactRefSchema = attachmentDigestSchema;
export type ArtifactRef = AttachmentDigest;
export const createArtifactRef = createAttachmentDigest;

/*
 * 结构化 artifact 固定为规范 JSON 字节，媒体类型只表达编码形态；
 * 字符集等参数不参与内容相等性，与附件摘要契约一致。
 */
export const CANONICAL_JSON_MEDIA_TYPE = "application/json";

/*
 * deterministic receipt 只能按稳定协议对象定位：namespace 划分协议域（如 worker turn report），
 * key 是宿主从当前协议身份推导的确定性 ID（如 reportId）。
 * 两种名称都只能是平坦的安全文件名：不允许路径分隔符、父目录引用或大小写含糊的层级语义。
 */
export interface ArtifactReceiptKey {
  readonly namespace: string;
  readonly key: string;
}

const ARTIFACT_NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const ARTIFACT_RECEIPT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;

export function assertArtifactNamespace(value: string): void {
  if (!ARTIFACT_NAMESPACE_PATTERN.test(value)) {
    throw new ArtifactNamespaceError(`非法 artifact namespace：${value}`);
  }
}

export function assertArtifactReceiptKey(value: string): void {
  /*
   * 点号用于运行 ID 等协议身份，但任何父目录片段或 Windows 不可表示的结尾都必须拒绝，
   * 防止寻址名称越过存储根的扁平层级。
   */
  if (
    !ARTIFACT_RECEIPT_KEY_PATTERN.test(value)
    || value.includes("..")
    || value.endsWith(".")
  ) {
    throw new ArtifactNamespaceError(`非法 artifact receipt 键：${value}`);
  }
}

export function createArtifactReceiptKey(
  namespace: string,
  key: string,
): ArtifactReceiptKey {
  assertArtifactNamespace(namespace);
  assertArtifactReceiptKey(key);
  return { namespace, key };
}
