/*
 * 项目契约投影是 SPEC/TASK 进入证据链的唯一规范形态。
 * 投影包含完整规范化正文：任何业务说明文字变化都会改变 contract hash，不能只哈希结构化块。
 * 等价 LF/CRLF 源文本得到相同 contract hash，路径与结构化字段变化同样改变对应摘要。
 */
import { z } from "zod";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import {
  canonicalSha256DigestSchema,
  defineCanonicalSchema,
  type CanonicalValue,
} from "./canonical-schema.js";
import { TASK_ID_PATTERN, type TaskDefinition } from "./project.js";

const TASK_FRONT_MATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/u;

const nonEmptyString = z.string().trim().min(1);
const canonicalPathSchema = z.string().min(1);

const sourceFileProjectionSchema = z.strictObject({
  path: canonicalPathSchema,
  sourceHash: canonicalSha256DigestSchema,
});

export const specContractProjectionSchema = defineCanonicalSchema(1, {
  body: z.string(),
});
export type SpecContractProjection = CanonicalValue<
  typeof specContractProjectionSchema
>;

/*
 * 验收契约的结构化解析由后续任务扩展并显式升级 schemaVersion。
 * 当前版本已经绑定完整规范化正文与 SPEC 契约，正文身份不存在第二套算法。
 */
export const taskContractProjectionSchema = defineCanonicalSchema(1, {
  id: z.string().regex(TASK_ID_PATTERN),
  title: nonEmptyString,
  body: z.string(),
  specContractHash: canonicalSha256DigestSchema,
});
export type TaskContractProjection = CanonicalValue<
  typeof taskContractProjectionSchema
>;

/*
 * 项目源集合投影绑定唯一 SPEC 与按领域顺序排列的全部 TASK 源摘要。
 * tasks 数组保持 TASK 数字线性顺序，不为追求稳定而额外排序。
 */
export const projectSourceProjectionSchema = defineCanonicalSchema(1, {
  specification: sourceFileProjectionSchema,
  tasks: z.array(sourceFileProjectionSchema),
});
export type ProjectSourceProjection = CanonicalValue<
  typeof projectSourceProjectionSchema
>;

/*
 * 前置元数据与正文只有一个拆分入口，仓储解析与契约投影共享同一事实源。
 * 输入必须已经完成 LF 归一化，正文中的 YAML 示例不会被误解析。
 */
export function splitTaskDocument(
  content: string,
): { readonly frontMatter: string; readonly body: string } | undefined {
  const match = TASK_FRONT_MATTER_PATTERN.exec(content);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return { frontMatter: match[1], body: content.slice(match[0].length) };
}

export function createSpecContractHash(
  normalizedSpecBody: string,
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(specContractProjectionSchema, {
    schemaVersion: specContractProjectionSchema.schemaVersion,
    body: normalizedSpecBody,
  });
}

export function createTaskContractHash(
  input: {
    readonly task: TaskDefinition;
    readonly body: string;
    readonly specContractHash: string;
  },
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(taskContractProjectionSchema, {
    schemaVersion: taskContractProjectionSchema.schemaVersion,
    id: input.task.id,
    title: input.task.title,
    body: input.body,
    specContractHash: input.specContractHash,
  });
}

export function createProjectHash(
  input: {
    readonly specification: z.infer<typeof sourceFileProjectionSchema>;
    readonly tasks: readonly z.infer<typeof sourceFileProjectionSchema>[];
  },
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(projectSourceProjectionSchema, {
    schemaVersion: projectSourceProjectionSchema.schemaVersion,
    specification: input.specification,
    tasks: [...input.tasks],
  });
}
