/*
 * 文件项目仓储把唯一规格文档与完整 TASK 目录编译成稳定的运行契约。
 * 每个 Markdown 文件既是任务正文也是机器元数据来源，目录中的任务不会被静默遗漏。
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { parse } from "yaml";
import { ConfigurationError } from "../../domain/errors.js";
import {
  PROJECT_STRUCTURE,
  taskDefinitionSchema,
  taskDocumentMetadataSchema,
  type LoadedProject,
  type TaskDefinition,
  type TextDocument,
} from "../../domain/project.js";
import { createTaskContractHash } from "../../domain/task-completion.js";
import { createLinearTaskSequence } from "../../domain/task-sequence.js";
import type { ProjectRepository } from "../../ports/project-repository.js";

const TASK_FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

interface LoadedTaskDocument {
  readonly task: TaskDefinition;
  readonly document: TextDocument;
}

export class FileProjectRepository implements ProjectRepository {
  public async load(projectRoot: string): Promise<LoadedProject> {
    const absoluteProjectRoot = resolve(projectRoot);
    await this.assertDirectory(absoluteProjectRoot);

    /*
     * 规格文档是唯一项目级上下文，加载失败必须立即终止。
     * 这里不保留空集合或额外策略文件 fallback，保证提示词和契约哈希共享同一事实源。
     */
    const specificationDocument = await this.loadDocument(
      absoluteProjectRoot,
      PROJECT_STRUCTURE.specification,
    );
    const taskEntries = await this.loadTaskDocuments(absoluteProjectRoot);
    const tasks = createLinearTaskSequence(taskEntries.map((entry) => entry.task));
    const taskDocuments = new Map(
      taskEntries.map((entry) => [entry.task.id, entry.document] as const),
    );
    /*
     * 整体 projectHash 服务于同一 Run 的精确恢复；逐 TASK 契约指纹服务于新 Run 的安全复用。
     * 执行策略由程序版本固定，项目哈希只绑定用户可编辑的项目上下文与任务事实。
     */
    const taskContractHashes = new Map(tasks.map((task) => {
      const taskDocument = taskDocuments.get(task.id);
      if (taskDocument === undefined) {
        throw new ConfigurationError(`缺少任务文档：${task.id}`);
      }
      return [
        task.id,
        createTaskContractHash({
          task,
          taskDocument,
          specificationDocument,
        }),
      ] as const;
    }));

    return {
      tasks,
      projectRoot: absoluteProjectRoot,
      projectHash: this.createContentHash(
        specificationDocument,
        tasks.map((task) => {
          const document = taskDocuments.get(task.id);
          if (document === undefined) {
            throw new ConfigurationError(`缺少任务文档：${task.id}`);
          }
          return document;
        }),
      ),
      taskDocuments,
      taskContractHashes,
      specificationDocument,
    };
  }

  private async loadTaskDocuments(
    projectRoot: string,
  ): Promise<readonly LoadedTaskDocument[]> {
    const absoluteDirectory = resolve(
      projectRoot,
      PROJECT_STRUCTURE.taskDirectory,
    );
    await this.assertDirectory(absoluteDirectory);

    const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => compareText(left.name, right.name));
    if (entries.length === 0) {
      throw new ConfigurationError(
        `TASK 目录没有 Markdown 任务文档：${PROJECT_STRUCTURE.taskDirectory}`,
      );
    }

    return Promise.all(entries.map(async (entry) => {
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const relativePath = normalize(relative(projectRoot, absolutePath));
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
      this.validateTaskBody(task, content);
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
    const match = TASK_FRONT_MATTER_PATTERN.exec(content);
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

  /*
   * TASK 正文只有一个固定入口，标题身份不再复制到 Markdown 一级标题中。
   * 任务描述必须包含实际内容，避免合法元数据包裹空任务后进入 Agent 执行阶段。
   */
  private validateTaskBody(task: TaskDefinition, content: string): void {
    const metadata = TASK_FRONT_MATTER_PATTERN.exec(content);
    const body = metadata === null ? "" : content.slice(metadata[0].length);
    if (!/^\r?\n## 任务描述\r?\n\r?\n[\s\S]*\S(?:\r?\n)?$/u.test(body)) {
      throw new ConfigurationError(
        `TASK 正文必须使用“## 任务描述”且内容不能为空：${task.file}`,
      );
    }
  }

  private async loadDocument(
    projectRoot: string,
    declaredPath: string,
  ): Promise<TextDocument> {
    const absolutePath = resolve(projectRoot, declaredPath);
    const content = await this.readRequiredFile(absolutePath, declaredPath);
    return { path: normalize(relative(projectRoot, absolutePath)), content };
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
    specificationDocument: TextDocument,
    taskDocuments: readonly TextDocument[],
  ): string {
    const hash = createHash("sha256");
    /*
     * 项目快照先绑定唯一规格，再按稳定文件名顺序绑定所有任务。
     * 显式顺序让恢复判断不依赖文件系统枚举行为，也不会混入运行状态文件。
     */
    for (const document of [specificationDocument, ...taskDocuments]) {
      hash.update(document.path);
      hash.update("\0");
      hash.update(document.content);
      hash.update("\0");
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
