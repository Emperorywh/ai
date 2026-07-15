/*
 * Manifest 只声明项目级策略，TASK Markdown 前置元数据是任务目录的唯一机器事实源。
 * TASK 契约只保留调度、资源熔断和人工验收事实，不用执行边界削减自主 Agent 能力。
 */
import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

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

const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const taskManifestSchema = z.object({
  /*
   * 第三版契约明确删除 scope、gates 与 verification，不解析也不兼容旧配置。
   * 版本提升让错误配置在 Agent 启动前失败，避免旧安全模型以隐式默认值残留。
   */
  version: z.literal(3),
  project: z.object({
    root: nonEmptyString.default("."),
    spec: nonEmptyString.optional(),
    plan: nonEmptyString.optional(),
    contextFiles: z.array(nonEmptyString).default([]),
  }).strict(),
  /*
   * 资源字段是显式熔断策略，省略即表示持续执行到收敛或收到外部中断。
   * Schema 只校验正数，不再用编排器硬编码上限替用户决定任务规模。
   */
  defaults: z.object({
    maxAttempts: z.number().int().positive().optional(),
    taskTimeoutMinutes: z.number().int().positive().optional(),
    maxTurns: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    model: nonEmptyString.default("sonnet"),
    effort: effortSchema.default("high"),
  }).strict(),
  review: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().positive().optional(),
    model: nonEmptyString.default("sonnet"),
    effort: effortSchema.default("high"),
    maxTurns: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
  }).strict().default({
    enabled: true,
    model: "sonnet",
    effort: "high",
  }),
  git: z.object({
    commitMessagePrefix: nonEmptyString.default("task"),
  }).strict().default({
    commitMessagePrefix: "task",
  }),
  taskCatalog: z.object({
    directory: nonEmptyString,
  }).strict(),
}).strict();

export type TaskDocumentMetadata = z.infer<typeof taskDocumentMetadataSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TaskManifest = z.infer<typeof taskManifestSchema>;

export interface TextDocument {
  readonly path: string;
  readonly content: string;
}

export interface LoadedTaskManifest {
  readonly manifest: TaskManifest;
  readonly tasks: readonly TaskDefinition[];
  readonly manifestPath: string;
  readonly projectRoot: string;
  readonly manifestHash: string;
  readonly taskDocuments: ReadonlyMap<string, TextDocument>;
  readonly taskContractHashes: ReadonlyMap<string, string>;
  readonly contextDocuments: readonly TextDocument[];
}

export function getTaskAttemptLimit(
  manifest: TaskManifest,
  task: TaskDefinition,
): number | undefined {
  return task.maxAttempts ?? manifest.defaults.maxAttempts;
}

export function getTaskTimeoutMinutes(
  manifest: TaskManifest,
  task: TaskDefinition,
): number | undefined {
  return task.timeoutMinutes ?? manifest.defaults.taskTimeoutMinutes;
}
