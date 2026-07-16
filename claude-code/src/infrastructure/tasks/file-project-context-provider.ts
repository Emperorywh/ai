/*
 * 文件项目上下文编译器只收集导航元数据，不读取源码正文。
 * 深度、数量和忽略目录均为系统固定策略，避免大型仓库把无界文件树注入 Agent 上下文。
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ProjectContextManifest,
  ProjectScript,
} from "../../domain/project-context.js";
import type { ProjectContextProvider } from "../../ports/project-context-provider.js";

const MAX_TREE_DEPTH = 2;
const MAX_TREE_ENTRIES = 300;
const MAX_PACKAGE_SCRIPTS = 100;
const MAX_SCRIPT_COMMAND_LENGTH = 500;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

interface TreeCompilation {
  readonly entries: readonly string[];
  readonly truncated: boolean;
}

interface PackageMetadata {
  readonly scripts: readonly ProjectScript[];
  readonly scriptsTruncated: boolean;
  readonly declaredPackageManager?: ProjectContextManifest["packageManager"];
  readonly diagnostics: readonly string[];
}

export class FileProjectContextProvider implements ProjectContextProvider {
  public async compile(projectRoot: string): Promise<ProjectContextManifest> {
    const absoluteRoot = resolve(projectRoot);
    const tree = await this.compileTree(absoluteRoot);
    const rootNames = new Set(
      (await readdir(absoluteRoot, { withFileTypes: true }))
        .map((entry) => entry.name),
    );
    const packageMetadata = rootNames.has("package.json")
      ? await this.readPackageMetadata(absoluteRoot)
      : { scripts: [], scriptsTruncated: false, diagnostics: [] };
    const packageManager = detectPackageManager(rootNames)
      ?? packageMetadata.declaredPackageManager;
    const scripts = packageMetadata.scripts;
    const canonical = JSON.stringify({
      packageManager: packageManager ?? null,
      scripts,
      scriptsTruncated: packageMetadata.scriptsTruncated,
      entries: tree.entries,
      truncated: tree.truncated,
      diagnostics: packageMetadata.diagnostics,
    });
    return {
      fingerprint: createHash("sha256").update(canonical).digest("hex"),
      ...(packageManager === undefined ? {} : { packageManager }),
      scripts,
      scriptsTruncated: packageMetadata.scriptsTruncated,
      entries: tree.entries,
      truncated: tree.truncated,
      diagnostics: packageMetadata.diagnostics,
    };
  }

  private async compileTree(projectRoot: string): Promise<TreeCompilation> {
    const entries: string[] = [];
    let truncated = false;

    /*
     * 深度优先遍历配合逐层字典序可在不同平台保持一致；符号链接只作为叶子展示，绝不跟随。
     * 达到上限后立即停止继续读取目录，避免“已经截断却仍扫描全仓”的隐性性能开销。
     */
    const visit = async (
      absoluteDirectory: string,
      prefix: string,
      depth: number,
    ): Promise<void> => {
      const children = (await readdir(absoluteDirectory, { withFileTypes: true }))
        .sort((left, right) => compareText(left.name, right.name));
      for (const child of children) {
        if (entries.length >= MAX_TREE_ENTRIES) {
          truncated = true;
          return;
        }
        const relativePath = prefix.length === 0
          ? child.name
          : `${prefix}/${child.name}`;
        if (child.isDirectory()) {
          entries.push(`${relativePath}/`);
          if (
            depth < MAX_TREE_DEPTH
            && !IGNORED_DIRECTORIES.has(child.name)
          ) {
            await visit(resolve(absoluteDirectory, child.name), relativePath, depth + 1);
            if (truncated) {
              return;
            }
          }
        } else {
          entries.push(relativePath);
        }
      }
    };

    await visit(projectRoot, "", 0);
    return { entries, truncated };
  }

  private async readPackageMetadata(
    projectRoot: string,
  ): Promise<PackageMetadata> {
    const path = resolve(projectRoot, "package.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      return {
        scripts: [],
        scriptsTruncated: false,
        diagnostics: [`package.json 无法解析：${describeError(error)}`],
      };
    }
    if (!isRecord(parsed)) {
      return {
        scripts: [],
        scriptsTruncated: false,
        diagnostics: ["package.json 根节点不是对象"],
      };
    }
    const declaredPackageManager = readDeclaredPackageManager(
      parsed.packageManager,
    );
    if (parsed.scripts === undefined) {
      return {
        scripts: [],
        scriptsTruncated: false,
        diagnostics: [],
        ...(declaredPackageManager === undefined
          ? {}
          : { declaredPackageManager }),
      };
    }
    if (!isRecord(parsed.scripts)) {
      return {
        scripts: [],
        scriptsTruncated: false,
        diagnostics: ["package.json 的 scripts 不是对象"],
        ...(declaredPackageManager === undefined
          ? {}
          : { declaredPackageManager }),
      };
    }
    const diagnostics: string[] = [];
    const allScripts = Object.entries(parsed.scripts)
      .flatMap(([name, command]) => {
        if (typeof command !== "string") {
          diagnostics.push(`package.json 脚本 ${name} 不是字符串`);
          return [];
        }
        return [{
          name,
          command: command.length <= MAX_SCRIPT_COMMAND_LENGTH
            ? command
            : `${command.slice(0, MAX_SCRIPT_COMMAND_LENGTH)}…`,
        }];
      })
      .sort((left, right) => compareText(left.name, right.name));
    const scripts = allScripts.slice(0, MAX_PACKAGE_SCRIPTS);
    return {
      scripts,
      scriptsTruncated: allScripts.length > scripts.length,
      diagnostics,
      ...(declaredPackageManager === undefined
        ? {}
        : { declaredPackageManager }),
    };
  }
}

function detectPackageManager(
  rootNames: ReadonlySet<string>,
): ProjectContextManifest["packageManager"] {
  if (rootNames.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (rootNames.has("bun.lock") || rootNames.has("bun.lockb")) {
    return "bun";
  }
  if (rootNames.has("yarn.lock")) {
    return "yarn";
  }
  if (rootNames.has("package-lock.json")) {
    return "npm";
  }
  return undefined;
}

function readDeclaredPackageManager(
  value: unknown,
): ProjectContextManifest["packageManager"] {
  if (typeof value !== "string") {
    return undefined;
  }
  const name = value.split("@", 1)[0];
  return name === "bun" || name === "npm" || name === "pnpm" || name === "yarn"
    ? name
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
