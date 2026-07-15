/*
 * YAML 仓储把项目级 Manifest 与 TASK 目录编译成完整、稳定的运行契约。
 * 每个 Markdown 文件既是任务正文也是机器元数据来源，目录中的任务无法被配置静默遗漏。
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { createStableTaskOrder } from "../../domain/dag.js";
import { ConfigurationError } from "../../domain/errors.js";
import {
  taskDefinitionSchema,
  taskDocumentMetadataSchema,
  taskManifestSchema,
  type LoadedTaskManifest,
  type TaskDefinition,
  type TaskManifest,
  type TextDocument,
} from "../../domain/manifest.js";
import type { ManifestRepository } from "../../ports/manifest-repository.js";
import { createTaskContractHash } from "../../domain/task-completion.js";

interface LoadedTaskDocument {
  readonly task: TaskDefinition;
  readonly document: TextDocument;
}

export class YamlManifestRepository implements ManifestRepository {
  public async load(manifestPath: string): Promise<LoadedTaskManifest> {
    const absoluteManifestPath = resolve(manifestPath);
    const rawManifest = await this.readRequiredFile(absoluteManifestPath, "Manifest");
    const manifest = this.parseManifest(rawManifest);
    const projectRoot = resolve(dirname(absoluteManifestPath), manifest.project.root);

    await this.assertDirectory(projectRoot);
    const manifestRelativePath = this.toProjectRelative(
      projectRoot,
      absoluteManifestPath,
      "Manifest",
    );
    this.validateProjectPaths(manifest);

    const contextDocuments = await Promise.all(
      this.collectContextPaths(manifest).map((path) =>
        this.loadDocument(projectRoot, path)),
    );
    const taskCatalog = await this.loadTaskCatalog(projectRoot, manifest);
    const tasks = createStableTaskOrder(taskCatalog.map((entry) => entry.task));
    const taskDocuments = new Map(
      taskCatalog.map((entry) => [entry.task.id, entry.document] as const),
    );
    const protectedPaths = [
      manifestRelativePath,
      ...contextDocuments.map((document) => document.path),
      ...taskCatalog.map((entry) => entry.document.path),
    ];
    /*
     * 整体 manifestHash 服务于同一 Run 的精确恢复；逐 TASK 契约指纹服务于新 Run 的安全复用。
     * 两者职责不同，不能用会被模型和重试策略影响的整体哈希替代任务完成契约。
     */
    const taskContractHashes = new Map(tasks.map((task) => {
      const taskDocument = taskDocuments.get(task.id);
      if (taskDocument === undefined) {
        throw new ConfigurationError(`缺少任务文档：${task.id}`);
      }
      return [
        task.id,
        createTaskContractHash({
          manifest,
          task,
          taskDocument,
          contextDocuments,
        }),
      ] as const;
    }));

    return {
      manifest,
      tasks,
      manifestPath: absoluteManifestPath,
      projectRoot,
      manifestHash: this.createContentHash(
        rawManifest,
        contextDocuments,
        taskCatalog.map((entry) => entry.document),
      ),
      taskDocuments,
      taskContractHashes,
      contextDocuments,
      protectedPaths: [...new Set(protectedPaths)],
    };
  }

  /*
   * Manifest 与 TASK 元数据分别严格解析，任何未知字段都会在 Agent 启动前失败。
   * 版本 2 不保留旧 tasks 数组，避免同一任务同时存在两套可漂移定义。
   */
  private parseManifest(rawManifest: string): TaskManifest {
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
        `Manifest 不符合契约：${this.describeIssues(parsed.error.issues)}`,
      );
    }
    return parsed.data;
  }

  private async loadTaskCatalog(
    projectRoot: string,
    manifest: TaskManifest,
  ): Promise<readonly LoadedTaskDocument[]> {
    const absoluteDirectory = resolve(projectRoot, manifest.taskCatalog.directory);
    this.toProjectRelative(
      projectRoot,
      absoluteDirectory,
      "TASK 目录",
    );
    await this.assertDirectory(absoluteDirectory);

    const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => compareText(left.name, right.name));
    if (entries.length === 0) {
      throw new ConfigurationError(
        `TASK 目录没有 Markdown 任务文档：${manifest.taskCatalog.directory}`,
      );
    }

    return Promise.all(entries.map(async (entry) => {
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const relativePath = this.toProjectRelative(
        projectRoot,
        absolutePath,
        `TASK 文档 ${entry.name}`,
      );
      const content = await this.readRequiredFile(absolutePath, relativePath);
      const metadata = this.parseTaskMetadata(relativePath, content);
      if (basename(relativePath) !== `${metadata.id}.md`) {
        throw new ConfigurationError(
          `TASK 文件名必须与 id 一致：${relativePath} 应命名为 ${metadata.id}.md`,
        );
      }

      const task = taskDefinitionSchema.parse({
        ...metadata,
        file: relativePath,
      });
      this.validateTaskPaths(task);
      this.validateTaskHeading(task, content);
      return {
        task,
        document: { path: relativePath, content },
      };
    }));
  }

  /*
   * 前置元数据必须位于文档开头并由成对分隔符包围，正文中的 YAML 示例不会被误解析。
   * TASK 状态不属于静态定义，诸如 status: pending 的字段会由严格 Schema 明确拒绝。
   */
  private parseTaskMetadata(path: string, content: string) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
    if (match?.[1] === undefined) {
      throw new ConfigurationError(`TASK 缺少 YAML 前置元数据：${path}`);
    }

    let parsedYaml: unknown;
    try {
      parsedYaml = parse(match[1]);
    } catch (error) {
      throw new ConfigurationError(
        `TASK 前置元数据无法解析：${path}（${this.describeError(error)}）`,
      );
    }
    const parsed = taskDocumentMetadataSchema.safeParse(parsedYaml);
    if (!parsed.success) {
      throw new ConfigurationError(
        `TASK 前置元数据不符合契约：${path}（${this.describeIssues(parsed.error.issues)}）`,
      );
    }
    return parsed.data;
  }

  private validateTaskHeading(task: TaskDefinition, content: string): void {
    const firstHeading = content.split(/\r?\n/u).find((line) => line.startsWith("# "));
    const expected = `# ${task.id} — ${task.title}`;
    if (firstHeading !== expected) {
      throw new ConfigurationError(
        `TASK 标题必须与前置元数据一致：${task.file} 期望“${expected}”`,
      );
    }
  }

  private collectContextPaths(manifest: TaskManifest): readonly string[] {
    const paths = [
      ...(manifest.project.spec === undefined ? [] : [manifest.project.spec]),
      ...(manifest.project.plan === undefined ? [] : [manifest.project.plan]),
      ...manifest.project.contextFiles,
    ];
    return [...new Set(paths)];
  }

  private validateProjectPaths(manifest: TaskManifest): void {
    for (const path of [
      ...this.collectContextPaths(manifest),
      manifest.taskCatalog.directory,
      ...manifest.verification.sharedPaths,
    ]) {
      this.assertSafeRelativePath(path, "项目路径");
    }
    if (normalize(manifest.taskCatalog.directory) === ".") {
      throw new ConfigurationError("TASK 目录不能直接使用项目根目录");
    }
    if (manifest.verification.sharedPaths.some((path) => normalize(path) === ".")) {
      throw new ConfigurationError("验证共享路径不能直接使用项目根目录");
    }
  }

  private validateTaskPaths(task: TaskDefinition): void {
    for (const pattern of [...task.scope.allow, ...task.scope.deny]) {
      this.assertSafeRelativePath(pattern, `任务 ${task.id} 的路径规则`);
    }
  }

  private assertSafeRelativePath(value: string, label: string): void {
    const normalized = normalize(value);
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
      throw new ConfigurationError(`${label} 必须是项目根内的路径`);
    }
    return normalize(relativePath);
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
        throw new ConfigurationError(`路径不是目录：${path}`);
      }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError(
        `目录无法访问：${path}（${this.describeError(error)}）`,
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

  private describeIssues(
    issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
  ): string {
    return issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("；");
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
