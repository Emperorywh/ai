/*
 * HostExecutionPolicySnapshot 是产品级只读输入：测试证明 strict 解析、内部完整性
 * （重复 ID、悬空 sandboxCapability 引用）与规范哈希的稳定性和敏感性。
 * 快照与项目文档共享同一稳定 ID 命名空间，非法 ID 形状在解析边界 fail closed。
 */
import { describe, expect, it } from "vitest";
import {
  createHostExecutionPolicyHash,
  parseHostExecutionPolicySnapshot,
} from "../src/domain/host-execution-policy.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

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
    envProfiles: [
      {
        id: "project_test",
        allowedVariableNames: ["CI", "LANG"],
        secretBindingIds: [] as string[],
      },
      {
        id: "project_build",
        allowedVariableNames: [] as string[],
        secretBindingIds: ["npm_token"],
      },
    ],
    dependencyProfiles: [{
      id: "pnpm_frozen",
      supportedPackageManagers: ["pnpm"],
      networkPolicy: "provision_then_offline",
      lifecycleScriptPolicy: "deny",
    }],
    executablePolicies: [{
      id: "node",
      executable: "node",
      fixedArgumentPrefix: ["--max-old-space-size=4096"],
      allowedPlatformIds: ["windows-4k"],
    }],
  };
}

function parse(input: unknown) {
  return parseHostExecutionPolicySnapshot(input, "测试宿主配置");
}

describe("parseHostExecutionPolicySnapshot", () => {
  it("解析完整快照并冻结全部稳定 ID", () => {
    const snapshot = parse(createSnapshotInput());

    expect(snapshot.id).toBe("host-default");
    expect(snapshot.currentPlatformId).toBe("windows-4k");
    expect(snapshot.platformCapabilities.map((c) => c.platformId)).toEqual([
      "windows-4k",
    ]);
    expect(snapshot.envProfiles.map((p) => p.id)).toEqual([
      "project_test",
      "project_build",
    ]);
    expect(snapshot.dependencyProfiles.map((p) => p.id)).toEqual([
      "pnpm_frozen",
    ]);
    expect(snapshot.executablePolicies.map((p) => p.id)).toEqual(["node"]);
  });

  it("拒绝未知字段、旧 schemaVersion 和缺失必需字段", () => {
    expect(() => parse({ ...createSnapshotInput(), unknown: true }))
      .toThrow("宿主执行策略快照不符合契约");
    expect(() => parse({ ...createSnapshotInput(), schemaVersion: 1 }))
      .toThrow("宿主执行策略快照不符合契约");
    const missing: Partial<ReturnType<typeof createSnapshotInput>> =
      createSnapshotInput();
    delete missing.envProfiles;
    expect(() => parse(missing)).toThrow("宿主执行策略快照不符合契约");
  });

  it("拒绝项目文档不可能合法引用的 ID 形状", () => {
    const upper = createSnapshotInput();
    upper.envProfiles = upper.envProfiles.map((profile, index) =>
      index === 0 ? { ...profile, id: "Project_Test" } : profile
    );
    expect(() => parse(upper)).toThrow("宿主执行策略快照不符合契约");

    const pathLike = createSnapshotInput();
    pathLike.executablePolicies = pathLike.executablePolicies.map((policy) => ({
      ...policy,
      id: "../bin/node",
    }));
    expect(() => parse(pathLike)).toThrow("宿主执行策略快照不符合契约");

    const badVariable = createSnapshotInput();
    badVariable.envProfiles = badVariable.envProfiles.map((profile, index) =>
      index === 0 ? { ...profile, allowedVariableNames: ["1INVALID"] } : profile
    );
    expect(() => parse(badVariable)).toThrow("宿主执行策略快照不符合契约");

    const badPlatform = createSnapshotInput();
    badPlatform.platformCapabilities = badPlatform.platformCapabilities.map(
      (capability) => ({ ...capability, platformId: "Windows_4K" }),
    );
    expect(() => parse(badPlatform)).toThrow("宿主执行策略快照不符合契约");
  });

  it("拒绝重复 ID、重复平台能力与悬空 sandboxCapability 引用", () => {
    const duplicateProfile = createSnapshotInput();
    duplicateProfile.envProfiles.push({
      id: "project_test",
      allowedVariableNames: [],
      secretBindingIds: [],
    });
    expect(() => parse(duplicateProfile)).toThrow("重复条目");

    const duplicatePlatform = createSnapshotInput();
    duplicatePlatform.platformCapabilities.push({
      platformId: "windows-4k",
      runnerId: "runner-local-2",
      kind: "remote",
      sandboxCapabilityId: "sandbox-win-job",
      trustIdentity: "host-signing-key-2",
    });
    expect(() => parse(duplicatePlatform)).toThrow("重复 platformId");

    const danglingSandbox = createSnapshotInput();
    danglingSandbox.platformCapabilities =
      danglingSandbox.platformCapabilities.map((capability) => ({
        ...capability,
        sandboxCapabilityId: "sandbox-missing",
      }));
    expect(() => parse(danglingSandbox)).toThrow(
      "引用未发布的 sandboxCapability",
    );

    const duplicateManager = createSnapshotInput();
    duplicateManager.dependencyProfiles =
      duplicateManager.dependencyProfiles.map((profile) => ({
        ...profile,
        supportedPackageManagers: ["pnpm", "pnpm"],
      }));
    expect(() => parse(duplicateManager)).toThrow("重复条目");

    const duplicatePolicyPlatform = createSnapshotInput();
    duplicatePolicyPlatform.executablePolicies =
      duplicatePolicyPlatform.executablePolicies.map((policy) => ({
        ...policy,
        allowedPlatformIds: ["windows-4k", "windows-4k"],
      }));
    expect(() => parse(duplicatePolicyPlatform)).toThrow("重复条目");
  });
});

describe("createHostExecutionPolicyHash", () => {
  it("相同快照重复解析得到相同规范哈希", () => {
    const canonicalHash = new NodeCanonicalHashService();
    const first = createHostExecutionPolicyHash(
      parse(createSnapshotInput()),
      canonicalHash,
    );
    const second = createHostExecutionPolicyHash(
      parse(createSnapshotInput()),
      canonicalHash,
    );

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toBe(first);
  });

  it("任何能力、数组顺序或策略字段变化都会改变规范哈希", () => {
    const canonicalHash = new NodeCanonicalHashService();
    const baseline = createHostExecutionPolicyHash(
      parse(createSnapshotInput()),
      canonicalHash,
    );

    const networkChanged = createSnapshotInput();
    networkChanged.dependencyProfiles =
      networkChanged.dependencyProfiles.map((profile) => ({
        ...profile,
        networkPolicy: "offline_only",
      }));
    expect(
      createHostExecutionPolicyHash(parse(networkChanged), canonicalHash),
    ).not.toBe(baseline);

    const reordered = createSnapshotInput();
    reordered.envProfiles.reverse();
    expect(
      createHostExecutionPolicyHash(parse(reordered), canonicalHash),
    ).not.toBe(baseline);

    const capabilityAdded = createSnapshotInput();
    capabilityAdded.sandboxCapabilities.push({ id: "sandbox-posix-group" });
    expect(
      createHostExecutionPolicyHash(parse(capabilityAdded), canonicalHash),
    ).not.toBe(baseline);

    const currentPlatformChanged = createSnapshotInput();
    currentPlatformChanged.currentPlatformId = "linux-gpu";
    expect(
      createHostExecutionPolicyHash(parse(currentPlatformChanged), canonicalHash),
    ).not.toBe(baseline);
  });
});
