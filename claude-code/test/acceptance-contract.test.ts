/*
 * 验收契约领域测试锁定四类 criterion、requirements、平台矩阵的 strict 语法形状与跨引用规则：
 * 未知 kind、未知字段、重复规范键、空描述、raw shell、非法 argv、缺失 human/external 字段和
 * 悬空稳定 ID 都在任何 Agent 启动前 fail closed，不存在宽松解析或自动补全。
 */
import { describe, expect, it } from "vitest";
import {
  attachCriterionKeys,
  canonicalCriterionKey,
  parseAcceptanceCriteriaDocument,
  parseRequirementsDocument,
  parseSupportedPlatformMatrixDocument,
  validateProjectContractReferences,
  type AcceptanceCriterion,
} from "../src/domain/acceptance-contract.js";

const commandCriterion = {
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
};

const staticCriterion = {
  id: "AC-002",
  requirementRefs: ["REQ-ARCH-001"],
  kind: "static",
  allowNotApplicable: false,
  description: "新模块不能反向依赖基础设施层",
};

const humanCriterion = {
  id: "AC-003",
  requirementRefs: ["REQ-UX-4K-001"],
  kind: "human",
  description: "人工检查 4K 页面视觉结果和交互流畅度",
  procedure: [
    "在目标设备以 3840x2160 打开规定页面",
    "按场景清单执行交互并采集帧时间",
  ],
  expected: {
    metric: "frame_time_p95_ms",
    operator: "less_than_or_equal",
    value: 16.7,
  },
  requiredEvidence: [
    "environment_manifest",
    "scenario_checklist",
    "metric_samples",
  ],
  responseSchema: "performance_acceptance_v1",
  allowNotApplicable: false,
};

const externalCriterion = {
  id: "AC-004",
  requirementRefs: ["REQ-COMPLIANCE-001"],
  kind: "external",
  description: "政治数据逐项人工审核",
  procedure: ["按数据来源清单逐项核对地图政治数据"],
  expected: {
    metric: "reviewed_item_ratio",
    operator: "equal",
    value: 1,
  },
  requiredEvidence: ["item_checklist", "data_provenance", "reviewer_identity"],
  responseSchema: "political_data_acceptance_v1",
  allowNotApplicable: false,
};

const requirementDocuments = {
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
    {
      id: "REQ-UX-4K-001",
      mandatory: true,
      evidencePolicy: {
        allowedCriterionKinds: ["human"],
        requiredPlatformIds: ["windows-4k-target-gpu"],
        requiredResponseSchemas: ["performance_acceptance_v1"],
        requiredEvidence: ["environment_manifest", "metric_samples"],
        finalCandidateRequired: true,
      },
    },
    {
      id: "REQ-COMPLIANCE-001",
      mandatory: true,
      evidencePolicy: {
        allowedCriterionKinds: ["external"],
        requiredPlatformIds: [],
        requiredResponseSchemas: ["political_data_acceptance_v1"],
        requiredEvidence: ["item_checklist", "data_provenance"],
        finalCandidateRequired: true,
      },
    },
  ],
};

const platformDocument = {
  supportedPlatformMatrix: [{
    platformId: "windows-4k-target-gpu",
    os: "windows",
    arch: "x64",
    runtime: "node-22",
    toolchain: "pnpm-11",
    packageManager: "pnpm",
    lineEndingPolicy: "crlf",
  }],
};

function parseCriteria(criteria: readonly unknown[]) {
  return parseAcceptanceCriteriaDocument({ criteria }, "测试 TASK");
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([entryKey]) => entryKey !== key),
  ) as Omit<T, K>;
}

describe("parseAcceptanceCriteriaDocument", () => {
  it("解析 command/static/human/external 四类 criterion", () => {
    const criteria = parseCriteria([
      commandCriterion,
      staticCriterion,
      humanCriterion,
      externalCriterion,
    ]);

    expect(criteria).toHaveLength(4);
    expect(criteria.map((criterion) => criterion.kind)).toEqual([
      "command",
      "static",
      "human",
      "external",
    ]);
  });

  it("省略的可选字段应用契约默认值", () => {
    const [command] = parseCriteria([{
      id: "AC-001",
      requirementRefs: ["REQ-BUILD-001"],
      kind: "command",
      scope: "targeted",
      execution: {
        kind: "package_script",
        packageManager: "pnpm",
        script: "test",
        timeoutMs: 900000,
        envProfile: "project_test",
        dependencyProfile: "pnpm_frozen",
      },
      success: "exit_code_zero",
      description: "定向测试通过",
    }]);

    expect(command).toMatchObject({
      allowNotApplicable: false,
      execution: { args: [], cwdRelative: "." },
    });
  });

  it("argv 执行描述只携带宿主稳定 ID", () => {
    const [command] = parseCriteria([{
      ...commandCriterion,
      execution: {
        kind: "argv",
        executable: "node",
        args: ["--version"],
        timeoutMs: 60000,
        envProfile: "project_test",
      },
    }]);

    expect(command).toMatchObject({
      execution: { kind: "argv", executable: "node", cwdRelative: "." },
    });
  });

  it("拒绝缺少 criteria 键、空 criteria 和额外根字段", () => {
    expect(() => parseAcceptanceCriteriaDocument({}, "测试 TASK")).toThrow(
      "验收契约不符合契约",
    );
    expect(() => parseCriteria([])).toThrow("验收契约不符合契约");
    expect(() =>
      parseAcceptanceCriteriaDocument(
        { criteria: [staticCriterion], extra: true },
        "测试 TASK",
      )
    ).toThrow("验收契约不符合契约");
  });

  it("拒绝未知 kind 与未知字段", () => {
    expect(() =>
      parseCriteria([{ ...staticCriterion, kind: "shell" }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([{ ...staticCriterion, notes: "宽松备注" }])
    ).toThrow("验收契约不符合契约");
  });

  it("拒绝重复 criterion id 与非法 id", () => {
    expect(() =>
      parseCriteria([
        staticCriterion,
        { ...staticCriterion, description: "另一条同 id 条款" },
      ])
    ).toThrow("重复 criterion id");
    for (const id of ["ac-001", "AC-1", "AC-001/AC-002", "验收-001"]) {
      expect(() => parseCriteria([{ ...staticCriterion, id }])).toThrow(
        "验收契约不符合契约",
      );
    }
  });

  it("拒绝空描述与空 requirementRefs", () => {
    expect(() =>
      parseCriteria([{ ...staticCriterion, description: "   " }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([{ ...staticCriterion, requirementRefs: [] }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([
        { ...staticCriterion, requirementRefs: ["REQ-ARCH-001", "REQ-ARCH-001"] },
      ])
    ).toThrow("重复条目");
  });

  it("拒绝 raw shell 执行描述", () => {
    expect(() =>
      parseCriteria([{ ...commandCriterion, execution: "pnpm test" }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([
        {
          ...commandCriterion,
          execution: { kind: "shell", command: "pnpm test && pnpm build" },
        },
      ])
    ).toThrow("验收契约不符合契约");
  });

  it("拒绝携带路径或实现语义的 executable 与 packageManager", () => {
    for (const executable of [
      "/bin/sh",
      "./node",
      "../tools/node",
      "node.exe",
      "C:\\tools\\node.exe",
      "node -e",
    ]) {
      expect(() =>
        parseCriteria([
          {
            ...commandCriterion,
            execution: {
              kind: "argv",
              executable,
              args: [],
              timeoutMs: 60000,
              envProfile: "project_test",
            },
          },
        ])
      ).toThrow("验收契约不符合契约");
    }
    expect(() =>
      parseCriteria([
        {
          ...commandCriterion,
          execution: {
            ...commandCriterion.execution,
            packageManager: "/usr/local/bin/pnpm",
          },
        },
      ])
    ).toThrow("验收契约不符合契约");
  });

  it("拒绝包含 shell 拼接语义的参数与空参数", () => {
    for (const arg of [
      "--flag; rm -rf /",
      "a && b",
      "a || b",
      "a | b",
      "out > file",
      "in < file",
      "run `whoami`",
      "$(whoami)",
      "${HOME}",
      "line\nbreak",
      "",
    ]) {
      expect(() =>
        parseCriteria([
          {
            ...commandCriterion,
            execution: { ...commandCriterion.execution, args: [arg] },
          },
        ])
      ).toThrow(/shell 拼接语义|验收契约不符合契约/u);
    }
  });

  it("拒绝越出项目的 cwdRelative", () => {
    for (const cwdRelative of [
      "/etc",
      "C:/work",
      "..",
      "src/../outside",
      "src\\scripts",
      "src//scripts",
    ]) {
      expect(() =>
        parseCriteria([
          {
            ...commandCriterion,
            execution: { ...commandCriterion.execution, cwdRelative },
          },
        ])
      ).toThrow("cwdRelative");
    }
    const [command] = parseCriteria([
      {
        ...commandCriterion,
        execution: { ...commandCriterion.execution, cwdRelative: "packages/app" },
      },
    ]);
    expect(command).toMatchObject({
      execution: { cwdRelative: "packages/app" },
    });
  });

  it("拒绝非法 timeoutMs、缺失 profile 与非法 success", () => {
    for (const timeoutMs of [0, -1, 1.5, "900000"]) {
      expect(() =>
        parseCriteria([
          {
            ...commandCriterion,
            execution: { ...commandCriterion.execution, timeoutMs },
          },
        ])
      ).toThrow("验收契约不符合契约");
    }
    const missingEnv = omit(commandCriterion.execution, "envProfile");
    expect(() =>
      parseCriteria([
        { ...commandCriterion, execution: missingEnv },
      ])
    ).toThrow("验收契约不符合契约");
    const missingDep = omit(commandCriterion.execution, "dependencyProfile");
    expect(() =>
      parseCriteria([
        { ...commandCriterion, execution: missingDep },
      ])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([{ ...commandCriterion, success: "output_contains_ok" }])
    ).toThrow("验收契约不符合契约");
  });

  it("clean_platform 必须声明 platformId，其他 kind 不得携带 command 字段", () => {
    expect(() =>
      parseCriteria([{ ...commandCriterion, scope: "clean_platform" }])
    ).toThrow("必须声明 platformId");
    const [clean] = parseCriteria([
      {
        ...commandCriterion,
        scope: "clean_platform",
        platformId: "windows-4k-target-gpu",
      },
    ]);
    expect(clean).toMatchObject({ scope: "clean_platform" });
    expect(() =>
      parseCriteria([{ ...staticCriterion, scope: "full" }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([{ ...staticCriterion, execution: commandCriterion.execution }])
    ).toThrow("验收契约不符合契约");
  });

  it("human/external 必须包含 procedure、结构化 expected、非空 requiredEvidence 和版本化 responseSchema", () => {
    expect(() => parseCriteria([omit(humanCriterion, "procedure")])).toThrow(
      "验收契约不符合契约",
    );
    expect(() => parseCriteria([omit(humanCriterion, "expected")])).toThrow(
      "验收契约不符合契约",
    );
    expect(() => parseCriteria([omit(humanCriterion, "requiredEvidence")])).toThrow(
      "验收契约不符合契约",
    );
    expect(() => parseCriteria([omit(humanCriterion, "responseSchema")])).toThrow(
      "验收契约不符合契约",
    );
    expect(() =>
      parseCriteria([{ ...humanCriterion, procedure: [] }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([{ ...humanCriterion, requiredEvidence: [] }])
    ).toThrow("验收契约不符合契约");
  });

  it("拒绝未版本化 responseSchema、自由文本 expected 与重复 requiredEvidence", () => {
    for (const responseSchema of [
      "performance_acceptance",
      "performance_acceptance_v0",
      "PERFORMANCE_ACCEPTANCE_V1",
    ]) {
      expect(() =>
        parseCriteria([{ ...humanCriterion, responseSchema }])
      ).toThrow("验收契约不符合契约");
    }
    expect(() =>
      parseCriteria([{ ...humanCriterion, expected: "看起来正常" }])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([
        {
          ...humanCriterion,
          expected: { metric: "fps", operator: "about", value: 60 },
        },
      ])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([
        {
          ...humanCriterion,
          expected: { metric: "fps", operator: "equal", value: Infinity },
        },
      ])
    ).toThrow("验收契约不符合契约");
    expect(() =>
      parseCriteria([
        {
          ...humanCriterion,
          requiredEvidence: ["metric_samples", "metric_samples"],
        },
      ])
    ).toThrow("重复条目");
  });
});

describe("规范 criterion key", () => {
  it("带 TASK/integration scope 的规范键稳定且跨 TASK 不碰撞", () => {
    expect(canonicalCriterionKey({ kind: "task", taskId: "TASK-001" }, "AC-001"))
      .toBe("task:TASK-001/AC-001");
    expect(canonicalCriterionKey({ kind: "integration" }, "AC-001"))
      .toBe("integration/AC-001");

    const firstTask = attachCriterionKeys(parseCriteria([staticCriterion]), {
      kind: "task",
      taskId: "TASK-001",
    });
    const secondTask = attachCriterionKeys(parseCriteria([staticCriterion]), {
      kind: "task",
      taskId: "TASK-002",
    });
    expect(firstTask[0]?.key).toBe("task:TASK-001/AC-002");
    expect(secondTask[0]?.key).toBe("task:TASK-002/AC-002");
    expect(firstTask[0]?.key).not.toBe(secondTask[0]?.key);
  });
});

describe("parseRequirementsDocument", () => {
  it("解析携带 evidence policy 的 requirements", () => {
    const requirements = parseRequirementsDocument(
      requirementDocuments,
      "测试 SPEC",
    );

    expect(requirements).toHaveLength(4);
    expect(requirements[2]).toMatchObject({
      id: "REQ-UX-4K-001",
      mandatory: true,
      evidencePolicy: { finalCandidateRequired: true },
    });
  });

  it("拒绝空集合、重复 id、非法 id 与未知字段", () => {
    expect(() =>
      parseRequirementsDocument({ requirements: [] }, "测试 SPEC")
    ).toThrow("需求契约不符合契约");
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [
            requirementDocuments.requirements[0],
            requirementDocuments.requirements[0],
          ],
        },
        "测试 SPEC",
      )
    ).toThrow("重复 requirement id");
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [{
            ...requirementDocuments.requirements[0],
            id: "REQ-BUILD",
          }],
        },
        "测试 SPEC",
      )
    ).toThrow("需求契约不符合契约");
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [{
            ...requirementDocuments.requirements[0],
            owner: "team-a",
          }],
        },
        "测试 SPEC",
      )
    ).toThrow("需求契约不符合契约");
  });

  it("拒绝空或重复的 evidence policy 条目", () => {
    const base = requirementDocuments.requirements[0];
    if (base === undefined) {
      throw new Error("测试夹具缺少基础 requirement");
    }
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [{
            ...base,
            evidencePolicy: { ...base.evidencePolicy, allowedCriterionKinds: [] },
          }],
        },
        "测试 SPEC",
      )
    ).toThrow("需求契约不符合契约");
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [{
            ...base,
            evidencePolicy: {
              ...base.evidencePolicy,
              allowedCriterionKinds: ["command", "command"],
            },
          }],
        },
        "测试 SPEC",
      )
    ).toThrow("重复条目");
    expect(() =>
      parseRequirementsDocument(
        {
          requirements: [{
            ...base,
            evidencePolicy: {
              ...base.evidencePolicy,
              allowedCriterionKinds: ["shell"],
            },
          }],
        },
        "测试 SPEC",
      )
    ).toThrow("需求契约不符合契约");
  });
});

describe("parseSupportedPlatformMatrixDocument", () => {
  it("解析平台矩阵并允许显式空矩阵", () => {
    const platforms = parseSupportedPlatformMatrixDocument(
      platformDocument,
      "测试 SPEC",
    );

    expect(platforms).toHaveLength(1);
    expect(platforms[0]).toMatchObject({
      platformId: "windows-4k-target-gpu",
      os: "windows",
      lineEndingPolicy: "crlf",
    });
    expect(
      parseSupportedPlatformMatrixDocument(
        { supportedPlatformMatrix: [] },
        "测试 SPEC",
      ),
    ).toEqual([]);
  });

  it("拒绝重复 platformId、未知 OS/架构/换行策略与未知字段", () => {
    const [platform] = platformDocument.supportedPlatformMatrix;
    expect(() =>
      parseSupportedPlatformMatrixDocument(
        { supportedPlatformMatrix: [platform, platform] },
        "测试 SPEC",
      )
    ).toThrow("重复 platformId");
    for (const patch of [
      { os: "android" },
      { arch: "x86" },
      { lineEndingPolicy: "native" },
      { gpu: "rtx" },
    ]) {
      expect(() =>
        parseSupportedPlatformMatrixDocument(
          { supportedPlatformMatrix: [{ ...platform, ...patch }] },
          "测试 SPEC",
        )
      ).toThrow("支持平台矩阵不符合契约");
    }
  });
});

describe("validateProjectContractReferences", () => {
  function createReferenceInput() {
    const requirements = parseRequirementsDocument(
      requirementDocuments,
      "测试 SPEC",
    );
    const supportedPlatformMatrix = parseSupportedPlatformMatrixDocument(
      platformDocument,
      "测试 SPEC",
    );
    const integrationCriteria = attachCriterionKeys(
      parseCriteria([commandCriterion]),
      { kind: "integration" },
    );
    const taskAcceptanceCriteria = new Map([
      [
        "TASK-001",
        attachCriterionKeys(
          parseCriteria([staticCriterion, humanCriterion, externalCriterion]),
          { kind: "task", taskId: "TASK-001" },
        ),
      ],
    ]);
    return {
      requirements,
      supportedPlatformMatrix,
      integrationCriteria,
      taskAcceptanceCriteria,
    };
  }

  it("全部引用可解析时通过", () => {
    expect(() =>
      validateProjectContractReferences(createReferenceInput())
    ).not.toThrow();
  });

  it("拒绝悬空 requirementRef", () => {
    const input = createReferenceInput();
    const dangling = attachCriterionKeys(
      parseCriteria([
        { ...staticCriterion, requirementRefs: ["REQ-MISSING-001"] },
      ]),
      { kind: "task", taskId: "TASK-009" },
    );
    input.taskAcceptanceCriteria.set("TASK-009", dangling);

    expect(() => validateProjectContractReferences(input)).toThrow(
      "引用不存在的 requirement：task:TASK-009/AC-002",
    );
  });

  it("拒绝 criterion 与 evidence policy 的悬空 platformId", () => {
    const input = createReferenceInput();
    const dangling = attachCriterionKeys(
      parseCriteria([
        {
          ...commandCriterion,
          id: "AC-005",
          scope: "clean_platform",
          platformId: "linux-gpu",
        },
      ]),
      { kind: "integration" },
    );

    expect(() =>
      validateProjectContractReferences({
        ...input,
        integrationCriteria: dangling,
      })
    ).toThrow("引用不存在的 platformId：integration/AC-005");

    const requirements = parseRequirementsDocument(
      {
        requirements: [
          ...requirementDocuments.requirements,
          {
            id: "REQ-PERF-001",
            mandatory: true,
            evidencePolicy: {
              allowedCriterionKinds: ["command"],
              requiredPlatformIds: ["linux-gpu"],
              requiredResponseSchemas: [],
              requiredEvidence: [],
              finalCandidateRequired: false,
            },
          },
        ],
      },
      "测试 SPEC",
    );
    expect(() =>
      validateProjectContractReferences({ ...input, requirements })
    ).toThrow("需求契约引用不存在的 platformId：REQ-PERF-001");
  });
});

describe("契约值不参与第二套解析", () => {
  it("解析结果是冻结语义值，规范键只由 scope 与 id 推导", () => {
    const criteria: readonly AcceptanceCriterion[] = parseCriteria([
      staticCriterion,
    ]);
    const scoped = attachCriterionKeys(criteria, {
      kind: "task",
      taskId: "TASK-001",
    });

    expect(Object.keys(scoped[0] ?? {})).toContain("key");
    expect(Object.keys(criteria[0] ?? {})).not.toContain("key");
    expect(scoped[0]).toMatchObject({ id: "AC-002", kind: "static" });
  });
});
