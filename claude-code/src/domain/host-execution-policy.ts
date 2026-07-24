/*
 * HostExecutionPolicySnapshot 是产品级只读输入：composition root 从宿主配置编译，
 * 在 Run 创建时计算规范哈希并冻结进 Run 契约。项目文档只能引用其中已有的稳定 ID，
 * 不能通过 TASK、SPEC、项目 settings、skill、MCP 或 CLI 参数扩大 executable、网络、
 * 凭据、平台或 Sandbox 权限。快照与项目文档共享同一稳定 ID 命名空间，
 * 引用解析（capability 校验）属于 host-capability-validation，宿主配置的编译属于组合根。
 * SandboxCapability 只允许发布已经通过平台一致性 conformance 的 OS 隔离能力；
 * 本模块只冻结契约与规范身份，不决定产品实际支持哪些 OS/架构。
 */
import { z } from "zod";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import {
  describeContractIssues,
  platformIdSchema,
  stableIdSchema,
} from "./acceptance-contract.js";
import {
  defineCanonicalSchema,
  type CanonicalValue,
} from "./canonical-schema.js";
import { ConfigurationError } from "./errors.js";

const nonEmptyString = z.string().trim().min(1);

/*
 * 环境变量白名单只接受可移植变量名；secret 只绑定宿主已有的稳定绑定 ID，不携带凭据值。
 */
const environmentVariableNameSchema = z.string().regex(
  /^[A-Za-z_][A-Za-z0-9_]*$/u,
  "环境变量名必须是可移植标识符",
);

export const hostEnvironmentProfileSchema = z.strictObject({
  id: stableIdSchema,
  allowedVariableNames: z.array(environmentVariableNameSchema),
  secretBindingIds: z.array(stableIdSchema),
});
export type HostEnvironmentProfile = z.infer<typeof hostEnvironmentProfileSchema>;

/*
 * 依赖供应只允许离线或“受限 provisioning 后断网”两种网络策略；
 * verification phase 一律断网，lifecycle script 默认拒绝。
 */
export const dependencyProfileSchema = z.strictObject({
  id: stableIdSchema,
  supportedPackageManagers: z.array(stableIdSchema).min(1),
  networkPolicy: z.enum(["offline_only", "provision_then_offline"]),
  lifecycleScriptPolicy: z.enum(["deny", "sandboxed_allowlist"]),
});
export type DependencyProfile = z.infer<typeof dependencyProfileSchema>;

/*
 * executable 是实现细节，只允许出现在宿主快照中；项目文档引用的是该策略的稳定 ID。
 * allowedPlatformIds 声明该 executable 允许在哪些目标平台上执行。
 */
export const executablePolicySchema = z.strictObject({
  id: stableIdSchema,
  executable: nonEmptyString,
  fixedArgumentPrefix: z.array(z.string().min(1)),
  allowedPlatformIds: z.array(platformIdSchema),
});
export type ExecutablePolicy = z.infer<typeof executablePolicySchema>;

/*
 * SandboxCapability 是宿主通过平台一致性 conformance 后才允许发布的 OS 隔离能力。
 * 契约只冻结稳定身份；能力证明与发布流程属于宿主配置编译职责，未通过 conformance 的
 * 宿主不得把对应条目编译进快照。
 */
export const sandboxCapabilitySchema = z.strictObject({
  id: stableIdSchema,
});
export type SandboxCapability = z.infer<typeof sandboxCapabilitySchema>;

/*
 * 每个 platformId 最多一个 RunnerCapability，保证按 platformId 路由时结果唯一确定。
 * trustIdentity 是远程结果 attestation 必须核验的宿主注册信任身份。
 */
export const platformRunnerCapabilitySchema = z.strictObject({
  platformId: platformIdSchema,
  runnerId: nonEmptyString,
  kind: z.enum(["local", "remote"]),
  sandboxCapabilityId: stableIdSchema,
  trustIdentity: nonEmptyString,
});
export type PlatformRunnerCapability = z.infer<
  typeof platformRunnerCapabilitySchema
>;

/*
 * 规范投影即宿主配置的唯一可哈希形态；快照 hash 进入 Run 契约、
 * VerificationEnvironment 和 RunnerAttestation，协议升级只能显式换代。
 * schemaVersion 2 新增 currentPlatformId，使未显式声明目标平台的 command
 * 也必须确定性路由到一个受控 Runner/Sandbox，不允许把“当前宿主”当作隐式能力。
 */
export const hostExecutionPolicyProjectionSchema = defineCanonicalSchema(2, {
  id: stableIdSchema,
  currentPlatformId: platformIdSchema,
  platformCapabilities: z.array(platformRunnerCapabilitySchema),
  sandboxCapabilities: z.array(sandboxCapabilitySchema),
  envProfiles: z.array(hostEnvironmentProfileSchema),
  dependencyProfiles: z.array(dependencyProfileSchema),
  executablePolicies: z.array(executablePolicySchema),
});
export type HostExecutionPolicySnapshot = CanonicalValue<
  typeof hostExecutionPolicyProjectionSchema
>;

/*
 * 宿主快照与项目契约共用同一条 fail-closed 边界：strict Schema 拒绝未知字段和旧版本，
 * 语义校验拒绝重复 ID 和悬空 sandboxCapability 引用，禁止清洗后继续。
 */
export function parseHostExecutionPolicySnapshot(
  input: unknown,
  label: string,
): HostExecutionPolicySnapshot {
  const parsed = hostExecutionPolicyProjectionSchema.schema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigurationError(
      `宿主执行策略快照不符合契约：${label}（${describeContractIssues(parsed.error.issues)}）`,
    );
  }
  const snapshot = parsed.data;
  assertUniqueIds(
    snapshot.sandboxCapabilities.map((capability) => capability.id),
    "sandboxCapabilities",
    label,
  );
  assertUniqueIds(
    snapshot.envProfiles.map((profile) => profile.id),
    "envProfiles",
    label,
  );
  assertUniqueIds(
    snapshot.dependencyProfiles.map((profile) => profile.id),
    "dependencyProfiles",
    label,
  );
  assertUniqueIds(
    snapshot.executablePolicies.map((policy) => policy.id),
    "executablePolicies",
    label,
  );
  const sandboxIds = new Set(
    snapshot.sandboxCapabilities.map((capability) => capability.id),
  );
  const platformIds = new Set<string>();
  for (const capability of snapshot.platformCapabilities) {
    if (platformIds.has(capability.platformId)) {
      throw new ConfigurationError(
        `宿主执行策略快照存在重复 platformId：${label}（${capability.platformId}）`,
      );
    }
    platformIds.add(capability.platformId);
    if (!sandboxIds.has(capability.sandboxCapabilityId)) {
      throw new ConfigurationError(
        `宿主执行策略快照引用未发布的 sandboxCapability：${label}（${capability.sandboxCapabilityId}）`,
      );
    }
  }
  for (const profile of snapshot.envProfiles) {
    assertUniqueIds(
      profile.allowedVariableNames,
      `envProfiles.${profile.id}.allowedVariableNames`,
      label,
    );
    assertUniqueIds(
      profile.secretBindingIds,
      `envProfiles.${profile.id}.secretBindingIds`,
      label,
    );
  }
  for (const profile of snapshot.dependencyProfiles) {
    assertUniqueIds(
      profile.supportedPackageManagers,
      `dependencyProfiles.${profile.id}.supportedPackageManagers`,
      label,
    );
  }
  for (const policy of snapshot.executablePolicies) {
    assertUniqueIds(
      policy.allowedPlatformIds,
      `executablePolicies.${policy.id}.allowedPlatformIds`,
      label,
    );
  }
  return snapshot;
}

/*
 * 快照规范哈希由唯一哈希入口对 strict 投影计算；数组保持宿主配置的声明顺序。
 */
export function createHostExecutionPolicyHash(
  snapshot: HostExecutionPolicySnapshot,
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(hostExecutionPolicyProjectionSchema, {
    schemaVersion: hostExecutionPolicyProjectionSchema.schemaVersion,
    id: snapshot.id,
    currentPlatformId: snapshot.currentPlatformId,
    platformCapabilities: [...snapshot.platformCapabilities],
    sandboxCapabilities: [...snapshot.sandboxCapabilities],
    envProfiles: [...snapshot.envProfiles],
    dependencyProfiles: [...snapshot.dependencyProfiles],
    executablePolicies: [...snapshot.executablePolicies],
  });
}

function assertUniqueIds(
  ids: readonly string[],
  field: string,
  label: string,
): void {
  if (new Set(ids).size !== ids.length) {
    throw new ConfigurationError(
      `宿主执行策略快照存在重复条目：${label}（${field}）`,
    );
  }
}
