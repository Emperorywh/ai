/*
 * RunStartupCapabilityValidator 是 Run 创建/恢复前唯一的宿主能力门禁。
 * 它把项目冻结契约与产品级宿主快照交给领域规则判定，只返回已验证的策略摘要；
 * QueueOrchestrator 不读取配置文件，也不自行解释 capability 缺失原因。
 */
import { ConfigurationError } from "../domain/errors.js";
import {
  validateRunStartupCapabilities,
  type HostCapabilityIssue,
  type RunStartupValidation,
} from "../domain/host-capability-validation.js";
import type { LoadedProject } from "../domain/project.js";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import type { HostExecutionPolicySource } from "../ports/host-execution-policy-source.js";

export interface ValidatedRunStartupCapabilities {
  readonly hostExecutionPolicyHash: string;
}

export interface RunStartupCapabilityValidator {
  validate(loaded: LoadedProject): Promise<ValidatedRunStartupCapabilities>;
}

export class DefaultRunStartupCapabilityValidator
  implements RunStartupCapabilityValidator {
  public constructor(
    private readonly source: HostExecutionPolicySource,
    private readonly canonicalHash: CanonicalHashService,
  ) {}

  public async validate(
    loaded: LoadedProject,
  ): Promise<ValidatedRunStartupCapabilities> {
    const snapshot = await this.source.load();
    const result = validateRunStartupCapabilities(
      {
        requirements: loaded.requirements,
        integrationCriteria: loaded.integrationCriteria,
        taskAcceptanceCriteria: loaded.taskAcceptanceCriteria,
        snapshot,
      },
      this.canonicalHash,
    );
    return requireValidCapabilities(result);
  }
}

function requireValidCapabilities(
  result: RunStartupValidation,
): ValidatedRunStartupCapabilities {
  if (result.status === "valid") {
    return {
      hostExecutionPolicyHash: result.hostExecutionPolicyHash,
    };
  }
  if (result.status === "unsupported_contract") {
    throw new ConfigurationError(
      `项目验收合同不满足启动要求：${
        result.failures.map((failure) => failure.requirementId).join("、")
      }`,
    );
  }
  throw new ConfigurationError(
    `宿主执行能力配置缺失：${result.issues.map(describeCapabilityIssue).join("；")}`,
  );
}

function describeCapabilityIssue(issue: HostCapabilityIssue): string {
  switch (issue.kind) {
    case "missing_env_profile":
    case "missing_dependency_profile":
      return `${issue.criterionKey} 缺少 profile ${issue.profileId}`;
    case "unsupported_package_manager":
      return `${issue.criterionKey} 的 ${issue.profileId} 不支持 ${issue.packageManager}`;
    case "missing_executable_policy":
      return `${issue.criterionKey} 缺少 executable ${issue.executableId}`;
    case "executable_platform_not_allowed":
      return `${issue.criterionKey} 的 ${issue.executableId} 未授权平台 ${issue.platformId}`;
    case "missing_runner_capability":
      return `${issue.criterionKey} 缺少平台 Runner ${issue.platformId}`;
    case "missing_sandbox_capability":
      return `${issue.criterionKey} 缺少 Sandbox ${issue.sandboxCapabilityId}`;
  }
}
