/**
 * Application 规划工作流（Readme.md §6 文档体系 / §8 上下文包 / §11 执行流程第 1-6 步）。
 *
 * 承载 SPEC/ARCHITECTURE → PLAN → 任务拆分的 application 用例，产出计划与任务的领域
 * 模型；不调用模型、不做文件 I/O、不修改规格文档（任务 §7）。
 *
 *   - validatePlanningInputs：校验 SPEC/ARCHITECTURE 存在且已审查，或自举 source_spec
 *     可接受（须返回人工确认标记）。纯逻辑校验——文件存在性与审查状态作为显式输入
 *     传入（CLI composition root 负责 I/O 与解析），本用例不读文件（任务 §7「不写文件」
 *     的精神延伸至读：application 层只产领域模型，文件存在性判定属 CLI）。
 *   - createPlanDraft：基于显式阶段输入生成 PLAN 草案模型（§6.4 阶段级计划），并提供
 *     markdown 渲染供 CLI 落盘。
 *   - createTaskDrafts：生成 TaskFrontmatter 集合（初始 status: draft，§8 不得直接
 *     ready），source_files 按依赖 allowed_paths 预填（§8），并对每个任务调
 *     computeContextPack 产出初始注入清单（任务 §2）。
 *   - validateTaskGraph：复用调度器（topologicalOrder / detectParallelizable）检测
 *     依赖环与 allowed_paths 并行冲突，复用 core detectDependencyCycle 取环路径。
 *
 * 设计约束（任务 §7 / §8 / ARCHITECTURE §3-4）：
 *   - application 层只产出计划与任务的领域模型；CLI 负责入参解析与落盘，infra 负责
 *     文件系统。
 *   - 自举 source_spec 是显式输入，不得在用例内部硬编码 Readme.md（任务 §8）。
 *   - 任务拆分必须先生成 draft，不得直接生成 ready（任务 §8）。
 *   - 经 core 类型 + 同层 application 模块（computeContextPack / topologicalOrder /
 *     detectParallelizable）表达，零反向依赖，不 import infrastructure/cli。
 *
 * 权威来源：根目录 Readme.md §6 / §8 / §9 / §11。
 */
import {
  TaskFrontmatterSchema,
  detectDependencyCycle,
  type ContextPack,
  type Layer,
  type Permission,
  type TaskFrontmatter,
  type TaskId,
} from '../core/index.js'
import {
  computeContextPack,
  type DependencyResultSummary,
} from './context-pack-generator.js'
import { detectParallelizable, topologicalOrder } from './scheduler.js'

/* ============================================================ *
 * 规划输入校验（§11 第 2-4 步：SPEC / ARCHITECTURE 审查 / 自举例外）
 * ============================================================ */

/**
 * 规划输入的显式状态（由调用方 CLI 经文件 I/O 与解析后传入）。
 *
 * application 层不读文件（任务 §7）：SPEC/ARCHITECTURE 的存在性与审查状态由 CLI
 * composition root 判定后作为显式输入传入。sourceSpec 非空表示采用自举例外
 * （§6 自举例外：新系统实现本工作流自身时，以单一已确认需求文档作 source_spec）。
 */
export interface PlanningInputs {
  /** docs/SPEC.md 是否存在。 */
  readonly specExists: boolean
  /** docs/ARCHITECTURE.md 是否存在。 */
  readonly architectureExists: boolean
  /** docs/SPEC.md 是否已通过 Reviewer 独立审查（§11 第 4 步）。 */
  readonly specReviewed: boolean
  /** docs/ARCHITECTURE.md 是否已通过 Reviewer 独立审查（§11 第 4 步）。 */
  readonly architectureReviewed: boolean
  /** 自举 source_spec（如 'Readme.md'）；undefined / 空串 / 纯空白表示非自举。 */
  readonly sourceSpec?: string
}

/** 标准模式结果：SPEC + ARCHITECTURE 均存在且已通过 Reviewer 审查。 */
export interface StandardPlanningValidation {
  readonly ok: true
  readonly mode: 'standard'
}

/**
 * 自举模式结果：以 source_spec 替代正式 SPEC，须人工 / Reviewer 确认（§11 自举例外）。
 *
 * needsHumanConfirmation 固定为 true——§11 验收「自举 source_spec 输入可通过，但必须
 * 返回需要人工 / Reviewer 确认的标记」。具体确认状态由 createPlanDraft 写入 PLAN 前置
 * 说明，本结果只标记「需要确认」。
 */
export interface BootstrapPlanningValidation {
  readonly ok: true
  readonly mode: 'bootstrap'
  readonly sourceSpec: string
  readonly needsHumanConfirmation: true
}

/** 校验失败结果：缺少必要前置且无自举兜底（§11 验收「拒绝生成」）。 */
export interface FailedPlanningValidation {
  readonly ok: false
  readonly reason: string
  /** 缺失或未通过的前置项清单（供调用方展示给人工）。 */
  readonly missing: readonly string[]
}

export type PlanningValidationResult =
  | StandardPlanningValidation
  | BootstrapPlanningValidation
  | FailedPlanningValidation

/**
 * 校验规划前置输入（§11 第 2-4 步）。
 *
 * 规则：
 *   1. 标准 mode：SPEC 与 ARCHITECTURE 均存在且已通过 Reviewer 审查 → ok:true、
 *      mode:'standard'。
 *   2. 自举 mode：不满足标准但声明了 source_spec → ok:true、mode:'bootstrap'、
 *      needsHumanConfirmation:true（§11 验收：自举必须返回需人工确认的标记）。
 *   3. 拒绝：既不满足标准、也无 source_spec → ok:false + missing 清单（§11 验收：
 *      缺 SPEC/ARCHITECTURE 且未声明 source_spec 时拒绝生成）。
 *
 * 标准模式优先：即便同时声明了 source_spec，只要 SPEC + ARCHITECTURE 审查通过就走标准
 * （更严格的前置，符合 §6「目标项目通过 SPEC + ARCHITECTURE 承载长期协议」）。
 */
export function validatePlanningInputs(
  input: PlanningInputs,
): PlanningValidationResult {
  const standardOk =
    input.specExists &&
    input.architectureExists &&
    input.specReviewed &&
    input.architectureReviewed
  if (standardOk) {
    return { ok: true, mode: 'standard' }
  }

  const sourceSpec = input.sourceSpec?.trim()
  if (sourceSpec !== undefined && sourceSpec !== '') {
    return { ok: true, mode: 'bootstrap', sourceSpec, needsHumanConfirmation: true }
  }

  // 既不满足标准、也无自举兜底 → 收集缺失项，显式拒绝不静默（AGENTS §3）。
  const missing: string[] = []
  if (!input.specExists) missing.push('docs/SPEC.md 不存在')
  if (!input.architectureExists) missing.push('docs/ARCHITECTURE.md 不存在')
  if (input.specExists && !input.specReviewed) {
    missing.push('docs/SPEC.md 未通过审查')
  }
  if (input.architectureExists && !input.architectureReviewed) {
    missing.push('docs/ARCHITECTURE.md 未通过审查')
  }
  return {
    ok: false,
    reason: '规划前置不满足：缺少已审查的 SPEC/ARCHITECTURE，且未声明自举 source_spec',
    missing,
  }
}

/* ============================================================ *
 * PLAN 草案模型（§6.4 阶段级开发计划）
 * ============================================================ */

/** 显式阶段输入（由调用方提供，不在用例内硬编码 §6.4 推荐顺序——任务 §8）。 */
export interface PlanPhaseInput {
  readonly name: string
  readonly description: string
}

/** PLAN 草案输入。 */
export interface PlanDraftInput {
  /** 项目 / 计划标题。 */
  readonly title: string
  /** 自举 source_spec（写入前置说明的自举声明）；省略表示标准模式。 */
  readonly sourceSpec?: string
  /** 显式阶段定义（§6.4：阶段级计划，不应写成过细任务清单）。 */
  readonly phases: readonly PlanPhaseInput[]
}

/** PLAN 阶段（带 1-based order，按输入顺序）。 */
export interface PlanPhase {
  readonly name: string
  readonly description: string
  readonly order: number
}

/** PLAN 草案模型（领域模型，CLI 经 renderPlanMarkdown 序列化落盘）。 */
export interface PlanDraft {
  readonly title: string
  readonly sourceSpec?: string
  /** 前置说明（含审查 / 自举确认声明，§11 第 4 步 / 自举例外）。 */
  readonly preface: string
  readonly phases: readonly PlanPhase[]
}

/**
 * 生成 PLAN 草案模型（§6.4）。
 *
 * 基于显式阶段输入组装 PLAN 草案：分配 1-based order、生成前置说明（标准模式声明
 * 审查通过，自举模式声明 source_spec 与人工确认要求）。不调用模型、不写文件、不在
 * 用例内硬编码阶段顺序（任务 §8：阶段由调用方显式提供）。
 *
 * 非法输入显式抛错不静默：phases 为空（无阶段的 PLAN 无意义）、阶段名重复或为空。
 */
export function createPlanDraft(input: PlanDraftInput): PlanDraft {
  if (input.phases.length === 0) {
    throw new Error('PLAN 草案至少需包含一个阶段（phases 为空）')
  }
  // 阶段名重复 / 为空会让 PLAN 阅读混乱，显式拒绝。
  const names = new Set<string>()
  input.phases.forEach((p, i) => {
    if (p.name.trim() === '') {
      throw new Error(`PLAN 阶段名不能为空（阶段 order=${i + 1}）`)
    }
    if (names.has(p.name)) {
      throw new Error(`PLAN 阶段名重复：${p.name}`)
    }
    names.add(p.name)
  })

  const phases: PlanPhase[] = input.phases.map((p, i) => ({
    name: p.name,
    description: p.description,
    order: i + 1,
  }))

  return {
    title: input.title,
    sourceSpec: input.sourceSpec,
    preface: buildPlanPreface(input),
    phases,
  }
}

/**
 * 生成 PLAN 前置说明：标准模式声明 SPEC/ARCHITECTURE 审查通过，自举模式声明
 * source_spec 与人工确认要求（§11 第 4 步 / 自举例外）。
 */
function buildPlanPreface(input: PlanDraftInput): string {
  const sourceSpec = input.sourceSpec?.trim()
  if (sourceSpec !== undefined && sourceSpec !== '') {
    return [
      `本项目采用自举例外（Readme §6 / §11），以 \`${sourceSpec}\` 作为权威 source_spec，`,
      '替代正式 docs/SPEC.md + docs/ARCHITECTURE.md。',
      '依据 §11 自举例外：须经人工 / Reviewer 独立确认该 source_spec 可作为权威规格来源，',
      '确认结果记录于本前置说明，且不得遗留会阻塞实现的待确认问题。',
    ].join('')
  }
  return [
    '本项目 docs/SPEC.md 与 docs/ARCHITECTURE.md 已通过 Reviewer 独立审查（Readme §11 第 4 步），',
    '审查意见与修订记录见 docs/DECISIONS.md / docs/ISSUES.md。',
  ].join('')
}

/**
 * 把 PLAN 草案模型渲染为 markdown 文本（供 CLI 落盘）。
 *
 * application 层产模型并提供渲染；文件 I/O 归 CLI。渲染结构对齐 §6.4（阶段级计划：
 * 标题 + 前置说明 + 阶段列表，不写成过细任务清单）。
 */
export function renderPlanMarkdown(draft: PlanDraft): string {
  const lines: string[] = []
  lines.push(`# ${draft.title}`)
  lines.push('')
  lines.push('> 阶段级开发计划（Readme §6.4）：描述阶段、依赖关系与交付顺序，非过细任务清单。')
  lines.push('')
  lines.push(draft.preface)
  lines.push('')
  lines.push('## 阶段')
  lines.push('')
  for (const p of draft.phases) {
    lines.push(`${p.order}. **${p.name}**：${p.description}`)
  }
  return `${lines.join('\n')}\n`
}

/* ============================================================ *
 * 任务草案集合（§9 任务模板 + §8 Context Pack 预填）
 * ============================================================ */

/** 单个任务的显式拆分输入（字段对齐 TaskFrontmatter，初始 status 固定 draft）。 */
export interface TaskDraftSpec {
  readonly id: TaskId
  readonly title: string
  readonly layer: Layer
  readonly depends_on?: readonly TaskId[]
  readonly allowed_paths: readonly string[]
  readonly forbidden_paths?: readonly string[]
  readonly permissions?: readonly Permission[]
  readonly no_review?: boolean
  readonly restart_on_retry?: boolean
  readonly verification: readonly string[]
  /** context_pack.required_docs 初始声明（按需文档，不含必读核心 / 任务文件）。 */
  readonly required_docs?: readonly string[]
  /** context_pack.optional_doc_excerpts 初始声明。 */
  readonly optional_doc_excerpts?: readonly string[]
  /**
   * context_pack.source_files 初始预填；省略时按 depends_on 各任务 allowed_paths
   * 并集预填（Readme §8：拆分阶段依赖尚未执行，先按依赖 allowed_paths 预填）。
   */
  readonly source_files?: readonly string[]
  /** workflow_outputs.result_file（docs/tasks/TASK-XXX-<slug>.result.md）。 */
  readonly result_file: string
}

/** 任务草案输入。 */
export interface TaskDraftsInput {
  readonly tasks: readonly TaskDraftSpec[]
}

/** 单个任务草案产物：合法 TaskFrontmatter（draft）+ 初始注入清单（computeContextPack）。 */
export interface TaskDraftResult {
  readonly task: TaskFrontmatter
  /** computeContextPack 产出的完整初始注入清单（含必读核心 ∪ 任务文件，§8 并集）。 */
  readonly contextPack: ContextPack
}

/** 任务草案集合产物。 */
export interface TaskDraftsResult {
  readonly drafts: readonly TaskDraftResult[]
}

/**
 * 生成任务草案集合（§9 + §8）。
 *
 * 每个 spec 组装为初始 status:'draft' 的 TaskFrontmatter（任务 §8：任务拆分必须先
 * 生成 draft，不得直接 ready），经 TaskFrontmatterSchema 校验（任务 §11 验收「生成的
 * 任务均通过 Schema」）后，调 computeContextPack 产出初始注入清单（任务 §2）。
 *
 * source_files 预填规则（§8）：spec 显式提供则用之，否则按 depends_on 各依赖任务
 * （同一批 drafts）的 allowed_paths 并集预填——依赖尚未执行，先以依赖的 allowed_paths
 * 作源码范围下限，running 前再由 refreshSourceFiles 用实际 .result.md 清单刷新
 * （归 TASK-017 / 026）。frontmatter.context_pack 存「裁剪声明」（required_docs /
 * optional_doc_excerpts / 预填 source_files，不含必读核心与任务文件——后者由
 * computeContextPack 运行时并入，§8），TaskDraftResult.contextPack 存完整注入清单。
 *
 * 重复 id 抛错（任务集合内 id 须唯一）。依赖指向集合外任务时，该依赖对 source_files
 * 预填无贡献（跳过，存在性校验归 validateTaskGraph）。
 */
export function createTaskDrafts(input: TaskDraftsInput): TaskDraftsResult {
  // 先建 id→spec 索引（供 source_files 按依赖预填）；重复 id 显式拒绝。
  const byId = new Map<TaskId, TaskDraftSpec>()
  for (const spec of input.tasks) {
    if (byId.has(spec.id)) {
      throw new Error(`任务草案含重复 id：${spec.id}`)
    }
    byId.set(spec.id, spec)
  }

  // 初始拆分阶段无依赖完成 → refreshSourceFiles 保留预填（all-or-nothing）。
  const dependencyResults: ReadonlyMap<TaskId, DependencyResultSummary> = new Map()

  const drafts: TaskDraftResult[] = []
  for (const spec of input.tasks) {
    const sourceFiles = resolveInitialSourceFiles(spec, byId)
    const initialContextPack = {
      required_docs: [...(spec.required_docs ?? [])],
      optional_doc_excerpts: [...(spec.optional_doc_excerpts ?? [])],
      source_files: sourceFiles,
    }
    const task = {
      id: spec.id,
      title: spec.title,
      status: 'draft' as const,
      layer: spec.layer,
      depends_on: [...(spec.depends_on ?? [])],
      allowed_paths: [...spec.allowed_paths],
      forbidden_paths: [...(spec.forbidden_paths ?? [])],
      permissions: [...(spec.permissions ?? [])],
      no_review: spec.no_review ?? false,
      restart_on_retry: spec.restart_on_retry ?? false,
      verification: [...spec.verification],
      context_pack: initialContextPack,
      workflow_outputs: { result_file: spec.result_file },
    }
    // 读取即校验：确保产出的 frontmatter 通过 Schema（任务 §11 验收）。
    const validated = TaskFrontmatterSchema.parse(task)
    // computeContextPack 产出完整初始注入清单（必读核心 ∪ 声明 ∪ 任务文件，§8 并集）。
    const computed = computeContextPack(validated, { dependencyResults })
    drafts.push({ task: validated, contextPack: computed })
  }
  return { drafts }
}

/**
 * 解析任务初始 source_files（§8 预填规则）。
 *
 * spec 显式提供 → 用之（允许调用方精确控制）；否则按 depends_on 各依赖任务（同批）
 * 的 allowed_paths 并集预填。依赖指向集合外任务时跳过（无 allowed_paths 可取，存在性
 * 校验归 validateTaskGraph）。保持插入顺序去重，便于确定性写回与测试断言。
 */
function resolveInitialSourceFiles(
  spec: TaskDraftSpec,
  byId: Map<TaskId, TaskDraftSpec>,
): string[] {
  if (spec.source_files !== undefined) {
    return [...spec.source_files]
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const dep of spec.depends_on ?? []) {
    const depSpec = byId.get(dep)
    if (depSpec === undefined) continue // 外部依赖跳过
    for (const p of depSpec.allowed_paths) {
      if (!seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
    }
  }
  return out
}

/* ============================================================ *
 * 任务图校验（依赖环 + allowed_paths 并行冲突）
 * ============================================================ */

/** allowed_paths 并行冲突：两任务路径重叠（§3.2 默认串行 → 建议不并行）。 */
export interface PathConflict {
  readonly taskA: TaskId
  readonly taskB: TaskId
}

/** 任务图校验结果。 */
export interface TaskGraphValidationResult {
  /** 重复 id 清单（图不合法；scheduler topologicalOrder 会对重复 id 抛错）。 */
  readonly duplicateIds: readonly TaskId[]
  /** 是否存在依赖环。 */
  readonly hasCycle: boolean
  /** 依赖环的闭合路径（core detectDependencyCycle）；无环 / 无法检测时为 null。 */
  readonly cyclePath: readonly string[] | null
  /** allowed_paths 并行冲突清单（§3.2 warning，不阻断规划）。 */
  readonly pathConflicts: readonly PathConflict[]
  /**
   * 图是否合法：无重复 id 且无依赖环。路径冲突不计入（§3.2 默认串行，冲突只影响
   * 并行度，不阻断任务执行）。
   */
  readonly ok: boolean
}

/**
 * 校验任务图（任务 §2：复用调度器检测依赖环与 allowed_paths 并行冲突）。
 *
 * 依赖环检测：复用 scheduler.topologicalOrder（遇环抛错 → hasCycle:true），并调 core
 * detectDependencyCycle 取闭合环路径作诊断。重复 id 会使 topologicalOrder 抛错（其内
 * assertUniqueIds），故先单独检测重复 id；有重复时跳过环检测（图已不合法，避免把
 * 「重复 id 抛错」误判为「依赖环」）。
 *
 * 路径冲突：见 detectPathConflicts（复用 scheduler.detectParallelizable 推断，零重复
 * scheduler 私有路径判定逻辑）。
 *
 * ok = 无重复 id 且无环。路径冲突是 warning（不阻断规划，§3.2 默认串行）。
 */
export function validateTaskGraph(
  tasks: readonly TaskFrontmatter[],
): TaskGraphValidationResult {
  // 重复 id 检测：scheduler.topologicalOrder 内部 assertUniqueIds 会对重复 id 抛错，
  // 此处先行检测，避免把「重复 id 抛错」误判为「依赖环」。
  const seen = new Set<TaskId>()
  const dupSet = new Set<TaskId>()
  for (const t of tasks) {
    if (seen.has(t.id)) dupSet.add(t.id)
    else seen.add(t.id)
  }
  const duplicateIds = [...dupSet]

  let hasCycle = false
  let cyclePath: string[] | null = null
  // 仅有唯一 id 集合时环检测才有意义（scheduler 对重复 id 抛错）。
  if (duplicateIds.length === 0) {
    try {
      topologicalOrder(tasks)
    } catch {
      hasCycle = true
      // core detectDependencyCycle 返回闭合环路径（诊断用），无环返回 null。
      cyclePath = detectDependencyCycle(tasks)
    }
  }

  const pathConflicts = detectPathConflicts(tasks)

  return {
    duplicateIds,
    hasCycle,
    cyclePath,
    pathConflicts,
    ok: duplicateIds.length === 0 && !hasCycle,
  }
}

/**
 * 检测任务集合内的 allowed_paths 并行冲突（§3.2：路径不重叠才允许并行）。
 *
 * 完全复用 scheduler.detectParallelizable：对每对**互无依赖**的任务 (A,B)，单独喂给
 * detectParallelizable([A,B])——返回单批次 [[A,B]] 表示可并行（路径不重叠），返回两
 * 单元素批次 [[A],[B]] 表示路径冲突无法并行。有依赖关系的对（A→B 或 B→A）本就不并行，
 * 直接跳过不计入路径冲突。
 *
 * 该做法**零重复** scheduler 私有路径判定逻辑（pathsOverlap / literalPrefix 等）——
 * 判定一致性天然保证（用同一公开函数），仅代价是对每对任务单独调用一次
 * detectParallelizable（规划期一次性校验，任务数有限，O(n²) 次调用可接受）。
 *
 * 空 allowed_paths 任务不参与冲突：detectParallelizable 对空 allowed_paths 视为不与
 * 任何任务路径重叠，故含空 allowed_paths 的对恒返回单批次，自然被排除（§3.2：
 * .result.md 是内置产物不计入 allowed_paths）。同 id 对跳过（避免重复 id 触发
 * detectParallelizable 内 assertUniqueIds 抛错，重复 id 已由 duplicateIds 报告）。
 */
function detectPathConflicts(tasks: readonly TaskFrontmatter[]): PathConflict[] {
  const conflicts: PathConflict[] = []
  for (let i = 0; i < tasks.length; i++) {
    const a = tasks[i]
    if (a === undefined) continue // noUncheckedIndexedAccess 守卫
    for (let j = i + 1; j < tasks.length; j++) {
      const b = tasks[j]
      if (b === undefined) continue // noUncheckedIndexedAccess 守卫
      if (a.id === b.id) continue // 重复 id 对跳过（已由 duplicateIds 报告）
      // 有依赖关系（A→B 或 B→A）的本就不并行，不计入路径冲突。
      if (a.depends_on.includes(b.id) || b.depends_on.includes(a.id)) continue
      // detectParallelizable([a,b])：单批次 = 可并行，两单元素批次 = 路径冲突。
      const batches = detectParallelizable([a, b])
      if (batches.length === 2) {
        conflicts.push({ taskA: a.id, taskB: b.id })
      }
    }
  }
  return conflicts
}
