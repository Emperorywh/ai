/*
 * 持久化测试使用独立临时目录验证原子状态快照、latest 指针和进程级独占锁。
 * 锁文件解析失败必须保持失败关闭，只有合法且确认失活的 PID 记录才允许自动回收。
 */
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialRunState } from "../src/domain/run-state.js";
import { FileRunLock } from "../src/infrastructure/persistence/file-run-lock.js";
import { FileStateStore } from "../src/infrastructure/persistence/file-state-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })),
  );
});

describe("FileStateStore", () => {
  it("接受明确包含北京时间偏移的文件安全运行 ID", async () => {
    const directory = await createTemporaryDirectory();
    const store = new FileStateStore(directory);
    const state = createInitialRunState({
      runId: "2026-07-15T03-28-40-710+08-00-1234abcd",
      projectHash: "hash",
      projectRoot: "/project",
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base",
      },
      tasks: [{ taskId: "TASK-001" }],
      now: "2026-07-14T19:28:40.710Z",
    });

    /*
     * 加号只表达固定 UTC 偏移，不是路径分隔符；状态目录仍由严格白名单约束。
     * round-trip 同时证明 latest 扫描和精确加载都接受新的运行 ID 契约。
     */
    await store.save(state);

    await expect(store.load(state.runId)).resolves.toEqual(state);
    await expect(store.getLatestRunId()).resolves.toBe(state.runId);
  });

  it("连续原子覆盖状态，并维护 latest 与安全产物路径", async () => {
    const directory = await createTemporaryDirectory();
    const store = new FileStateStore(directory);
    const initial = createInitialRunState({
      runId: "run-atomic",
      projectHash: "hash",
      projectRoot: "/project",
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base",
      },
      tasks: [{ taskId: "TASK-001" }],
      now: "2026-07-13T00:00:00.000Z",
    });
    const updated = {
      ...initial,
      updatedAt: "2026-07-13T00:00:01.000Z",
    };

    await store.save(initial);
    await store.save(updated);

    await expect(store.load(initial.runId)).resolves.toEqual(updated);
    await expect(store.getLatestRunId()).resolves.toBe(initial.runId);
    await unlink(join(directory, "latest"));
    await expect(store.getLatestRunId()).resolves.toBe(initial.runId);
    const artifact = await store.writeArtifact(
      initial.runId,
      "summary.md",
      "# summary\n",
    );
    await expect(readFile(artifact, "utf8")).resolves.toBe("# summary\n");
    await expect(
      store.writeArtifact(initial.runId, "../escape.md", "unsafe"),
    ).rejects.toThrow("非法产物名称");
  });

  it("拒绝没有版本 4 标记的旧状态快照", async () => {
    const directory = await createTemporaryDirectory();
    const store = new FileStateStore(directory);
    const runDirectory = join(directory, "runs", "run-old-state");
    await mkdir(runDirectory, { recursive: true });
    /*
     * 旧状态不能被隐式补默认值，否则候选归档、依赖阻塞和审核语义会变得不可推导。
     * 明确拒绝后，操作者只能创建符合当前契约的新运行。
     */
    await writeFile(
      join(runDirectory, "state.json"),
      JSON.stringify({ runId: "run-old-state", status: "running" }),
      "utf8",
    );

    await expect(store.load("run-old-state")).rejects.toThrow("运行状态损坏");
  });
});

describe("FileRunLock", () => {
  it("拒绝同目录双实例，并在持有者释放后允许重新取得", async () => {
    const directory = await createTemporaryDirectory();
    const lock = new FileRunLock(directory);
    const first = await lock.acquire("run-first");

    await expect(lock.acquire("run-second")).rejects.toThrow("已有运行中的编排器");
    await first.release();
    const second = await lock.acquire("run-second");
    await second.release();
  });

  it("不删除无法解析的锁，但回收合法的失活 PID 锁", async () => {
    const directory = await createTemporaryDirectory();
    const lockPath = join(directory, "active.lock");
    const lock = new FileRunLock(directory);
    await writeFile(lockPath, "{\"token\":", "utf8");

    await expect(lock.acquire("run-invalid")).rejects.toThrow("不会自动删除");
    await expect(readFile(lockPath, "utf8")).resolves.toBe("{\"token\":");

    await writeFile(lockPath, JSON.stringify({
      token: "stale-token",
      runId: "run-stale",
      pid: 2_147_483_647,
      createdAt: "2026-07-13T00:00:00.000Z",
    }), "utf8");
    const recovered = await lock.acquire("run-recovered");
    await recovered.release();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "claude-orchestrator-state-"));
  temporaryDirectories.push(directory);
  return directory;
}
