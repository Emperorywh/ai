/*
 * 文件宿主策略来源测试锁定产品级固定路径、严格文本解码和 YAML/Schema 解析边界。
 * 临时目录只模拟用户配置目录，不经过项目 cwd，确保项目无法覆盖 capability 来源。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileHostExecutionPolicySource,
  resolveDefaultHostExecutionPolicyPath,
} from "../src/infrastructure/host/file-host-execution-policy-source.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })),
  );
});

describe("FileHostExecutionPolicySource", () => {
  it("从显式产品配置文件读取 v2 strict 快照", async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, "host-execution-policy.yaml");
    await writeFile(path, validPolicyYaml(), "utf8");

    const snapshot = await new FileHostExecutionPolicySource(path).load();

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.currentPlatformId).toBe("current-host");
  });

  it("缺失文件、重复 YAML 键和旧版本都 fail closed", async () => {
    const directory = await createTemporaryDirectory();
    const missing = join(directory, "missing.yaml");
    await expect(
      new FileHostExecutionPolicySource(missing).load(),
    ).rejects.toThrow("宿主执行策略无法读取");

    const duplicate = join(directory, "duplicate.yaml");
    await writeFile(
      duplicate,
      `${validPolicyYaml()}\nid: duplicate\n`,
      "utf8",
    );
    await expect(
      new FileHostExecutionPolicySource(duplicate).load(),
    ).rejects.toThrow("YAML 无法解析");

    const oldVersion = join(directory, "old-version.yaml");
    await writeFile(
      oldVersion,
      validPolicyYaml().replace("schemaVersion: 2", "schemaVersion: 1"),
      "utf8",
    );
    await expect(
      new FileHostExecutionPolicySource(oldVersion).load(),
    ).rejects.toThrow("不符合契约");
  });
});

describe("resolveDefaultHostExecutionPolicyPath", () => {
  it("只依据操作系统用户配置目录生成固定产品路径", () => {
    expect(resolveDefaultHostExecutionPolicyPath({
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\tester",
    })).toBe(
      "C:\\Users\\tester\\AppData\\Roaming\\apex-coding-agent\\host-execution-policy.yaml",
    );
    expect(resolveDefaultHostExecutionPolicyPath({
      platform: "linux",
      environment: { XDG_CONFIG_HOME: "/config" },
      homeDirectory: "/home/tester",
    })).toBe("/config/apex-coding-agent/host-execution-policy.yaml");
  });

  it("拒绝会退化为项目 cwd 相对路径的配置目录", () => {
    expect(() => resolveDefaultHostExecutionPolicyPath({
      platform: "linux",
      environment: { XDG_CONFIG_HOME: "project-relative" },
      homeDirectory: "/home/tester",
    })).toThrow("必须是绝对路径");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "apex-host-policy-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validPolicyYaml(): string {
  return `schemaVersion: 2
id: test-host
currentPlatformId: current-host
platformCapabilities:
  - platformId: current-host
    runnerId: local-runner
    kind: local
    sandboxCapabilityId: process-sandbox
    trustIdentity: local-host
sandboxCapabilities:
  - id: process-sandbox
envProfiles: []
dependencyProfiles: []
executablePolicies: []
`;
}
