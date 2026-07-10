import { Command } from 'commander'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { LayerSchema, PermissionSchema, TaskIdSchema } from '../../core/index.js'
import {
  createPlanDraft,
  createTaskDrafts,
  renderPlanMarkdown,
  validatePlanningInputs,
  validateTaskGraph,
  type PathConflict,
} from '../../application/index.js'
import { writeTaskFile } from './task-create.js'

/**
 * `plan` 命令：生成 docs/PLAN.md + 拆分 docs/tasks/（Readme.md §6.4 / §8 / §11 第 5-6 步）。
 *
 * 职责（任务 §2）：
 *  - 读 docs/SPEC.md / docs/ARCHITECTURE.md 判存在 + `--reviewed` 判审查 → validatePlanningInputs
 *    （standard：SPEC+ARCH 存在且已审查 / bootstrap：自举 source_spec + 人工确认 / failed：拒绝）。
 *  - createPlanDraft + renderPlanMarkdown → 落盘 docs/PLAN.md。
 *  - createTaskDrafts（TASK-029：TaskFrontmatterSchema 校验 + computeContextPack 预填）→
 *    每个任务落盘 docs/tasks/TASK-XXX-<slug>.md（draft + 预填 context_pack）。
 *  - validateTaskGraph 检测依赖环 / 路径冲突，路径冲突为 warning 不阻断（§3.2 默认串行）。
 *
 * 分层定位（任务 §7 / §8 / ARCHITECTURE §7）：CLI 是 composition root——不在 CLI 内实现
 * 「SPEC/ARCHITECTURE → 任务」的智能拆分逻辑（该逻辑只调用 TASK-029 的 application 用例），
 * 不重复领域规则。计划定义（title / phases / tasks）由调用方经 `--from <file>` 显式提供
 * （§12：智能拆分需多轮交互时另立后续任务，本任务只做可一次闭环骨架）。
 *
 * ISS-018 裁定：「已审查」机器化判据采用显式 `--reviewed` 标志（AGENTS §3 显式能力声明），
 * standard 模式必须携带（声明 SPEC/ARCHITECTURE 已通过 Reviewer 独立审查）。
 */

/* ============================================================ *
 * 计划定义 Schema（配置文件 → PlanDefinition）
 * ============================================================ */

/** 计划定义中的阶段（对齐 PlanPhaseInput）。 */
const PlanPhaseSchema = z.object({
  name: z.string().min(1, '阶段名不能为空'),
  description: z.string(),
})

/**
 * 计划定义中的单任务（对齐 TaskDraftSpec，枚举字段复用 core Schema 做配置级校验）。
 *
 * 与 TaskFrontmatterSchema 的重复校验为有意为之：配置级先拦截常见误用（非法 id / layer）
 * 给清晰错误，createTaskDrafts 再做完整领域校验 + context_pack 预填。
 */
const PlanTaskSchema = z.object({
  id: TaskIdSchema,
  title: z.string().min(1, '任务 title 不能为空'),
  layer: LayerSchema,
  depends_on: z.array(TaskIdSchema).optional(),
  allowed_paths: z.array(z.string()),
  forbidden_paths: z.array(z.string()).optional(),
  permissions: z.array(PermissionSchema).optional(),
  no_review: z.boolean().optional(),
  restart_on_retry: z.boolean().optional(),
  verification: z.array(z.string()),
  required_docs: z.array(z.string()).optional(),
  optional_doc_excerpts: z.array(z.string()).optional(),
  source_files: z.array(z.string()).optional(),
  result_file: z.string().min(1, 'result_file 不能为空'),
})

/** 计划定义 Schema（YAML / JSON 配置文件结构）。 */
export const PlanDefinitionSchema = z.object({
  title: z.string().min(1, 'title 不能为空'),
  sourceSpec: z.string().optional(),
  phases: z.array(PlanPhaseSchema).min(1, '至少需要一个阶段'),
  tasks: z.array(PlanTaskSchema).min(1, '至少需要一个任务'),
})
/** 计划定义（经 PlanDefinitionSchema 校验的计划模型，字段对齐 PlanningWorkflow 输入）。 */
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>

/**
 * 解析计划定义文件内容（YAML / JSON）为 PlanDefinition。
 *
 * YAML 库 parse 兼容 JSON（YAML 1.2 超集），故 .json / .yaml / .yml 一律走 yaml.parse。
 * 解析后经 PlanDefinitionSchema 校验，失败抛含 Zod 错误信息的 Error（不静默）。
 */
export function parsePlanDefinition(raw: string): PlanDefinition {
  let obj: unknown
  try {
    obj = parseYaml(raw)
  } catch (err) {
    throw new Error(
      `计划定义文件解析失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const parsed = PlanDefinitionSchema.safeParse(obj)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`计划定义校验失败: ${issues}`)
  }
  return parsed.data
}

/* ============================================================ *
 * 公开 API：planProject
 * ============================================================ */

/** planProject 的输入。 */
export interface PlanProjectInput {
  /** 项目根目录（读 docs/SPEC.md / ARCHITECTURE.md，写 docs/PLAN.md / docs/tasks/）。 */
  readonly projectRoot: string
  /**
   * 是否声明 SPEC/ARCHITECTURE 已通过 Reviewer 独立审查（ISS-018 机器判据）。
   * standard 模式必需；bootstrap 模式不依赖此标志（自举走 needsHumanConfirmation）。
   */
  readonly reviewed: boolean
  /** 计划定义（经 parsePlanDefinition 校验）。 */
  readonly definition: PlanDefinition
}

/** planProject 产物。 */
export interface PlanOutcome {
  readonly projectRoot: string
  /** 生效的规划模式（standard / bootstrap）。 */
  readonly mode: 'standard' | 'bootstrap'
  /** 写入的 PLAN.md 绝对路径。 */
  readonly planFile: string
  /** 写入的任务文件绝对路径清单（按定义顺序）。 */
  readonly taskFiles: readonly string[]
  /** allowed_paths 并行冲突清单（§3.2 warning，不阻断规划）。 */
  readonly pathConflicts: readonly PathConflict[]
}

/**
 * 生成 PLAN.md + 任务文件集合（Readme.md §11 第 5-6 步）。
 *
 * 链路：
 *   1. 判 docs/SPEC.md / docs/ARCHITECTURE.md 存在（CLI composition root 做 I/O）。
 *   2. validatePlanningInputs：standard（存在+审查）/ bootstrap（source_spec）/ failed（拒绝）。
 *   3. createPlanDraft + renderPlanMarkdown → 落盘 docs/PLAN.md（standard 用审查声明 preface，
 *      bootstrap 用自举声明 preface）。
 *   4. createTaskDrafts → 每个任务 writeTaskFile 落盘 docs/tasks/TASK-XXX-<slug>.md
 *      （draft + 预填 context_pack）。
 *   5. validateTaskGraph：依赖环抛错（ok:false）、路径冲突仅 warning 返回不阻断。
 *
 * 非法输入显式抛错不静默：规划前置不满足（failed）、PLAN 阶段 / 任务草案非法、任务图含环。
 */
export function planProject(input: PlanProjectInput): PlanOutcome {
  const projectRoot = input.projectRoot

  // 1. SPEC / ARCHITECTURE 存在性（application 不读文件，§7；CLI 判定后传布尔）。
  const specExists = existsSync(join(projectRoot, 'docs', 'SPEC.md'))
  const architectureExists = existsSync(join(projectRoot, 'docs', 'ARCHITECTURE.md'))

  // 2. 规划前置校验（standard / bootstrap / failed）。
  const validation = validatePlanningInputs({
    specExists,
    architectureExists,
    specReviewed: input.reviewed,
    architectureReviewed: input.reviewed,
    sourceSpec: input.definition.sourceSpec,
  })
  if (!validation.ok) {
    throw new Error(
      `规划前置不满足: ${validation.reason}\n  缺失项:\n` +
        validation.missing.map((m) => `    - ${m}`).join('\n'),
    )
  }

  // 3. PLAN 草案模型（bootstrap 传 sourceSpec 写自举声明 preface，standard 不传写审查声明）。
  const planDraft = createPlanDraft({
    title: input.definition.title,
    sourceSpec: validation.mode === 'bootstrap' ? validation.sourceSpec : undefined,
    phases: input.definition.phases,
  })

  // 4. 任务草案集合（createTaskDrafts：TaskFrontmatterSchema 校验 + computeContextPack 预填）。
  const { drafts } = createTaskDrafts({ tasks: input.definition.tasks })

  // 5. 任务图校验：先校验后写盘，避免依赖环 / 重复 id 留下部分写入的文件。
  //    依赖环 / 重复 id 抛错（ok:false 视为规划非法）；路径冲突为 warning 返回不阻断。
  const graph = validateTaskGraph(drafts.map((d) => d.task))
  if (!graph.ok) {
    const detail =
      graph.cyclePath !== null
        ? `依赖环: ${graph.cyclePath.join(' → ')}`
        : `重复 id: ${graph.duplicateIds.join(', ')}`
    throw new Error(`任务图非法，拒绝生成: ${detail}`)
  }

  // 6. 全部校验通过 → 落盘 PLAN.md + 任务文件（createTaskDrafts 产出的 draft 含预填 context_pack）。
  const planFile = join(projectRoot, 'docs', 'PLAN.md')
  mkdirSync(dirname(planFile), { recursive: true })
  writeFileSync(planFile, renderPlanMarkdown(planDraft), 'utf8')

  const tasksDir = join(projectRoot, 'docs', 'tasks')
  const taskFiles: string[] = []
  for (const draft of drafts) {
    taskFiles.push(writeTaskFile(tasksDir, draft))
  }

  return {
    projectRoot,
    mode: validation.mode,
    planFile,
    taskFiles,
    pathConflicts: [...graph.pathConflicts],
  }
}

/* ============================================================ *
 * commander 注册
 * ============================================================ */

/** commander 解析后的 plan 选项。 */
interface PlanCommandOptions {
  from: string
  reviewed?: boolean
  projectRoot?: string
}

/**
 * 向 commander program 注册 plan 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 */
export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('生成 PLAN.md + 拆分任务文件（SPEC/ARCHITECTURE → 任务集合，§11 第 5-6 步）')
    .requiredOption('--from <file>', '计划定义文件（YAML/JSON：title + phases + tasks）')
    .option('--reviewed', '声明 SPEC/ARCHITECTURE 已通过独立审查（standard 模式必需，ISS-018）')
    .option('--project-root <dir>', '项目根目录（默认当前工作目录）')
    .action((options: PlanCommandOptions) => {
      const projectRoot = resolve(options.projectRoot ?? process.cwd())
      // 配置文件路径相对 cwd 解析（用户运行位置），非项目根。
      const configPath = resolve(options.from)
      if (!existsSync(configPath)) {
        throw new Error(`计划定义文件不存在: ${configPath}`)
      }
      const definition = parsePlanDefinition(readFileSync(configPath, 'utf8'))
      const outcome = planProject({
        projectRoot,
        reviewed: options.reviewed === true,
        definition,
      })
      console.log(`规划完成（模式: ${outcome.mode}）`)
      console.log(`  PLAN: ${outcome.planFile}`)
      console.log(`  任务文件（${outcome.taskFiles.length} 个）:`)
      for (const f of outcome.taskFiles) console.log(`    + ${f}`)
      if (outcome.pathConflicts.length > 0) {
        // 路径冲突为 warning（§3.2 默认串行不阻断），走 stderr 提示。
        const list = outcome.pathConflicts
          .map((c) => `${c.taskA} ⋂ ${c.taskB}`)
          .join('; ')
        console.warn(`warning: 检测到 allowed_paths 并行冲突（不阻断，将串行执行）: ${list}`)
      }
    })
}
