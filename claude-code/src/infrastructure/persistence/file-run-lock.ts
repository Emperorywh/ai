/*
 * 锁文件用独占创建保证同一 Git worktree 同时只有一个编排器进程，解析不完整的锁一律按占用处理。
 * 只有确认记录合法且 PID 已不存在时才回收旧锁，避免创建与写入窗口被另一个进程误删。
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { RunLockedError } from "../../domain/errors.js";
import type { RunLock, RunLockHandle } from "../../ports/run-lock.js";

interface LockRecord {
  readonly token: string;
  readonly runId: string;
  readonly pid: number;
  readonly createdAt: string;
}

const MAX_ACQUIRE_ATTEMPTS = 3;

export class FileRunLock implements RunLock {
  private readonly lockPath: string;

  public constructor(private readonly baseDirectory: string) {
    this.lockPath = join(baseDirectory, "active.lock");
  }

  public async acquire(runId: string): Promise<RunLockHandle> {
    await mkdir(this.baseDirectory, { recursive: true });
    const record: LockRecord = {
      token: randomUUID(),
      runId,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };

    for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      try {
        await this.createLock(record);
        return this.createHandle(record);
      } catch (error) {
        if (!this.isAlreadyExists(error)) {
          throw error;
        }

        const existing = await this.readExistingLock();
        if (existing === undefined) {
          continue;
        }
        if (this.isProcessAlive(existing.pid)) {
          throw new RunLockedError(
            `当前 Git worktree 已有运行中的编排器：runId=${existing.runId}，pid=${existing.pid}`,
          );
        }
        await unlink(this.lockPath).catch((unlinkError: unknown) => {
          if (!isMissingFile(unlinkError)) {
            throw unlinkError;
          }
        });
      }
    }

    throw new RunLockedError("锁竞争持续发生，无法安全取得项目独占权");
  }

  private createHandle(record: LockRecord): RunLockHandle {
    let released = false;
    return {
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        const current = await this.readExistingLock();
        if (current?.token === record.token) {
          await unlink(this.lockPath).catch((error: unknown) => {
            if (!isMissingFile(error)) {
              throw error;
            }
          });
        }
      },
    };
  }

  private async createLock(record: LockRecord): Promise<void> {
    const handle = await open(this.lockPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async readExistingLock(): Promise<LockRecord | undefined> {
    let content: string;
    try {
      content = await readFile(this.lockPath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }

    try {
      const value = JSON.parse(content) as unknown;
      if (!isLockRecord(value)) {
        throw new Error("字段不完整");
      }
      return value;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RunLockedError(
        `锁文件尚未写完或已经损坏；为避免双实例，不会自动删除：${reason}`,
      );
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private isAlreadyExists(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
  }
}

function isLockRecord(value: unknown): value is LockRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.token === "string"
    && typeof record.runId === "string"
    && typeof record.pid === "number"
    && Number.isInteger(record.pid)
    && record.pid > 0
    && typeof record.createdAt === "string";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
