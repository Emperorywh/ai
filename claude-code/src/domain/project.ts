/*
 * 项目结构是编排器唯一支持的目录契约，不从文件、环境变量或命令行读取可变配置。
 * 初始化器与项目仓储共享同一组路径，保证生成模板和运行时加载不会形成两套约定。
 */
import { z } from "zod";

export const PROJECT_STRUCTURE = Object.freeze({
  specification: "SPEC.md",
  plan: "PLAN.md",
  agentInstructions: "AGENTS.md",
  taskDirectory: "tasks",
});

export const PROJECT_CONTEXT_FILES = Object.freeze([
  PROJECT_STRUCTURE.specification,
  PROJECT_STRUCTURE.plan,
  PROJECT_STRUCTURE.agentInstructions,
]);

const nonEmptyString = z.string().trim().min(1);

/*
 * TASK 前置元数据只承载任务身份、依赖、单任务熔断和人工验收事实。
 * 系统级模型、审核与 Git 策略不允许从 TASK 反向覆盖，避免执行规则产生多事实源。
 */
export const taskDocumentMetadataSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  title: nonEmptyString,
  dependsOn: z.array(nonEmptyString),
  maxAttempts: z.number().int().positive().optional(),
  timeoutMinutes: z.number().int().positive().optional(),
  manualAcceptance: z.array(nonEmptyString).default([]),
}).strict();

export const taskDefinitionSchema = taskDocumentMetadataSchema.extend({
  file: nonEmptyString,
}).strict();

export type TaskDocumentMetadata = z.infer<typeof taskDocumentMetadataSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;

export interface TextDocument {
  readonly path: string;
  readonly content: string;
}

/*
 * LoadedProject 是文件系统项目经过严格校验后的不可变运行输入。
 * 应用层只消费该结构，不感知模板文件读取、Markdown 元数据解析或哈希实现细节。
 */
export interface LoadedProject {
  readonly tasks: readonly TaskDefinition[];
  readonly projectRoot: string;
  readonly projectHash: string;
  readonly taskDocuments: ReadonlyMap<string, TextDocument>;
  readonly taskContractHashes: ReadonlyMap<string, string>;
  readonly contextDocuments: readonly TextDocument[];
}

export function getTaskAttemptLimit(
  task: TaskDefinition,
): number | undefined {
  return task.maxAttempts;
}

export function getTaskTimeoutMinutes(
  task: TaskDefinition,
): number | undefined {
  return task.timeoutMinutes;
}
