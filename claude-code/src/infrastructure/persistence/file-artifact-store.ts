/*
 * FileArtifactStore 是 ArtifactStore 的文件系统实现，位于产品状态目录（Git common dir 下的项目作用域）。
 * 存储根不进入项目工作树，不随 clone 传播，也不存在任何联网补取 fallback。
 *
 * 落盘语义固定为：同目录临时文件 → fsync → atomic rename → 落盘后重读比对 → 尽力同步目录项。
 * 崩溃只可能留下 `.tmp-` 前缀的孤儿临时文件，它们永远不会被任何读取路径接受；
 * 同 hash 重复写入逐字节幂等，已有内容与引用摘要不符一律 fail closed，不做自动修复。
 */
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  assertArtifactNamespace,
  assertArtifactReceiptKey,
  artifactRefSchema,
  CANONICAL_JSON_MEDIA_TYPE,
  createArtifactRef,
  type ArtifactReceiptKey,
  type ArtifactRef,
} from "../../domain/artifact-ref.js";
import {
  assertCanonicalSchemaDefinition,
  assertSchemaPreservesValue,
  canonicalSha256DigestSchema,
  type CanonicalSchema,
} from "../../domain/canonical-schema.js";
import {
  ArtifactConflictError,
  ArtifactIntegrityError,
  ArtifactNamespaceError,
  ArtifactNotFoundError,
  CanonicalViolationError,
  InfrastructureError,
} from "../../domain/errors.js";
import type {
  ArtifactBytesInput,
  ArtifactReceipt,
  ArtifactStore,
} from "../../ports/artifact-store.js";
import type { CanonicalHashService } from "../../ports/canonical-hash.js";

const TEMPORARY_FILE_PREFIX = ".tmp-";

let temporaryFileCounter = 0;

export class FileArtifactStore implements ArtifactStore {
  public constructor(
    private readonly rootDirectory: string,
    private readonly canonicalHash: CanonicalHashService,
  ) {}

  public async putStructured<T>(
    schema: CanonicalSchema<T>,
    value: unknown,
  ): Promise<ArtifactRef> {
    const bytes = this.canonicalHash.encodeStructured(schema, value);
    return this.putBytes({ mediaType: CANONICAL_JSON_MEDIA_TYPE, bytes });
  }

  public async putBytes(input: ArtifactBytesInput): Promise<ArtifactRef> {
    const ref = createArtifactRef(input, this.canonicalHash);
    const path = this.objectPath(ref.contentHash);
    await this.persistImmutable(path, input.bytes, (existing) => {
      const existingHash = this.canonicalHash.digestBytes(existing);
      if (existingHash !== ref.contentHash) {
        return new ArtifactIntegrityError(
          `artifact 已损坏：${ref.contentHash} 的落盘字节重算为 ${existingHash}`,
        );
      }
      return new ArtifactIntegrityError(
        `artifact hash 碰撞：${ref.contentHash} 已存在不同内容`,
      );
    });
    return ref;
  }

  public async read(ref: ArtifactRef): Promise<Uint8Array> {
    const validRef = this.assertValidRef(ref);
    const path = this.objectPath(validRef.contentHash);
    const bytes = await this.readExisting(
      path,
      () => new ArtifactNotFoundError(`artifact 未持久化：${validRef.contentHash}`),
    );
    if (bytes.byteLength !== validRef.byteLength) {
      throw new ArtifactIntegrityError(
        `artifact 长度不符：${validRef.contentHash} 期望 ${validRef.byteLength} 字节，实际 ${bytes.byteLength} 字节`,
      );
    }
    const actualHash = this.canonicalHash.digestBytes(bytes);
    if (actualHash !== validRef.contentHash) {
      throw new ArtifactIntegrityError(
        `artifact 摘要重算不匹配：${validRef.contentHash} 的落盘字节重算为 ${actualHash}`,
      );
    }
    return bytes;
  }

  public async readStructured<T>(
    schema: CanonicalSchema<T>,
    ref: ArtifactRef,
  ): Promise<T> {
    return this.decodeStructured(schema, await this.read(ref));
  }

  public async has(ref: ArtifactRef): Promise<boolean> {
    const validRef = this.assertValidRef(ref);
    return this.exists(this.objectPath(validRef.contentHash));
  }

  public async verify(ref: ArtifactRef): Promise<void> {
    await this.read(ref);
  }

  public async putStructuredReceipt<T>(
    key: ArtifactReceiptKey,
    schema: CanonicalSchema<T>,
    value: unknown,
  ): Promise<ArtifactRef> {
    const bytes = this.canonicalHash.encodeStructured(schema, value);
    const path = this.receiptPath(key);
    await this.persistImmutable(path, bytes, () =>
      new ArtifactConflictError(
        `receipt 协议冲突：${key.namespace}/${key.key} 已存在不同内容`,
      ));
    return createArtifactRef(
      { mediaType: CANONICAL_JSON_MEDIA_TYPE, bytes },
      this.canonicalHash,
    );
  }

  public async readReceipt<T>(
    key: ArtifactReceiptKey,
    schema: CanonicalSchema<T>,
  ): Promise<ArtifactReceipt<T>> {
    const path = this.receiptPath(key);
    const bytes = await this.readExisting(
      path,
      () =>
        new ArtifactNotFoundError(
          `receipt 未持久化：${key.namespace}/${key.key}`,
        ),
    );
    return {
      ref: createArtifactRef(
        { mediaType: CANONICAL_JSON_MEDIA_TYPE, bytes },
        this.canonicalHash,
      ),
      value: this.decodeStructured(schema, bytes),
    };
  }

  public async hasReceipt(key: ArtifactReceiptKey): Promise<boolean> {
    return this.exists(this.receiptPath(key));
  }

  /*
   * 不可变写入的共同路径：已有同内容直接幂等返回；已有不同内容交给调用方分类为碰撞或协议冲突。
   * rename 后重读比对兜底并发写同一身份的窗口，保证至少一方收到冲突而非静默覆盖。
   */
  private async persistImmutable(
    path: string,
    bytes: Uint8Array,
    describeConflict: (existing: Uint8Array) => Error,
  ): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const existing = await this.tryReadFile(path);
      if (existing !== undefined) {
        if (bytesEqual(existing, bytes)) {
          return;
        }
        throw describeConflict(existing);
      }
      const temporaryPath = join(
        dirname(path),
        `${TEMPORARY_FILE_PREFIX}${process.pid}-${temporaryFileCounter++}`,
      );
      try {
        const handle = await open(temporaryPath, "w");
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      const landed = await this.tryReadFile(path);
      if (landed === undefined || !bytesEqual(landed, bytes)) {
        throw describeConflict(landed ?? new Uint8Array());
      }
      await this.syncDirectory(dirname(path));
    } catch (error) {
      if (
        error instanceof ArtifactIntegrityError
        || error instanceof ArtifactConflictError
      ) {
        throw error;
      }
      throw new InfrastructureError(`无法落盘 artifact：${path}`, {
        cause: error,
      });
    }
  }

  private decodeStructured<T>(
    schema: CanonicalSchema<T>,
    bytes: Uint8Array,
  ): T {
    assertCanonicalSchemaDefinition(schema);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new ArtifactIntegrityError("结构化 artifact 不是合法 UTF-8 JSON");
    }
    const parsed = schema.schema.safeParse(value);
    if (!parsed.success) {
      throw new ArtifactIntegrityError(
        `结构化 artifact 不符合 Schema：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("；")}`,
      );
    }
    try {
      assertSchemaPreservesValue(value, parsed.data);
    } catch (error) {
      throw new ArtifactIntegrityError(
        `结构化 artifact 未通过值保留校验：${(error as Error).message}`,
      );
    }
    return parsed.data;
  }

  private assertValidRef(ref: ArtifactRef): ArtifactRef {
    const parsed = artifactRefSchema.schema.safeParse(ref);
    if (!parsed.success) {
      throw new CanonicalViolationError(
        `非法 artifact 引用：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("；")}`,
      );
    }
    return parsed.data;
  }

  private objectPath(contentHash: string): string {
    if (!canonicalSha256DigestSchema.safeParse(contentHash).success) {
      throw new CanonicalViolationError(`非法 artifact 摘要：${contentHash}`);
    }
    return this.resolveWithinRoot("objects", contentHash);
  }

  private receiptPath(key: ArtifactReceiptKey): string {
    /*
     * 寻址名称在基础设施边界再次校验，防止任何上层绕过领域断言直接拼装路径。
     */
    assertArtifactNamespace(key.namespace);
    assertArtifactReceiptKey(key.key);
    return this.resolveWithinRoot("receipts", key.namespace, key.key);
  }

  /*
   * 名称白名单之外的第二道防线：解析后的绝对路径必须位于存储根内，杜绝符号链接式越界构造。
   */
  private resolveWithinRoot(...segments: readonly string[]): string {
    const absoluteRoot = resolve(this.rootDirectory);
    const candidate = resolve(absoluteRoot, ...segments);
    if (
      candidate !== absoluteRoot
      && !candidate.startsWith(`${absoluteRoot}${sep}`)
    ) {
      throw new ArtifactNamespaceError(
        `artifact 路径越界：${segments.join("/")}`,
      );
    }
    return candidate;
  }

  private async readExisting(
    path: string,
    describeMissing: () => Error,
  ): Promise<Uint8Array> {
    const bytes = await this.tryReadFile(path);
    if (bytes === undefined) {
      throw describeMissing();
    }
    return bytes;
  }

  private async tryReadFile(path: string): Promise<Uint8Array | undefined> {
    try {
      /*
       * 端口契约是平台无关的 Uint8Array；readFile 的 Buffer 子类在此归一化，
       * 避免调用方对相等性或序列化行为产生实现依赖。
       */
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw new InfrastructureError(`无法读取 artifact：${path}`, {
        cause: error,
      });
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }
      throw new InfrastructureError(`无法检查 artifact：${path}`, {
        cause: error,
      });
    }
  }

  /*
   * 目录项同步保证 rename 结果在宿主崩溃后仍然可见；Windows 不允许对用户态目录句柄 fsync，
   * 仅在该平台明确拒绝时跳过（文件本身已在 rename 前 fsync），其余错误照常失败。
   */
  private async syncDirectory(path: string): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      await handle.sync();
    } catch (error) {
      if (isUnsupportedDirectorySync(error)) {
        return;
      }
      throw new InfrastructureError(`无法同步 artifact 目录：${path}`, {
        cause: error,
      });
    } finally {
      await handle?.close();
    }
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.compare(left, right) === 0;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return (
    error instanceof Error
    && "code" in error
    && (error.code === "EPERM"
      || error.code === "EISDIR"
      || error.code === "ENOTSUP"
      || error.code === "EINVAL")
  );
}
