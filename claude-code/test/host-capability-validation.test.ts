/*
 * HostCapabilityValidator 在 Run 创建前区分三类结果：valid、unsupported_contract
 * （合同自身无效）与 configuration_missing（合同有效但宿主缺少 capability）。
 * 测试证明 Runner/Sandbox/env/dependency/executable 引用的正常解析、逐类缺失诊断、
 * 两类失败不会互相混淆，且诊断是结构化事实而不是可批准的人工替代请求。
 */
import { describe, expect, it } from "vitest";
import {
  attachCriterionKeys,
  parseAcceptanceCriteriaDocument,
  parseRequirementsDocument,
  type RequirementDefinition,
  type ScopedAcceptanceCriterion,
} from "../src/domain/acceptance-contract.js";
import {
  validateRunStartupCapabilities,
  type HostCapabilityIssue,
  type RunStartupValidation,
} from "../src/domain/host-capability-validation.js";
import {
  createHostExecutionPolicyHash,
  parseHostExecutionPolicySnapshot,
  type HostExecutionPolicySnapshot,
} from "../src/domain/host-execution-policy.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

const REQUIREMENTS: readonly RequirementDefinition[] =
  parseRequirementsDocument({
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
        id: "REQ-UX-4K-001",
        mandatory: true,
        evidencePolicy: {
          allowedCriterionKinds: ["human"],
          requiredPlatformIds: ["windows-4k"],
          requiredResponseSchemas: ["performance_acceptance_v1"],
          requiredEvidence: ["environment_manifest", "metric_samples"],
          finalCandidateRequired: true,
        },
      },
    ],
  }, "capability 测试");

const COMMAND_EXECUTION = {
  kind: "package_script",
  packageManager: "pnpm",
  script: "test",
  args: [],
  cwdRelative: ".",
  timeoutMs: 900000,
  envProfile: "project_test",
  dependencyProfile: "pnpm_frozen",
} as const;

const UX_HUMAN_CRITERION = {
  id: "AC-002",
  requirementRefs: ["REQ-UX-4K-001"],
  kind: "human",
  description: "人工在目标平台完成 4K 性能验收",
  procedure: ["在 windows-4k 目标设备按场景清单执行交互并采集帧时间"],
  expected: {
    metric: "frame_time_p95_ms",
    operator: "less_than_or_equal",
    value: 16.7,
  },
  requiredEvidence: ["environment_manifest", "metric_samples"],
  responseSchema: "performance_acceptance_v1",
  allowNotApplicable: false,
} as const;

function integrationCriteria(): readonly ScopedAcceptanceCriterion[] {
  return attachCriterionKeys(
    parseAcceptanceCriteriaDocument({
      criteria: [
        {
          id: "AC-001",
          requirementRefs: ["REQ-BUILD-001"],
          kind: "command",
          scope: "full",
          execution: COMMAND_EXECUTION,
          success: "exit_code_zero",
          allowNotApplicable: false,
          description: "集成全量测试通过",
        },
        UX_HUMAN_CRITERION,
        {
          id: "AC-003",
          requirementRefs: ["REQ-BUILD-001"],
          kind: "command",
          scope: "clean_platform",
          platformId: "windows-4k",
          execution: {
            kind: "argv",
            executable: "node",
            args: ["--version"],
            cwdRelative: ".",
            timeoutMs: 60000,
            envProfile: "project_test",
          },
          success: "exit_code_zero",
          allowNotApplicable: false,
          description: "目标平台干净环境运行时检查",
        },
      ],
    }, "capability 测试"),
    { kind: "integration" },
  );
}

function taskCriteria(): ReadonlyMap<
  string,
  readonly ScopedAcceptanceCriterion[]
> {
  return new Map([[
    "TASK-001",
    attachCriterionKeys(
      parseAcceptanceCriteriaDocument({
        criteria: [{
          id: "AC-001",
          requirementRefs: ["REQ-BUILD-001"],
          kind: "command",
          scope: "full",
          execution: COMMAND_EXECUTION,
          success: "exit_code_zero",
          allowNotApplicable: false,
          description: "全量测试通过",
        }],
      }, "capability 测试"),
      { kind: "task", taskId: "TASK-001" },
    ),
  ]]);
}

function createSnapshotInput() {
  return {
    schemaVersion: 2,
    id: "host-default",
    currentPlatformId: "windows-4k",
    platformCapabilities: [{
      platformId: "windows-4k",
      runnerId: "runner-local-1",
      kind: "local",
      sandboxCapabilityId: "sandbox-win-job",
      trustIdentity: "host-signing-key-1",
    }],
    sandboxCapabilities: [{ id: "sandbox-win-job" }],
    envProfiles: [{
      id: "project_test",
      allowedVariableNames: ["CI"],
      secretBindingIds: [] as string[],
    }],
    dependencyProfiles: [{
      id: "pnpm_frozen",
      supportedPackageManagers: ["pnpm"],
      networkPolicy: "provision_then_offline",
      lifecycleScriptPolicy: "deny",
    }],
    executablePolicies: [{
      id: "node",
      executable: "node",
      fixedArgumentPrefix: [] as string[],
      allowedPlatformIds: ["windows-4k"],
    }],
  };
}

function parseSnapshot(input: unknown): HostExecutionPolicySnapshot {
  return parseHostExecutionPolicySnapshot(input, "测试宿主配置");
}

function validate(input: {
  readonly requirements?: readonly RequirementDefinition[];
  readonly integration?: readonly ScopedAcceptanceCriterion[];
  readonly tasks?: ReadonlyMap<string, readonly ScopedAcceptanceCriterion[]>;
  readonly snapshot?: HostExecutionPolicySnapshot;
}): RunStartupValidation {
  return validateRunStartupCapabilities(
    {
      requirements: input.requirements ?? REQUIREMENTS,
      integrationCriteria: input.integration ?? integrationCriteria(),
      taskAcceptanceCriteria: input.tasks ?? taskCriteria(),
      snapshot: input.snapshot ?? parseSnapshot(createSnapshotInput()),
    },
    new NodeCanonicalHashService(),
  );
}

function issuesOf(
  result: RunStartupValidation,
): readonly HostCapabilityIssue[] {
  if (result.status !== "configuration_missing") {
    throw new Error(`预期 configuration_missing，实际 ${result.status}`);
  }
  return result.issues;
}

function failuresOf(result: RunStartupValidation) {
  if (result.status !== "unsupported_contract") {
    throw new Error(`预期 unsupported_contract，实际 ${result.status}`);
  }
  return result.failures;
}

function issueKinds(issues: readonly HostCapabilityIssue[]): readonly string[] {
  return issues.map((issue) => `${issue.kind}@${issue.criterionKey}`);
}

describe("validateRunStartupCapabilities", () => {
  it("完整宿主快照满足全部 Runner/Sandbox/env/dependency/executable 引用", () => {
    const result = validate({});
    const expectedHash = createHostExecutionPolicyHash(
      parseSnapshot(createSnapshotInput()),
      new NodeCanonicalHashService(),
    );

    expect(result).toEqual({
      status: "valid",
      hostExecutionPolicyHash: expectedHash,
    });
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("缺少 env/dependency profile 或不受支持 package manager 是 configuration_missing", () => {
    const withoutEnv = createSnapshotInput();
    withoutEnv.envProfiles = [];
    expect(issueKinds(issuesOf(validate({ snapshot: parseSnapshot(withoutEnv) }))))
      .toEqual([
        "missing_env_profile@integration/AC-001",
        "missing_env_profile@integration/AC-003",
        "missing_env_profile@task:TASK-001/AC-001",
      ]);

    const withoutDependency = createSnapshotInput();
    withoutDependency.dependencyProfiles = [];
    expect(
      issueKinds(issuesOf(validate({ snapshot: parseSnapshot(withoutDependency) }))),
    ).toEqual([
      "missing_dependency_profile@integration/AC-001",
      "missing_dependency_profile@task:TASK-001/AC-001",
    ]);

    const wrongManager = createSnapshotInput();
    wrongManager.dependencyProfiles = wrongManager.dependencyProfiles.map(
      (profile) => ({ ...profile, supportedPackageManagers: ["npm"] }),
    );
    expect(
      issueKinds(issuesOf(validate({ snapshot: parseSnapshot(wrongManager) }))),
    ).toEqual([
      "unsupported_package_manager@integration/AC-001",
      "unsupported_package_manager@task:TASK-001/AC-001",
    ]);
  });

  it("缺少 executable policy、平台未授权或缺 Runner/Sandbox capability 是 configuration_missing", () => {
    const withoutExecutable = createSnapshotInput();
    withoutExecutable.executablePolicies = [];
    expect(
      issueKinds(issuesOf(validate({ snapshot: parseSnapshot(withoutExecutable) }))),
    ).toEqual(["missing_executable_policy@integration/AC-003"]);

    const platformDenied = createSnapshotInput();
    platformDenied.executablePolicies = platformDenied.executablePolicies.map(
      (policy) => ({ ...policy, allowedPlatformIds: ["linux-gpu"] }),
    );
    expect(
      issueKinds(issuesOf(validate({ snapshot: parseSnapshot(platformDenied) }))),
    ).toEqual(["executable_platform_not_allowed@integration/AC-003"]);

    const withoutRunner = createSnapshotInput();
    withoutRunner.platformCapabilities = [];
    expect(
      issueKinds(issuesOf(validate({ snapshot: parseSnapshot(withoutRunner) }))),
    ).toEqual([
      "missing_runner_capability@integration/AC-001",
      "missing_runner_capability@integration/AC-003",
      "missing_runner_capability@task:TASK-001/AC-001",
    ]);

    /*
     * 快照解析已经拒绝悬空 sandboxCapability 引用；校验器对绕过解析边界
     * 构造的输入仍然 fail closed，不信任任何未验证的快照对象。
     */
    const tampered: HostExecutionPolicySnapshot = {
      ...parseSnapshot(createSnapshotInput()),
      sandboxCapabilities: [],
    };
    expect(issueKinds(issuesOf(validate({ snapshot: tampered })))).toEqual([
      "missing_sandbox_capability@integration/AC-001",
      "missing_sandbox_capability@integration/AC-003",
      "missing_sandbox_capability@task:TASK-001/AC-001",
    ]);
  });

  it("未声明 platformId 的 command 仍绑定 currentPlatformId Runner/Sandbox", () => {
    const onlyFullCommands = integrationCriteria().filter(
      (criterion) => criterion.id === "AC-001",
    );
    const withoutControlledExecution = createSnapshotInput();
    withoutControlledExecution.platformCapabilities = [];
    withoutControlledExecution.sandboxCapabilities = [];
    const result = validate({
      requirements: REQUIREMENTS.filter(
        (requirement) => requirement.id === "REQ-BUILD-001",
      ),
      integration: onlyFullCommands,
      tasks: new Map(),
      snapshot: parseSnapshot(withoutControlledExecution),
    });

    expect(issueKinds(issuesOf(result))).toEqual([
      "missing_runner_capability@integration/AC-001",
    ]);
  });

  it("合同非法与宿主 capability 缺失产生不同且可恢复的诊断", () => {
    /*
     * mandatory requirement 缺 integration criterion 是 unsupported_contract：
     * 合同自身无效，必须修改项目契约；即使宿主能力完整也不会误报为缺能力。
     */
    const contractResult = validate({
      integration: integrationCriteria().filter(
        (criterion) => criterion.id !== "AC-002",
      ),
    });
    expect(contractResult.status).toBe("unsupported_contract");
    expect(
      failuresOf(contractResult).map((failure) => failure.requirementId),
    ).toEqual(["REQ-UX-4K-001"]);
    expect(contractResult).not.toHaveProperty("issues");
    expect(contractResult).not.toHaveProperty("hostExecutionPolicyHash");

    /*
     * 弱 kind 的 integration criterion 同样只进入 unsupported_contract 的驳回诊断，
     * 机器码与启动门禁共用同一组语义。
     */
    const weakIntegration = [
      ...integrationCriteria().filter((criterion) => criterion.id !== "AC-002"),
      ...attachCriterionKeys(
        parseAcceptanceCriteriaDocument({
          criteria: [{
            id: "AC-002",
            requirementRefs: ["REQ-UX-4K-001"],
            kind: "static",
            allowNotApplicable: false,
            description: "静态审核不能冒充人工性能验收",
          }],
        }, "capability 测试"),
        { kind: "integration" },
      ),
    ];
    const weakResult = validate({ integration: weakIntegration });
    const weakFailures = failuresOf(weakResult);
    expect(weakFailures[0]?.integration.rejectedCandidates).toEqual([{
      criterionKey: "integration/AC-002",
      reasons: [
        "kind_not_allowed",
        "static_cannot_bind_platform",
        "response_schema_not_allowed",
        "required_evidence_missing",
      ],
    }]);

    /*
     * 同一份合同在能力缺失时是 configuration_missing：诊断指向宿主稳定 ID，
     * 操作者配置能力后重试即可，不属于合同修改。
     */
    const capabilityResult = validate({
      snapshot: parseSnapshot({ ...createSnapshotInput(), envProfiles: [] }),
    });
    expect(capabilityResult.status).toBe("configuration_missing");
    expect(capabilityResult).not.toHaveProperty("failures");
  });

  it("诊断是结构化事实，不携带任何可批准的人工替代请求形状", () => {
    const result = validate({
      snapshot: parseSnapshot({ ...createSnapshotInput(), envProfiles: [] }),
    });
    expect(Object.keys(result).sort()).toEqual([
      "hostExecutionPolicyHash",
      "issues",
      "status",
    ]);
    for (const issue of issuesOf(result)) {
      expect(issue.criterionKey).toMatch(/^(integration|task:TASK-\d{3,})\//u);
      expect(issue.kind).toMatch(/^missing_|^unsupported_/u);
    }

    const contractResult = validate({
      integration: integrationCriteria().filter(
        (criterion) => criterion.id !== "AC-002",
      ),
    });
    expect(Object.keys(contractResult).sort()).toEqual(["failures", "status"]);
  });

  it("相同冻结合同与快照得到完全相同的校验结果", () => {
    expect(validate({})).toEqual(validate({}));
  });
});
