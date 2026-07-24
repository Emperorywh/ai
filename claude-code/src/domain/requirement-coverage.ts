/*
 * RequirementCoverageValidator 是确定性领域规则：只依据冻结的 requirements、
 * evidencePolicy 与解析后的 criteria 判定覆盖，不接受 Worker/Reviewer 自报矩阵。
 * criterion 必须同时满足 kind、platform、responseSchema 和 requiredEvidence 的最低强度
 * 才计入覆盖；错误 kind、弱证据或其他平台不能冒充覆盖。
 * TASK criterion 只证明里程碑候选；mandatory requirement 的最终证明只能由 integration
 * scope 中满足强度的 criterion 提供，项目在任何 Agent 启动前被该门禁 fail closed。
 */
import type {
  EvidencePolicy,
  RequirementDefinition,
  ScopedAcceptanceCriterion,
} from "./acceptance-contract.js";
import { ConfigurationError } from "./errors.js";

/*
 * 覆盖判定的冻结输入与 LoadedProject 的契约字段结构一致，
 * 纯函数不依赖文件系统、Git、SDK 或宿主快照。
 */
export interface RequirementCoverageInput {
  readonly requirements: readonly RequirementDefinition[];
  readonly integrationCriteria: readonly ScopedAcceptanceCriterion[];
  readonly taskAcceptanceCriteria: ReadonlyMap<
    string,
    readonly ScopedAcceptanceCriterion[]
  >;
}

/*
 * 覆盖驳回原因是稳定机器码，诊断、测试与后续 evidence 矩阵共用同一组语义，
 * 不把自然语言解释当作判定依据。
 */
export type CoverageRejectionReason =
  | "kind_not_allowed"
  | "command_missing_platform"
  | "platform_not_required"
  | "static_cannot_bind_platform"
  | "response_schema_not_allowed"
  | "required_evidence_missing";

export interface RejectedCoverageCandidate {
  readonly criterionKey: string;
  readonly reasons: readonly CoverageRejectionReason[];
}

/*
 * 单个 scope（里程碑 = 全部 TASK 的并集，或 integration）下的覆盖视图。
 * coveringCriterionKeys 只保存规范键，跨 TASK 的裸 criterion id 不会碰撞。
 */
export interface RequirementScopeCoverage {
  readonly coveringCriterionKeys: readonly string[];
  readonly rejectedCandidates: readonly RejectedCoverageCandidate[];
  readonly uncoveredPlatformIds: readonly string[];
}

export interface RequirementCoverageEntry {
  readonly requirementId: string;
  readonly mandatory: boolean;
  readonly finalCandidateRequired: boolean;
  readonly milestone: RequirementScopeCoverage;
  readonly integration: RequirementScopeCoverage;
}

export interface RequirementCoverageReport {
  readonly entries: readonly RequirementCoverageEntry[];
}

/*
 * 报告顺序只由 SPEC 声明顺序决定：requirements 按声明序，
 * criterion 先 integration 文档序、再 TASK 数字线性序与各自文档序。
 * 相同冻结输入永远得到逐字节相同的报告。
 */
export function evaluateRequirementCoverage(
  input: RequirementCoverageInput,
): RequirementCoverageReport {
  const taskCriteria = [...input.taskAcceptanceCriteria.values()].flat();
  return {
    entries: input.requirements.map((requirement) => ({
      requirementId: requirement.id,
      mandatory: requirement.mandatory,
      finalCandidateRequired: requirement.evidencePolicy.finalCandidateRequired,
      milestone: evaluateScopeCoverage(requirement, taskCriteria),
      integration: evaluateScopeCoverage(requirement, input.integrationCriteria),
    })),
  };
}

export function isRequirementScopeCovered(
  scope: RequirementScopeCoverage,
): boolean {
  return (
    scope.coveringCriterionKeys.length > 0 &&
    scope.uncoveredPlatformIds.length === 0
  );
}

/*
 * 启动门禁：每条 mandatory requirement 必须至少有一条满足最低强度的
 * integration criterion。finalCandidateRequired 的 requirement 同样只有
 * integration 覆盖计入最终证明，TASK 覆盖永远不足以证明最终 Run。
 */
export function assertMandatoryIntegrationCoverage(
  report: RequirementCoverageReport,
): void {
  const failures = report.entries.filter(
    (entry) => entry.mandatory && !isRequirementScopeCovered(entry.integration),
  );
  if (failures.length === 0) {
    return;
  }
  throw new ConfigurationError(
    `mandatory requirement 缺少满足最低证据强度的 integration criterion：${
      failures.map(describeCoverageFailure).join("；")
    }`,
  );
}

function evaluateScopeCoverage(
  requirement: RequirementDefinition,
  criteria: readonly ScopedAcceptanceCriterion[],
): RequirementScopeCoverage {
  const policy = requirement.evidencePolicy;
  const candidates = criteria.filter((criterion) =>
    criterion.requirementRefs.includes(requirement.id)
  );
  const coveringCriterionKeys: string[] = [];
  const rejectedCandidates: RejectedCoverageCandidate[] = [];
  const eligible: ScopedAcceptanceCriterion[] = [];
  for (const criterion of candidates) {
    const reasons = collectRejectionReasons(criterion, policy);
    if (reasons.length === 0) {
      coveringCriterionKeys.push(criterion.key);
      eligible.push(criterion);
    } else {
      rejectedCandidates.push({ criterionKey: criterion.key, reasons });
    }
  }
  /*
   * 平台受限 requirement 要求每个必需平台都有可绑定证据：
   * command criterion 只能证明其声明的 platformId；human/external criterion
   * 由操作者在目标平台执行 procedure，平台绑定在验收时经 requiredEvidence
   * （如 environment_manifest）核对，契约期只证明该 criterion 有资格覆盖。
   */
  const uncoveredPlatformIds = policy.requiredPlatformIds.filter(
    (platformId) =>
      !eligible.some((criterion) => bindsPlatform(criterion, platformId)),
  );
  return { coveringCriterionKeys, rejectedCandidates, uncoveredPlatformIds };
}

function collectRejectionReasons(
  criterion: ScopedAcceptanceCriterion,
  policy: EvidencePolicy,
): CoverageRejectionReason[] {
  const reasons: CoverageRejectionReason[] = [];
  if (!policy.allowedCriterionKinds.includes(criterion.kind)) {
    reasons.push("kind_not_allowed");
  }
  if (policy.requiredPlatformIds.length > 0) {
    if (criterion.kind === "command") {
      if (criterion.platformId === undefined) {
        reasons.push("command_missing_platform");
      } else if (!policy.requiredPlatformIds.includes(criterion.platformId)) {
        reasons.push("platform_not_required");
      }
    } else if (criterion.kind === "static") {
      reasons.push("static_cannot_bind_platform");
    }
  }
  if (
    policy.requiredResponseSchemas.length > 0 &&
    ((criterion.kind !== "human" && criterion.kind !== "external") ||
      !policy.requiredResponseSchemas.includes(criterion.responseSchema))
  ) {
    reasons.push("response_schema_not_allowed");
  }
  if (
    policy.requiredEvidence.length > 0 &&
    ((criterion.kind !== "human" && criterion.kind !== "external") ||
      !policy.requiredEvidence.every(
        (evidence) => criterion.requiredEvidence.includes(evidence),
      ))
  ) {
    reasons.push("required_evidence_missing");
  }
  return reasons;
}

function bindsPlatform(
  criterion: ScopedAcceptanceCriterion,
  platformId: string,
): boolean {
  if (criterion.kind === "command") {
    return criterion.platformId === platformId;
  }
  return criterion.kind === "human" || criterion.kind === "external";
}

const REJECTION_REASON_DESCRIPTIONS: Readonly<
  Record<CoverageRejectionReason, string>
> = {
  kind_not_allowed: "criterion kind 不在 evidencePolicy.allowedCriterionKinds 中",
  command_missing_platform: "平台受限 requirement 的 command criterion 必须声明 platformId",
  platform_not_required: "command criterion 平台不在 requiredPlatformIds 中",
  static_cannot_bind_platform: "static criterion 不能提供平台绑定证据",
  response_schema_not_allowed: "responseSchema 不满足 requiredResponseSchemas",
  required_evidence_missing: "requiredEvidence 未覆盖 policy 要求的证据种类",
};

function describeCoverageFailure(entry: RequirementCoverageEntry): string {
  const details: string[] = [];
  if (entry.integration.coveringCriterionKeys.length === 0) {
    details.push("无满足强度的 integration criterion");
  }
  if (entry.integration.uncoveredPlatformIds.length > 0) {
    details.push(`未覆盖平台：${entry.integration.uncoveredPlatformIds.join("、")}`);
  }
  if (entry.integration.rejectedCandidates.length > 0) {
    details.push(
      `驳回候选：${
        entry.integration.rejectedCandidates
          .map((candidate) =>
            `${candidate.criterionKey}（${
              candidate.reasons
                .map((reason) =>
                  `${reason}：${REJECTION_REASON_DESCRIPTIONS[reason]}`)
                .join("、")
            }）`
          )
          .join("，")
      }`,
    );
  }
  return `${entry.requirementId}（${details.join("；")}）`;
}
