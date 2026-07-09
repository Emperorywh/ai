import { Command } from 'commander'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import {
  DECISIONS_TABLE,
  EXECUTIONS_TABLE,
  GlobalDocRepository,
  ISSUES_TABLE,
  IndexRepository,
  TASKS_TABLE,
  TaskDocRepository,
} from '../../infrastructure/index.js'

/** better-sqlite3 数据库实例类型（与 sqlite/schema.ts 一致，仅做 COUNT 查询）。 */
type DB = Database.Database

/**
 * `rebuild-index` 命令：从文档全量重建 SQLite 状态索引。
 *
 * 职责（见 docs/tasks/TASK-025 §2 / Readme §3.1 / §3.2）：
 *  - 打开（或新建）索引数据库 → 读 DECISIONS.md / ISSUES.md 内容 →
 *    IndexRepository.rebuildFromDocs 在单事务内清空四表后从文档全量重灌（原子）。
 *  - 输出重建统计（四表行数），并在输出中提示这是破坏性操作（清空后重建）。
 *
 * 设计依据（Readme §3.2）：
 *  - SQLite 是**派生存储**，文档（Markdown 正文 + YAML frontmatter）是唯一事实来源；
 *    索引与文档不一致时以文档为准，可经本命令从文档全量重建。
 *  - 任务 / 执行摘要从 docs/tasks 重建；决策 / 问题从全局文档解析。全局文档不存在视为
 *    空集（新建项目尚未填写），任务目录不存在视为配置错误（提示先 caw init）。
 *
 * 不做（任务 §7）：任务执行 / 状态流转 / 查询展示（status 查询以文档为准）。
 */

/** rebuild-index 重建统计：四张索引表行数 + 索引文件绝对路径。 */
export interface RebuildStats {
  readonly dbPath: string
  readonly tasks: number
  readonly executions: number
  readonly decisions: number
  readonly issues: number
}

/** 默认索引数据库相对路径（相对项目根）。 */
const DEFAULT_DB_REL = join('.caw', 'index.db')

/** rebuildIndex 选项。 */
export interface RebuildOptions {
  /** 项目根目录（默认当前工作目录）。 */
  readonly projectRoot?: string
  /** 索引数据库路径（默认 <项目根>/.caw/index.db）。 */
  readonly dbPath?: string
}

/**
 * 从文档全量重建 SQLite 索引（§3.2：索引为派生存储，文档是唯一事实来源）。
 *
 * 步骤：解析项目根 → 校验任务目录存在 → 读全局文档内容 → 建索引库父目录 →
 * 打开索引库 → IndexRepository.rebuildFromDocs（构造即 runMigrations 建表，幂等；
 * rebuild 单事务清空 + 重灌）→ 统计行数 → 关库。文档损坏让错误冒泡（rebuild 应忠实
 * 反映文档现状，不静默丢行）。
 */
export function rebuildIndex(options: RebuildOptions = {}): RebuildStats {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const tasksDir = join(projectRoot, 'docs', 'tasks')
  const docsDir = join(projectRoot, 'docs')
  const dbPath = resolve(options.dbPath ?? join(projectRoot, DEFAULT_DB_REL))

  if (!existsSync(tasksDir)) {
    throw new Error(`任务目录不存在: ${tasksDir}（请先在项目根运行 caw init）`)
  }

  const decisionsDoc = readDocOptional(join(docsDir, 'DECISIONS.md'))
  const issuesDoc = readDocOptional(join(docsDir, 'ISSUES.md'))

  // 索引数据库父目录随写建立（首次重建时创建 .caw/）
  mkdirSync(dirname(dbPath), { recursive: true })

  const db: DB = new Database(dbPath)
  try {
    const repo = new IndexRepository(db)
    repo.rebuildFromDocs({
      taskRepo: new TaskDocRepository(tasksDir),
      globalRepo: new GlobalDocRepository(),
      decisionsDoc,
      issuesDoc,
    })
    const counts = countRows(db)
    return { dbPath, ...counts }
  } finally {
    db.close()
  }
}

/** 读取文档文件内容；不存在返回空串（readDecisions/readIssues 对无 fenced yaml 返回空数组）。 */
function readDocOptional(filePath: string): string {
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf8')
}

/** 统计四张索引表行数（重建后「索引 = 文档全集」的量化体现）。 */
function countRows(db: DB): { tasks: number; executions: number; decisions: number; issues: number } {
  const countOf = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined
    return row?.n ?? 0
  }
  return {
    tasks: countOf(TASKS_TABLE),
    executions: countOf(EXECUTIONS_TABLE),
    decisions: countOf(DECISIONS_TABLE),
    issues: countOf(ISSUES_TABLE),
  }
}

/** commander 解析后的 rebuild-index 选项。 */
interface RebuildCommandOptions {
  db?: string
  projectRoot?: string
}

/**
 * 向 commander program 注册 rebuild-index 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 */
export function registerRebuildIndexCommand(program: Command): void {
  program
    .command('rebuild-index')
    .description('从文档全量重建 SQLite 索引（破坏性：清空后从文档重灌，§3.2）')
    .option('--db <path>', '索引数据库路径（默认 <项目根>/.caw/index.db）')
    .option('--project-root <dir>', '项目根目录（默认当前工作目录）')
    .action((options: RebuildCommandOptions) => {
      // 破坏性操作提示（任务 §8：需在输出中提示），走 stderr 与正常统计输出区分
      console.warn('注意：rebuild-index 是破坏性操作，将清空索引后从文档全量重建（§3.2）。')
      const stats = rebuildIndex({ projectRoot: options.projectRoot, dbPath: options.db })
      console.log(`已重建索引: ${stats.dbPath}`)
      console.log(`  tasks:       ${stats.tasks} 行`)
      console.log(`  executions:  ${stats.executions} 行`)
      console.log(`  decisions:   ${stats.decisions} 行`)
      console.log(`  issues:      ${stats.issues} 行`)
      console.log('索引内容 = 文档全集（§11）')
    })
}
