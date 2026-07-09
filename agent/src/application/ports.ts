/**
 * Application → Infrastructure 窄接口（Ports，ARCHITECTURE.md §4）。
 *
 * 定义 application 层依赖 infrastructure 的唯一通道：4 个 Port 接口，分别覆盖
 * 任务 / 结果 / 审查文档读写、全局文档读写与 section 合并、worktree 生命周期、
 * git 合并原语。后续 application 任务（TASK-017 状态编排 / TASK-019 rebase-ff /
 * TASK-020 section 回写 / TASK-021 幂等恢复 / TASK-029）经这些接口访问 infra，
 * 不直接 import infra 实现类。
 *
 * 设计约束（ARCHITECTURE.md §4 / 任务 §8）：
 *   - application 只经 Port 依赖 infra，禁止 import infra 实现类（TaskDocRepository /
 *     GlobalDocRepository / WorktreeAdapter / GitMergeAdapter）。
 *   - 借助 TypeScript 结构类型兼容，infra 实现类无需显式 implements；由 cli 在
 *     composition root（TASK-025）处把具体实现 / 适配器注入 application。
 *   - TaskDocRepositoryPort / GlobalDocRepositoryPort 的「正文变换」方法签名与现有
 *     infra 实现（TaskDocRepository / GlobalDocRepository）逐项对齐，CLI wiring 时
 *     infra 类结构性地满足这部分；GlobalDocRepositoryPort 的「文件 I/O」方法
 *     （readGlobalDoc / writeGlobalDoc）为前瞻契约——当前 GlobalDocRepository 仅做
 *     正文纯变换无 I/O，由 CLI 层适配器组合 fs + GlobalDocRepository 满足全契约。
 *   - WorktreePort / GitMergePort 方法集对齐 TASK-018 计划的 WorktreeAdapter /
 *     GitMergeAdapter，待 TASK-018 落地实现后结构性满足。
 *
 * 本文件只导入 core 的类型（type-only），零运行时依赖、零反向依赖。
 */
import type {
  Decision,
  ExecutionCommit,
  Issue,
  ProgressUpdateRequest,
  ResultFrontmatter,
  ReviewFrontmatter,
  TaskFrontmatter,
  TaskId,
} from '../core/index.js'

/* ============================================================ *
 * 任务 / 结果 / 审查文档读写 Port
 * ============================================================ */

/**
 * 任务 / 结果 / 审查文档读写 Port（对应 infra TaskDocRepository，TASK-011）。
 *
 * 方法语义与 TaskDocRepository 逐项对齐：
 *   - readTask / readResult / readReview：读取并 Zod 校验 frontmatter；文件不存在 /
 *     frontmatter 缺失 / 校验失败均抛错（不静默）。
 *   - writeTask：更新已存在任务文件的 frontmatter（+ 可选正文）；任务文件不存在抛错。
 *   - writeResult / writeReview：可新建（文件名按 §6 复用任务文件 slug）；body 未传
 *     保留现有正文（如 Orchestrator 回填 execution_commits 仅改 frontmatter）。
 *   - listTasks：扫描 docs/tasks/ 返回 TASK-XXX-*.md 的 id（排除 result/review，
 *     数值升序）。
 *
 * TASK-017 状态编排经此 Port 读写任务 status 与 result / review。
 */
export interface TaskDocRepositoryPort {
  readTask(id: TaskId): TaskFrontmatter
  writeTask(task: TaskFrontmatter, body?: string): void
  readResult(id: TaskId): ResultFrontmatter
  writeResult(result: ResultFrontmatter, body?: string): void
  readReview(id: TaskId): ReviewFrontmatter
  writeReview(review: ReviewFrontmatter, body?: string): void
  listTasks(): TaskId[]
}

/* ============================================================ *
 * 全局文档读写与 section 合并 Port
 * ============================================================ */

/**
 * 全局文档名称（PROGRESS / DECISIONS / ISSUES，Readme.md §6 文档体系）。
 *
 * 用于 readGlobalDoc / writeGlobalDoc 的文件 I/O 寻址——三份全局文档各有独立文件，
 * I/O 以名称区分；正文变换方法（applyProgressUpdate / appendDecision / appendIssue）
 * 因合并语义不同而各自独立，不做泛化。
 */
export type GlobalDocName = 'progress' | 'decisions' | 'issues'

/**
 * 全局文档（PROGRESS / DECISIONS / ISSUES）读写与 section 合并 Port
 * （对应 infra GlobalDocRepository 的正文变换 + 文件 I/O）。
 *
 * 方法分两组：
 *   - 文件 I/O（前瞻契约）：readGlobalDoc / writeGlobalDoc 读取 / 写回全局文档原文，
 *     供 TASK-020 section 回写「基于最新主分支重读 → 合并 → 回写」使用。当前 infra
 *     GlobalDocRepository 仅做正文纯变换（DEC-009），I/O 由 CLI 层适配器组合注入。
 *   - 正文变换（匹配 infra GlobalDocRepository，TASK-012）：
 *       · applyProgressUpdate：PROGRESS 按 mode(replace/append) + section 合并；
 *       · appendDecision / appendIssue：按 id 去重追加；
 *       · readDecisions / readIssues：解析正文 fenced yaml block 经 Schema 校验返回
 *         数组（供 TASK-020 id 分配去重判断）。
 */
export interface GlobalDocRepositoryPort {
  /** 读取指定全局文档原文（文件 I/O）。 */
  readGlobalDoc(name: GlobalDocName): string
  /** 写回指定全局文档原文（文件 I/O）。 */
  writeGlobalDoc(name: GlobalDocName, content: string): void
  /** PROGRESS section 级合并（匹配 infra GlobalDocRepository.applyProgressUpdate）。 */
  applyProgressUpdate(doc: string, update: ProgressUpdateRequest): string
  /** DECISIONS 按 id 去重追加（匹配 infra appendDecision）。 */
  appendDecision(doc: string, decision: Decision): string
  /** ISSUES 按 id 去重追加（匹配 infra appendIssue）。 */
  appendIssue(doc: string, issue: Issue): string
  /** 解析 DECISIONS 正文为条目数组（匹配 infra readDecisions）。 */
  readDecisions(doc: string): Decision[]
  /** 解析 ISSUES 正文为条目数组（匹配 infra readIssues）。 */
  readIssues(doc: string): Issue[]
}

/* ============================================================ *
 * Git worktree 生命周期 Port
 * ============================================================ */

/**
 * Git worktree 生命周期 Port（对应 infra WorktreeAdapter，TASK-018）。
 *
 * 每个 running 任务用独立 worktree + 分支 task/TASK-XXX（§3.2），infrastructure 层
 * 负责自动创建与回收。方法集对齐 TASK-018 WorktreeAdapter：
 *   - create：基于主分支基线创建 worktree + 分支 task/TASK-XXX，返回 worktree 路径。
 *   - reset：restart_on_retry 时从干净状态重置（按主分支基线重建）。
 *   - retain / remove：按 §3.2 分支保留策略（rejected/failed/cancelled 不自动清理）。
 */
export interface WorktreePort {
  /** 基于主分支基线创建 worktree + 分支 task/<taskId>，返回 worktree 路径。 */
  create(mainRef: string, taskId: TaskId): string
  /** restart_on_retry 时从干净状态重置 worktree（按主分支基线重建）。 */
  reset(taskId: TaskId): void
  /** 按 §3.2 保留策略保留 worktree 分支。 */
  retain(taskId: TaskId): void
  /** 按 §3.2 保留策略回收 worktree 分支。 */
  remove(taskId: TaskId): void
}

/* ============================================================ *
 * Git 合并原语 Port
 * ============================================================ */

/**
 * Git 合并原语 Port（对应 infra GitMergeAdapter，TASK-018）。
 *
 * 提供合并编排所需的 git 底层原语（合并顺序 / 审计回填 / 恢复策略归 application 层
 * TASK-019 / TASK-021）。方法集对齐 TASK-018 GitMergeAdapter：
 *   - rebaseOnto：把 worktree 分支 rebase 到最新 main；冲突时不抛断，留待
 *     listConflicts 探测、abortOrCleanRebase 清理（TASK-019 §2「失败不抛断」）。
 *   - fastForwardMain：以 fast-forward 回收 main，避免 merge commit（§3.2）。
 *   - collectPostRebaseCommits：采集 post-rebase 的实现 commit 元信息（hash/message/
 *     author/time 四元组），供 Orchestrator 回填 .result.md 的 execution_commits。
 *   - commitAuditResult：提交 Orchestrator 回填后的 workflow audit commit（独立于
 *     实现 commit，§3.2）。
 *   - branchMerged：底层等价 git branch --merged，判定 worktree 分支是否已进入 main
 *     （TASK-021 幂等恢复据此跳过已完成合并）。
 *   - abortOrCleanRebase：丢弃上次不完整的 rebase 中间态。
 *   - listConflicts：列出当前冲突文件清单（供 TASK-019 返回冲突不抛断）。
 */
export interface GitMergePort {
  /** 把 worktree 分支 rebase 到最新 main（冲突不抛断，留待 listConflicts 探测）。 */
  rebaseOnto(taskId: TaskId, mainRef: string): void
  /** 以 fast-forward 把 worktree 分支合并回 main（避免 merge commit）。 */
  fastForwardMain(taskId: TaskId, mainRef: string): void
  /** 采集 post-rebase 的实现 commit 元信息（不含 audit commit）。 */
  collectPostRebaseCommits(taskId: TaskId, baseRef: string): ExecutionCommit[]
  /** 提交回填 .result.md 后的独立 workflow audit commit。 */
  commitAuditResult(taskId: TaskId, resultPath: string): void
  /** 判定 worktree 分支是否已 fast-forward 进入 main（幂等恢复用）。 */
  branchMerged(taskId: TaskId, mainRef: string): boolean
  /** 丢弃上次不完整的 rebase 中间态，从干净基线重启。 */
  abortOrCleanRebase(taskId: TaskId): void
  /** 列出当前冲突文件清单（rebase 冲突时供上层返回，不抛断）。 */
  listConflicts(taskId: TaskId): string[]
}
