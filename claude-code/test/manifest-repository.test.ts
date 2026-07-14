/*
 * 任务目录测试在独立临时项目中验证版本 2 Manifest、TASK 前置元数据和内容指纹。
 * 用例证明目录是唯一事实源：新增文档会自动进入 DAG，错误元数据不会被静默忽略。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { YamlManifestRepository } from "../src/infrastructure/tasks/yaml-manifest-repository.js";

const temporaryRoots: string[] = [];

interface FixtureOptions {
  readonly catalogDirectory?: string;
  readonly allowPattern?: string;
}

interface ProjectFixture {
  readonly root: string;
  readonly manifestPath: string;
}

async function createProjectFixture(
  options: FixtureOptions = {},
): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-task-manifest-"));
  temporaryRoots.push(root);

  await Promise.all([
    mkdir(join(root, "context"), { recursive: true }),
    mkdir(join(root, "tasks"), { recursive: true }),
  ]);

  const manifestPath = join(root, "orchestrator.yaml");
  const manifest = {
    version: 2,
    project: {
      root: ".",
      spec: "SPEC.md",
      plan: "PLAN.md",
      contextFiles: ["context/ARCHITECTURE.md"],
    },
    defaults: {},
    taskCatalog: {
      directory: options.catalogDirectory ?? "tasks",
    },
    verification: {
      sharedPaths: ["node_modules"],
    },
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
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
        allowPattern: options.allowPattern ?? "src/**",
      }),
      "utf8",
    ),
  ]);

  return { root, manifestPath };
}

/*
 * 测试任务文档使用与生产一致的严格前置元数据，不通过辅助 Schema 绕过解析器。
 * 参数只暴露每个用例需要改变的事实，避免复制大段 YAML 形成测试漂移。
 */
function createTaskDocument(input: {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly allowPattern?: string;
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
}): string {
  const metadata = stringify({
    id: input.id,
    title: input.title,
    dependsOn: input.dependsOn,
    scope: {
      allow: [input.allowPattern ?? "src/**"],
      deny: [],
    },
    gates: [{
      name: "类型检查",
      command: "pnpm",
      args: ["typecheck"],
    }],
    manualAcceptance: [],
    ...input.extraMetadata,
  }).trimEnd();
  return `---\n${metadata}\n---\n\n# ${input.id} — ${input.title}\n\n任务正文。\n`;
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("YamlManifestRepository", () => {
  it("加载项目策略和完整 TASK 目录并收集受保护路径", async () => {
    const fixture = await createProjectFixture();
    const loaded = await new YamlManifestRepository().load(fixture.manifestPath);

    expect(loaded.projectRoot).toBe(resolve(fixture.root));
    expect(loaded.manifest.version).toBe(2);
    expect(loaded.manifest.defaults).toEqual({
      maxAttempts: 3,
      taskTimeoutMinutes: 45,
      maxTurns: 80,
      model: "sonnet",
      effort: "high",
    });
    expect(loaded.manifest.verification).toEqual({
      sharedPaths: ["node_modules"],
    });
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]).toMatchObject({
      id: "TASK-001",
      title: "实现任务目录",
      file: "tasks/TASK-001.md",
      dependsOn: [],
      scope: { allow: ["src/**"], deny: [] },
    });
    expect(loaded.protectedPaths).toEqual([
      "orchestrator.yaml",
      "SPEC.md",
      "PLAN.md",
      "context/ARCHITECTURE.md",
      "tasks/TASK-001.md",
    ]);
    expect(loaded.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("新增 TASK 文档后自动进入稳定 DAG，无需修改 Manifest", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "tasks", "TASK-002.md"),
      createTaskDocument({
        id: "TASK-002",
        title: "消费任务目录",
        dependsOn: ["TASK-001"],
      }),
      "utf8",
    );

    const loaded = await new YamlManifestRepository().load(fixture.manifestPath);

    expect(loaded.tasks.map((task) => task.id)).toEqual(["TASK-001", "TASK-002"]);
    expect(loaded.taskDocuments.size).toBe(2);
  });

  it("拒绝目录越界、scope 越界和文件名与 ID 漂移", async () => {
    const directoryFixture = await createProjectFixture({
      catalogDirectory: "../outside-tasks",
    });
    const scopeFixture = await createProjectFixture({
      allowPattern: "../outside/**",
    });
    const identityFixture = await createProjectFixture();
    const original = await readFile(
      join(identityFixture.root, "tasks", "TASK-001.md"),
      "utf8",
    );
    await writeFile(
      join(identityFixture.root, "tasks", "TASK-001.md"),
      original.replaceAll("TASK-001", "TASK-OTHER"),
      "utf8",
    );
    const repository = new YamlManifestRepository();

    await expect(repository.load(directoryFixture.manifestPath)).rejects.toThrow(
      "必须位于项目根内",
    );
    await expect(repository.load(scopeFixture.manifestPath)).rejects.toThrow(
      "必须位于项目根内",
    );
    await expect(repository.load(identityFixture.manifestPath)).rejects.toThrow(
      "文件名必须与 id 一致",
    );
  });

  it("拒绝静态 status 和其他未知字段，运行状态不能污染任务定义", async () => {
    const fixture = await createProjectFixture();
    const taskPath = join(fixture.root, "tasks", "TASK-001.md");
    await writeFile(
      taskPath,
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
        extraMetadata: { status: "pending" },
      }),
      "utf8",
    );

    await expect(
      new YamlManifestRepository().load(fixture.manifestPath),
    ).rejects.toThrow("Unrecognized key");
  });

  it("任一 TASK 内容变化都会改变整体内容哈希", async () => {
    const fixture = await createProjectFixture();
    const repository = new YamlManifestRepository();
    const initial = await repository.load(fixture.manifestPath);
    const taskPath = join(fixture.root, "tasks", "TASK-001.md");
    const current = await readFile(taskPath, "utf8");
    await writeFile(taskPath, `${current}\n补充验收事实。\n`, "utf8");

    const changed = await repository.load(fixture.manifestPath);

    expect(changed.manifestHash).not.toBe(initial.manifestHash);
  });

  it("拒绝 Manifest 未知字段和旧版本 tasks 数组", async () => {
    const fixture = await createProjectFixture();
    const current = await readFile(fixture.manifestPath, "utf8");
    await writeFile(
      fixture.manifestPath,
      `${current}\ntasks: []\n`,
      "utf8",
    );

    await expect(
      new YamlManifestRepository().load(fixture.manifestPath),
    ).rejects.toThrow("Unrecognized key");
  });
});
