/*
 * Manifest 仓储测试在独立临时项目中验证 YAML、文档、路径边界和内容指纹。
 * 用例不依赖当前仓库文件，也不会把运行状态或测试数据泄漏到真实工作区。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { YamlManifestRepository } from "../src/infrastructure/tasks/yaml-manifest-repository.js";

const temporaryRoots: string[] = [];

interface FixtureOptions {
  readonly taskFile?: string;
  readonly allowPattern?: string;
}

interface ProjectFixture {
  readonly root: string;
  readonly manifestPath: string;
}

/**
 * 夹具只声明契约要求的最小字段，其余字段应由 Zod Schema 统一提供默认值。
 * 任务文件始终写在项目内；越界用例只改变 Manifest 声明，以验证读取前的边界检查。
 */
async function createProjectFixture(
  options: FixtureOptions = {},
): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-task-manifest-"));
  temporaryRoots.push(root);

  await Promise.all([
    mkdir(join(root, "context"), { recursive: true }),
    mkdir(join(root, "tasks"), { recursive: true }),
  ]);

  const manifestPath = join(root, "task-manifest.yaml");
  const manifest = {
    version: 1,
    project: {
      root: ".",
      spec: "SPEC.md",
      plan: "PLAN.md",
      contextFiles: ["context/ARCHITECTURE.md"],
    },
    defaults: {},
    tasks: [
      {
        id: "TASK-001",
        title: "实现任务队列",
        file: options.taskFile ?? "tasks/TASK-001.md",
        scope: {
          allow: [options.allowPattern ?? "src/**"],
        },
        gates: [
          {
            name: "类型检查",
            command: "pnpm",
          },
        ],
      },
    ],
  };

  await Promise.all([
    writeFile(manifestPath, stringify(manifest), "utf8"),
    writeFile(join(root, "SPEC.md"), "# SPEC\n\n完整规格。\n", "utf8"),
    writeFile(join(root, "PLAN.md"), "# PLAN\n\n开发计划。\n", "utf8"),
    writeFile(
      join(root, "context", "ARCHITECTURE.md"),
      "# 架构\n\n领域层不依赖基础设施。\n",
      "utf8",
    ),
    writeFile(
      join(root, "tasks", "TASK-001.md"),
      "# TASK-001\n\n实现单并发任务队列。\n",
      "utf8",
    ),
  ]);

  return { root, manifestPath };
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("YamlManifestRepository", () => {
  it("从临时目录加载 YAML、补齐默认值并收集受保护路径", async () => {
    const fixture = await createProjectFixture();
    const loaded = await new YamlManifestRepository().load(
      fixture.manifestPath,
    );

    expect(loaded.projectRoot).toBe(resolve(fixture.root));
    expect(loaded.manifestPath).toBe(resolve(fixture.manifestPath));
    expect(loaded.manifest.defaults).toEqual({
      maxAttempts: 3,
      taskTimeoutMinutes: 45,
      maxTurns: 80,
      model: "sonnet",
      effort: "high",
    });
    expect(loaded.manifest.review).toEqual({
      enabled: true,
      maxAttempts: 2,
      model: "sonnet",
      effort: "high",
      maxTurns: 30,
    });
    expect(loaded.manifest.git).toEqual({ commitMessagePrefix: "task" });
    expect(loaded.manifest.tasks[0]).toMatchObject({
      dependsOn: [],
      scope: { allow: ["src/**"], deny: [] },
      gates: [
        {
          name: "类型检查",
          command: "pnpm",
          args: [],
          timeoutMinutes: 15,
        },
      ],
      manualAcceptance: [],
    });
    expect(loaded.contextDocuments.map((document) => document.path)).toEqual([
      "SPEC.md",
      "PLAN.md",
      "context/ARCHITECTURE.md",
    ]);
    expect(loaded.taskDocuments.get("TASK-001")).toEqual({
      path: "tasks/TASK-001.md",
      content: "# TASK-001\n\n实现单并发任务队列。\n",
    });
    expect(loaded.protectedPaths).toEqual([
      "task-manifest.yaml",
      "SPEC.md",
      "PLAN.md",
      "context/ARCHITECTURE.md",
      "tasks/TASK-001.md",
    ]);
    expect(loaded.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("拒绝任务文档和路径规则逃逸项目根目录", async () => {
    const documentFixture = await createProjectFixture({
      taskFile: "../outside-task.md",
    });
    const scopeFixture = await createProjectFixture({
      allowPattern: "../outside/**",
    });
    const repository = new YamlManifestRepository();

    await expect(
      repository.load(documentFixture.manifestPath),
    ).rejects.toThrow(
      "必须位于项目根内",
    );
    await expect(repository.load(scopeFixture.manifestPath)).rejects.toThrow(
      "必须位于项目根内",
    );
  });

  it("文档内容变化时生成新的整体内容哈希", async () => {
    const fixture = await createProjectFixture();
    const repository = new YamlManifestRepository();
    const initial = await repository.load(fixture.manifestPath);
    const unchanged = await repository.load(fixture.manifestPath);

    await writeFile(
      join(fixture.root, "tasks", "TASK-001.md"),
      "# TASK-001\n\n实现队列，并持久化恢复点。\n",
      "utf8",
    );
    const changed = await repository.load(fixture.manifestPath);

    expect(unchanged.manifestHash).toBe(initial.manifestHash);
    expect(changed.manifestHash).not.toBe(initial.manifestHash);
  });

  it("拒绝未知字段，避免配置拼写错误被静默忽略", async () => {
    const fixture = await createProjectFixture();
    const current = await readFile(fixture.manifestPath, "utf8");
    await writeFile(
      fixture.manifestPath,
      `${current}\nunexpectedOption: true\n`,
      "utf8",
    );

    await expect(
      new YamlManifestRepository().load(fixture.manifestPath),
    ).rejects.toThrow("Unrecognized key");
  });
});
