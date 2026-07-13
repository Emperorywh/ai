/**
 * Infrastructure Git worktree 生命周期与合并原语适配器（Readme.md §3.2 / §7）。
 *
 * 本适配器把「每个 running 任务独立 worktree + 分支 task/TASK-XXX」与「合并编排所需的
 * git 底层原语」收敛为两个无业务规则的工具类，供 application 层（TASK-019 rebase-ff /
 * TASK-021 幂等恢复 / TASK-026 task:run 调度）经 WorktreePort / GitMergePort 调用，
 * 对上层完全透明（上层不直接拼 git 命令）。
 *
 * 设计约束（任务 §7 / §8 / AGENTS.md §2）：
 *   - 通过子进程调用系统 git，不引入重型 git 库（任务 §8）。
 *   - 不承载业务规则：合并顺序、回填时机、ff 顺序、冲突仲裁均归 application 层
 *     （TASK-019 / TASK-021）；本层只提供原子原语，冲突时返回清单不仲裁（任务 §7）。
 *   - 借助 TypeScript 结构类型兼容，本类无需显式 implements application 层 Port
 *     （ARCHITECTURE.md §4），由 cli composition root（TASK-025）wiring 注入。
 *   - 子进程错误统一转为领域错误 GitAdapterError（含命令、退出码、stderr），不静默
 *     （任务 §12「子进程错误需捕获并转为领域错误」，AGENTS.md §4 不静默）。
 *
 * 方法语义（任务 §2 / Readme.md §3.2）：
 *   - create：基于主分支基线创建 worktree + 分支 task/TASK-XXX，返回 worktree 绝对路径。
 *   - reset：restart_on_retry 时回到 create 记录的基线 commit（git reset --hard +
 *     clean -fd，保留被忽略文件如 node_modules，§12），丢弃上一次执行的改动。
 *   - retain：显式保留（§3.2 分支保留策略由 application 按任务状态决定调 retain/remove）。
 *   - remove：回收 worktree + 分支（§3.2 人工确认放弃后由 infrastructure 删除）。
 *   - rebaseOnto：rebase 到最新 main，冲突不抛断（留 listConflicts 探测）。
 *   - fastForwardMain：以 update-ref 快进 main，绝不产生 merge commit（§3.2）。
 *   - collectPostRebaseCommits：采集 post-rebase 实现 commit 的 hash/message/author/time。
 *   - commitAuditResult：提交回填 .result.md 后的独立 workflow audit commit（§3.2）。
 *   - branchMerged：等价 git merge-base --is-ancestor，幂等恢复判定用。
 *   - abortOrCleanRebase：丢弃不完整 rebase 中间态（幂等）。
 *   - listConflicts：列出 unmerged 文件清单。
 *
 * 权威来源：根目录 Readme.md §3.2（合并策略）/ §7（worktree 保留与重置）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExecutionCommit, TaskId } from '../../core/index.js'

/** worktree 分支前缀（Readme.md §3.2「命名建议 task/TASK-XXX」）。 */
const BRANCH_PREFIX = 'task/'

/** audit commit 的 message 前缀（§3.2 独立 workflow audit commit，便于历史识别）。 */
const AUDIT_MESSAGE_PREFIX = 'chore(workflow-audit): '

/** git log 字段 / 记录分隔符（unit sep / record sep，规避 commit message 含换行干扰解析）。 */
const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

/**
 * 由 taskId 派生 worktree 分支名（task/TASK-XXX，§3.2）。
 *
 * 模块级纯函数，供 WorktreeAdapter / GitMergeAdapter 共用，避免重复拼接（AGENTS.md §3）。
 */
function branchName(taskId: TaskId): string {
  return `${BRANCH_PREFIX}${taskId}`
}

/**
 * Git 适配器领域错误：封装失败的 git 命令、退出码与 stderr，供上层显式处理
 * （任务 §12「子进程错误需捕获并转为领域错误」，AGENTS.md §4 不静默）。
 */
export class GitAdapterError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`git 命令失败（退出码 ${exitCode}）：${command}\n${stderr.trim()}`)
    this.name = 'GitAdapterError'
  }
}

/* ============================================================ *
 * 子进程执行辅助（模块级，两个适配器共用，不复制粘贴）
 * ============================================================ */

/** 一次 git 子进程执行的原始结果（不判定成败）。 */
interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * 执行 git 命令并返回原始结果（退出码 + stdout + stderr）。
 *
 * spawn 自身失败（找不到 git / cwd 不存在等）抛 Error——这类是环境异常而非 git 业务退出，
 * 无法靠退出码区分，直接上抛由调用方感知（AGENTS.md §4 不静默）。
 */
function rawExec(args: string[], cwd: string): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) {
    throw new Error(`git ${args.join(' ')} 无法执行：${r.error.message}`)
  }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 执行 git 命令，退出码非 0 抛 GitAdapterError；返回 stdout。 */
function runGit(args: string[], cwd: string): string {
  const r = rawExec(args, cwd)
  if (r.code !== 0) {
    throw new GitAdapterError(args.join(' '), r.code, r.stderr)
  }
  return r.stdout
}

/** 执行 git 命令但不抛错，返回成败 + 退出码 + 输出（供需区分退出码的场景，如冲突探测）。 */
function tryGit(args: string[], cwd: string): { ok: boolean } & GitResult {
  const r = rawExec(args, cwd)
  return { ok: r.code === 0, ...r }
}

/**
 * 判断 cwd（worktree）当前是否处于 rebase 中间态。
 *
 * rebase 遇冲突会停在中间态，git 退出码非 0——本函数据此区分「冲突停顿」与「真错误」
 * （rebaseOnto 冲突不抛断、abortOrCleanRebase 幂等，GitMergePort 契约）。
 * 实现：rebase 进行中时 worktree 的 git 目录下存在 rebase-merge 或 rebase-apply，
 * `git rev-parse --git-path <name>` 解析其绝对 / 相对路径后用 existsSync 判定。
 */
function isRebaseInProgress(cwd: string): boolean {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const r = tryGit(['rev-parse', '--git-path', name], cwd)
    const dir = r.stdout.trim()
    if (dir !== '' && existsSync(resolve(cwd, dir))) {
      return true
    }
  }
  return false
}

/* ============================================================ *
 * WorktreeAdapter —— worktree 生命周期（WorktreePort）
 * ============================================================ */

/**
 * Worktree 生命周期适配器（对应 application 层 WorktreePort，TASK-018）。
 *
 * 构造时传入主仓库目录与 worktree 存放根目录（均接受相对 / 绝对路径，内部 resolve 为
 * 绝对路径传给 git worktree add）。create 时把 mainRef 解析为绝对 commit hash 记入
 * bases，供 reset 精确回到同一基线（即便 main 后续已变）。
 */
export class WorktreeAdapter {
  /**
   * create 时记录的基线 commit（mainRef 解析得到的绝对 hash），reset 用。
   *
   * 适配器在单进程内由 application / cli 持有（CLI task:run 一次执行内 create→reset→
   * remove 同实例），故内存映射足以；跨进程持久化非本层职责——合并进度可从 git 状态 +
   * frontmatter status 完全重建（§3.2「合并进度不写 SQLite」）。
   */
  private readonly bases = new Map<string, string>()

  constructor(
    private readonly mainRepoDir: string,
    private readonly worktreesDir: string,
  ) {}

  /** taskId → worktree 绝对路径（worktreesDir/<taskId>）。 */
  private worktreePath(taskId: TaskId): string {
    return resolve(this.worktreesDir, taskId)
  }

  /** 基于主分支基线创建 worktree + 分支 task/<taskId>，返回 worktree 绝对路径。 */
  create(mainRef: string, taskId: TaskId): string {
    const branch = branchName(taskId)
    const wtPath = this.worktreePath(taskId)
    // 解析基线为绝对 commit hash，供 reset 精确回到同一基线（main 后续可能已变）。
    const base = runGit(['rev-parse', mainRef], this.mainRepoDir).trim()
    runGit(['worktree', 'add', '-b', branch, wtPath, base], this.mainRepoDir)
    this.bases.set(taskId, base)
    return wtPath
  }

  /** restart_on_retry 时从干净状态重置 worktree（回到 create 记录的基线）。 */
  reset(taskId: TaskId): void {
    const base = this.bases.get(taskId)
    if (base === undefined) {
      throw new Error(`reset 失败：${taskId} 未由本适配器 create，无法确定重置基线`)
    }
    const cwd = this.worktreePath(taskId)
    if (!existsSync(cwd)) {
      throw new Error(`reset 失败：${taskId} 的 worktree 不存在（${cwd}）`)
    }
    // 丢弃 worktree 分支上的执行 commit 回到基线（restart_on_retry「从干净状态重跑」，§7）。
    runGit(['reset', '--hard', base], cwd)
    // clean -fd 删除未跟踪且未被忽略的文件；保留被忽略文件（node_modules 等依赖，
    // §12「node_modules 不归本适配器」，CLI 层 TASK-026 处理依赖复用）。
    runGit(['clean', '-fd'], cwd)
  }

  /** 按 §3.2 保留策略保留 worktree 分支（显式 no-op，保留与否由 application 决定）。 */
  retain(taskId: TaskId): void {
    // rejected/failed/cancelled 分支保留至人工确认放弃后 remove（§3.2）；retain 表态保留，
    // 本层不做删除，调用方据任务终态选择 retain 或 remove。
    void taskId
  }

  /** 按 §3.2 保留策略回收 worktree 分支（删除 worktree + 分支，幂等）。 */
  remove(taskId: TaskId): void {
    const branch = branchName(taskId)
    const wtPath = this.worktreePath(taskId)
    // worktree remove 仅在目录存在时执行（重复 remove / 手动清理后幂等不抛错）。
    if (existsSync(wtPath)) {
      runGit(['worktree', 'remove', '--force', wtPath], this.mainRepoDir)
    }
    // 分支删除仅在分支存在时执行（rev-parse --verify 判定存在性，不依赖 stderr 文本）。
    const exists = tryGit(['rev-parse', '--verify', `refs/heads/${branch}`], this.mainRepoDir)
    if (exists.ok) {
      // -D 强制删：任务可能未合并即被放弃（§3.2），回收由 application 在确认后触发。
      runGit(['branch', '-D', branch], this.mainRepoDir)
    }
    this.bases.delete(taskId)
  }

  /**
   * 枚举 worktree 相对基线的全部变更文件（TASK-040 / WorkspaceInspectionPort）。
   *
   * 覆盖四类 Git 工作区状态（任务 §11 验收）：
   *   - tracked 内容修改（unstaged）。
   *   - staged 新增 / 修改（已 git add）。
   *   - untracked 新文件（未被 .gitignore 忽略，--untracked-files=all 含全部）。
   *   - 删除（tracked 已移除）。
   *
   * 实现：`git status --porcelain=v1 --untracked-files=all -z`，NUL 分隔记录、不转义路径
   * （含空格 / 非_ascii 的路径原样输出，避免非 -z 模式的引号包裹与截断）。每条记录形如
   * `XY <path>`（X=staged 状态码、Y=unstaged 状态码、第 3 列空格、其后路径）；rename(R) /
   * copy(C) 的 staged 形态后跟一条无前缀的旧路径记录，需跳过以避免把已不存在的旧路径计入变更。
   *
   * @param worktreePath worktree 根目录绝对路径（不依赖适配器内部 taskId→path 映射，Port 通用）。
   * @returns 变更文件相对 worktree 根的路径数组（正斜杠、去 rename 旧路径、去重由 git 保证）。
   */
  listChangedFiles(worktreePath: string): string[] {
    const out = runGit(
      ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
      worktreePath,
    )
    const files: string[] = []
    // -z 模式:每条记录以 NUL 结尾;split('\0') 后,rename/copy 的新路径与旧路径为相邻独立段。
    const records = out.split('\0')
    let i = 0
    while (i < records.length) {
      const rec = records[i] ?? ''
      // 末尾 NUL 产生空串,以及非 -z 残留换行——空串跳过。
      if (rec === '') {
        i += 1
        continue
      }
      // 记录格式:XY<space>path(X/Y 各 1 字符状态码 + 1 空格 + 路径),最少 3 字符。
      if (rec.length < 3) {
        i += 1
        continue
      }
      const xStatus = rec[0] ?? ''
      const path = rec.slice(3)
      if (path !== '') files.push(path)
      // staged rename(R) / copy(C):下一段是旧路径(无 XY 前缀),跳过避免计入已不存在路径。
      if (xStatus === 'R' || xStatus === 'C') {
        i += 2
      } else {
        i += 1
      }
    }
    return files
  }
}

/* ============================================================ *
 * GitMergeAdapter —— 合并原语（GitMergePort）
 * ============================================================ */

/**
 * Git 合并原语适配器（对应 application 层 GitMergePort，TASK-018）。
 *
 * 提供合并编排所需的 git 底层原语——rebase / fast-forward / commit 采集 / 审计提交 /
 * 幂等恢复判定 / 冲突清单。合并顺序、回填时机、ff 顺序、冲突仲裁归 application 层
 * （TASK-019 / TASK-021），本类只做原子操作。构造参数与 WorktreeAdapter 同形（同一仓库
 * 的 mainRepoDir + worktreesDir），由 cli composition root wiring 时一并注入。
 */
export class GitMergeAdapter {
  constructor(
    private readonly mainRepoDir: string,
    private readonly worktreesDir: string,
  ) {}

  /** taskId → worktree 绝对路径（worktreesDir/<taskId>）。 */
  private worktreePath(taskId: TaskId): string {
    return resolve(this.worktreesDir, taskId)
  }

  /** 把 worktree 分支 rebase 到最新 main（冲突不抛断，留 listConflicts 探测）。 */
  rebaseOnto(taskId: TaskId, mainRef: string): void {
    const cwd = this.worktreePath(taskId)
    const r = tryGit(['rebase', mainRef], cwd)
    if (r.ok) return
    // 冲突时 rebase 停在中间态（退出码非 0）——不抛断，留 listConflicts 探测 /
    // abortOrCleanRebase 清理（GitMergePort.rebaseOnto 契约，TASK-019 §2「失败不抛断」）。
    if (isRebaseInProgress(cwd)) return
    throw new GitAdapterError(['rebase', mainRef].join(' '), r.code, r.stderr)
  }

  /** 以 fast-forward 把 worktree 分支合并回 main（避免 merge commit）。 */
  fastForwardMain(taskId: TaskId, mainRef: string): void {
    const branch = branchName(taskId)
    // 先确认 mainRef 是 branch 的祖先（fast-forward 可行），否则抛错——
    // 线性快进才能避免 merge commit（§3.2）；分叉应由上层先 rebase。
    const anc = tryGit(['merge-base', '--is-ancestor', mainRef, branch], this.mainRepoDir)
    if (!anc.ok) {
      throw new GitAdapterError(
        ['merge-base', '--is-ancestor', mainRef, branch].join(' '),
        anc.code,
        `${mainRef} 不是 ${branch} 的祖先，无法 fast-forward（main 已分叉，需先 rebase）:\n${anc.stderr}`,
      )
    }
    // update-ref 直接移动 main 指向 branch HEAD（线性快进，无 merge commit，§3.2）。
    // 假定 mainRef 为短分支名（如 'main'），构造 refs/heads/<mainRef>。
    runGit(['update-ref', `refs/heads/${mainRef}`, branch], this.mainRepoDir)
  }

  /** 采集 post-rebase 的实现 commit 元信息（不含 audit commit）。 */
  collectPostRebaseCommits(taskId: TaskId, baseRef: string): ExecutionCommit[] {
    const cwd = this.worktreePath(taskId)
    // baseRef..HEAD = 基线之后到当前 HEAD 的实现 commit（rebase 后、audit commit 前）。
    // --reverse 按提交时间正序（旧→新）；%x1f 分隔字段、%x1e 分隔记录，规避 message 换行。
    const fmt = ['%H', '%s', '%an', '%aI'].join(FIELD_SEP) + RECORD_SEP
    const out = runGit(['log', `${baseRef}..HEAD`, '--reverse', `--format=${fmt}`], cwd)
    const commits: ExecutionCommit[] = []
    for (const rawRecord of out.split(RECORD_SEP)) {
      // git 在每条 --format 记录后追加换行，多条记录间的 \n 残留在下一条记录首部；
      // 去首尾换行后再按字段分隔符解析（hash/message/author/time 均不含首尾换行）。
      const record = rawRecord.replace(/^[\r\n]+|[\r\n]+$/g, '')
      if (record === '') continue
      const [hash, message, author, time] = record.split(FIELD_SEP)
      // noUncheckedIndexedAccess：split 结果索引可能 undefined，缺字段跳过该条。
      if (hash === undefined || message === undefined || author === undefined || time === undefined) {
        continue
      }
      commits.push({ hash, message, author, time })
    }
    return commits
  }

  /** 提交回填 .result.md 后的独立 workflow audit commit（§3.2）。 */
  commitAuditResult(taskId: TaskId, resultPath: string): void {
    const cwd = this.worktreePath(taskId)
    // 独立 audit commit：提交 Orchestrator 回填后的 .result.md，作为记录载体进入主分支历史
    // （§3.2「audit commit 只作为记录载体」，不计入 execution_commits）。
    runGit(['add', '--', resultPath], cwd)
    runGit(['commit', '-m', `${AUDIT_MESSAGE_PREFIX}回填 ${taskId} 执行审计字段`], cwd)
  }

  /** 判定 worktree 分支是否已 fast-forward 进入 main（幂等恢复用）。 */
  branchMerged(taskId: TaskId, mainRef: string): boolean {
    const branch = branchName(taskId)
    // branch 已进入 main = branch 是 main 的祖先（等价 git branch --merged <mainRef>）。
    const r = tryGit(['merge-base', '--is-ancestor', branch, mainRef], this.mainRepoDir)
    return r.ok
  }

  /** 丢弃上次不完整的 rebase 中间态，从干净基线重启（幂等）。 */
  abortOrCleanRebase(taskId: TaskId): void {
    const cwd = this.worktreePath(taskId)
    const r = tryGit(['rebase', '--abort'], cwd)
    if (r.ok) return
    // 仍有中间态却 abort 失败 → 真错误；无 rebase 在进行时 git 报错 → 幂等成功。
    if (isRebaseInProgress(cwd)) {
      throw new GitAdapterError(['rebase', '--abort'].join(' '), r.code, r.stderr)
    }
  }

  /** 列出当前冲突文件清单（rebase 冲突时供上层返回，不抛断）。 */
  listConflicts(taskId: TaskId): string[] {
    const cwd = this.worktreePath(taskId)
    // --diff-filter=U 仅列 unmerged 文件（rebase/merge 冲突路径）。
    const out = runGit(['diff', '--name-only', '--diff-filter=U'], cwd)
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
  }
}
