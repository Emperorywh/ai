/*
 * 文件项目仓储把唯一规格文档与完整 TASK 目录编译成稳定的运行契约。
 * 每个 Markdown 文件既是任务正文也是机器元数据来源，目录中的任务不会被静默遗漏。
 * 所有文档先经过 UTF-8/BOM/NUL 校验与 LF 归一化，再由唯一规范哈希入口计算 source/contract 摘要。
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { parse } from "yaml";
import { encodeCanonicalUtf8 } from "../../domain/canonical-json.js";
import { assertCanonicalGitPathSet } from "../../domain/canonical-paths.js";
import { decodeCanonicalSourceText } from "../../domain/canonical-text.js";
import { ConfigurationError } from "../../domain/errors.js";
import {
  PROJECT_STRUCTURE,
  taskDefinitionSchema,
  taskDocumentMetadataSchema,
  type LoadedProject,
  type TaskDefinition,
  type TextDocument,
} from "../../domain/project.js";
import {
  createProjectHash,
  createSpecContractHash,
  createTaskContractHash,
  splitTaskDocument,
} from "../../domain/project-contract.js";
import { createLinearTaskSequence } from "../../domain/task-sequence.js";
import type { CanonicalHashService } from "../../ports/canonical-hash.js";
import type { ProjectRepository } from "../../ports/project-repository.js";

const TASK_BODY_PATTERN = /^\n## 任务描述\n\n[\s\S]*\S\n?$/u;

interface LoadedTaskDocument {
  readonly task: TaskDefinition;
  readonly document: TextDocument;
  readonly body: string;
}

export class FileProjectRepository implements ProjectRepository {
  /*
   * 规范哈希服务由组合根注入，仓储不自行选择摘要算法。
   */
  public constructor(private readonly canonicalHash: CanonicalHashService) {}

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
     * Git 路径在哈希前整体校验 NFC、碰撞与平台可表示性，非法路径直接拒绝项目。
     */
    assertCanonicalGitPathSet([
      specificationDocument.path,
      ...taskEntries.map((entry) => entry.document.path),
    ]);

    /*
     * 整体 projectHash 服务于同一 Run 的精确恢复；逐 TASK 契约指纹服务于新 Run 的安全复用。
     * SPEC 契约哈希绑定完整规范化正文，任一业务说明文字变化都会使全部 TASK 契约失效。
     * 契约与源集合投影都按 TASK 数字线性顺序排列，不依赖文件系统枚举顺序。
     */
    const specificationContractHash = createSpecContractHash(
      specificationDocument.content,
      this.canonicalHash,
    );
    const entriesByTaskId = new Map(
      taskEntries.map((entry) => [entry.task.id, entry] as const),
    );
    const taskContractHashes = new Map(tasks.map((task) => {
      const entry = entriesByTaskId.get(task.id);
      if (entry === undefined) {
        throw new ConfigurationError(`缺少任务文档：${task.id}`);
      }
      return [
        task.id,
        createTaskContractHash(
          {
            task,
            body: entry.body,
            specContractHash: specificationContractHash,
          },
          this.canonicalHash,
        ),
      ] as const;
    }));
    const projectHash = createProjectHash(
      {
        specification: {
          path: specificationDocument.path,
          sourceHash: specificationDocument.sourceHash,
        },
        tasks: tasks.map((task) => {
          const entry = entriesByTaskId.get(task.id);
          if (entry === undefined) {
            throw new ConfigurationError(`缺少任务文档：${task.id}`);
          }
          return {
            path: entry.document.path,
            sourceHash: entry.document.sourceHash,
          };
        }),
      },
      this.canonicalHash,
    );

    return {
      tasks,
      projectRoot: absoluteProjectRoot,
      projectHash,
      taskDocuments,
      taskContractHashes,
      specificationDocument,
      specificationContractHash,
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
      const body = this.validateTaskBody(task, content);
      return {
        task,
        document: { path: relativePath, content, sourceHash: this.hashText(content) },
        body,
      };
    }));
  }

  /*
   * 前置元数据必须位于文档开头并由成对分隔符包围，正文中的 YAML 示例不会被误解析。
   * TASK 状态不属于静态定义，诸如 status: pending 的字段会由严格 Schema 明确拒绝。
   */
  private parseTaskMetadata(path: string, content: string) {
    const split = splitTaskDocument(content);
    if (split === undefined) {
      throw new ConfigurationError(`TASK 缺少 YAML 前置元数据：${path}`);
    }

    let parsedYaml: unknown;
    try {
      parsedYaml = parse(split.frontMatter);
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
  private validateTaskBody(task: TaskDefinition, content: string): string {
    const body = splitTaskDocument(content)?.body ?? "";
    if (!TASK_BODY_PATTERN.test(body)) {
      throw new ConfigurationError(
        `TASK 正文必须使用“## 任务描述”且内容不能为空：${task.file}`,
      );
    }
    return body;
  }

  private async loadDocument(
    projectRoot: string,
    declaredPath: string,
  ): Promise<TextDocument> {
    const absolutePath = resolve(projectRoot, declaredPath);
    const content = await this.readRequiredFile(absolutePath, declaredPath);
    return {
      path: normalize(relative(projectRoot, absolutePath)),
      content,
      sourceHash: this.hashText(content),
    };
  }

  /*
   * 源文本先按字节校验 UTF-8、BOM 和 NUL，再做唯一的 CRLF/CR → LF 归一化。
   * 归一化正文是提示词、source hash 与 contract hash 的共同输入，不存在第二份原文。
   */
  private async readRequiredFile(path: string, label: string): Promise<string> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      throw new ConfigurationError(
        `${label} 无法读取：${path}（${this.describeError(error)}）`,
      );
    }
    const content = decodeCanonicalSourceText(bytes, label);
    if (content.trim().length === 0) {
      throw new ConfigurationError(`${label} 不能为空：${path}`);
    }
    return content;
  }

  private hashText(normalizedText: string): string {
    return this.canonicalHash.digestBytes(encodeCanonicalUtf8(normalizedText));
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
