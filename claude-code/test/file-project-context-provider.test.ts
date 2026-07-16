/*
 * 项目上下文编译器测试只构造最小临时目录，验证排序、忽略策略、脚本发现与稳定指纹。
 * 测试不读取当前仓库结构，避免环境变化成为上下文协议的隐式输入。
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectContextProvider } from "../src/infrastructure/tasks/file-project-context-provider.js";

describe("FileProjectContextProvider", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })),
    );
  });

  it("生成稳定排序的轻量文件树、包管理器和脚本清单", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "src", "feature"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(root, "src", "z.ts"), "export {};\n");
    await writeFile(join(root, "src", "a.ts"), "export {};\n");
    await writeFile(join(root, "src", "feature", "deep.ts"), "export {};\n");
    await writeFile(join(root, "node_modules", "ignored", "package.js"), "");
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        test: "vitest run",
        build: "tsc -p tsconfig.json",
      },
    }));
    const provider = new FileProjectContextProvider();

    const first = await provider.compile(root);
    const second = await provider.compile(root);

    expect(first).toEqual(second);
    expect(first.packageManager).toBe("pnpm");
    expect(first.scripts.map((script) => script.name)).toEqual(["build", "test"]);
    expect(first.entries).toContain("src/a.ts");
    expect(first.entries).toContain("src/feature/deep.ts");
    expect(first.entries).toContain("node_modules/");
    expect(first.entries).not.toContain("node_modules/ignored/");
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("把无效 package.json 作为显式诊断交给 Agent 而不是中断执行", async () => {
    const root = await createTemporaryRoot();
    await writeFile(join(root, "package.json"), "{ invalid json");

    const context = await new FileProjectContextProvider().compile(root);

    expect(context.scripts).toEqual([]);
    expect(context.diagnostics[0]).toContain("package.json 无法解析");
  });

  async function createTemporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "apex-context-test-"));
    temporaryRoots.push(root);
    return root;
  }
});
