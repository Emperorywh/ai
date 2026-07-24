/*
 * 版本化 strict Schema 是结构化对象进入证据链的唯一入口。
 * defineCanonicalSchema 强制每个可哈希对象携带 schemaVersion 并拒绝未知字段，
 * 调用方无法绕过 Schema 对任意对象签发规范摘要。
 */
import { z } from "zod";
import { CanonicalViolationError } from "./errors.js";

const canonicalSchemaBrand: unique symbol = Symbol("apex.canonical-schema");

/*
 * CanonicalSchema 只能由 defineCanonicalSchema 构造。
 * 品牌字段阻止外部拼装未版本化或非 strict 的 Schema 进入规范哈希管道。
 */
export interface CanonicalSchema<T> {
  readonly [canonicalSchemaBrand]: true;
  readonly schemaVersion: number;
  readonly schema: z.ZodType<T>;
}

export type CanonicalValue<Schema> = Schema extends CanonicalSchema<infer T>
  ? T
  : never;

/* SHA-256 摘要的外部表示固定为小写十六进制，所有契约字段共享同一约束。 */
export const canonicalSha256DigestSchema = z.string().regex(
  /^[0-9a-f]{64}$/u,
  "SHA-256 摘要必须是小写十六进制",
);

/*
 * 每个规范对象都内嵌 schemaVersion 字面量，协议升级只能显式换代，不存在旧算法 fallback。
 * shape 不允许重复声明 schemaVersion，避免版本字段出现两个事实源。
 */
export function defineCanonicalSchema<Shape extends z.ZodRawShape>(
  schemaVersion: number,
  shape: Shape,
): CanonicalSchema<{ schemaVersion: number } & z.infer<z.ZodObject<Shape>>> {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new CanonicalViolationError(
      `schemaVersion 必须是正整数：${String(schemaVersion)}`,
    );
  }
  if ("schemaVersion" in shape) {
    throw new CanonicalViolationError("规范 Schema 不允许重复声明 schemaVersion");
  }
  const schema = z.strictObject({
    schemaVersion: z.literal(schemaVersion),
    ...shape,
  });
  return {
    [canonicalSchemaBrand]: true,
    schemaVersion,
    schema,
  } as CanonicalSchema<{ schemaVersion: number } & z.infer<z.ZodObject<Shape>>>;
}

/*
 * Schema 校验只允许拒绝字段，不允许静默丢弃字段后再哈希。
 * 该守卫逐层比对校验前后的自有键，任何被 Schema 吞掉的键或符号键都视为非规范输入。
 */
export function assertSchemaPreservesValue(input: unknown, parsed: unknown): void {
  if (isPlainRecord(parsed)) {
    if (!isPlainRecord(input)) {
      throw new CanonicalViolationError("规范 Schema 校验改变了值的对象形态");
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      throw new CanonicalViolationError("规范对象不允许携带符号键");
    }
    for (const key of Object.keys(input)) {
      if (!(key in parsed)) {
        throw new CanonicalViolationError(
          `规范 Schema 静默丢弃了字段：${key}`,
        );
      }
      assertSchemaPreservesValue(input[key], parsed[key]);
    }
    return;
  }
  if (Array.isArray(parsed)) {
    if (!Array.isArray(input) || input.length !== parsed.length) {
      throw new CanonicalViolationError("规范 Schema 校验改变了数组形态");
    }
    for (let index = 0; index < parsed.length; index += 1) {
      assertSchemaPreservesValue(input[index], parsed[index]);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
