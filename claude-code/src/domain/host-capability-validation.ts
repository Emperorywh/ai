/*
 * HostCapabilityValidator 在 Run 创建前把“项目契约无效”与“宿主尚无相应 capability”分开：
 * - unsupported_contract：覆盖门禁失败，合同自身无效，必须修改项目契约；
 * - configuration_missing：合同有效但快照缺少 Runner/Sandbox/env/dependency/executable
 *   引用，只能由操作者配置宿主能力后重试——新 Run validate 失败，
 *   已创建 Run 按 SPEC 进入 paused/configuration；
 * - valid：全部引用可解析，快照规范哈希可进入 Run 契约。
 * 两类失败都是结构化、可恢复的诊断，永远不生成可批准的人工替代请求。
 */
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import type { ScopedAcceptanceCriterion } from "./acceptance-contract.js";
import {
  createHostExecutionPolicyHash,
  type HostExecutionPolicySnapshot,
} from "./host-execution-policy.js";
import {
  evaluateRequirementCoverage,
  isRequirementScopeCovered,
  type RequirementCoverageEntry,
  type RequirementCoverageInput,
} from "./requirement-coverage.js";

/*
 * 每个 capability 问题都绑定规范 criterion key 与缺失的宿主稳定 ID，
 * 操作者据此配置宿主，而不是把缺失降级为人工日志或人工替代验收。
 */
export type HostCapabilityIssue =
  | {
      readonly kind: "missing_env_profile";
      readonly criterionKey: string;
      readonly profileId: string;
    }
  | {
      readonly kind: "missing_dependency_profile";
      readonly criterionKey: string;
      readonly profileId: string;
    }
  | {
      readonly kind: "unsupported_package_manager";
      readonly criterionKey: string;
      readonly packageManager: string;
      readonly profileId: string;
    }
  | {
      readonly kind: "missing_executable_policy";
      readonly criterionKey: string;
      readonly executableId: string;
    }
  | {
      readonly kind: "executable_platform_not_allowed";
      readonly criterionKey: string;
      readonly executableId: string;
      readonly platformId: string;
    }
  | {
      readonly kind: "missing_runner_capability";
      readonly criterionKey: string;
      readonly platformId: string;
    }
  | {
      readonly kind: "missing_sandbox_capability";
      readonly criterionKey: string;
      readonly platformId: string;
      readonly sandboxCapabilityId: string;
    };

export type RunStartupValidation =
  | {
      readonly status: "valid";
      readonly hostExecutionPolicyHash: string;
    }
  | {
      readonly status: "unsupported_contract";
      readonly failures: readonly RequirementCoverageEntry[];
    }
  | {
      readonly status: "configuration_missing";
      readonly hostExecutionPolicyHash: string;
      readonly issues: readonly HostCapabilityIssue[];
    };

export interface RunStartupValidationInput extends RequirementCoverageInput {
  readonly snapshot: HostExecutionPolicySnapshot;
}

/*
 * 校验顺序固定：先证明合同自身可覆盖（unsupported_contract），
 * 再解析宿主能力引用（configuration_missing），两者不能混淆为同一类诊断。
 * 快照规范哈希在 Run 创建时冻结，新 Run 即使复用全部 TASK 完成提交也必须重新检查。
 */
export function validateRunStartupCapabilities(
  input: RunStartupValidationInput,
  canonicalHash: CanonicalHashService,
): RunStartupValidation {
  const coverage = evaluateRequirementCoverage(input);
  const failures = coverage.entries.filter(
    (entry) => entry.mandatory && !isRequirementScopeCovered(entry.integration),
  );
  if (failures.length > 0) {
    return { status: "unsupported_contract", failures };
  }
  const hostExecutionPolicyHash = createHostExecutionPolicyHash(
    input.snapshot,
    canonicalHash,
  );
  const issues = collectHostCapabilityIssues(input);
  if (issues.length > 0) {
    return { status: "configuration_missing", hostExecutionPolicyHash, issues };
  }
  return { status: "valid", hostExecutionPolicyHash };
}

/*
 * 每条 command criterion 的全部宿主引用都必须解析：env/dependency profile、
 * package manager、executable 与 platformId 绑定的 Runner/Sandbox capability。
 * 问题按 integration 文档序、再 TASK 数字线性序收集，相同输入得到相同诊断序列。
 */
function collectHostCapabilityIssues(
  input: RunStartupValidationInput,
): HostCapabilityIssue[] {
  const snapshot = input.snapshot;
  const envProfileIds = new Set(
    snapshot.envProfiles.map((profile) => profile.id),
  );
  const dependencyProfiles = new Map(
    snapshot.dependencyProfiles.map((profile) => [profile.id, profile]),
  );
  const executablePolicies = new Map(
    snapshot.executablePolicies.map((policy) => [policy.id, policy]),
  );
  const runnerCapabilities = new Map(
    snapshot.platformCapabilities.map((capability) => [
      capability.platformId,
      capability,
    ]),
  );
  const sandboxCapabilityIds = new Set(
    snapshot.sandboxCapabilities.map((capability) => capability.id),
  );
  const commandCriteria = [
    ...input.integrationCriteria,
    ...[...input.taskAcceptanceCriteria.values()].flat(),
  ].filter(isCommandCriterion);

  const issues: HostCapabilityIssue[] = [];
  for (const criterion of commandCriteria) {
    if (!envProfileIds.has(criterion.execution.envProfile)) {
      issues.push({
        kind: "missing_env_profile",
        criterionKey: criterion.key,
        profileId: criterion.execution.envProfile,
      });
    }
    if (criterion.execution.kind === "package_script") {
      const profile = dependencyProfiles.get(
        criterion.execution.dependencyProfile,
      );
      if (profile === undefined) {
        issues.push({
          kind: "missing_dependency_profile",
          criterionKey: criterion.key,
          profileId: criterion.execution.dependencyProfile,
        });
      } else if (
        !profile.supportedPackageManagers.includes(
          criterion.execution.packageManager,
        )
      ) {
        issues.push({
          kind: "unsupported_package_manager",
          criterionKey: criterion.key,
          packageManager: criterion.execution.packageManager,
          profileId: profile.id,
        });
      }
    } else {
      const policy = executablePolicies.get(criterion.execution.executable);
      if (policy === undefined) {
        issues.push({
          kind: "missing_executable_policy",
          criterionKey: criterion.key,
          executableId: criterion.execution.executable,
        });
      } else if (
        criterion.platformId !== undefined &&
        !policy.allowedPlatformIds.includes(criterion.platformId)
      ) {
        issues.push({
          kind: "executable_platform_not_allowed",
          criterionKey: criterion.key,
          executableId: policy.id,
          platformId: criterion.platformId,
        });
      }
    }
    if (criterion.platformId !== undefined) {
      const capability = runnerCapabilities.get(criterion.platformId);
      if (capability === undefined) {
        issues.push({
          kind: "missing_runner_capability",
          criterionKey: criterion.key,
          platformId: criterion.platformId,
        });
      } else if (!sandboxCapabilityIds.has(capability.sandboxCapabilityId)) {
        issues.push({
          kind: "missing_sandbox_capability",
          criterionKey: criterion.key,
          platformId: criterion.platformId,
          sandboxCapabilityId: capability.sandboxCapabilityId,
        });
      }
    }
  }
  return issues;
}

type ScopedCommandCriterion = Extract<
  ScopedAcceptanceCriterion,
  { kind: "command" }
>;

function isCommandCriterion(
  criterion: ScopedAcceptanceCriterion,
): criterion is ScopedCommandCriterion {
  return criterion.kind === "command";
}
