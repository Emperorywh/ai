/*
 * 项目契约投影是 SPEC/TASK 进入证据链的唯一规范形态。
 * 投影包含完整规范化正文与解析后的结构化契约：任何业务说明文字、requirements、
 * 平台矩阵、验收条款变化都会改变对应 contract hash，不能只哈希结构化块或 YAML 验收块。
 * 等价 LF/CRLF 源文本得到相同 contract hash，路径与结构化字段变化同样改变对应摘要。
 */
import { z } from "zod";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import {
  acceptanceCriterionSchema,
  platformDefinitionSchema,
  requirementDefinitionSchema,
  type AcceptanceCriterion,
  type PlatformDefinition,
  type RequirementDefinition,
} from "./acceptance-contract.js";
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

/*
 * schemaVersion 2 起 SPEC 契约同时绑定完整规范化正文、requirements、支持平台矩阵和
 * 同构 integrationCriteria；任一结构化契约或业务说明文字变化都会使全部 TASK 契约失效。
 */
export const specContractProjectionSchema = defineCanonicalSchema(2, {
  body: z.string(),
  requirements: z.array(requirementDefinitionSchema),
  supportedPlatformMatrix: z.array(platformDefinitionSchema),
  integrationCriteria: z.array(acceptanceCriterionSchema),
});
export type SpecContractProjection = CanonicalValue<
  typeof specContractProjectionSchema
>;

/*
 * schemaVersion 2 起 TASK 契约同时绑定完整规范化正文与解析后的验收契约。
 * 规范 criterion key 由正文身份与 criterion id 推导，不作为投影字段重复参与哈希。
 */
export const taskContractProjectionSchema = defineCanonicalSchema(2, {
  id: z.string().regex(TASK_ID_PATTERN),
  title: nonEmptyString,
  body: z.string(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema),
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
 * requirement 集合与平台矩阵拥有独立的稳定合同身份，Run 契约可直接引用，
 * 不必重算整个 SPEC 契约即可证明需求或平台语义是否变化。
 */
export const requirementSetProjectionSchema = defineCanonicalSchema(1, {
  requirements: z.array(requirementDefinitionSchema),
});
export type RequirementSetProjection = CanonicalValue<
  typeof requirementSetProjectionSchema
>;

export const platformMatrixProjectionSchema = defineCanonicalSchema(1, {
  platforms: z.array(platformDefinitionSchema),
});
export type PlatformMatrixProjection = CanonicalValue<
  typeof platformMatrixProjectionSchema
>;

/*
 * task-set 身份绑定按数字线性顺序排列的全部 TASK 契约指纹，
 * 任一 TASK 契约或集合顺序变化都会改变该身份。
 */
export const taskSetProjectionSchema = defineCanonicalSchema(1, {
  tasks: z.array(z.strictObject({
    id: z.string().regex(TASK_ID_PATTERN),
    contractHash: canonicalSha256DigestSchema,
  })),
});
export type TaskSetProjection = CanonicalValue<typeof taskSetProjectionSchema>;

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
  input: {
    readonly body: string;
    readonly requirements: readonly RequirementDefinition[];
    readonly supportedPlatformMatrix: readonly PlatformDefinition[];
    readonly integrationCriteria: readonly AcceptanceCriterion[];
  },
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(specContractProjectionSchema, {
    schemaVersion: specContractProjectionSchema.schemaVersion,
    body: input.body,
    requirements: [...input.requirements],
    supportedPlatformMatrix: [...input.supportedPlatformMatrix],
    integrationCriteria: [...input.integrationCriteria],
  });
}

export function createTaskContractHash(
  input: {
    readonly task: TaskDefinition;
    readonly body: string;
    readonly acceptanceCriteria: readonly AcceptanceCriterion[];
    readonly specContractHash: string;
  },
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(taskContractProjectionSchema, {
    schemaVersion: taskContractProjectionSchema.schemaVersion,
    id: input.task.id,
    title: input.task.title,
    body: input.body,
    acceptanceCriteria: [...input.acceptanceCriteria],
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

export function createRequirementSetHash(
  requirements: readonly RequirementDefinition[],
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(requirementSetProjectionSchema, {
    schemaVersion: requirementSetProjectionSchema.schemaVersion,
    requirements: [...requirements],
  });
}

export function createPlatformMatrixHash(
  platforms: readonly PlatformDefinition[],
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(platformMatrixProjectionSchema, {
    schemaVersion: platformMatrixProjectionSchema.schemaVersion,
    platforms: [...platforms],
  });
}

export function createTaskSetHash(
  tasks: readonly { readonly id: string; readonly contractHash: string }[],
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(taskSetProjectionSchema, {
    schemaVersion: taskSetProjectionSchema.schemaVersion,
    tasks: tasks.map((task) => ({ ...task })),
  });
}
