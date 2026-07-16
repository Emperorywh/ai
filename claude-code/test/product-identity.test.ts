/*
 * 产品身份测试锁定 npm 包、全局可执行入口和代码内命名空间之间的一致性。
 * 发布前若 manifest 与运行时身份发生漂移，测试必须失败，不能产出名称不一致的全局包。
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readPackageVersion } from "../src/cli/package-manifest.js";
import { PRODUCT_IDENTITY } from "../src/product-identity.js";

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly bin: Readonly<Record<string, string>>;
}

describe("Apex Coding Agent 产品身份", () => {
  it("统一 npm 包名、全局命令和运行时命名空间", async () => {
    const content = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(content) as PackageManifest;

    expect(PRODUCT_IDENTITY.displayName).toBe("Apex Coding Agent");
    expect(PRODUCT_IDENTITY.slug).toBe("apex-coding-agent");
    expect(PRODUCT_IDENTITY.gitReferenceRoot).toBe("refs/apex-coding-agent");
    expect(manifest.name).toBe(PRODUCT_IDENTITY.slug);
    expect(manifest.bin).toEqual({
      [PRODUCT_IDENTITY.slug]: "./dist/cli/index.js",
    });
    await expect(readPackageVersion()).resolves.toBe(manifest.version);
  });
});
