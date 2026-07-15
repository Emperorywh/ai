/*
 * 任务完成契约只包含会改变“任务是否仍然有效”的事实，不包含模型、预算、重试次数等执行策略。
 * 自主 Worker 的能力不再由路径或命令清单塑形，需求、上下文与审核策略是完成定义的全部输入。
 */
import { createHash } from "node:crypto";
import type {
  TaskDefinition,
  TaskManifest,
  TextDocument,
} from "./manifest.js";

export interface TaskContractHashInput {
  readonly manifest: TaskManifest;
  readonly task: TaskDefinition;
  readonly taskDocument: TextDocument;
  readonly contextDocuments: readonly TextDocument[];
}

export interface DependencyCompletion {
  readonly taskId: string;
  readonly commitSha: string;
}

/*
 * TASK 前置元数据已经由严格 Schema 解析，因此契约使用规范化字段，并只从原文保留任务正文。
 * maxAttempts、timeoutMinutes 及 Manifest 的模型/预算字段被有意排除，它们只控制执行过程，不改变完成定义。
 */
export function createTaskContractHash(input: TaskContractHashInput): string {
  const contract = {
    /*
     * 第二版完成契约与 Manifest v3 同步删除 scope、gates 和 verificationSharedPaths。
     * 显式换代确保旧提交证据不会在新执行模型下被错误复用。
     */
    version: 2,
    task: {
      id: input.task.id,
      title: input.task.title,
      file: input.task.file,
      dependsOn: input.task.dependsOn,
      manualAcceptance: input.task.manualAcceptance,
      body: extractTaskBody(input.taskDocument.content),
    },
    reviewRequired: input.manifest.review.enabled,
    contextDocuments: [...input.contextDocuments]
      .sort((left, right) => compareText(left.path, right.path))
      .map((document) => ({
        path: document.path,
        content: document.content,
      })),
  };
  return createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");
}

/*
 * 下游任务绑定依赖任务的具体完成提交，而不是只绑定 completed 布尔值。
 * 任一依赖重新执行并产生新提交时，下游指纹都会改变，从而沿 DAG 确定性传播失效。
 */
export function createDependencyCompletionFingerprint(
  dependencies: readonly DependencyCompletion[],
): string {
  const hash = createHash("sha256");
  for (const dependency of dependencies) {
    hash.update(dependency.taskId);
    hash.update("\0");
    hash.update(dependency.commitSha);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function extractTaskBody(content: string): string {
  const metadata = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(content);
  return metadata === null ? content : content.slice(metadata[0].length);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
