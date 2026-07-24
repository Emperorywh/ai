/*
 * 验收契约是 SPEC/TASK 文档中唯一机器可判定的完成门禁。
 * 本模块只接收基础设施层完成 Markdown 分节与 YAML 解析后的规范值：
 * strict Schema 校验语法形状，纯函数校验唯一性与跨引用，两者都在任何 Agent 启动前 fail closed。
 * command 执行描述只携带宿主稳定 ID，项目文档不能内嵌实现、绝对路径或凭据来扩大宿主执行能力。
 * 不存在旧自由文本推测、自动补全或宽松 fallback；语法形状非法即拒绝整个项目。
 */
import { z } from "zod";
import { assertCanonicalGitPath } from "./canonical-paths.js";
import { ConfigurationError } from "./errors.js";

const nonEmptyString = z.string().trim().min(1);

/*
 * 规范 ID 只允许小写数字与连字符/下划线分隔，天然排除绝对路径、盘符、空白和 shell 元字符。
 * package manager、executable、env/dependency profile 和 platform 在项目文档中只是稳定 ID，
 * 其实现由宿主 HostExecutionPolicySnapshot 在 Run 启动时冻结，项目不得定义或覆盖。
 * 宿主快照与项目文档共享同一稳定 ID 命名空间，因此该 Schema 对两个边界同时可见。
 */
export const stableIdSchema = z.string().regex(
  /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u,
  "稳定 ID 必须是小写字母数字与连字符/下划线组合",
);
const criterionIdSchema = z.string().regex(
  /^AC-\d{3,}$/u,
  "criterion id 必须是 AC-数字（至少三位）形式",
);
const requirementIdSchema = z.string().regex(
  /^REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/u,
  "requirement id 必须是 REQ-大写片段-数字（至少三位）形式",
);
export const platformIdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  "platformId 必须是小写字母数字与连字符组合",
);
const evidenceKindSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
  "evidence 种类必须是小写 snake_case 标识",
);
/*
 * response schema 必须显式版本化，单独一个未版本化名称不能绑定验收响应形状。
 */
const responseSchemaIdSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_v[1-9]\d*$/u,
  "response schema 必须是版本化 ID（以 _vN 结尾，N 从 1 开始）",
);
const packageScriptNameSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
  "package script 名称不允许空白或 shell 元字符",
);
const runtimeTokenSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
  "runtime/toolchain 必须是单 token 标识",
);

export const criterionKindSchema = z.enum([
  "command",
  "static",
  "human",
  "external",
]);
export type CriterionKind = z.infer<typeof criterionKindSchema>;

export const criterionScopeSchema = z.enum([
  "targeted",
  "full",
  "clean_platform",
]);
export type CriterionScope = z.infer<typeof criterionScopeSchema>;

/*
 * human/external 的 expected 必须是机器可判定的结构化比较，自由文本“看起来正常”永远不构成期望。
 */
export const comparisonOperatorSchema = z.enum([
  "less_than",
  "less_than_or_equal",
  "equal",
  "not_equal",
  "greater_than_or_equal",
  "greater_than",
]);
export const structuredExpectationSchema = z.strictObject({
  metric: nonEmptyString,
  operator: comparisonOperatorSchema,
  value: z.union([z.number(), nonEmptyString, z.boolean()]),
});
export type StructuredExpectation = z.infer<typeof structuredExpectationSchema>;

/*
 * command 不接受 raw shell 字符串；执行描述只有 package_script 与 argv 两个结构化分支。
 * 参数数组逐项传递，Runner 不经 shell 解析；cwd 只能是项目内相对路径。
 */
export const packageScriptExecutionSchema = z.strictObject({
  kind: z.literal("package_script"),
  packageManager: stableIdSchema,
  script: packageScriptNameSchema,
  args: z.array(z.string().min(1)),
  cwdRelative: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  envProfile: stableIdSchema,
  dependencyProfile: stableIdSchema,
});
export const argvExecutionSchema = z.strictObject({
  kind: z.literal("argv"),
  executable: stableIdSchema,
  args: z.array(z.string().min(1)),
  cwdRelative: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  envProfile: stableIdSchema,
});
export const criterionExecutionSchema = z.discriminatedUnion("kind", [
  packageScriptExecutionSchema,
  argvExecutionSchema,
]);
export type CriterionExecution = z.infer<typeof criterionExecutionSchema>;
export type PackageScriptExecution = Extract<
  CriterionExecution,
  { kind: "package_script" }
>;
export type ArgvExecution = Extract<CriterionExecution, { kind: "argv" }>;

const criterionBaseShape = {
  id: criterionIdSchema,
  requirementRefs: z.array(requirementIdSchema).min(1),
  allowNotApplicable: z.boolean().default(false),
  description: nonEmptyString,
};

/*
 * allowNotApplicable 默认且通常为 false；只有契约显式设为 true，Reviewer 才能给出带理由的 not_applicable。
 * platformId 引用 SPEC 支持平台矩阵中的稳定 ID，scope 为 clean_platform 时必录。
 */
export const commandCriterionSchema = z.strictObject({
  ...criterionBaseShape,
  kind: z.literal("command"),
  scope: criterionScopeSchema,
  platformId: platformIdSchema.optional(),
  execution: criterionExecutionSchema,
  success: z.literal("exit_code_zero"),
});
export const staticCriterionSchema = z.strictObject({
  ...criterionBaseShape,
  kind: z.literal("static"),
});
/*
 * human/external 必须包含 procedure、结构化 expected、非空 requiredEvidence 和版本化 responseSchema。
 */
const operatorJudgedShape = {
  ...criterionBaseShape,
  procedure: z.array(nonEmptyString).min(1),
  expected: structuredExpectationSchema,
  requiredEvidence: z.array(evidenceKindSchema).min(1),
  responseSchema: responseSchemaIdSchema,
};
export const humanCriterionSchema = z.strictObject({
  ...operatorJudgedShape,
  kind: z.literal("human"),
});
export const externalCriterionSchema = z.strictObject({
  ...operatorJudgedShape,
  kind: z.literal("external"),
});

export const acceptanceCriterionSchema = z.discriminatedUnion("kind", [
  commandCriterionSchema,
  staticCriterionSchema,
  humanCriterionSchema,
  externalCriterionSchema,
]);
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type CommandCriterion = Extract<AcceptanceCriterion, { kind: "command" }>;
export type StaticCriterion = Extract<AcceptanceCriterion, { kind: "static" }>;
export type HumanCriterion = Extract<AcceptanceCriterion, { kind: "human" }>;
export type ExternalCriterion = Extract<
  AcceptanceCriterion,
  { kind: "external" }
>;

/*
 * 规范 criterion key 带 TASK/integration scope，任何 evidence、finding、acceptance 和 certificate
 * 只保存规范键，跨 TASK 的裸 criterion id 冲突不会碰撞。
 */
export type ScopedAcceptanceCriterion = {
  [Kind in AcceptanceCriterion["kind"]]: Extract<
    AcceptanceCriterion,
    { kind: Kind }
  > & { readonly key: string };
}[AcceptanceCriterion["kind"]];

export const acceptanceCriteriaDocumentSchema = z.strictObject({
  criteria: z.array(acceptanceCriterionSchema).min(1),
});

/*
 * 每条 requirement 声明最低证据强度；覆盖判定只信任结构化 evidencePolicy，不接受 Agent 自报。
 */
export const evidencePolicySchema = z.strictObject({
  allowedCriterionKinds: z.array(criterionKindSchema).min(1),
  requiredPlatformIds: z.array(platformIdSchema),
  requiredResponseSchemas: z.array(responseSchemaIdSchema),
  requiredEvidence: z.array(evidenceKindSchema),
  finalCandidateRequired: z.boolean(),
});
export type EvidencePolicy = z.infer<typeof evidencePolicySchema>;

export const requirementDefinitionSchema = z.strictObject({
  id: requirementIdSchema,
  mandatory: z.boolean(),
  evidencePolicy: evidencePolicySchema,
});
export type RequirementDefinition = z.infer<typeof requirementDefinitionSchema>;

export const requirementsDocumentSchema = z.strictObject({
  requirements: z.array(requirementDefinitionSchema).min(1),
});

/*
 * 支持平台矩阵为每个目标声明稳定 platformId、OS、架构、runtime/toolchain、包管理器和换行策略。
 * 矩阵允许为空数组，但任何 platformId 引用（command criterion、requirement evidence policy）
 * 都必须能解析到矩阵中的真实条目。
 */
export const platformDefinitionSchema = z.strictObject({
  platformId: platformIdSchema,
  os: z.enum(["windows", "linux", "darwin"]),
  arch: z.enum(["x64", "arm64"]),
  runtime: runtimeTokenSchema,
  toolchain: runtimeTokenSchema,
  packageManager: stableIdSchema,
  lineEndingPolicy: z.enum(["lf", "crlf"]),
});
export type PlatformDefinition = z.infer<typeof platformDefinitionSchema>;

export const supportedPlatformMatrixDocumentSchema = z.strictObject({
  supportedPlatformMatrix: z.array(platformDefinitionSchema),
});

/*
 * SPEC/TASK 正文中结构化契约所在的固定章节；章节内容只允许一个 ```yaml 代码块。
 */
export const CONTRACT_SECTIONS = Object.freeze({
  requirements: "## 需求契约",
  supportedPlatformMatrix: "## 支持平台矩阵",
  integrationCriteria: "## 集成验收契约",
  taskAcceptanceCriteria: "### 验收契约",
});

export type AcceptanceCriterionScope =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "integration" };

export function canonicalCriterionKey(
  scope: AcceptanceCriterionScope,
  criterionId: string,
): string {
  return scope.kind === "task"
    ? `task:${scope.taskId}/${criterionId}`
    : `integration/${criterionId}`;
}

/*
 * 规范键由 scope 与 criterion id 唯一推导，不属于 YAML 输入；
 * 契约投影只哈希解析后的契约本体，规范键与 TASK id、SPEC 身份的绑定已由投影内容覆盖。
 */
export function attachCriterionKeys(
  criteria: readonly AcceptanceCriterion[],
  scope: AcceptanceCriterionScope,
): readonly ScopedAcceptanceCriterion[] {
  return criteria.map((criterion) => ({
    ...criterion,
    key: canonicalCriterionKey(scope, criterion.id),
  }));
}

export function parseAcceptanceCriteriaDocument(
  input: unknown,
  label: string,
): readonly AcceptanceCriterion[] {
  const { criteria } = parseContractDocument(
    acceptanceCriteriaDocumentSchema,
    input,
    "验收契约",
    label,
  );
  const seen = new Set<string>();
  for (const criterion of criteria) {
    if (seen.has(criterion.id)) {
      throw new ConfigurationError(
        `验收契约存在重复 criterion id：${label}（${criterion.id}）`,
      );
    }
    seen.add(criterion.id);
    validateCriterionSemantics(criterion, label);
  }
  return criteria;
}

export function parseRequirementsDocument(
  input: unknown,
  label: string,
): readonly RequirementDefinition[] {
  const { requirements } = parseContractDocument(
    requirementsDocumentSchema,
    input,
    "需求契约",
    label,
  );
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.id)) {
      throw new ConfigurationError(
        `需求契约存在重复 requirement id：${label}（${requirement.id}）`,
      );
    }
    seen.add(requirement.id);
    const policy = requirement.evidencePolicy;
    assertUniqueValues(policy.allowedCriterionKinds, "allowedCriterionKinds", label);
    assertUniqueValues(policy.requiredPlatformIds, "requiredPlatformIds", label);
    assertUniqueValues(
      policy.requiredResponseSchemas,
      "requiredResponseSchemas",
      label,
    );
    assertUniqueValues(policy.requiredEvidence, "requiredEvidence", label);
  }
  return requirements;
}

export function parseSupportedPlatformMatrixDocument(
  input: unknown,
  label: string,
): readonly PlatformDefinition[] {
  const { supportedPlatformMatrix } = parseContractDocument(
    supportedPlatformMatrixDocumentSchema,
    input,
    "支持平台矩阵",
    label,
  );
  const seen = new Set<string>();
  for (const platform of supportedPlatformMatrix) {
    if (seen.has(platform.platformId)) {
      throw new ConfigurationError(
        `支持平台矩阵存在重复 platformId：${label}（${platform.platformId}）`,
      );
    }
    seen.add(platform.platformId);
  }
  return supportedPlatformMatrix;
}

/*
 * 跨引用校验只接受悬空 ID fail closed：requirementRefs 必须指向存在的 SPEC requirement，
 * command criterion 与 evidence policy 的 platformId 必须指向平台矩阵中的真实条目。
 * requirement 覆盖强度判定属于后续任务，这里只证明引用可解析。
 */
export function validateProjectContractReferences(input: {
  readonly requirements: readonly RequirementDefinition[];
  readonly supportedPlatformMatrix: readonly PlatformDefinition[];
  readonly integrationCriteria: readonly ScopedAcceptanceCriterion[];
  readonly taskAcceptanceCriteria: ReadonlyMap<
    string,
    readonly ScopedAcceptanceCriterion[]
  >;
}): void {
  const requirementIds = new Set(
    input.requirements.map((requirement) => requirement.id),
  );
  const platformIds = new Set(
    input.supportedPlatformMatrix.map((platform) => platform.platformId),
  );
  for (const requirement of input.requirements) {
    for (const platformId of requirement.evidencePolicy.requiredPlatformIds) {
      if (!platformIds.has(platformId)) {
        throw new ConfigurationError(
          `需求契约引用不存在的 platformId：${requirement.id}（${platformId}）`,
        );
      }
    }
  }
  const validateCriteria = (
    criteria: readonly ScopedAcceptanceCriterion[],
  ): void => {
    for (const criterion of criteria) {
      for (const requirementRef of criterion.requirementRefs) {
        if (!requirementIds.has(requirementRef)) {
          throw new ConfigurationError(
            `验收契约引用不存在的 requirement：${criterion.key}（${requirementRef}）`,
          );
        }
      }
      if (
        criterion.kind === "command" &&
        criterion.platformId !== undefined &&
        !platformIds.has(criterion.platformId)
      ) {
        throw new ConfigurationError(
          `验收契约引用不存在的 platformId：${criterion.key}（${criterion.platformId}）`,
        );
      }
    }
  };
  validateCriteria(input.integrationCriteria);
  for (const criteria of input.taskAcceptanceCriteria.values()) {
    validateCriteria(criteria);
  }
}

export function describeContractIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("；");
}

function parseContractDocument<T>(
  schema: z.ZodType<T>,
  input: unknown,
  contractName: string,
  label: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigurationError(
      `${contractName}不符合契约：${label}（${describeContractIssues(parsed.error.issues)}）`,
    );
  }
  return parsed.data;
}

function validateCriterionSemantics(
  criterion: AcceptanceCriterion,
  label: string,
): void {
  assertUniqueValues(criterion.requirementRefs, "requirementRefs", label);
  if (criterion.kind === "command") {
    if (criterion.scope === "clean_platform" && criterion.platformId === undefined) {
      throw new ConfigurationError(
        `clean_platform criterion 必须声明 platformId：${label}（${criterion.id}）`,
      );
    }
    assertCwdRelative(criterion.execution.cwdRelative, label);
    assertArgumentSafety(criterion.execution.args, label);
    return;
  }
  if (criterion.kind === "human" || criterion.kind === "external") {
    assertUniqueValues(criterion.requiredEvidence, "requiredEvidence", label);
  }
}

/*
 * cwd 只允许 “.” 或项目内规范相对 POSIX 路径；绝对路径、盘符、.. 与反斜杠都属于
 * 项目文档试图越出宿主执行边界的语法形状，必须拒绝。
 */
function assertCwdRelative(cwdRelative: string, label: string): void {
  if (cwdRelative === ".") {
    return;
  }
  try {
    assertCanonicalGitPath(cwdRelative);
  } catch (error) {
    throw new ConfigurationError(
      `验收执行 cwdRelative 不是项目内规范相对路径：${label}（${
        error instanceof Error ? error.message : String(error)
      }）`,
    );
  }
}

/*
 * 参数逐项传递且不经 shell 解析，任何 shell 拼接语义都属于非法 execution。
 */
const SHELL_OPERATOR_PATTERN = /[;&|><`]/u;

function assertArgumentSafety(args: readonly string[], label: string): void {
  for (const arg of args) {
    if (
      hasControlCharacter(arg) ||
      SHELL_OPERATOR_PATTERN.test(arg) ||
      arg.includes("$(") ||
      arg.includes("${")
    ) {
      throw new ConfigurationError(
        `验收执行参数包含 shell 拼接语义：${label}（${arg}）`,
      );
    }
  }
}

function assertUniqueValues(
  values: readonly string[],
  field: string,
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new ConfigurationError(
      `验收契约字段存在重复条目：${label}（${field}）`,
    );
  }
}

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
