/*
 * CanonicalHashService 是所有证书、manifest、结构化 evidence、契约投影和 Git trailer 引用的唯一哈希入口。
 * 结构化对象必须先通过版本化 strict Schema，再按 JCS 编码计算 SHA-256；
 * 原始字节（附件、规范化源文本）不经任何文本归一化直接计算。
 * 该端口不提供任何绕过 Schema 对任意对象签发摘要的方法。
 */
import type { CanonicalSchema } from "../domain/canonical-schema.js";

export interface CanonicalHashService {
  /*
   * encodeStructured 与 digestStructured 共享同一条管道，产物是同一批规范字节：
   * 内容寻址存储由此保存结构化 artifact，digestBytes(encodeStructured(x)) 恒等于 digestStructured(x)。
   */
  encodeStructured<T>(schema: CanonicalSchema<T>, value: unknown): Uint8Array;
  digestStructured<T>(schema: CanonicalSchema<T>, value: unknown): string;
  digestBytes(bytes: Uint8Array): string;
}
