/*
 * 文件状态库存放在 Git common dir 中，不会让运行日志和快照污染目标项目工作区。
 * 每次保存先写临时文件再原子替换，latest 指针仅用于 CLI 便捷查询而非调度真相。
 */
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { runStateSchema, type RunState } from "../../domain/run-state.js";
import { InfrastructureError } from "../../domain/errors.js";
import type { StateStore } from "../../ports/state-store.js";

export class FileStateStore implements StateStore {
  public constructor(private readonly baseDirectory: string) {}

  public async save(state: RunState): Promise<void> {
    const runDirectory = this.getRunDirectory(state.runId);
    await mkdir(runDirectory, { recursive: true });
    await this.atomicWrite(
      join(runDirectory, "state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    await mkdir(this.baseDirectory, { recursive: true });
    await this.atomicWrite(join(this.baseDirectory, "latest"), `${state.runId}\n`);
  }

  public async load(runId: string): Promise<RunState | undefined> {
    const path = join(this.getRunDirectory(runId), "state.json");
    try {
      const content = await readFile(path, "utf8");
      const parsed = runStateSchema.safeParse(JSON.parse(content) as unknown);
      if (!parsed.success) {
        throw new InfrastructureError(
          `运行状态损坏：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
        );
      }
      return parsed.data;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return undefined;
      }
      if (error instanceof InfrastructureError) {
        throw error;
      }
      throw new InfrastructureError(`无法读取运行状态 ${runId}`, {
        cause: error,
      });
    }
  }

  public async getLatestRunId(): Promise<string | undefined> {
    try {
      const content = await readFile(join(this.baseDirectory, "latest"), "utf8");
      const runId = content.trim();
      if (runId.length > 0 && await this.hasState(runId)) {
        return runId;
      }
      return await this.findLatestPersistedRunId();
    } catch (error) {
      if (this.isMissingFile(error)) {
        return await this.findLatestPersistedRunId();
      }
      throw new InfrastructureError("无法读取 latest 运行指针", { cause: error });
    }
  }

  private async findLatestPersistedRunId(): Promise<string | undefined> {
    const runsDirectory = join(this.baseDirectory, "runs");
    try {
      const entries = await readdir(runsDirectory, { withFileTypes: true });
      const candidates = entries
        .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9._-]+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const runId of candidates) {
        if (await this.hasState(runId)) {
          return runId;
        }
      }
      return undefined;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return undefined;
      }
      throw new InfrastructureError("无法扫描运行状态目录", { cause: error });
    }
  }

  private async hasState(runId: string): Promise<boolean> {
    try {
      await access(join(this.getRunDirectory(runId), "state.json"));
      return true;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return false;
      }
      throw error;
    }
  }

  public async writeArtifact(
    runId: string,
    name: string,
    content: string,
  ): Promise<string> {
    if (basename(name) !== name || name.includes("..")) {
      throw new InfrastructureError(`非法产物名称：${name}`);
    }
    const runDirectory = this.getRunDirectory(runId);
    await mkdir(runDirectory, { recursive: true });
    const path = join(runDirectory, name);
    await this.atomicWrite(path, content);
    return path;
  }

  private getRunDirectory(runId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
      throw new InfrastructureError(`非法 runId：${runId}`);
    }
    return join(this.baseDirectory, "runs", runId);
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    const handle = await open(temporaryPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private isMissingFile(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
