/*
 * 项目契约投影测试锁定完整正文与结构化契约共同参与语义：
 * 等价换行不改变 contract hash，正文、结构化字段或有序数组的任一有效变化都会改变对应摘要。
 */
import { describe, expect, it } from "vitest";
import {
  parseAcceptanceCriteriaDocument,
  parseRequirementsDocument,
  parseSupportedPlatformMatrixDocument,
} from "../src/domain/acceptance-contract.js";
import { encodeCanonicalUtf8 } from "../src/domain/canonical-json.js";
import type { TaskDefinition } from "../src/domain/project.js";
import {
  createPlatformMatrixHash,
  createProjectHash,
  createRequirementSetHash,
  createSpecContractHash,
  createTaskContractHash,
  createTaskSetHash,
  splitTaskDocument,
} from "../src/domain/project-contract.js";
import {
  createPredecessorCompletionFingerprint,
  predecessorCompletionProjectionSchema,
} from "../src/domain/task-completion.js";
import { CanonicalViolationError } from "../src/domain/errors.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

const canonicalHash = new NodeCanonicalHashService();

const demoTask: TaskDefinition = {
  id: "TASK-001",
  title: "实现第一个任务",
  file: "orchestration/tasks/TASK-001.md",
};

/*
 * 投影测试复用生产解析入口构造契约值，只有协议明确可省略的字段
 * 与其显式默认值才能得到同一规范身份。
 */
const demoRequirements = parseRequirementsDocument(
  {
    requirements: [{
      id: "REQ-BUILD-001",
      mandatory: true,
      evidencePolicy: {
        allowedCriterionKinds: ["command"],
        requiredPlatformIds: [],
        requiredResponseSchemas: [],
        requiredEvidence: [],
        finalCandidateRequired: false,
      },
    }],
  },
  "投影测试 SPEC",
);

const demoPlatforms = parseSupportedPlatformMatrixDocument(
  {
    supportedPlatformMatrix: [{
      platformId: "windows-x64",
      os: "windows",
      arch: "x64",
      runtime: "node-22",
      toolchain: "pnpm-11",
      packageManager: "pnpm",
      lineEndingPolicy: "crlf",
    }],
  },
  "投影测试 SPEC",
);

const demoCriteria = parseAcceptanceCriteriaDocument(
  {
    criteria: [{
      id: "AC-001",
      requirementRefs: ["REQ-BUILD-001"],
      kind: "command",
      scope: "full",
      execution: {
        kind: "package_script",
        packageManager: "pnpm",
        script: "test",
        args: [],
        cwdRelative: ".",
        timeoutMs: 900000,
        envProfile: "project_test",
        dependencyProfile: "pnpm_frozen",
      },
      success: "exit_code_zero",
      description: "全量测试通过",
    }],
  },
  "投影测试 TASK",
);

function createSpecInput(body: string) {
  return {
    body,
    requirements: demoRequirements,
    supportedPlatformMatrix: demoPlatforms,
    integrationCriteria: demoCriteria,
  };
}

function createTaskDocument(body: string): string {
  return `---\nid: TASK-001\ntitle: 实现第一个任务\n---\n\n## 任务描述\n\n${body}\n`;
}

describe("splitTaskDocument", () => {
  it("拆分前置元数据与完整正文", () => {
    const split = splitTaskDocument(createTaskDocument("任务正文。"));

    expect(split?.frontMatter).toBe("id: TASK-001\ntitle: 实现第一个任务");
    expect(split?.body).toBe("\n## 任务描述\n\n任务正文。\n");
  });

  it("缺少前置元数据时返回 undefined", () => {
    expect(splitTaskDocument("# 没有元数据\n")).toBeUndefined();
  });
});

describe("createSpecContractHash", () => {
  it("同一规范化正文与契约重复计算得到相同 contract hash", () => {
    const body = "# SPEC\n\n完整规格与架构约束。\n";

    expect(createSpecContractHash(createSpecInput(body), canonicalHash)).toBe(
      createSpecContractHash(createSpecInput(body), canonicalHash),
    );
  });

  it("正文任一变化都会改变 contract hash", () => {
    const base = createSpecContractHash(
      createSpecInput("# SPEC\n\n完整规格。\n"),
      canonicalHash,
    );

    expect(
      createSpecContractHash(
        createSpecInput("# SPEC\n\n完整规格，补充一句。\n"),
        canonicalHash,
      ),
    ).not.toBe(base);
  });

  it("requirements、平台矩阵或 integration criteria 变化都会改变 contract hash", () => {
    const body = "# SPEC\n\n完整规格。\n";
    const base = createSpecContractHash(createSpecInput(body), canonicalHash);

    const changedRequirements = parseRequirementsDocument(
      {
        requirements: [{
          id: "REQ-BUILD-001",
          mandatory: false,
          evidencePolicy: {
            allowedCriterionKinds: ["command"],
            requiredPlatformIds: [],
            requiredResponseSchemas: [],
            requiredEvidence: [],
            finalCandidateRequired: false,
          },
        }],
      },
      "投影测试 SPEC",
    );
    expect(
      createSpecContractHash(
        { ...createSpecInput(body), requirements: changedRequirements },
        canonicalHash,
      ),
    ).not.toBe(base);
    expect(
      createSpecContractHash(
        { ...createSpecInput(body), supportedPlatformMatrix: [] },
        canonicalHash,
      ),
    ).not.toBe(base);
    expect(
      createSpecContractHash(
        {
          ...createSpecInput(body),
          integrationCriteria: parseAcceptanceCriteriaDocument(
            {
              criteria: [{
                id: "AC-001",
                requirementRefs: ["REQ-BUILD-001"],
                kind: "static",
                description: "改为静态审核",
              }],
            },
            "投影测试 SPEC",
          ),
        },
        canonicalHash,
      ),
    ).not.toBe(base);
  });

  it("省略 allowNotApplicable 与显式 false 得到相同 contract hash", () => {
    const explicitCriteria = parseAcceptanceCriteriaDocument(
      {
        criteria: [{
          id: "AC-001",
          requirementRefs: ["REQ-BUILD-001"],
          kind: "command",
          scope: "full",
          execution: {
            kind: "package_script",
            packageManager: "pnpm",
            script: "test",
            args: [],
            cwdRelative: ".",
            timeoutMs: 900000,
            envProfile: "project_test",
            dependencyProfile: "pnpm_frozen",
          },
          success: "exit_code_zero",
          allowNotApplicable: false,
          description: "全量测试通过",
        }],
      },
      "投影测试 TASK",
    );

    expect(
      createSpecContractHash(
        { ...createSpecInput("# SPEC\n"), integrationCriteria: explicitCriteria },
        canonicalHash,
      ),
    ).toBe(createSpecContractHash(createSpecInput("# SPEC\n"), canonicalHash));
  });
});

describe("createTaskContractHash", () => {
  it("等价换行的正文得到相同 contract hash", () => {
    const lfBody = "\n## 任务描述\n\n任务正文。\n";
    const crlfSource = createTaskDocument("任务正文。").replaceAll("\n", "\r\n");
    /*
     * CRLF 源文本在加载边界归一化为 LF，因此投影输入与 LF 版本完全一致。
     */
    const normalized = crlfSource.replaceAll("\r\n", "\n");
    const crlfBody = splitTaskDocument(normalized)?.body ?? "";
    const specContractHash = createSpecContractHash(
      createSpecInput("# SPEC\n"),
      canonicalHash,
    );

    expect(crlfBody).toBe(lfBody);
    expect(
      createTaskContractHash(
        {
          task: demoTask,
          body: crlfBody,
          acceptanceCriteria: demoCriteria,
          specContractHash,
        },
        canonicalHash,
      ),
    ).toBe(
      createTaskContractHash(
        {
          task: demoTask,
          body: lfBody,
          acceptanceCriteria: demoCriteria,
          specContractHash,
        },
        canonicalHash,
      ),
    );
  });

  it("正文变化但 YAML 未改时 contract hash 必须变化", () => {
    const specContractHash = createSpecContractHash(
      createSpecInput("# SPEC\n"),
      canonicalHash,
    );
    const base = createTaskContractHash(
      {
        task: demoTask,
        body: splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "",
        acceptanceCriteria: demoCriteria,
        specContractHash,
      },
      canonicalHash,
    );
    const changed = createTaskContractHash(
      {
        task: demoTask,
        body: splitTaskDocument(createTaskDocument("任务正文，补充验收事实。"))
          ?.body ?? "",
        acceptanceCriteria: demoCriteria,
        specContractHash,
      },
      canonicalHash,
    );

    expect(changed).not.toBe(base);
  });

  it("验收契约变化会改变 contract hash", () => {
    const body = splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "";
    const specContractHash = createSpecContractHash(
      createSpecInput("# SPEC\n"),
      canonicalHash,
    );
    const base = createTaskContractHash(
      {
        task: demoTask,
        body,
        acceptanceCriteria: demoCriteria,
        specContractHash,
      },
      canonicalHash,
    );
    const changedCriteria = parseAcceptanceCriteriaDocument(
      {
        criteria: [{
          id: "AC-001",
          requirementRefs: ["REQ-BUILD-001"],
          kind: "command",
          scope: "targeted",
          execution: {
            kind: "package_script",
            packageManager: "pnpm",
            script: "test",
            args: [],
            cwdRelative: ".",
            timeoutMs: 900000,
            envProfile: "project_test",
            dependencyProfile: "pnpm_frozen",
          },
          success: "exit_code_zero",
          description: "全量测试通过",
        }],
      },
      "投影测试 TASK",
    );

    expect(
      createTaskContractHash(
        {
          task: demoTask,
          body,
          acceptanceCriteria: changedCriteria,
          specContractHash,
        },
        canonicalHash,
      ),
    ).not.toBe(base);
  });

  it("SPEC 契约变化会使任务契约失效", () => {
    const body = splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "";
    const base = createTaskContractHash(
      {
        task: demoTask,
        body,
        acceptanceCriteria: demoCriteria,
        specContractHash: createSpecContractHash(
          createSpecInput("# SPEC v1\n"),
          canonicalHash,
        ),
      },
      canonicalHash,
    );
    const changed = createTaskContractHash(
      {
        task: demoTask,
        body,
        acceptanceCriteria: demoCriteria,
        specContractHash: createSpecContractHash(
          createSpecInput("# SPEC v2\n"),
          canonicalHash,
        ),
      },
      canonicalHash,
    );

    expect(changed).not.toBe(base);
  });

  it("标题或 id 变化会改变 contract hash", () => {
    const body = splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "";
    const specContractHash = createSpecContractHash(
      createSpecInput("# SPEC\n"),
      canonicalHash,
    );
    const base = createTaskContractHash(
      {
        task: demoTask,
        body,
        acceptanceCriteria: demoCriteria,
        specContractHash,
      },
      canonicalHash,
    );

    expect(
      createTaskContractHash(
        {
          task: { ...demoTask, title: "实现更名后的任务" },
          body,
          acceptanceCriteria: demoCriteria,
          specContractHash,
        },
        canonicalHash,
      ),
    ).not.toBe(base);
    expect(
      createTaskContractHash(
        {
          task: { ...demoTask, id: "TASK-002" },
          body,
          acceptanceCriteria: demoCriteria,
          specContractHash,
        },
        canonicalHash,
      ),
    ).not.toBe(base);
  });
});

describe("createProjectHash", () => {
  const specification = {
    path: "orchestration/SPEC.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("# SPEC\n")),
  };
  const taskA = {
    path: "orchestration/tasks/TASK-001.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("A")),
  };
  const taskB = {
    path: "orchestration/tasks/TASK-002.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("B")),
  };

  it("相同项目重复计算得到相同 project hash", () => {
    expect(
      createProjectHash(
        { specification, tasks: [taskA, taskB] },
        canonicalHash,
      ),
    ).toBe(
      createProjectHash(
        { specification, tasks: [taskA, taskB] },
        canonicalHash,
      ),
    );
  });

  it("有序任务数组的顺序变化会改变 project hash", () => {
    const base = createProjectHash(
      { specification, tasks: [taskA, taskB] },
      canonicalHash,
    );

    expect(
      createProjectHash(
        { specification, tasks: [taskB, taskA] },
        canonicalHash,
      ),
    ).not.toBe(base);
  });

  it("任一源摘要变化都会改变 project hash", () => {
    const base = createProjectHash(
      { specification, tasks: [taskA] },
      canonicalHash,
    );

    expect(
      createProjectHash(
        {
          specification: {
            ...specification,
            sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("# 变更\n")),
          },
          tasks: [taskA],
        },
        canonicalHash,
      ),
    ).not.toBe(base);
  });
});

describe("合同身份投影", () => {
  it("requirement 集合身份稳定且随内容变化", () => {
    const base = createRequirementSetHash(demoRequirements, canonicalHash);

    expect(createRequirementSetHash(demoRequirements, canonicalHash)).toBe(base);
    const changed = parseRequirementsDocument(
      {
        requirements: [{
          id: "REQ-BUILD-001",
          mandatory: true,
          evidencePolicy: {
            allowedCriterionKinds: ["command", "static"],
            requiredPlatformIds: [],
            requiredResponseSchemas: [],
            requiredEvidence: [],
            finalCandidateRequired: false,
          },
        }],
      },
      "投影测试 SPEC",
    );
    expect(createRequirementSetHash(changed, canonicalHash)).not.toBe(base);
  });

  it("requirement 集合保持领域顺序，顺序变化改变身份", () => {
    const extra = parseRequirementsDocument(
      {
        requirements: [
          {
            id: "REQ-BUILD-001",
            mandatory: true,
            evidencePolicy: {
              allowedCriterionKinds: ["command"],
              requiredPlatformIds: [],
              requiredResponseSchemas: [],
              requiredEvidence: [],
              finalCandidateRequired: false,
            },
          },
          {
            id: "REQ-ARCH-001",
            mandatory: false,
            evidencePolicy: {
              allowedCriterionKinds: ["static"],
              requiredPlatformIds: [],
              requiredResponseSchemas: [],
              requiredEvidence: [],
              finalCandidateRequired: false,
            },
          },
        ],
      },
      "投影测试 SPEC",
    );
    const reversed = [...extra].reverse();

    expect(createRequirementSetHash(extra, canonicalHash)).not.toBe(
      createRequirementSetHash(reversed, canonicalHash),
    );
  });

  it("平台矩阵身份稳定且随内容变化", () => {
    const base = createPlatformMatrixHash(demoPlatforms, canonicalHash);

    expect(createPlatformMatrixHash(demoPlatforms, canonicalHash)).toBe(base);
    const changed = parseSupportedPlatformMatrixDocument(
      {
        supportedPlatformMatrix: [{
          platformId: "windows-x64",
          os: "windows",
          arch: "x64",
          runtime: "node-22",
          toolchain: "pnpm-11",
          packageManager: "pnpm",
          lineEndingPolicy: "lf",
        }],
      },
      "投影测试 SPEC",
    );
    expect(createPlatformMatrixHash(changed, canonicalHash)).not.toBe(base);
    expect(createPlatformMatrixHash([], canonicalHash)).not.toBe(base);
  });

  it("task-set 身份绑定线性顺序的全部 TASK 契约指纹", () => {
    const first = {
      id: "TASK-001",
      contractHash: canonicalHash.digestBytes(encodeCanonicalUtf8("A")),
    };
    const second = {
      id: "TASK-002",
      contractHash: canonicalHash.digestBytes(encodeCanonicalUtf8("B")),
    };
    const base = createTaskSetHash([first, second], canonicalHash);

    expect(createTaskSetHash([first, second], canonicalHash)).toBe(base);
    expect(createTaskSetHash([second, first], canonicalHash)).not.toBe(base);
    expect(
      createTaskSetHash(
        [{
          id: "TASK-001",
          contractHash: canonicalHash.digestBytes(encodeCanonicalUtf8("C")),
        }, second],
        canonicalHash,
      ),
    ).not.toBe(base);
  });
});

describe("createPredecessorCompletionFingerprint", () => {
  it("根任务与后继任务使用同一规范哈希入口", () => {
    const root = createPredecessorCompletionFingerprint(undefined, canonicalHash);
    const next = createPredecessorCompletionFingerprint(
      { taskId: "TASK-001", commitSha: "a".repeat(40) },
      canonicalHash,
    );

    expect(root).toMatch(/^[0-9a-f]{64}$/u);
    expect(next).toMatch(/^[0-9a-f]{64}$/u);
    expect(next).not.toBe(root);
    expect(
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "a".repeat(40) },
        canonicalHash,
      ),
    ).toBe(next);
  });

  it("拒绝 Schema 外联合分支与非法提交 OID", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "not-an-oid" },
        service,
      )
    ).toThrow(CanonicalViolationError);
    expect(() =>
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "A".repeat(40) },
        service,
      )
    ).toThrow(CanonicalViolationError);
  });

  it("拒绝未知联合分支、多余字段和缺失字段", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: "trunk",
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: {
          taskId: "TASK-001",
          commitSha: "a".repeat(40),
          extra: true,
        },
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: { taskId: "TASK-001" },
      })
    ).toThrow(CanonicalViolationError);
  });
});
