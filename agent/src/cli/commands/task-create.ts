import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  LayerSchema,
  TaskIdSchema,
  type Layer,
  type Permission,
  type TaskFrontmatter,
  type TaskId,
} from '../../core/index.js'
import { createTaskDrafts, type TaskDraftResult, type TaskDraftSpec } from '../../application/index.js'
import { serializeDocument } from '../../infrastructure/index.js'

/**
 * `task:create` 命令：增量创建单个任务文件（Readme.md §9 任务文件模板 / §11 第 6 步）。
 *
 * 职责（任务 §2）：
 *  - 按入参组装单个 TaskDraftSpec，经 TASK-029 createTaskDrafts 校验 + 产出 draft frontmatter
 *    （初始 status: draft，§8 不得直接 ready）与初始 context_pack（computeContextPack 预填）。
 *  - 经 frontmatter-parser 序列化 frontmatter + §9 十三节正文模板落盘 docs/tasks/TASK-XXX-<slug>.md。
 *
 * 分层定位（任务 §8 / ARCHITECTURE §7）：CLI 是 composition root——只编排 application
 * （PlanningWorkflow）+ infrastructure（serializeDocument），不重复领域规则、不新建 Schema。
 *
 * 与 plan 命令的关系：plan 批量生成任务文件时复用本文件导出的 writeTaskFile / buildTaskBody
 * （延续 ISS-015 跨命令 import 先例；taskFileFromResult 同 task-run.ts 私有助手，就地重实现）。
 */

/** .result.md 后缀（§9 约定，用于从 result_file 派生任务文件路径）。 */
const RESULT_SUFFIX = '.result.md'
/** 合法 slug 模式：小写字母 / 数字，以连字符分段（与现有 TASK-XXX-<slug>.md 命名一致）。 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/* ============================================================ *
 * 纯辅助：slug 派生 / 任务文件路径 / 正文模板
 * ============================================================ */

/**
 * 从标题派生 slug（小写化、非字母数字段转连字符、去首尾连字符）。
 *
 * 纯英文标题可直接派生；纯中文 / 非_ascii 标题派生结果为空时，调用方应要求显式 --slug。
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 从 workflow_outputs.result_file 派生任务文件路径（去 .result.md 加 .md，§9 共用 slug）。
 *
 * 与 task-run.ts 私有 taskFileFromResult 同逻辑（ISS-015：未导出故就地重实现）。
 */
function taskFileFromResult(resultFile: string): string {
  if (!resultFile.endsWith(RESULT_SUFFIX)) return resultFile
  return resultFile.slice(0, resultFile.length - RESULT_SUFFIX.length) + '.md'
}

/**
 * 生成任务文件正文（Readme.md §9 十三节模板）。
 *
 * frontmatter 可派生的字段（layer / 必读文件 / 修改范围 / 禁止范围 / 预期文件 / 产出）预填，
 * 其余章节留占位由 Orchestrator / 人工在任务定义阶段补全。正文以空行起首，与 frontmatter
 * 闭合围栏隔一空行（§9 模板可读性）。
 */
export function buildTaskBody(task: TaskFrontmatter): string {
  const resultFile = task.workflow_outputs.result_file
  const taskFile = taskFileFromResult(resultFile)
  const lines: string[] = [''] // frontmatter 闭合围栏后的空行
  lines.push(`# ${task.id} ${task.title}`)
  lines.push('')
  lines.push('## 1. 背景')
  lines.push('')
  lines.push('（待填充：说明该任务为什么存在，它来自 `docs/PLAN.md` 中的哪个阶段。）')
  lines.push('')
  lines.push('## 2. 当前目标')
  lines.push('')
  lines.push('（待填充：说明本任务要完成什么。）')
  lines.push('')
  lines.push('## 3. 所属层级')
  lines.push('')
  lines.push(`\`${task.layer}\``)
  lines.push('')
  lines.push('## 4. 必读文件')
  lines.push('')
  lines.push('- AGENTS.md')
  lines.push('- docs/ARCHITECTURE.md')
  lines.push('- docs/PROGRESS.md')
  lines.push(`- ${taskFile}`)
  lines.push('- context_pack 中声明的相关文档章节与源码文件')
  lines.push('')
  lines.push('## 5. 修改范围')
  lines.push('')
  pushPathList(lines, task.allowed_paths, '（待填充：允许修改的源码文件 / 目录。）')
  lines.push('')
  lines.push('## 6. 禁止修改范围')
  lines.push('')
  pushPathList(lines, task.forbidden_paths, '（待填充：不能修改的目录 / 文件 / 模块。）')
  lines.push('')
  lines.push('## 7. 不做什么')
  lines.push('')
  lines.push('（待填充：明确本任务不包含的内容，避免提前实现后续任务。）')
  lines.push('')
  lines.push('## 8. 架构约束')
  lines.push('')
  lines.push('（待填充：本任务必须遵守的架构规则。）')
  lines.push('')
  lines.push('## 9. 数据流和状态流要求')
  lines.push('')
  lines.push('（待填充：数据如何流动，状态由哪里拥有、哪里消费。）')
  lines.push('')
  lines.push('## 10. 预期新增或修改文件')
  lines.push('')
  // §10 含 allowed_paths（业务改动）+ result_file（工作流产物）。
  for (const p of task.allowed_paths) lines.push(`- ${p}`)
  lines.push(`- ${resultFile}`)
  lines.push('')
  lines.push('## 11. 验收标准')
  lines.push('')
  lines.push('（待填充：完成后如何判断任务合格。）')
  lines.push('')
  lines.push('## 12. 风险提示')
  lines.push('')
  lines.push('（待填充：可能出现的风险、边界情况或容易误解的地方。）')
  lines.push('')
  lines.push('## 13. 结束时必须产出（Task Executor 负责）')
  lines.push('')
  lines.push(`- ${resultFile}`)
  lines.push('- 在 `.result.md` 中写入 `docs/PROGRESS.md` 更新建议')
  lines.push('- 在 `.result.md` 中写入 `docs/DECISIONS.md` 更新建议，如有新增架构决策')
  lines.push('- 在 `.result.md` 中写入 `docs/ISSUES.md` 更新建议，如有未解决问题')
  lines.push('')
  return `${lines.join('\n')}\n`
}

/** 把路径列表追加为 bullet 行；空列表写占位提示。 */
function pushPathList(lines: string[], paths: readonly string[], emptyPlaceholder: string): void {
  if (paths.length === 0) {
    lines.push(emptyPlaceholder)
    return
  }
  for (const p of paths) lines.push(`- ${p}`)
}

/**
 * 把单个任务草案落盘为 docs/tasks/TASK-XXX-<slug>.md（frontmatter + §9 正文模板）。
 *
 * 任务文件路径从 result_file 派生（§6 共用 slug）；tasksDir 不存在时随写建立。
 * 返回写入的绝对路径。不做存在性检查（plan 批量生成允许覆盖重生成；task:create 自行前置检查）。
 */
export function writeTaskFile(tasksDir: string, draft: TaskDraftResult): string {
  const taskFileRelative = taskFileFromResult(draft.task.workflow_outputs.result_file)
  const absPath = join(tasksDir, basename(taskFileRelative))
  mkdirSync(tasksDir, { recursive: true })
  writeFileSync(absPath, serializeDocument(draft.task, buildTaskBody(draft.task)), 'utf8')
  return absPath
}

/* ============================================================ *
 * 公开 API：createSingleTask
 * ============================================================ */

/** task:create 的单任务输入（字段对齐 TaskDraftSpec，slug 决定文件命名）。 */
export interface TaskCreateInput {
  /** 项目根目录（任务文件落 docs/tasks/<projectRoot>/...）。 */
  readonly projectRoot: string
  readonly id: TaskId
  readonly title: string
  /** 文件名 slug（省略时从 title 派生）。 */
  readonly slug?: string
  readonly layer: Layer
  readonly depends_on?: readonly TaskId[]
  readonly allowed_paths: readonly string[]
  readonly forbidden_paths?: readonly string[]
  readonly permissions?: readonly Permission[]
  readonly no_review?: boolean
  readonly restart_on_retry?: boolean
  readonly verification: readonly string[]
  readonly required_docs?: readonly string[]
  readonly optional_doc_excerpts?: readonly string[]
  readonly source_files?: readonly string[]
}

/** task:create 产物：任务文件绝对路径 + 派生的 result_file（相对路径）。 */
export interface TaskCreateOutcome {
  /** 写入的任务文件绝对路径。 */
  readonly taskFile: string
  /** 派生的 workflow_outputs.result_file（相对项目根）。 */
  readonly resultFile: string
}

/**
 * 创建单个任务文件（Readme.md §11 第 6 步）。
 *
 * 把入参组装为 TaskDraftSpec → createTaskDrafts 校验（TaskFrontmatterSchema）+ 产出 draft
 * frontmatter 与初始 context_pack（§8 预填 source_files）→ writeTaskFile 落盘。
 *
 * 非法输入显式抛错不静默：id 不符 TASK-XXX、layer 非法枚举、slug 派生为空或非法、
 * 任务文件已存在（避免覆盖既有任务定义）。
 */
export function createSingleTask(input: TaskCreateInput): TaskCreateOutcome {
  // id / layer 前置校验给出清晰错误（createTaskDrafts 也会经 Schema 校验，此处先拦截常见误用）。
  const idCheck = TaskIdSchema.safeParse(input.id)
  if (!idCheck.success) {
    throw new Error(`任务 id 非法: ${input.id}（须形如 TASK-\\d+，例如 TASK-003）`)
  }
  const layerCheck = LayerSchema.safeParse(input.layer)
  if (!layerCheck.success) {
    throw new Error(
      `layer 非法: ${input.layer}（合法值: ${LayerSchema.options.join(', ')}）`,
    )
  }

  // slug：显式提供则校验合法性，否则从 title 派生；派生为空（如纯中文标题）要求显式提供。
  const slug = input.slug ?? slugify(input.title)
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug 非法或为空: "${slug}"（须为小写字母/数字以连字符分段，如 core-enums；` +
        '中文标题请用 --slug 显式提供英文 slug）',
    )
  }

  const resultFile = `docs/tasks/${input.id}-${slug}.result.md`
  const spec: TaskDraftSpec = {
    id: input.id,
    title: input.title,
    layer: input.layer,
    depends_on: input.depends_on,
    allowed_paths: input.allowed_paths,
    forbidden_paths: input.forbidden_paths,
    permissions: input.permissions,
    no_review: input.no_review,
    restart_on_retry: input.restart_on_retry,
    verification: input.verification,
    required_docs: input.required_docs,
    optional_doc_excerpts: input.optional_doc_excerpts,
    source_files: input.source_files,
    result_file: resultFile,
  }

  // createTaskDrafts：TaskFrontmatterSchema 校验 + computeContextPack 预填初始注入清单。
  const { drafts } = createTaskDrafts({ tasks: [spec] })
  const draft = drafts[0]
  if (draft === undefined) {
    throw new Error('createTaskDrafts 未产出任务草案（内部异常）')
  }

  const tasksDir = join(input.projectRoot, 'docs', 'tasks')
  const taskFileRelative = basename(taskFileFromResult(resultFile))
  const absPath = join(tasksDir, taskFileRelative)
  // 任务文件已存在 → 拒绝覆盖（task:create 语义是创建新任务，既有文件多为误操作或 id 冲突）。
  if (existsSync(absPath)) {
    throw new Error(`任务文件已存在: ${absPath}（task:create 不覆盖既有任务，请更换 id 或先删除）`)
  }

  const taskFile = writeTaskFile(tasksDir, draft)
  return { taskFile, resultFile }
}

/* ============================================================ *
 * commander 注册
 * ============================================================ */

/** 逗号分隔字符串拆为字符串数组（空串 / undefined → 空数组）。 */
function splitCsv(value: string | undefined): string[] {
  if (value === undefined) return []
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return parts
}

/** commander 解析后的 task:create 选项。 */
interface TaskCreateCommandOptions {
  id: string
  title: string
  layer: string
  slug?: string
  dependsOn?: string
  allowedPaths?: string
  forbiddenPaths?: string
  permissions?: string
  noReview?: boolean
  restartOnRetry?: boolean
  verification?: string
  requiredDocs?: string
  sourceFiles?: string
  projectRoot?: string
}

/**
 * 向 commander program 注册 task:create 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 */
export function registerTaskCreateCommand(program: Command): void {
  program
    .command('task:create')
    .description('创建单个任务文件（status=draft，预填 context_pack，§11 第 6 步）')
    .requiredOption('--id <id>', '任务 id（TASK-XXX）')
    .requiredOption('--title <title>', '任务标题')
    .requiredOption('--layer <layer>', `任务层级（${LayerSchema.options.join('/')}）`)
    .option('--slug <slug>', '文件名 slug（省略时从 title 派生）')
    .option('--depends-on <ids>', '依赖任务 id，逗号分隔')
    .option('--allowed-paths <paths>', '允许修改路径，逗号分隔')
    .option('--forbidden-paths <paths>', '禁止修改路径，逗号分隔')
    .option('--permissions <perms>', '权限能力，逗号分隔')
    .option('--no-review', '声明 no_review: true（允许 running→done 免审）')
    .option('--restart-on-retry', '声明 restart_on_retry: true（续跑时重置 worktree）')
    .option('--verification <cmds>', '验证命令，逗号分隔（默认 npm run typecheck）')
    .option('--required-docs <docs>', 'context_pack.required_docs，逗号分隔')
    .option('--source-files <files>', 'context_pack.source_files 预填，逗号分隔')
    .option('--project-root <dir>', '项目根目录（默认当前工作目录）')
    .action((options: TaskCreateCommandOptions) => {
      const outcome = createSingleTask({
        projectRoot: resolve(options.projectRoot ?? process.cwd()),
        id: options.id,
        title: options.title,
        slug: options.slug,
        layer: options.layer as Layer,
        depends_on: splitCsv(options.dependsOn),
        allowed_paths: splitCsv(options.allowedPaths),
        forbidden_paths: splitCsv(options.forbiddenPaths),
        permissions: splitCsv(options.permissions) as Permission[],
        no_review: options.noReview === true,
        restart_on_retry: options.restartOnRetry === true,
        verification: splitCsv(options.verification).length > 0
          ? splitCsv(options.verification)
          : ['npm run typecheck'],
        required_docs: splitCsv(options.requiredDocs),
        source_files: splitCsv(options.sourceFiles),
      })
      console.log(`已创建任务文件: ${outcome.taskFile}`)
      console.log(`  result_file: ${outcome.resultFile}`)
      console.log('  初始 status: draft（经 task:run 前需先置 ready）')
    })
}
