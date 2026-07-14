/*
 * 初始化器测试验证现有项目中的增量创建、重复执行幂等性和路径类型冲突回滚。
 * 测试只检查路径与文件元数据，不读取任何 Markdown 内容，也不会接触真实项目目录。
 */
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSampleProject } from "../src/cli/sample-project-writer.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

describe("writeSampleProject", () => {
  it("在已有项目目录中创建全部缺失的骨架文件", async () => {
    const root = await createTemporaryRoot();
    await writeFile(join(root, "package.json"), "{}\n", "utf8");

    const result = await writeSampleProject(root);

    expect(result.createdFiles).toHaveLength(5);
    expect(result.skippedFiles).toEqual([]);
    await expect(access(join(root, "orchestrator.yaml"))).resolves.toBeUndefined();
    await expect(access(join(root, "tasks", "TASK-001.md"))).resolves.toBeUndefined();
  });

  it("保留已有普通文件并使重复初始化稳定收敛", async () => {
    const root = await createTemporaryRoot();
    const existingPath = join(root, "SPEC.md");
    await writeFile(existingPath, "existing specification\n", "utf8");
    const before = await stat(existingPath);

    const first = await writeSampleProject(root);
    const afterFirst = await stat(existingPath);
    const second = await writeSampleProject(root);
    const afterSecond = await stat(existingPath);

    expect(first.createdFiles).toHaveLength(4);
    expect(first.skippedFiles).toEqual([existingPath]);
    expect(second.createdFiles).toEqual([]);
    expect(second.skippedFiles).toHaveLength(5);
    expect(afterFirst.size).toBe(before.size);
    expect(afterSecond.size).toBe(before.size);
  });

  it("同名路径不是普通文件时回滚本次创建内容", async () => {
    const root = await createTemporaryRoot();
    const conflictingPath = join(root, "SPEC.md");
    await mkdir(conflictingPath);

    await expect(writeSampleProject(root)).rejects.toThrow(
      "目标路径已存在且不是普通文件",
    );
    await expect(access(join(root, "orchestrator.yaml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const conflictingMetadata = await lstat(conflictingPath);
    expect(conflictingMetadata.isDirectory()).toBe(true);
  });
});

/*
 * 每个用例使用独立临时目录，确保初始化结果和回滚行为之间没有共享状态。
 * 清理逻辑集中在 afterEach，测试失败时也不会遗留生成的任务骨架。
 */
async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-orchestrator-init-"));
  temporaryRoots.push(root);
  return root;
}
