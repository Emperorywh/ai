/*
 * 版本化 strict Schema 是结构化对象进入证据链的唯一入口。
 * defineCanonicalSchema 强制每个可哈希对象携带 schemaVersion 并拒绝未知字段，
 * 调用方无法绕过 Schema 对任意对象签发规范摘要。
 */
import { z } from "zod";
import { CanonicalViolationError } from "./errors.js";

const canonicalSchemaBrand: unique symbol = Symbol("apex.canonical-schema");
const canonicalSchemaDefinitions = new WeakSet();

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
  const canonicalSchema = {
    [canonicalSchemaBrand]: true,
    schemaVersion,
    schema,
  } as CanonicalSchema<{ schemaVersion: number } & z.infer<z.ZodObject<Shape>>>;
  canonicalSchemaDefinitions.add(canonicalSchema);
  return canonicalSchema;
}

/*
 * TypeScript 品牌在编译后仍需要运行时校验，防止 JavaScript 调用方或强制类型断言
 * 把任意 Zod Schema 注入唯一规范哈希入口。
 */
export function assertCanonicalSchemaDefinition(
  schema: unknown,
): asserts schema is CanonicalSchema<unknown> {
  if (
    typeof schema !== "object"
    || schema === null
    || !canonicalSchemaDefinitions.has(schema)
  ) {
    throw new CanonicalViolationError("规范哈希只接受由 defineCanonicalSchema 创建的 Schema");
  }
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
    const inputKeys = Object.keys(input);
    const parsedKeys = Object.keys(parsed);
    assertSameOwnKeys(inputKeys, parsedKeys, "规范对象");
    for (const key of inputKeys) {
      assertSchemaPreservesValue(input[key], parsed[key]);
    }
    return;
  }
  if (Array.isArray(parsed)) {
    if (!Array.isArray(input)) {
      throw new CanonicalViolationError("规范 Schema 校验改变了数组形态");
    }
    const inputKeys = Object.keys(input);
    const parsedKeys = Object.keys(parsed);
    assertSameOwnKeys(inputKeys, parsedKeys, "规范数组");
    for (const key of inputKeys) {
      assertSchemaPreservesValue(
        (input as unknown as Record<string, unknown>)[key],
        (parsed as unknown as Record<string, unknown>)[key],
      );
    }
    return;
  }
  /*
   * Schema 只能判定输入是否有效，不能通过 trim/default/coerce/transform 改写待签名值。
   * Object.is 同时保留 NaN、-0 等 JavaScript 标量差异；非有限数字仍由 JCS 边界拒绝。
   */
  if (!Object.is(input, parsed)) {
    throw new CanonicalViolationError("规范 Schema 校验改变了标量值");
  }
}

function assertSameOwnKeys(
  inputKeys: readonly string[],
  parsedKeys: readonly string[],
  label: string,
): void {
  const parsedKeySet = new Set(parsedKeys);
  for (const key of inputKeys) {
    if (!parsedKeySet.has(key)) {
      throw new CanonicalViolationError(`${label}校验静默丢弃了字段：${key}`);
    }
  }
  const inputKeySet = new Set(inputKeys);
  for (const key of parsedKeys) {
    if (!inputKeySet.has(key)) {
      throw new CanonicalViolationError(`${label}校验静默补全了字段：${key}`);
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
