/**
 * Application Context Pack 生成器（Readme.md §8 上下文包）。
 *
 * Task Executor 启动前由 Orchestrator 调用本模块生成最终注入清单：
 *   - computeContextPack：应用并集规则（必读核心 ∪ required_docs ∪
 *     optional_doc_excerpts ∪ source_files），产出最终 Context Pack 清单。
 *   - refreshSourceFiles：用已完成依赖任务 .result.md 的实际产物清单
 *     （modified_files ∪ created_files）替换预填 source_files，供回写 frontmatter。
 *
 * 设计约束（任务 §7 / §8）：
 *   - 依赖 core Task Schema 类型；本模块是纯计算——不做文件 I/O、不执行 frontmatter
 *     回写（回写归 TASK-017 状态编排）、不注入文档内容（注入归 SDK 适配器 TASK-022）。
 *   - 必读核心（AGENTS.md / docs/ARCHITECTURE.md / docs/PROGRESS.md / 当前任务文件）
 *     是硬性下限，不得被 frontmatter 省略——computeContextPack 显式并入，即便
 *     frontmatter 省略必读核心也会补齐（§8：不得通过省略必读核心缩小注入范围）。
 *   - 不扩展范围：最终清单 ⊆ 候选来源——输出只取并集去重，不引入额外文件。
 *
 * 任务文件路径派生（任务 §12 风险点 + §8）：当前任务文件是 Context Pack 入口载体，
 * 本身不计入 frontmatter 的 required_docs 数组，但属必读核心。由于 frontmatter 不含
 * slug，本模块从 workflow_outputs.result_file（§9 约定 docs/tasks/TASK-XXX-<slug>.result.md）
 * 派生任务文件路径：去掉尾部 .result.md 加 .md，与任务文件共用同一 slug。
 *
 * 权威来源：根目录 Readme.md §8（Context Pack 上下文包）/ §9（任务文件模板）。
 */
import type { ContextPack, TaskFrontmatter, TaskId } from '../core/index.js'

/* ============================================================ *
 * 必读核心文档（§8 硬性下限）
 * ============================================================ */

/**
 * 必读核心文档（Readme.md §8），任意任务都要带。
 *
 * 当前任务文件因 slug 不固定、由 computeContextPack 按任务单独并入，不在此常量中。
 */
const CORE_REQUIRED_DOCS: readonly string[] = [
  'AGENTS.md',
  'docs/ARCHITECTURE.md',
  'docs/PROGRESS.md',
]

/* ============================================================ *
 * 依赖结果投影类型
 * ============================================================ */

/**
 * 依赖任务执行结果摘要（最小投影）。
 *
 * refreshSourceFiles 只需依赖任务的产物文件清单（modified_files / created_files），
 * 不关心其余 result 字段。结构类型——任意同时具备 task_id / modified_files /
 * created_files 的对象（如 ResultFrontmatter，见 src/core/schemas/result-schema.ts）
 * 均可直接传入，应用层不必为刷新另行装配数据。
 */
export interface DependencyResultSummary {
  readonly task_id: TaskId
  readonly modified_files: readonly string[]
  readonly created_files: readonly string[]
}

/** computeContextPack 的输入参数。 */
export interface ComputeContextPackInput {
  /** 已完成依赖任务的 .result.md 摘要，按 task_id 索引；无依赖时传空 Map。 */
  readonly dependencyResults: ReadonlyMap<TaskId, DependencyResultSummary>
}

/* ============================================================ *
 * 任务文件路径派生
 * ============================================================ */

/**
 * 从 workflow_outputs.result_file 派生任务文件路径（任务 §12 + §8）。
 *
 * result_file 形如 docs/tasks/TASK-XXX-<slug>.result.md（§9），任务文件与之共用
 * slug，去掉尾部 .result.md 加 .md 即得 docs/tasks/TASK-XXX-<slug>.md。result_file
 * 不以 .result.md 结尾视为任务定义非法（违反 §9 约定），显式抛错不静默。
 */
function taskFilePath(task: TaskFrontmatter): string {
  const resultFile = task.workflow_outputs.result_file
  const suffix = '.result.md'
  if (!resultFile.endsWith(suffix)) {
    throw new Error(
      `workflow_outputs.result_file 必须以 .result.md 结尾（§9 约定），实际值: ${resultFile}`,
    )
  }
  return resultFile.slice(0, resultFile.length - suffix.length) + '.md'
}

/* ============================================================ *
 * 去重工具
 * ============================================================ */

/** 保持插入顺序去重：输出 = 输入各元素首次出现序列。 */
function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

/* ============================================================ *
 * source_files 刷新
 * ============================================================ */

/**
 * 用已完成依赖任务 .result.md 的实际产物清单替换预填 source_files（§8 / 任务 §11）。
 *
 * 规则（all-or-nothing）：
 *   - 任务 depends_on **非空且全部已完成**（dependencyResults 覆盖全部 depends_on）时，
 *     用各依赖 modified_files ∪ created_files 的并集替换预填 source_files。
 *   - 任务**无依赖**或**任一依赖未完成**时**不刷新**，原样返回预填 source_files
 *     （任务 §11：依赖未完成时保留预填；无依赖时无可刷新来源，同样保留预填）。
 *
 * 返回值为「需回写 frontmatter 的新 source_files」；本函数不执行回写（回写归
 * TASK-017 状态编排）。返回顺序确定：按 depends_on 顺序、各依赖文件声明顺序累加
 * 去重，便于上层确定性写回与测试断言。任务转入 running 前依赖必已全部 done（§7），
 * 故实践中刷新分支在 ready→running 时触发。
 */
export function refreshSourceFiles(
  task: TaskFrontmatter,
  dependencyResults: ReadonlyMap<TaskId, DependencyResultSummary>,
): string[] {
  const prefilled = task.context_pack.source_files

  // 无依赖，或任一依赖未完成 → 保留预填（任务 §11）。
  const hasDeps = task.depends_on.length > 0
  const allDepsCompleted =
    hasDeps && task.depends_on.every((dep) => dependencyResults.has(dep))
  if (!allDepsCompleted) {
    return [...prefilled]
  }

  // 全部依赖已完成 → 用实际产物清单（modified ∪ created）替换预填 source_files。
  const files = new Set<string>()
  for (const dep of task.depends_on) {
    const result = dependencyResults.get(dep)
    // every 已保证存在；防御性守卫满足 noUncheckedIndexedAccess。
    if (!result) continue
    for (const file of result.modified_files) files.add(file)
    for (const file of result.created_files) files.add(file)
  }
  return [...files]
}

/* ============================================================ *
 * Context Pack 并集计算
 * ============================================================ */

/**
 * 应用并集规则生成最终 Context Pack 清单（§8）。
 *
 * 实际注入范围 = 必读核心 ∪ required_docs ∪ optional_doc_excerpts ∪ source_files：
 *   - required_docs = 必读核心（AGENTS.md / docs/ARCHITECTURE.md / docs/PROGRESS.md /
 *     当前任务文件）与 frontmatter 声明的 required_docs 取并集去重；必读核心为
 *     硬性下限，frontmatter 省略也会补齐（§8）。
 *   - optional_doc_excerpts = frontmatter 声明值去重（按需引用章节，原样保留，
 *     不由本模块裁剪——裁剪归 Orchestrator 拆分阶段）。
 *   - source_files = refreshSourceFiles 产出（依赖完成时为实际产物，否则预填）。
 *
 * 输出为 ContextPack（与 frontmatter context_pack 同构），供 SDK 适配器（TASK-022）
 * 据此注入文档内容。最终清单 ⊆ 候选来源：只取并集去重，不引入额外文件（任务 §8）。
 */
export function computeContextPack(
  task: TaskFrontmatter,
  input: ComputeContextPackInput,
): ContextPack {
  // 失败前置：result_file 非法（不以 .result.md 结尾）时尽早暴露任务定义错误。
  const taskFile = taskFilePath(task)
  const sourceFiles = refreshSourceFiles(task, input.dependencyResults)

  // required_docs = 必读核心（含当前任务文件）∪ frontmatter 声明值，保持插入顺序去重。
  const requiredDocs = dedupe([
    ...CORE_REQUIRED_DOCS,
    taskFile,
    ...task.context_pack.required_docs,
  ])

  // optional_doc_excerpts 原样去重（按需引用，不由本模块裁剪）。
  const optionalDocExcerpts = dedupe(task.context_pack.optional_doc_excerpts)

  return {
    required_docs: requiredDocs,
    optional_doc_excerpts: optionalDocExcerpts,
    source_files: sourceFiles,
  }
}
