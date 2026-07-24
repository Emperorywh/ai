/*
 * 项目仓储测试在独立临时目录中验证唯一规格、TASK 前置元数据和内容指纹。
 * 用例同时证明旧根目录文件与配置文件不会参与加载，项目结构只有程序内一套事实源。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";
import { FileProjectRepository } from "../src/infrastructure/tasks/file-project-repository.js";

function createRepository(): FileProjectRepository {
  return new FileProjectRepository(new NodeCanonicalHashService());
}

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
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
}): string {
  const metadata = stringify({
    id: input.id,
    title: input.title,
    ...input.extraMetadata,
  }).trimEnd();
  return `---\n${metadata}\n---\n\n## 任务描述\n\n任务正文。\n`;
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
    const loaded = await createRepository().load(fixture.root);

    expect(loaded.projectRoot).toBe(resolve(fixture.root));
    expect(loaded.specificationDocument.path).toBe("orchestration/SPEC.md");
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]).toMatchObject({
      id: "TASK-001",
      title: "实现任务目录",
      file: "orchestration/tasks/TASK-001.md",
    });
    expect(loaded.projectHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(loaded.taskContractHashes.get("TASK-001")).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("新增 TASK 文档后按数字而非文件名字符串排序，无需同步维护索引", async () => {
    const fixture = await createProjectFixture();
    await Promise.all([
      writeFile(
        join(fixture.root, "orchestration", "tasks", "TASK-010.md"),
        createTaskDocument({
          id: "TASK-010",
          title: "实现第十个任务",
        }),
        "utf8",
      ),
      writeFile(
        join(fixture.root, "orchestration", "tasks", "TASK-002.md"),
        createTaskDocument({
          id: "TASK-002",
          title: "实现第二个任务",
        }),
        "utf8",
      ),
    ]);

    const loaded = await createRepository().load(fixture.root);

    expect(loaded.tasks.map((task) => task.id)).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-010",
    ]);
    expect(loaded.taskDocuments.size).toBe(3);
  });

  it("拒绝旧重复标题、缺失任务描述和空正文", async () => {
    const duplicateHeadingFixture = await createProjectFixture();
    const emptyBodyFixture = await createProjectFixture();
    const duplicateHeadingPath = join(
      duplicateHeadingFixture.root,
      "orchestration",
      "tasks",
      "TASK-001.md",
    );
    const duplicateHeadingDocument = await readFile(duplicateHeadingPath, "utf8");
    await Promise.all([
      writeFile(
        duplicateHeadingPath,
        duplicateHeadingDocument.replace(
          "## 任务描述",
          "# TASK-001 — 实现任务目录\n\n## 任务描述",
        ),
        "utf8",
      ),
      writeFile(
        join(emptyBodyFixture.root, "orchestration", "tasks", "TASK-001.md"),
        "---\nid: TASK-001\ntitle: 实现任务目录\n---\n\n## 任务描述\n\n",
        "utf8",
      ),
    ]);

    /*
     * 标题身份只能存在于 YAML，正文入口和非空内容也属于同一严格模板。
     * 两类错误都必须在启动 Agent 前由仓储拒绝，不能依赖提示词阶段猜测文档结构。
     */
    await expect(
      createRepository().load(duplicateHeadingFixture.root),
    ).rejects.toThrow("TASK 正文必须使用");
    await expect(
      createRepository().load(emptyBodyFixture.root),
    ).rejects.toThrow("TASK 正文必须使用");
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
      original.replaceAll("TASK-001", "TASK-002"),
      "utf8",
    );
    const repository = createRepository();

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
        extraMetadata: { status: "pending" },
      }),
      "utf8",
    );

    await expect(
      createRepository().load(fixture.root),
    ).rejects.toThrow("Unrecognized key");
  });

  it("任一 TASK 内容变化都会改变项目和任务契约指纹", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
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
      }),
      "utf8",
    );
    const repository = createRepository();
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

  it("拒绝依赖、资源熔断和人工验收旧字段", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        extraMetadata: {
          dependsOn: [],
          maxAttempts: 9,
          timeoutMinutes: 120,
          manualAcceptance: ["人工浏览器验收"],
        },
      }),
      "utf8",
    );

    /*
     * 线性前驱由 ID 顺序推导，执行限制属于系统策略，验收要求属于任务正文或 SPEC。
     * 严格 Schema 必须一次拒绝所有旧入口，不能静默忽略并形成灰度契约。
     */
    await expect(
      createRepository().load(fixture.root),
    ).rejects.toThrow("Unrecognized keys");
  });

  it("忽略任意同名 YAML 文件，不提供文件配置入口", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
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
        extraMetadata: {
          scope: { allow: ["src/**"], deny: [] },
          gates: [{ name: "test", command: "pnpm", args: ["test"] }],
        },
      }),
      "utf8",
    );

    await expect(
      createRepository().load(fixture.root),
    ).rejects.toThrow("Unrecognized keys");
  });

  it("等价 LF/CRLF 源文本得到相同 source/contract/project 摘要", async () => {
    const lfFixture = await createProjectFixture();
    const crlfFixture = await createProjectFixture();
    const repository = createRepository();
    const lfLoaded = await repository.load(lfFixture.root);
    /*
     * 等价换行的同一项目在任何受支持平台上必须得到同一组规范摘要。
     * 正文其他字符不参与归一化，CRLF 与 LF 在加载边界统一为 LF。
     */
    for (const relativePath of [
      "orchestration/SPEC.md",
      "orchestration/tasks/TASK-001.md",
    ]) {
      const path = join(crlfFixture.root, ...relativePath.split("/"));
      const content = await readFile(path, "utf8");
      await writeFile(path, content.replaceAll("\n", "\r\n"), "utf8");
    }
    const crlfLoaded = await repository.load(crlfFixture.root);

    expect(crlfLoaded.projectHash).toBe(lfLoaded.projectHash);
    expect(crlfLoaded.specificationContractHash).toBe(
      lfLoaded.specificationContractHash,
    );
    expect(crlfLoaded.specificationDocument.sourceHash).toBe(
      lfLoaded.specificationDocument.sourceHash,
    );
    expect(crlfLoaded.taskContractHashes.get("TASK-001")).toBe(
      lfLoaded.taskContractHashes.get("TASK-001"),
    );
    expect(crlfLoaded.specificationDocument.content).not.toContain("\r");
  });

  it("拒绝携带 BOM 或 NUL 的源文本", async () => {
    const bomFixture = await createProjectFixture();
    const nulFixture = await createProjectFixture();
    const bomPath = join(bomFixture.root, "orchestration", "SPEC.md");
    const nulPath = join(nulFixture.root, "orchestration", "SPEC.md");
    const bomContent = await readFile(bomPath);
    await writeFile(
      bomPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bomContent]),
    );
    const nulContent = await readFile(nulPath);
    await writeFile(
      nulPath,
      Buffer.concat([nulContent, Buffer.from([0x00])]),
    );

    await expect(createRepository().load(bomFixture.root)).rejects.toThrow(
      "BOM",
    );
    await expect(createRepository().load(nulFixture.root)).rejects.toThrow(
      "NUL",
    );
  });

  it("拒绝前置元数据中的重复规范键", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      "---\nid: TASK-001\nid: TASK-001\ntitle: 实现任务目录\n---\n\n## 任务描述\n\n任务正文。\n",
      "utf8",
    );

    await expect(createRepository().load(fixture.root)).rejects.toThrow(
      "无法解析",
    );
  });

  it("前置元数据格式变化不改变契约哈希，但改变 source hash", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
    const initial = await repository.load(fixture.root);
    /*
     * 契约哈希只绑定语义事实；前置元数据的 YAML 引号风格不属于契约。
     * source hash 绑定规范化字节，因此仍会发现文档被编辑过。
     */
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      "---\nid: \"TASK-001\"\ntitle: \"实现任务目录\"\n---\n\n## 任务描述\n\n任务正文。\n",
      "utf8",
    );
    const changed = await repository.load(fixture.root);

    expect(changed.taskContractHashes.get("TASK-001")).toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
    expect(
      changed.taskDocuments.get("TASK-001")?.sourceHash,
    ).not.toBe(initial.taskDocuments.get("TASK-001")?.sourceHash);
    expect(changed.projectHash).not.toBe(initial.projectHash);
  });
});
