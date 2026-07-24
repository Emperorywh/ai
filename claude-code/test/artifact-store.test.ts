/*
 * 内容寻址证据存储测试锁定 SupervisedExecutionLoopSpec 17.1 的核心语义：
 * fsync + atomic rename 落盘、逐字节幂等、读取即重算校验、确定性 receipt 只按稳定协议键定位。
 * 异常路径证明：崩溃临时文件、截断、同 hash/同键不同内容、非法 namespace 和越界寻址
 * 都不会产生可接受引用，孤立 receipt 也不会被目录扫描提升为业务事实。
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ArtifactReferenceGuard } from "../src/application/artifact-reference-guard.js";
import {
  CANONICAL_JSON_MEDIA_TYPE,
  createArtifactReceiptKey,
} from "../src/domain/artifact-ref.js";
import { defineCanonicalSchema } from "../src/domain/canonical-schema.js";
import {
  ArtifactConflictError,
  ArtifactIntegrityError,
  ArtifactNamespaceError,
  ArtifactNotFoundError,
  CanonicalViolationError,
} from "../src/domain/errors.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";
import { FileArtifactStore } from "../src/infrastructure/persistence/file-artifact-store.js";

const reportSchema = defineCanonicalSchema(1, {
  action: z.string(),
  summary: z.string(),
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })),
  );
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "apex-artifacts-"));
  temporaryDirectories.push(directory);
  const canonicalHash = new NodeCanonicalHashService();
  const store = new FileArtifactStore(directory, canonicalHash);
  return {
    directory,
    canonicalHash,
    store,
    guard: new ArtifactReferenceGuard(store),
  };
}

describe("FileArtifactStore 结构化 artifact", () => {
  it("写入后可按引用逐字节读回，摘要与元数据均可重算", async () => {
    const { store, canonicalHash } = await createStore();
    const value = { schemaVersion: 1, action: "candidate_ready", summary: "完成" };

    const ref = await store.putStructured(reportSchema, value);

    /*
     * 结构化 artifact 的引用必须由 TASK-001 唯一规范管道推导：
     * contentHash 恒等于 digestStructured，字节恒等于 encodeStructured。
     */
    expect(ref.mediaType).toBe(CANONICAL_JSON_MEDIA_TYPE);
    expect(ref.contentHash).toBe(
      canonicalHash.digestStructured(reportSchema, value),
    );
    expect(ref.byteLength).toBe(
      canonicalHash.encodeStructured(reportSchema, value).byteLength,
    );
    const bytes = await store.read(ref);
    expect(bytes).toEqual(canonicalHash.encodeStructured(reportSchema, value));
    await expect(store.readStructured(reportSchema, ref)).resolves.toEqual(value);
    await expect(store.has(ref)).resolves.toBe(true);
    await expect(store.verify(ref)).resolves.toBeUndefined();
  });

  it("同内容重复 put 幂等返回同一引用，磁盘只保留一个对象", async () => {
    const { store, directory } = await createStore();
    const value = { schemaVersion: 1, action: "continue", summary: "推进中" };

    const first = await store.putStructured(reportSchema, value);
    const second = await store.putStructured(reportSchema, value);

    expect(second).toEqual(first);
    const objects = await readdir(join(directory, "objects"));
    expect(objects).toEqual([first.contentHash]);
  });

  it("Schema 校验失败时不产生任何落盘对象", async () => {
    const { store, directory } = await createStore();

    await expect(
      store.putStructured(reportSchema, {
        schemaVersion: 1,
        action: "continue",
        summary: "x",
        extra: "未知字段",
      }),
    ).rejects.toThrow(CanonicalViolationError);

    await expect(
      readdir(join(directory, "objects")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("FileArtifactStore 原始附件与大输出", () => {
  it("文本附件按原始字节保存，不做隐式换行归一化", async () => {
    const { store, canonicalHash } = await createStore();
    const bytes = new TextEncoder().encode("第一行\r\n第二行\n第三行");

    const ref = await store.putBytes({ mediaType: "text/plain", bytes });

    expect(ref.contentHash).toBe(canonicalHash.digestBytes(bytes));
    expect(ref.byteLength).toBe(bytes.byteLength);
    await expect(store.read(ref)).resolves.toEqual(bytes);
  });

  it("二进制附件含 NUL 与高位字节也逐字节一致", async () => {
    const { store } = await createStore();
    const bytes = new Uint8Array([0x00, 0xff, 0x0d, 0x0a, 0x7f, 0x80, 0x00]);

    const ref = await store.putBytes({
      mediaType: "application/octet-stream",
      bytes,
    });

    await expect(store.read(ref)).resolves.toEqual(bytes);
    const duplicate = await store.putBytes({
      mediaType: "application/octet-stream",
      bytes,
    });
    expect(duplicate).toEqual(ref);
  });
});

describe("ArtifactReferenceGuard 状态引用边界", () => {
  it("只放行已持久化且重算匹配的引用", async () => {
    const { store, guard } = await createStore();
    const value = { schemaVersion: 1, action: "candidate_ready", summary: "送审" };
    const ref = await store.putStructured(reportSchema, value);

    await expect(guard.requireReadable(ref)).resolves.toBeUndefined();

    /*
     * 形状合法但从未持久化的引用不得进入状态。
     */
    const fabricated = {
      schemaVersion: 1 as const,
      mediaType: CANONICAL_JSON_MEDIA_TYPE,
      byteLength: 3,
      contentHash: "0".repeat(64),
    };
    await expect(guard.requireReadable(fabricated)).rejects.toThrow(
      ArtifactNotFoundError,
    );

    /*
     * 指向另一份内容的篡改引用（真实 hash + 虚假长度）同样被拒绝。
     */
    const tampered = { ...ref, byteLength: ref.byteLength + 1 };
    await expect(guard.requireReadable(tampered)).rejects.toThrow(
      ArtifactIntegrityError,
    );
    await expect(store.has(fabricated)).resolves.toBe(false);
  });

  it("receipt 引用必须与状态记录逐字段一致才放行", async () => {
    const { store, guard } = await createStore();
    const key = createArtifactReceiptKey("worker-turn-report", "a".repeat(64));
    const value = { schemaVersion: 1, action: "continue", summary: "继续" };
    const ref = await store.putStructuredReceipt(key, reportSchema, value);

    await expect(
      guard.requireReceipt(key, reportSchema, ref),
    ).resolves.toEqual(value);

    const tampered = { ...ref, contentHash: "b".repeat(64) };
    await expect(
      guard.requireReceipt(key, reportSchema, tampered),
    ).rejects.toThrow(ArtifactIntegrityError);

    const malformed = { ...ref, contentHash: "not-a-hash" };
    await expect(
      guard.requireReceipt(key, reportSchema, malformed),
    ).rejects.toThrow(CanonicalViolationError);
  });
});

describe("FileArtifactStore deterministic receipt", () => {
  it("同键同内容幂等成功，同键不同内容拒绝为协议冲突", async () => {
    const { store } = await createStore();
    const key = createArtifactReceiptKey("worker-turn-report", "c".repeat(64));
    const value = { schemaVersion: 1, action: "request_input", summary: "需要输入" };

    const first = await store.putStructuredReceipt(key, reportSchema, value);
    const second = await store.putStructuredReceipt(key, reportSchema, value);
    expect(second).toEqual(first);

    await expect(
      store.putStructuredReceipt(key, reportSchema, {
        schemaVersion: 1,
        action: "candidate_ready",
        summary: "篡改",
      }),
    ).rejects.toThrow(ArtifactConflictError);

    /*
     * 冲突失败后原内容必须保持可读，冲突写不覆盖已落盘事实。
     */
    await expect(store.readReceipt(key, reportSchema)).resolves.toMatchObject({
      ref: first,
      value,
    });
    await expect(store.hasReceipt(key)).resolves.toBe(true);
  });

  it("未知 receipt 键只报告缺失，不做目录扫描式猜测", async () => {
    const { store } = await createStore();
    const key = createArtifactReceiptKey("worker-turn-report", "d".repeat(64));

    await expect(store.hasReceipt(key)).resolves.toBe(false);
    await expect(store.readReceipt(key, reportSchema)).rejects.toThrow(
      ArtifactNotFoundError,
    );
  });
});

describe("FileArtifactStore 崩溃与腐化路径", () => {
  it("原子替换前崩溃只留下临时文件，不产生可接受引用", async () => {
    const { store, directory, canonicalHash } = await createStore();
    const bytes = new TextEncoder().encode("崩溃前未完成写入");
    const ref = {
      schemaVersion: 1 as const,
      mediaType: "text/plain",
      byteLength: bytes.byteLength,
      contentHash: canonicalHash.digestBytes(bytes),
    };

    /*
     * 模拟崩溃现场：objects 目录中只存在 `.tmp-` 孤儿临时文件。
     * 存在性、读取与后续写入都必须把临时文件当作不存在。
     */
    await mkdir(join(directory, "objects"), { recursive: true });
    await writeFile(join(directory, "objects", ".tmp-1234-0"), bytes);

    await expect(store.has(ref)).resolves.toBe(false);
    await expect(store.read(ref)).rejects.toThrow(ArtifactNotFoundError);

    const persisted = await store.putBytes({ mediaType: "text/plain", bytes });
    expect(persisted).toEqual(ref);
    await expect(store.read(ref)).resolves.toEqual(bytes);
  });

  it("截断文件重算不匹配，读取、校验与重复写入全部 fail closed", async () => {
    const { store, directory } = await createStore();
    const bytes = new TextEncoder().encode("完整的证据内容需要全部被保留");
    const ref = await store.putBytes({ mediaType: "text/plain", bytes });

    /*
     * 模拟磁盘腐化：对象文件被截断。存在性不退化为可用性，
     * 也不允许用正确内容覆盖一个已损坏的不可变对象。
     */
    await writeFile(
      join(directory, "objects", ref.contentHash),
      bytes.subarray(0, 4),
    );

    await expect(store.has(ref)).resolves.toBe(true);
    await expect(store.read(ref)).rejects.toThrow(ArtifactIntegrityError);
    await expect(store.verify(ref)).rejects.toThrow(ArtifactIntegrityError);
    await expect(
      store.putBytes({ mediaType: "text/plain", bytes }),
    ).rejects.toThrow(ArtifactIntegrityError);
  });

  it("落盘字节被替换为重算不符的内容时拒绝读取", async () => {
    const { store, directory } = await createStore();
    const bytes = new TextEncoder().encode("原始证据");
    const ref = await store.putBytes({ mediaType: "text/plain", bytes });

    const replacement = new TextEncoder().encode("被替换的相同长度内容？");
    await writeFile(join(directory, "objects", ref.contentHash), replacement);

    await expect(store.read(ref)).rejects.toThrow(ArtifactIntegrityError);
  });
});

describe("FileArtifactStore 寻址安全", () => {
  it("非法 namespace 与 receipt 键一律拒绝", async () => {
    const { store } = await createStore();
    const value = { schemaVersion: 1, action: "continue", summary: "x" };

    for (const namespace of ["", "..", "../escape", "a/b", "A_UPPER", "a.b"]) {
      await expect(
        store.putStructuredReceipt({ namespace, key: "k" }, reportSchema, value),
      ).rejects.toThrow(ArtifactNamespaceError);
    }
    for (const key of ["", "..", "a/b", "a\\b", "trail.", "a..b"]) {
      await expect(
        store.putStructuredReceipt(
          { namespace: "worker-turn-report", key },
          reportSchema,
          value,
        ),
      ).rejects.toThrow(ArtifactNamespaceError);
    }
  });

  it("形状非法的引用在任何操作上都被拒绝", async () => {
    const { store } = await createStore();
    const malformed = {
      schemaVersion: 1 as const,
      mediaType: "text/plain",
      byteLength: 1,
      contentHash: "NOT-HEX",
    };

    await expect(store.read(malformed)).rejects.toThrow(CanonicalViolationError);
    await expect(store.has(malformed)).rejects.toThrow(CanonicalViolationError);
    await expect(store.verify(malformed)).rejects.toThrow(
      CanonicalViolationError,
    );
  });
});

describe("FileArtifactStore 孤立事实不提升", () => {
  it("孤立 receipt 不会被当前协议键的对账读取接纳", async () => {
    const { store, guard, directory, canonicalHash } = await createStore();
    const orphanValue = {
      schemaVersion: 1,
      action: "candidate_ready",
      summary: "其他 run 遗留的报告",
    };
    const orphanBytes = canonicalHash.encodeStructured(reportSchema, orphanValue);

    /*
     * 模拟恢复现场：磁盘上存在一份内容合法的 receipt，
     * 但它的键不能由当前协议身份（run/scope/session/turn）推导出来。
     * 恢复流程只读取当前 turn 的确定性键，孤立文件不得成为业务事实。
     */
    await mkdir(join(directory, "receipts", "worker-turn-report"), {
      recursive: true,
    });
    await writeFile(
      join(directory, "receipts", "worker-turn-report", "orphan-report"),
      orphanBytes,
    );

    const currentTurnKey = createArtifactReceiptKey(
      "worker-turn-report",
      "e".repeat(64),
    );
    await expect(store.hasReceipt(currentTurnKey)).resolves.toBe(false);
    await expect(
      guard.requireReceipt(currentTurnKey, reportSchema, {
        schemaVersion: 1,
        mediaType: CANONICAL_JSON_MEDIA_TYPE,
        byteLength: orphanBytes.byteLength,
        contentHash: canonicalHash.digestBytes(orphanBytes),
      }),
    ).rejects.toThrow(ArtifactNotFoundError);

    /*
     * 端口不存在任何枚举 receipt 的能力，孤立文件无从被“发现”。
     */
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object)
        .filter((name) => /list|scan|enumerate/iu.test(name)),
    ).toEqual([]);
  });
});
