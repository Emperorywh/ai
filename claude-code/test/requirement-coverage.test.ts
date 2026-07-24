/*
 * RequirementCoverageValidator 是确定性领域规则：测试只通过真实 strict 解析入口
 * 构造 requirements 与 criteria，证明 kind、platform、responseSchema、requiredEvidence
 * 和 final-candidate policy 的最低强度判定，以及 mandatory requirement 的启动门禁。
 * 弱证据、错误平台或缺 final-candidate policy 都不能冒充覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  attachCriterionKeys,
  parseAcceptanceCriteriaDocument,
  parseRequirementsDocument,
  type RequirementDefinition,
  type ScopedAcceptanceCriterion,
} from "../src/domain/acceptance-contract.js";
import { ConfigurationError } from "../src/domain/errors.js";
import {
  assertMandatoryIntegrationCoverage,
  evaluateRequirementCoverage,
  isRequirementScopeCovered,
  type RequirementCoverageEntry,
  type RequirementCoverageInput,
  type RequirementCoverageReport,
} from "../src/domain/requirement-coverage.js";

function requirement(input: {
  readonly id: string;
  readonly mandatory?: boolean;
  readonly kinds: readonly string[];
  readonly platforms?: readonly string[];
  readonly schemas?: readonly string[];
  readonly evidence?: readonly string[];
  readonly finalCandidateRequired?: boolean;
}): RequirementDefinition {
  const [parsed] = parseRequirementsDocument({
    requirements: [{
      id: input.id,
      mandatory: input.mandatory ?? true,
      evidencePolicy: {
        allowedCriterionKinds: input.kinds,
        requiredPlatformIds: input.platforms ?? [],
        requiredResponseSchemas: input.schemas ?? [],
        requiredEvidence: input.evidence ?? [],
        finalCandidateRequired: input.finalCandidateRequired ?? false,
      },
    }],
  }, "coverage 测试");
  if (parsed === undefined) {
    throw new Error(`测试 requirement 缺失：${input.id}`);
  }
  return parsed;
}

function commandCriterion(input: {
  readonly id?: string;
  readonly refs?: readonly string[];
  readonly scope?: string;
  readonly platformId?: string;
}): unknown {
  return {
    id: input.id ?? "AC-001",
    requirementRefs: input.refs ?? ["REQ-BUILD-001"],
    kind: "command",
    scope: input.scope ?? "full",
    ...(input.platformId === undefined ? {} : { platformId: input.platformId }),
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
    description: "命令验证",
  };
}

function staticCriterion(input: {
  readonly id?: string;
  readonly refs?: readonly string[];
}): unknown {
  return {
    id: input.id ?? "AC-001",
    requirementRefs: input.refs ?? ["REQ-BUILD-001"],
    kind: "static",
    allowNotApplicable: false,
    description: "静态审核",
  };
}

function humanCriterion(input: {
  readonly id?: string;
  readonly refs?: readonly string[];
  readonly kind?: string;
  readonly responseSchema?: string;
  readonly evidence?: readonly string[];
}): unknown {
  return {
    id: input.id ?? "AC-001",
    requirementRefs: input.refs ?? ["REQ-BUILD-001"],
    kind: input.kind ?? "human",
    description: "人工验收",
    procedure: ["按规定 procedure 执行验收并归档证据"],
    expected: {
      metric: "frame_time_p95_ms",
      operator: "less_than_or_equal",
      value: 16.7,
    },
    requiredEvidence: input.evidence ?? ["environment_manifest"],
    responseSchema: input.responseSchema ?? "performance_acceptance_v1",
    allowNotApplicable: false,
  };
}

function inTask(
  taskId: string,
  criteria: readonly unknown[],
): readonly ScopedAcceptanceCriterion[] {
  return attachCriterionKeys(
    parseAcceptanceCriteriaDocument({ criteria }, `task ${taskId}`),
    { kind: "task", taskId },
  );
}

function inIntegration(
  criteria: readonly unknown[],
): readonly ScopedAcceptanceCriterion[] {
  return attachCriterionKeys(
    parseAcceptanceCriteriaDocument({ criteria }, "integration"),
    { kind: "integration" },
  );
}

function evaluate(input: {
  readonly requirements: readonly RequirementDefinition[];
  readonly integration?: readonly ScopedAcceptanceCriterion[];
  readonly tasks?: ReadonlyMap<string, readonly ScopedAcceptanceCriterion[]>;
}): RequirementCoverageReport {
  const coverageInput: RequirementCoverageInput = {
    requirements: input.requirements,
    integrationCriteria: input.integration ?? [],
    taskAcceptanceCriteria: input.tasks ?? new Map(),
  };
  return evaluateRequirementCoverage(coverageInput);
}

function entryOf(
  report: RequirementCoverageReport,
  requirementId: string,
): RequirementCoverageEntry {
  const entry = report.entries.find(
    (candidate) => candidate.requirementId === requirementId,
  );
  if (entry === undefined) {
    throw new Error(`覆盖报告缺少 requirement：${requirementId}`);
  }
  return entry;
}

describe("evaluateRequirementCoverage", () => {
  it("四类 criterion 在满足 evidencePolicy 时计入对应 scope 覆盖", () => {
    const req = requirement({
      id: "REQ-BUILD-001",
      kinds: ["command", "static", "human", "external"],
    });
    const report = evaluate({
      requirements: [req],
      integration: inIntegration([
        commandCriterion({ id: "AC-001" }),
        staticCriterion({ id: "AC-002" }),
        humanCriterion({ id: "AC-003" }),
        humanCriterion({ id: "AC-004", kind: "external" }),
      ]),
      tasks: new Map([["TASK-001", inTask("TASK-001", [
        commandCriterion({ id: "AC-001" }),
      ])]]),
    });
    const entry = entryOf(report, "REQ-BUILD-001");

    expect(entry.integration.coveringCriterionKeys).toEqual([
      "integration/AC-001",
      "integration/AC-002",
      "integration/AC-003",
      "integration/AC-004",
    ]);
    expect(entry.integration.rejectedCandidates).toEqual([]);
    expect(entry.milestone.coveringCriterionKeys).toEqual([
      "task:TASK-001/AC-001",
    ]);
    expect(isRequirementScopeCovered(entry.integration)).toBe(true);
    expect(isRequirementScopeCovered(entry.milestone)).toBe(true);
  });

  it("TASK criterion 只证明里程碑，mandatory requirement 缺 integration 覆盖时门禁拒绝", () => {
    const req = requirement({
      id: "REQ-BUILD-001",
      kinds: ["command"],
      finalCandidateRequired: true,
    });
    const report = evaluate({
      requirements: [req],
      tasks: new Map([["TASK-001", inTask("TASK-001", [
        commandCriterion({ id: "AC-001" }),
      ])]]),
    });
    const entry = entryOf(report, "REQ-BUILD-001");

    /*
     * finalCandidateRequired 的 requirement 只有 integration 覆盖计入最终证明；
     * 里程碑覆盖不能替代 final-candidate integration evidence。
     */
    expect(isRequirementScopeCovered(entry.milestone)).toBe(true);
    expect(isRequirementScopeCovered(entry.integration)).toBe(false);
    expect(() => assertMandatoryIntegrationCoverage(report)).toThrow(
      ConfigurationError,
    );
    expect(() => assertMandatoryIntegrationCoverage(report)).toThrow(
      "REQ-BUILD-001",
    );
  });

  it("非 mandatory requirement 没有覆盖时不阻断启动门禁", () => {
    const optional = requirement({
      id: "REQ-OPT-001",
      mandatory: false,
      kinds: ["command"],
    });
    const mandatory = requirement({ id: "REQ-BUILD-001", kinds: ["command"] });
    const report = evaluate({
      requirements: [optional, mandatory],
      integration: inIntegration([
        commandCriterion({ id: "AC-001", refs: ["REQ-BUILD-001"] }),
      ]),
    });

    expect(() => assertMandatoryIntegrationCoverage(report)).not.toThrow();
    expect(entryOf(report, "REQ-OPT-001").integration.coveringCriterionKeys)
      .toEqual([]);
  });

  it("static criterion 不能覆盖强制人工实测 requirement", () => {
    const req = requirement({
      id: "REQ-UX-4K-001",
      kinds: ["human"],
      platforms: ["windows-4k"],
      schemas: ["performance_acceptance_v1"],
      evidence: ["environment_manifest", "metric_samples"],
      finalCandidateRequired: true,
    });
    const report = evaluate({
      requirements: [req],
      integration: inIntegration([
        staticCriterion({ id: "AC-001", refs: ["REQ-UX-4K-001"] }),
      ]),
    });
    const entry = entryOf(report, "REQ-UX-4K-001");

    /*
     * 错误 kind 的候选只进入驳回清单，诊断携带全部稳定机器码，
     * 静态审核不能冒充带平台绑定的人工性能实测。
     */
    expect(entry.integration.coveringCriterionKeys).toEqual([]);
    expect(entry.integration.rejectedCandidates).toEqual([{
      criterionKey: "integration/AC-001",
      reasons: [
        "kind_not_allowed",
        "static_cannot_bind_platform",
        "response_schema_not_allowed",
        "required_evidence_missing",
      ],
    }]);
    expect(() => assertMandatoryIntegrationCoverage(report)).toThrow(
      "kind_not_allowed",
    );
  });

  it("平台受限 requirement 拒绝缺失或错误的 command 平台", () => {
    const req = requirement({
      id: "REQ-PERF-001",
      kinds: ["command"],
      platforms: ["windows-4k"],
    });
    const report = evaluate({
      requirements: [req],
      integration: inIntegration([
        commandCriterion({ id: "AC-001", refs: ["REQ-PERF-001"] }),
        commandCriterion({
          id: "AC-002",
          refs: ["REQ-PERF-001"],
          platformId: "linux-gpu",
        }),
        commandCriterion({
          id: "AC-003",
          refs: ["REQ-PERF-001"],
          scope: "clean_platform",
          platformId: "windows-4k",
        }),
      ]),
    });
    const entry = entryOf(report, "REQ-PERF-001");

    /*
     * 未声明 platformId 的 command 运行在宿主平台，宿主结果不能替代目标平台；
     * 只有落在 requiredPlatformIds 中的 command 才能形成覆盖。
     */
    expect(entry.integration.rejectedCandidates).toEqual([
      { criterionKey: "integration/AC-001", reasons: ["command_missing_platform"] },
      { criterionKey: "integration/AC-002", reasons: ["platform_not_required"] },
    ]);
    expect(entry.integration.coveringCriterionKeys).toEqual([
      "integration/AC-003",
    ]);
    expect(isRequirementScopeCovered(entry.integration)).toBe(true);
  });

  it("多平台 requirement 要求每个平台都有可绑定证据", () => {
    const req = requirement({
      id: "REQ-PERF-001",
      kinds: ["command", "human"],
      platforms: ["windows-4k", "linux-gpu"],
    });
    const commandOnly = evaluate({
      requirements: [req],
      integration: inIntegration([
        commandCriterion({
          id: "AC-001",
          refs: ["REQ-PERF-001"],
          scope: "clean_platform",
          platformId: "windows-4k",
        }),
      ]),
    });
    expect(
      entryOf(commandOnly, "REQ-PERF-001").integration.uncoveredPlatformIds,
    ).toEqual(["linux-gpu"]);
    expect(
      isRequirementScopeCovered(entryOf(commandOnly, "REQ-PERF-001").integration),
    ).toBe(false);

    /*
     * human criterion 由操作者在目标平台执行 procedure，契约期证明其有资格
     * 覆盖全部必需平台；真实平台匹配在验收时经 requiredEvidence 核对。
     */
    const withHuman = evaluate({
      requirements: [req],
      integration: inIntegration([
        commandCriterion({
          id: "AC-001",
          refs: ["REQ-PERF-001"],
          scope: "clean_platform",
          platformId: "windows-4k",
        }),
        humanCriterion({ id: "AC-002", refs: ["REQ-PERF-001"] }),
      ]),
    });
    expect(
      entryOf(withHuman, "REQ-PERF-001").integration.uncoveredPlatformIds,
    ).toEqual([]);
    expect(
      isRequirementScopeCovered(entryOf(withHuman, "REQ-PERF-001").integration),
    ).toBe(true);

    const bothPlatforms = evaluate({
      requirements: [req],
      integration: inIntegration([
        commandCriterion({
          id: "AC-001",
          refs: ["REQ-PERF-001"],
          scope: "clean_platform",
          platformId: "windows-4k",
        }),
        commandCriterion({
          id: "AC-002",
          refs: ["REQ-PERF-001"],
          scope: "clean_platform",
          platformId: "linux-gpu",
        }),
      ]),
    });
    expect(
      isRequirementScopeCovered(
        entryOf(bothPlatforms, "REQ-PERF-001").integration,
      ),
    ).toBe(true);
  });

  it("错误 responseSchema 与缺失 requiredEvidence 不能形成覆盖", () => {
    const req = requirement({
      id: "REQ-UX-4K-001",
      kinds: ["human"],
      schemas: ["performance_acceptance_v1"],
      evidence: ["environment_manifest", "metric_samples"],
    });
    const report = evaluate({
      requirements: [req],
      integration: inIntegration([
        humanCriterion({
          id: "AC-001",
          refs: ["REQ-UX-4K-001"],
          responseSchema: "compliance_acceptance_v1",
          evidence: ["environment_manifest", "metric_samples"],
        }),
        humanCriterion({
          id: "AC-002",
          refs: ["REQ-UX-4K-001"],
          evidence: ["environment_manifest"],
        }),
        humanCriterion({
          id: "AC-003",
          refs: ["REQ-UX-4K-001"],
          evidence: [
            "environment_manifest",
            "metric_samples",
            "scenario_checklist",
          ],
        }),
      ]),
    });
    const entry = entryOf(report, "REQ-UX-4K-001");

    expect(entry.integration.rejectedCandidates).toEqual([
      {
        criterionKey: "integration/AC-001",
        reasons: ["response_schema_not_allowed"],
      },
      {
        criterionKey: "integration/AC-002",
        reasons: ["required_evidence_missing"],
      },
    ]);
    expect(entry.integration.coveringCriterionKeys).toEqual([
      "integration/AC-003",
    ]);
  });

  it("跨 TASK 裸 criterion id 冲突在覆盖报告中不会碰撞规范键", () => {
    const req = requirement({ id: "REQ-BUILD-001", kinds: ["command"] });
    const report = evaluate({
      requirements: [req],
      tasks: new Map([
        ["TASK-001", inTask("TASK-001", [commandCriterion({ id: "AC-001" })])],
        ["TASK-002", inTask("TASK-002", [commandCriterion({ id: "AC-001" })])],
      ]),
    });

    expect(entryOf(report, "REQ-BUILD-001").milestone.coveringCriterionKeys)
      .toEqual([
        "task:TASK-001/AC-001",
        "task:TASK-002/AC-001",
      ]);
  });

  it("相同冻结输入得到完全相同的覆盖报告", () => {
    const req = requirement({
      id: "REQ-UX-4K-001",
      kinds: ["human"],
      platforms: ["windows-4k"],
      schemas: ["performance_acceptance_v1"],
      evidence: ["environment_manifest"],
    });
    const build = () => evaluate({
      requirements: [req],
      integration: inIntegration([
        humanCriterion({ id: "AC-001", refs: ["REQ-UX-4K-001"] }),
        staticCriterion({ id: "AC-002", refs: ["REQ-UX-4K-001"] }),
      ]),
      tasks: new Map([["TASK-001", inTask("TASK-001", [
        commandCriterion({ id: "AC-001", refs: ["REQ-UX-4K-001"] }),
      ])]]),
    });

    expect(build()).toEqual(build());
  });
});
