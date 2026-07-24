/*
 * 应用门禁测试证明 Queue 上层只会得到“已验证宿主策略摘要”或明确配置错误。
 * Fake source 提供产品级快照，测试不读取开发机用户配置，也不允许项目注入能力。
 */
import { describe, expect, it } from "vitest";
import { DefaultRunStartupCapabilityValidator } from "../src/application/run-startup-capability-validator.js";
import { parseHostExecutionPolicySnapshot } from "../src/domain/host-execution-policy.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";
import type { HostExecutionPolicySource } from "../src/ports/host-execution-policy-source.js";
import { createLoadedProject } from "./support/orchestrator-fixture.js";

function createSource(withRunner: boolean): HostExecutionPolicySource {
  const snapshot = parseHostExecutionPolicySnapshot({
    schemaVersion: 2,
    id: "test-host",
    currentPlatformId: "current-host",
    platformCapabilities: withRunner
      ? [{
          platformId: "current-host",
          runnerId: "local-runner",
          kind: "local",
          sandboxCapabilityId: "process-sandbox",
          trustIdentity: "local-host",
        }]
      : [],
    sandboxCapabilities: withRunner ? [{ id: "process-sandbox" }] : [],
    envProfiles: [{
      id: "project_test",
      allowedVariableNames: [],
      secretBindingIds: [],
    }],
    dependencyProfiles: [{
      id: "pnpm_frozen",
      supportedPackageManagers: ["pnpm"],
      networkPolicy: "offline_only",
      lifecycleScriptPolicy: "deny",
    }],
    executablePolicies: [],
  }, "测试宿主策略");
  return { load: async () => snapshot };
}

describe("DefaultRunStartupCapabilityValidator", () => {
  it("返回已验证且可重算的宿主策略摘要", async () => {
    const validator = new DefaultRunStartupCapabilityValidator(
      createSource(true),
      new NodeCanonicalHashService(),
    );

    const result = await validator.validate(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.hostExecutionPolicyHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("缺少 currentPlatformId Runner 时在 Run 创建前拒绝", async () => {
    const validator = new DefaultRunStartupCapabilityValidator(
      createSource(false),
      new NodeCanonicalHashService(),
    );

    await expect(
      validator.validate(createLoadedProject([{ id: "TASK-001" }])),
    ).rejects.toThrow("缺少平台 Runner current-host");
  });
});
