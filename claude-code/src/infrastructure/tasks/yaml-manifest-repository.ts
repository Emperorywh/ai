/*
 * YAML 仓储在进入应用层前完成路径归一化、内容加载、依赖校验和整体哈希计算。
 * 所有引用文件必须位于项目根内，防止配置通过路径穿越读取或保护项目外内容。
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { createStableTaskOrder } from "../../domain/dag.js";
import { ConfigurationError } from "../../domain/errors.js";
import {
  taskManifestSchema,
  type LoadedTaskManifest,
  type TaskManifest,
  type TextDocument,
} from "../../domain/manifest.js";
import type { ManifestRepository } from "../../ports/manifest-repository.js";

export class YamlManifestRepository implements ManifestRepository {
  public async load(manifestPath: string): Promise<LoadedTaskManifest> {
    const absoluteManifestPath = resolve(manifestPath);
    const rawManifest = await this.readRequiredFile(absoluteManifestPath, "Manifest");

    let parsedYaml: unknown;
    try {
      parsedYaml = parse(rawManifest);
    } catch (error) {
      throw new ConfigurationError(
        `Manifest YAML 无法解析：${this.describeError(error)}`,
      );
    }

    const parsed = taskManifestSchema.safeParse(parsedYaml);
    if (!parsed.success) {
      throw new ConfigurationError(
        `Manifest 不符合契约：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("；")}`,
      );
    }

    const manifest = parsed.data;
    createStableTaskOrder(manifest.tasks);

    const projectRoot = resolve(dirname(absoluteManifestPath), manifest.project.root);
    await this.assertDirectory(projectRoot);
    const manifestRelativePath = this.toProjectRelative(
      projectRoot,
      absoluteManifestPath,
      "Manifest",
    );

    this.validateDeclaredPaths(manifest);

    const contextPaths = this.collectContextPaths(manifest);
    const contextDocuments = await Promise.all(
      contextPaths.map((path) => this.loadDocument(projectRoot, path)),
    );
    const taskEntries = await Promise.all(
      manifest.tasks.map(async (task) => [
        task.id,
        await this.loadDocument(projectRoot, task.file),
      ] as const),
    );
    const taskDocuments = new Map(taskEntries);

    const protectedPaths = [
      manifestRelativePath,
      ...contextDocuments.map((document) => document.path),
      ...taskEntries.map(([, document]) => document.path),
    ];
    const manifestHash = this.createContentHash(
      rawManifest,
      contextDocuments,
      taskEntries.map(([, document]) => document),
    );

    return {
      manifest,
      manifestPath: absoluteManifestPath,
      projectRoot,
      manifestHash,
      taskDocuments,
      contextDocuments,
      protectedPaths: [...new Set(protectedPaths)],
    };
  }

  private collectContextPaths(manifest: TaskManifest): readonly string[] {
    const paths = [
      ...(manifest.project.spec === undefined ? [] : [manifest.project.spec]),
      ...(manifest.project.plan === undefined ? [] : [manifest.project.plan]),
      ...manifest.project.contextFiles,
    ];
    return [...new Set(paths)];
  }

  private validateDeclaredPaths(manifest: TaskManifest): void {
    const filePaths = [
      ...this.collectContextPaths(manifest),
      ...manifest.tasks.map((task) => task.file),
    ];
    for (const path of filePaths) {
      this.assertSafeRelativePath(path, "文件路径");
    }

    for (const task of manifest.tasks) {
      for (const pattern of [...task.scope.allow, ...task.scope.deny]) {
        this.assertSafeRelativePath(pattern, `任务 ${task.id} 的路径规则`);
      }
    }
  }

  private assertSafeRelativePath(value: string, label: string): void {
    const normalized = value.replaceAll("\\", "/");
    if (
      isAbsolute(value)
      || normalized.includes("\0")
      || normalized === ".."
      || normalized.startsWith("../")
      || normalized.includes("/../")
    ) {
      throw new ConfigurationError(`${label} 必须位于项目根内：${value}`);
    }
  }

  private async loadDocument(
    projectRoot: string,
    declaredPath: string,
  ): Promise<TextDocument> {
    const absolutePath = resolve(projectRoot, declaredPath);
    const relativePath = this.toProjectRelative(
      projectRoot,
      absolutePath,
      declaredPath,
    );
    const content = await this.readRequiredFile(absolutePath, declaredPath);
    return { path: relativePath, content };
  }

  private toProjectRelative(
    projectRoot: string,
    absolutePath: string,
    label: string,
  ): string {
    const relativePath = relative(projectRoot, absolutePath);
    if (
      relativePath === ""
      || relativePath === ".."
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    ) {
      throw new ConfigurationError(`${label} 必须是项目根内的文件`);
    }
    return relativePath.replaceAll("\\", "/");
  }

  private async readRequiredFile(path: string, label: string): Promise<string> {
    try {
      const content = await readFile(path, "utf8");
      if (content.trim().length === 0) {
        throw new ConfigurationError(`${label} 不能为空：${path}`);
      }
      return content;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError(
        `${label} 无法读取：${path}（${this.describeError(error)}）`,
      );
    }
  }

  private async assertDirectory(path: string): Promise<void> {
    try {
      const result = await stat(path);
      if (!result.isDirectory()) {
        throw new ConfigurationError(`项目根不是目录：${path}`);
      }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError(
        `项目根无法访问：${path}（${this.describeError(error)}）`,
      );
    }
  }

  private createContentHash(
    rawManifest: string,
    contextDocuments: readonly TextDocument[],
    taskDocuments: readonly TextDocument[],
  ): string {
    const hash = createHash("sha256");
    hash.update(rawManifest);
    for (const document of [...contextDocuments, ...taskDocuments]) {
      hash.update("\0");
      hash.update(document.path);
      hash.update("\0");
      hash.update(document.content);
    }
    return hash.digest("hex");
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
