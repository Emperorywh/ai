/*
 * 项目仓储测试在独立临时目录中验证唯一规格、TASK 前置元数据和内容指纹。
 * 用例同时证明旧根目录文件与配置文件不会参与加载，项目结构只有程序内一套事实源。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { FileProjectRepository } from "../src/infrastructure/tasks/file-project-repository.js";

const temporaryRoots: string[] = [];

interface ProjectFixture {
  readonly root: string;
}

async function createProjectFixture(): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-task-project-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "orchestration", "tasks"), { recursive: true });

  await Promise.all([
    writeFile(
      join(root, "orchestration", "SPEC.md"),
      "# SPEC\n\n完整规格与架构约束。\n",
      "utf8",
    ),
    writeFile(
      join(root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
      }),
      "utf8",
    ),
  ]);

  return { root };
}

/*
 * 测试任务文档使用与生产一致的严格前置元数据，不通过辅助 Schema 绕过解析器。
 * 参数只暴露每个用例需要改变的事实，避免复制大段 YAML 形成测试漂移。
 */
function createTaskDocument(input: {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
}): string {
  const metadata = stringify({
    id: input.id,
    title: input.title,
    dependsOn: input.dependsOn,
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

describe("FileProjectRepository", () => {
  it("按集中式项目结构加载唯一规格和完整 TASK 目录", async () => {
    const fixture = await createProjectFixture();
    const loaded = await new FileProjectRepository().load(fixture.root);

    expect(loaded.projectRoot).toBe(resolve(fixture.root));
    expect(loaded.specificationDocument.path).toBe("orchestration/SPEC.md");
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]).toMatchObject({
      id: "TASK-001",
      title: "实现任务目录",
      file: "orchestration/tasks/TASK-001.md",
      dependsOn: [],
    });
    expect(loaded.projectHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(loaded.taskContractHashes.get("TASK-001")).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("新增 TASK 文档后自动进入稳定 DAG，无需同步维护索引", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-002.md"),
      createTaskDocument({
        id: "TASK-002",
        title: "消费任务目录",
        dependsOn: ["TASK-001"],
      }),
      "utf8",
    );

    const loaded = await new FileProjectRepository().load(fixture.root);

    expect(loaded.tasks.map((task) => task.id)).toEqual(["TASK-001", "TASK-002"]);
    expect(loaded.taskDocuments.size).toBe(2);
  });

  it("拒绝缺失的唯一规格、旧根目录 fallback 和文件名与 ID 漂移", async () => {
    const missingTemplateFixture = await createProjectFixture();
    const identityFixture = await createProjectFixture();
    await rm(join(missingTemplateFixture.root, "orchestration", "SPEC.md"));
    await writeFile(
      join(missingTemplateFixture.root, "SPEC.md"),
      "# 旧根目录规格\n",
      "utf8",
    );
    const original = await readFile(
      join(identityFixture.root, "orchestration", "tasks", "TASK-001.md"),
      "utf8",
    );
    await writeFile(
      join(identityFixture.root, "orchestration", "tasks", "TASK-001.md"),
      original.replaceAll("TASK-001", "TASK-OTHER"),
      "utf8",
    );
    const repository = new FileProjectRepository();

    await expect(repository.load(missingTemplateFixture.root)).rejects.toThrow(
      "orchestration/SPEC.md 无法读取",
    );
    await expect(repository.load(identityFixture.root)).rejects.toThrow(
      "文件名必须与 id 一致",
    );
  });

  it("拒绝静态 status 和其他未知字段，运行状态不能污染任务定义", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
        extraMetadata: { status: "pending" },
      }),
      "utf8",
    );

    await expect(
      new FileProjectRepository().load(fixture.root),
    ).rejects.toThrow("Unrecognized key");
  });

  it("任一 TASK 内容变化都会改变项目和任务契约指纹", async () => {
    const fixture = await createProjectFixture();
    const repository = new FileProjectRepository();
    const initial = await repository.load(fixture.root);
    const taskPath = join(
      fixture.root,
      "orchestration",
      "tasks",
      "TASK-001.md",
    );
    const current = await readFile(taskPath, "utf8");
    await writeFile(taskPath, `${current}\n补充验收事实。\n`, "utf8");

    const changed = await repository.load(fixture.root);

    expect(changed.projectHash).not.toBe(initial.projectHash);
    expect(changed.taskContractHashes.get("TASK-001")).not.toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
  });

  it("唯一规格变化会使全部 TASK 完成契约失效", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-002.md"),
      createTaskDocument({
        id: "TASK-002",
        title: "实现第二个独立任务",
        dependsOn: [],
      }),
      "utf8",
    );
    const repository = new FileProjectRepository();
    const initial = await repository.load(fixture.root);

    /*
     * SPEC 是所有 TASK 共享的完成定义输入，规格变化必须确定性地使全部历史证据失效。
     * 测试使用两个独立任务，避免只验证单任务时遗漏契约哈希的批量传播语义。
     */
    await writeFile(
      join(fixture.root, "orchestration", "SPEC.md"),
      "# SPEC\n\n变更后的完整规格与架构约束。\n",
      "utf8",
    );
    const changed = await repository.load(fixture.root);

    expect(changed.projectHash).not.toBe(initial.projectHash);
    for (const taskId of ["TASK-001", "TASK-002"]) {
      expect(changed.taskContractHashes.get(taskId)).not.toBe(
        initial.taskContractHashes.get(taskId),
      );
    }
  });

  it("单任务资源熔断变化不让已完成任务契约失效", async () => {
    const fixture = await createProjectFixture();
    const repository = new FileProjectRepository();
    const initial = await repository.load(fixture.root);
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
        extraMetadata: { maxAttempts: 9, timeoutMinutes: 120 },
      }),
      "utf8",
    );

    const changed = await repository.load(fixture.root);

    /*
     * 项目哈希仍变化以阻止同一 Run 混用熔断值，但完成定义保持稳定。
     * 新 Run 因此可以调整单任务资源保护，而不浪费已经审核通过的完成证据。
     */
    expect(changed.projectHash).not.toBe(initial.projectHash);
    expect(changed.taskContractHashes.get("TASK-001")).toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
  });

  it("忽略任意同名 YAML 文件，不提供文件配置入口", async () => {
    const fixture = await createProjectFixture();
    const repository = new FileProjectRepository();
    const initial = await repository.load(fixture.root);
    await writeFile(
      join(fixture.root, "orchestrator.yaml"),
      "version: invalid\ntasks: []\nreview: false\n",
      "utf8",
    );

    const loaded = await repository.load(fixture.root);

    expect(loaded.projectHash).toBe(initial.projectHash);
    expect(loaded.tasks.map((task) => task.id)).toEqual(["TASK-001"]);
  });

  it("拒绝旧 scope 和 gates 字段，不保留隐式兼容路径", async () => {
    const fixture = await createProjectFixture();
    /*
     * 当前 TASK 契约只有一套能力模型，旧边界字段必须显式报错。
     * 测试同时写入两类旧字段，避免未来只恢复其中一半形成不可推导的灰度行为。
     */
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        dependsOn: [],
        extraMetadata: {
          scope: { allow: ["src/**"], deny: [] },
          gates: [{ name: "test", command: "pnpm", args: ["test"] }],
        },
      }),
      "utf8",
    );

    await expect(
      new FileProjectRepository().load(fixture.root),
    ).rejects.toThrow("Unrecognized keys");
  });
});
