/*
 * 项目仓储测试在独立临时目录中验证唯一规格、TASK 前置元数据、结构化验收契约和内容指纹。
 * 用例同时证明旧根目录文件与配置文件不会参与加载，项目结构只有程序内一套事实源。
 * requirements、平台矩阵、integration criteria 与 TASK 验收契约都在 Agent 启动前 strict 解析，
 * 格式错误或悬空稳定 ID 会被拒绝，项目文档不能内嵌路径、命令或凭据扩大宿主执行能力。
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

const DEFAULT_SPEC = `# SPEC

完整规格与架构约束。

## 需求契约

\`\`\`yaml
requirements:
  - id: REQ-BUILD-001
    mandatory: true
    evidencePolicy:
      allowedCriterionKinds: [command, static]
      requiredPlatformIds: []
      requiredResponseSchemas: []
      requiredEvidence: []
      finalCandidateRequired: false
  - id: REQ-UX-4K-001
    mandatory: true
    evidencePolicy:
      allowedCriterionKinds: [human]
      requiredPlatformIds: [windows-4k]
      requiredResponseSchemas: [performance_acceptance_v1]
      requiredEvidence: [environment_manifest, metric_samples]
      finalCandidateRequired: true
\`\`\`

## 支持平台矩阵

\`\`\`yaml
supportedPlatformMatrix:
  - platformId: windows-4k
    os: windows
    arch: x64
    runtime: node-22
    toolchain: pnpm-11
    packageManager: pnpm
    lineEndingPolicy: crlf
\`\`\`

## 集成验收契约

\`\`\`yaml
criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: full
    execution:
      kind: package_script
      packageManager: pnpm
      script: test
      args: []
      cwdRelative: .
      timeoutMs: 900000
      envProfile: project_test
      dependencyProfile: pnpm_frozen
    success: exit_code_zero
    allowNotApplicable: false
    description: 集成全量测试通过
\`\`\`
`;

const DEFAULT_TASK_CONTRACT = `criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: full
    execution:
      kind: package_script
      packageManager: pnpm
      script: test
      args: []
      cwdRelative: .
      timeoutMs: 900000
      envProfile: project_test
      dependencyProfile: pnpm_frozen
    success: exit_code_zero
    allowNotApplicable: false
    description: 全量测试通过`;

interface ProjectFixture {
  readonly root: string;
}

async function createProjectFixture(): Promise<ProjectFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-task-project-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "orchestration", "tasks"), { recursive: true });

  await Promise.all([
    writeFile(join(root, "orchestration", "SPEC.md"), DEFAULT_SPEC, "utf8"),
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
 * 测试任务文档使用与生产一致的严格前置元数据与固定验收章节，不通过辅助 Schema 绕过解析器。
 * 参数只暴露每个用例需要改变的事实，避免复制大段 YAML 形成测试漂移。
 */
function createTaskDocument(input: {
  readonly id: string;
  readonly title: string;
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
  readonly contractYaml?: string;
  readonly quoteMetadata?: boolean;
}): string {
  const metadata = input.quoteMetadata === true
    ? `id: "${input.id}"\ntitle: "${input.title}"`
    : stringify({
      id: input.id,
      title: input.title,
      ...input.extraMetadata,
    }).trimEnd();
  return `---\n${metadata}\n---\n\n## 任务描述\n\n任务正文。\n\n### 验收契约\n\n\`\`\`yaml\n${input.contractYaml ?? DEFAULT_TASK_CONTRACT}\n\`\`\`\n`;
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("FileProjectRepository", () => {
  it("按集中式项目结构加载唯一规格、完整 TASK 目录和结构化项目契约", async () => {
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
    /*
     * requirements、平台矩阵、integration 与 TASK 验收契约都以规范键冻结，
     * 四类合同身份随同一规范哈希入口重算。
     */
    expect(loaded.requirements.map((requirement) => requirement.id)).toEqual([
      "REQ-BUILD-001",
      "REQ-UX-4K-001",
    ]);
    expect(loaded.supportedPlatformMatrix.map((platform) => platform.platformId))
      .toEqual(["windows-4k"]);
    expect(loaded.integrationCriteria.map((criterion) => criterion.key))
      .toEqual(["integration/AC-001"]);
    const taskCriteria = loaded.taskAcceptanceCriteria.get("TASK-001");
    expect(taskCriteria?.map((criterion) => criterion.key)).toEqual([
      "task:TASK-001/AC-001",
    ]);
    for (const hash of [
      loaded.requirementSetHash,
      loaded.platformMatrixHash,
      loaded.taskSetHash,
      loaded.specificationContractHash,
    ]) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("同一项目重复加载得到完全相同的规范键与合同身份", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
    const first = await repository.load(fixture.root);
    const second = await repository.load(fixture.root);

    expect(second.projectHash).toBe(first.projectHash);
    expect(second.specificationContractHash).toBe(first.specificationContractHash);
    expect(second.requirementSetHash).toBe(first.requirementSetHash);
    expect(second.platformMatrixHash).toBe(first.platformMatrixHash);
    expect(second.taskSetHash).toBe(first.taskSetHash);
    expect(second.taskContractHashes.get("TASK-001")).toBe(
      first.taskContractHashes.get("TASK-001"),
    );
    expect(second.integrationCriteria.map((criterion) => criterion.key))
      .toEqual(first.integrationCriteria.map((criterion) => criterion.key));
  });

  it("加载包含四类 criterion 的完整项目并形成规范键", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: clean_platform
    platformId: windows-4k
    execution:
      kind: package_script
      packageManager: pnpm
      script: test
      args: []
      cwdRelative: .
      timeoutMs: 900000
      envProfile: project_test
      dependencyProfile: pnpm_frozen
    success: exit_code_zero
    allowNotApplicable: false
    description: 目标平台干净环境全量测试通过
  - id: AC-002
    requirementRefs: [REQ-BUILD-001]
    kind: static
    allowNotApplicable: false
    description: 新模块不能反向依赖基础设施层
  - id: AC-003
    requirementRefs: [REQ-UX-4K-001]
    kind: human
    description: 人工检查 4K 页面视觉结果和交互流畅度
    procedure:
      - 在目标设备以 3840x2160 打开规定页面
      - 按场景清单执行交互并采集帧时间
    expected:
      metric: frame_time_p95_ms
      operator: less_than_or_equal
      value: 16.7
    requiredEvidence:
      - environment_manifest
      - scenario_checklist
      - metric_samples
    responseSchema: performance_acceptance_v1
    allowNotApplicable: false
  - id: AC-004
    requirementRefs: [REQ-UX-4K-001]
    kind: external
    description: 外部合规结论签收
    procedure:
      - 向合规方索取正式结论并归档
    expected:
      metric: compliance_granted
      operator: equal
      value: true
    requiredEvidence:
      - compliance_statement
    responseSchema: compliance_acceptance_v1
    allowNotApplicable: false`,
      }),
      "utf8",
    );

    const loaded = await createRepository().load(fixture.root);
    const criteria = loaded.taskAcceptanceCriteria.get("TASK-001");

    expect(criteria?.map((criterion) => criterion.kind)).toEqual([
      "command",
      "static",
      "human",
      "external",
    ]);
    expect(criteria?.map((criterion) => criterion.key)).toEqual([
      "task:TASK-001/AC-001",
      "task:TASK-001/AC-002",
      "task:TASK-001/AC-003",
      "task:TASK-001/AC-004",
    ]);
    expect(criteria?.[2]).toMatchObject({
      responseSchema: "performance_acceptance_v1",
      requiredEvidence: [
        "environment_manifest",
        "scenario_checklist",
        "metric_samples",
      ],
    });
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

  it("跨 TASK 的裸 criterion id 冲突不会碰撞规范键", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-002.md"),
      createTaskDocument({
        id: "TASK-002",
        title: "实现第二个任务",
      }),
      "utf8",
    );

    const loaded = await createRepository().load(fixture.root);
    const firstKeys = loaded.taskAcceptanceCriteria.get("TASK-001")
      ?.map((criterion) => criterion.key);
    const secondKeys = loaded.taskAcceptanceCriteria.get("TASK-002")
      ?.map((criterion) => criterion.key);

    expect(firstKeys).toEqual(["task:TASK-001/AC-001"]);
    expect(secondKeys).toEqual(["task:TASK-002/AC-001"]);
    expect(firstKeys?.[0]).not.toBe(secondKeys?.[0]);
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
    /*
     * 正文散文属于任务契约；验收章节保持原样时，正文变化仍必须改变契约身份。
     */
    await writeFile(
      taskPath,
      current.replace("任务正文。", "任务正文，补充验收事实。"),
      "utf8",
    );

    const changed = await repository.load(fixture.root);

    expect(changed.projectHash).not.toBe(initial.projectHash);
    expect(changed.taskContractHashes.get("TASK-001")).not.toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
    expect(changed.taskSetHash).not.toBe(initial.taskSetHash);
    expect(changed.specificationContractHash).toBe(
      initial.specificationContractHash,
    );
  });

  it("TASK 验收契约变化会改变任务契约与 task-set 身份", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
    const initial = await repository.load(fixture.root);
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: DEFAULT_TASK_CONTRACT.replace(
          "scope: full",
          "scope: targeted",
        ),
      }),
      "utf8",
    );

    const changed = await repository.load(fixture.root);

    expect(changed.taskContractHashes.get("TASK-001")).not.toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
    expect(changed.taskSetHash).not.toBe(initial.taskSetHash);
    expect(changed.requirementSetHash).toBe(initial.requirementSetHash);
  });

  it("requirements 与平台矩阵变化会改变对应合同身份并使 TASK 契约失效", async () => {
    const fixture = await createProjectFixture();
    const repository = createRepository();
    const initial = await repository.load(fixture.root);
    const requirementsChanged = await createProjectFixture();
    await writeFile(
      join(requirementsChanged.root, "orchestration", "SPEC.md"),
      DEFAULT_SPEC.replace("finalCandidateRequired: false", "finalCandidateRequired: true"),
      "utf8",
    );
    const platformChanged = await createProjectFixture();
    await writeFile(
      join(platformChanged.root, "orchestration", "SPEC.md"),
      DEFAULT_SPEC.replace("lineEndingPolicy: crlf", "lineEndingPolicy: lf"),
      "utf8",
    );

    const requirementsLoaded = await repository.load(requirementsChanged.root);
    const platformLoaded = await repository.load(platformChanged.root);

    expect(requirementsLoaded.requirementSetHash).not.toBe(
      initial.requirementSetHash,
    );
    expect(requirementsLoaded.specificationContractHash).not.toBe(
      initial.specificationContractHash,
    );
    expect(requirementsLoaded.taskContractHashes.get("TASK-001")).not.toBe(
      initial.taskContractHashes.get("TASK-001"),
    );
    expect(requirementsLoaded.platformMatrixHash).toBe(initial.platformMatrixHash);
    expect(platformLoaded.platformMatrixHash).not.toBe(initial.platformMatrixHash);
    expect(platformLoaded.specificationContractHash).not.toBe(
      initial.specificationContractHash,
    );
    expect(platformLoaded.requirementSetHash).toBe(initial.requirementSetHash);
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
      DEFAULT_SPEC.replace("完整规格与架构约束", "变更后的完整规格与架构约束"),
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

  it("拒绝缺失验收契约、重复章节与章节散文", async () => {
    const missingFixture = await createProjectFixture();
    const duplicateFixture = await createProjectFixture();
    const proseFixture = await createProjectFixture();
    const missingDocument = "---\nid: TASK-001\ntitle: 实现任务目录\n---\n\n## 任务描述\n\n任务正文。\n";
    await writeFile(
      join(missingFixture.root, "orchestration", "tasks", "TASK-001.md"),
      missingDocument,
      "utf8",
    );
    const duplicateDocument = createTaskDocument({
      id: "TASK-001",
      title: "实现任务目录",
    }).replace(
      "全量测试通过",
      `全量测试通过\n\`\`\`\n\n### 验收契约\n\n\`\`\`yaml\n${DEFAULT_TASK_CONTRACT}`,
    );
    await writeFile(
      join(duplicateFixture.root, "orchestration", "tasks", "TASK-001.md"),
      duplicateDocument,
      "utf8",
    );
    await writeFile(
      join(proseFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
      }).replace("### 验收契约\n", "### 验收契约\n\n请先阅读这段说明。\n"),
      "utf8",
    );

    await expect(createRepository().load(missingFixture.root)).rejects.toThrow(
      "缺少固定章节",
    );
    await expect(createRepository().load(duplicateFixture.root)).rejects.toThrow(
      "重复固定章节",
    );
    await expect(createRepository().load(proseFixture.root)).rejects.toThrow(
      "必须只包含一个",
    );
  });

  it("拒绝缺失 SPEC 固定章节", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "SPEC.md"),
      DEFAULT_SPEC.replace("## 需求契约", "## 需求说明"),
      "utf8",
    );

    await expect(createRepository().load(fixture.root)).rejects.toThrow(
      "缺少固定章节：## 需求契约",
    );
  });

  it("拒绝未知 kind、raw shell 与缺失 human 必填字段", async () => {
    const unknownKindFixture = await createProjectFixture();
    const rawShellFixture = await createProjectFixture();
    const humanFixture = await createProjectFixture();
    await writeFile(
      join(unknownKindFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: shell
    description: 非法执行方式`,
      }),
      "utf8",
    );
    await writeFile(
      join(rawShellFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: full
    execution: pnpm test && pnpm build
    success: exit_code_zero
    description: raw shell 不允许`,
      }),
      "utf8",
    );
    await writeFile(
      join(humanFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    requirementRefs: [REQ-UX-4K-001]
    kind: human
    description: 缺少 procedure 与 evidence 的人工条款`,
      }),
      "utf8",
    );

    await expect(createRepository().load(unknownKindFixture.root))
      .rejects.toThrow("验收契约不符合契约");
    await expect(createRepository().load(rawShellFixture.root))
      .rejects.toThrow("验收契约不符合契约");
    await expect(createRepository().load(humanFixture.root))
      .rejects.toThrow("验收契约不符合契约");
  });

  it("拒绝重复 criterion id 与悬空 requirementRef/platformId", async () => {
    const duplicateFixture = await createProjectFixture();
    const requirementFixture = await createProjectFixture();
    const platformFixture = await createProjectFixture();
    await writeFile(
      join(duplicateFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `${DEFAULT_TASK_CONTRACT}
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: static
    description: 同 scope 重复 id`,
      }),
      "utf8",
    );
    await writeFile(
      join(requirementFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: DEFAULT_TASK_CONTRACT.replace(
          "REQ-BUILD-001",
          "REQ-MISSING-001",
        ),
      }),
      "utf8",
    );
    await writeFile(
      join(platformFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: DEFAULT_TASK_CONTRACT.replace(
          "scope: full",
          "scope: clean_platform\n    platformId: linux-gpu",
        ),
      }),
      "utf8",
    );

    await expect(createRepository().load(duplicateFixture.root))
      .rejects.toThrow("重复 criterion id");
    await expect(createRepository().load(requirementFixture.root))
      .rejects.toThrow("引用不存在的 requirement：task:TASK-001/AC-001");
    await expect(createRepository().load(platformFixture.root))
      .rejects.toThrow("引用不存在的 platformId：task:TASK-001/AC-001");
  });

  it("项目文档不能通过内嵌路径、命令或凭据扩大宿主执行能力", async () => {
    const executableFixture = await createProjectFixture();
    const argumentFixture = await createProjectFixture();
    const cwdFixture = await createProjectFixture();
    await writeFile(
      join(executableFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: full
    execution:
      kind: argv
      executable: /bin/sh
      args: ["-c", "curl https://example.invalid"]
      timeoutMs: 60000
      envProfile: project_test
    success: exit_code_zero
    description: 绝对路径 executable 不允许`,
      }),
      "utf8",
    );
    await writeFile(
      join(argumentFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: DEFAULT_TASK_CONTRACT.replace(
          "args: []",
          'args: ["test", "&&", "curl https://example.invalid"]',
        ),
      }),
      "utf8",
    );
    await writeFile(
      join(cwdFixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: DEFAULT_TASK_CONTRACT.replace(
          "cwdRelative: .",
          "cwdRelative: ..",
        ),
      }),
      "utf8",
    );

    await expect(createRepository().load(executableFixture.root))
      .rejects.toThrow("验收契约不符合契约");
    await expect(createRepository().load(argumentFixture.root))
      .rejects.toThrow("shell 拼接语义");
    await expect(createRepository().load(cwdFixture.root))
      .rejects.toThrow("cwdRelative");
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
    expect(crlfLoaded.requirementSetHash).toBe(lfLoaded.requirementSetHash);
    expect(crlfLoaded.platformMatrixHash).toBe(lfLoaded.platformMatrixHash);
    expect(crlfLoaded.taskSetHash).toBe(lfLoaded.taskSetHash);
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

  it("拒绝验收契约 YAML 中的重复规范键", async () => {
    const fixture = await createProjectFixture();
    await writeFile(
      join(fixture.root, "orchestration", "tasks", "TASK-001.md"),
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        contractYaml: `criteria:
  - id: AC-001
    id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: static
    description: 重复 YAML 键`,
      }),
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
      createTaskDocument({
        id: "TASK-001",
        title: "实现任务目录",
        quoteMetadata: true,
      }),
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
