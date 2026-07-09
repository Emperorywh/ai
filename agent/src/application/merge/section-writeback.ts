/**
 * Application 合并编排:全局文档 section 回写与冲突(Readme.md §3.2 / §10)。
 *
 * 在 rebaseAndFastForward(TASK-019)成功合并后,Orchestrator 按任务合并拓扑序**串行**回写
 * 三份全局文档:基于最新主分支重读 → 按 §3.2 section 级合并 global_update_requests → 写回。
 * progress 多条 replace 命中同一 section 时按拓扑序后写者覆盖先写者,先写者落选产出冲突清单
 * (供 Orchestrator 置 blocked / 落 ISSUES);decisions / issues 由注入的 idAllocator 统一分配
 * DEC-XXX / ISS-XXX 后按 id 去重追加。
 *
 * 设计约束(任务 §7 / §8 / §12 / AGENTS.md §2 / ARCHITECTURE.md §4):
 *   - 对全局文档仓储的依赖一律经 application/ports.ts 的 GlobalDocRepositoryPort,不直接
 *     import infrastructure 实现类(结构类型兼容,infra GlobalDocRepository 由 CLI 适配器
 *     组合 fs 满足全契约,DEC-009 / DEC-012)。
 *   - 回写串行:单次调用内对每份文档读一次 → 逐条纯变换合并 → 写一次(§3.2 明确串行、无
 *     并发;逐条 apply 到内存文档等价于「每条重读最新主分支」,任务 §12)。
 *   - id 分配由注入的 idAllocator 完成(单一分配点,避免重复 id,§8);本编排维护 usedIds
 *     集合(既有 id ∪ 本批次已分配)在每次分配前传入 allocator,保证不撞既有且批次内不重复。
 *   - 不做 rebase / ff(TASK-019)、不做幂等恢复(TASK-021)、不直接置 blocked——产出冲突清单,
 *     由编排 / CLI 决策(任务 §7)。
 *
 * 权威来源:根目录 Readme.md §3.2(并行执行与 worktree 合并策略)/ §10(任务执行结果模板)。
 */
import type {
  Decision,
  GlobalUpdateRequests,
  Issue,
  ProgressUpdateRequest,
  TaskId,
} from '../../core/index.js'
import type { GlobalDocName, GlobalDocRepositoryPort } from '../ports.js'

/* ============================================================ *
 * 类型:回写请求、id 分配器、结果
 * ============================================================ */

/**
 * 单条回写请求:来源任务 id + 其 global_update_requests(来自 .result.md frontmatter)。
 *
 * 结构类型——ResultFrontmatter.global_update_requests 可直接作为 updates 传入;
 * 调用方(Orchestrator)按合并拓扑序排列请求(被依赖方在前,§3.2「先合并被依赖方」),
 * 本编排按输入顺序逐条处理。
 */
export interface WritebackRequest {
  /** 来源任务 id(用于冲突清单 / assigned id 标注来源)。 */
  readonly task_id: TaskId
  /** 该任务的 global_update_requests(progress / decisions / issues)。 */
  readonly updates: GlobalUpdateRequests
}

/**
 * id 分配器(注入策略,单一分配点,§8)。
 *
 * 给定当前「已用 id 集合」,返回一个不与该集合冲突的新 id(DEC-XXX / ISS-XXX)。编号策略
 * 由实现决定(典型:现有最大编号 +1);writebackGlobalDocs 维护 usedIds(既有 id ∪ 本批次
 * 已分配)并在每次分配前传入,保证不撞既有且批次内不重复。无状态设计——号段生成完全由
 * usedIds 推断,便于测试注入 fake allocator。
 */
export interface IdAllocator {
  /** 返回一个不在 usedIds 中的决策 id(DEC-XXX)。 */
  nextDecisionId(usedIds: ReadonlySet<string>): string
  /** 返回一个不在 usedIds 中的问题 id(ISS-XXX)。 */
  nextIssueId(usedIds: ReadonlySet<string>): string
}

/**
 * progress section 冲突:同一 section 多条 replace,先写者被后写者覆盖(§3.2)。
 *
 * 供 Orchestrator 据情置 blocked / 写入 docs/ISSUES.md(§3.2「先写者落选...将冲突项写入
 * docs/ISSUES.md,视情况把后合并任务置为 blocked」)。本编排不做仲裁(任务 §7)。
 */
export interface ProgressWritebackConflict {
  /** 冲突的 PROGRESS section 名称。 */
  readonly section: string
  /** 落选(被覆盖)请求的来源任务。 */
  readonly task_id: TaskId
  /** 落选请求的 content(便于落 ISSUES 时记录丢失内容)。 */
  readonly content: string
  /** 覆盖方(该 section 拓扑序最后一条 replace)的来源任务。 */
  readonly superseded_by: TaskId
}

/**
 * 已分配 id 追踪(来源任务 → 分配的 id),供审计与 Orchestrator 回填 .result.md 的提议项 id。
 */
export interface AssignedId {
  /** 来源任务 id。 */
  readonly task_id: TaskId
  /** 该任务该条目分配到的 id(DEC-XXX / ISS-XXX)。 */
  readonly id: string
}

/**
 * writebackGlobalDocs 返回值。
 *
 *   - docs:三份全局文档回写后的内容(有变更者已写盘;无请求者保留读取的原内容,不写盘)。
 *   - progress_conflicts:progress section 冲突清单(§3.2 后写者覆盖先写者)。
 *   - assigned_decision_ids / assigned_issue_ids:本批次分配的决策 / 问题 id(拓扑序)。
 */
export interface WritebackOutcome {
  readonly docs: Readonly<Record<GlobalDocName, string>>
  readonly progress_conflicts: readonly ProgressWritebackConflict[]
  readonly assigned_decision_ids: readonly AssignedId[]
  readonly assigned_issue_ids: readonly AssignedId[]
}

/* ============================================================ *
 * 内部辅助:progress 冲突检测
 * ============================================================ */

/** 扁平化后的 progress 请求(保留全局序号以便精确标记落选项)。 */
interface FlatProgress {
  /** 全局扁平序号(输入顺序,即合并拓扑序)。 */
  readonly index: number
  readonly task_id: TaskId
  readonly update: ProgressUpdateRequest
}

/**
 * 把所有 progress 请求扁平化为 (index, task_id, update),index 为全局拓扑序。
 *
 * 输入顺序即合并拓扑序(调用方按 depends_on 排序);同一任务多条 progress 按数组内顺序累加。
 */
function flattenProgress(requests: readonly WritebackRequest[]): FlatProgress[] {
  const flat: FlatProgress[] = []
  for (const req of requests) {
    for (const u of req.updates.progress) {
      flat.push({ index: flat.length, task_id: req.task_id, update: u })
    }
  }
  return flat
}

/**
 * 检测 progress section 冲突(§3.2):同一 section 的多条 replace,按拓扑序只保留最后一条,
 * 其余每条生成一个冲突项,并返回落选项的全局序号集合(apply 时跳过)。
 *
 * append 不参与冲突——多条 append 是叠加(§3.2「append 按拓扑序拼接」),不视为覆盖;append
 * 与 replace 混合时,replace 在 apply 阶段天然覆盖此前 append 写入的内容(后写者覆盖先写者,
 * §3.2 字面仅把「多条 replace 命中同一 section」列为冲突场景)。
 */
function detectProgressConflicts(flat: readonly FlatProgress[]): {
  conflicts: ProgressWritebackConflict[]
  supersededIndexes: ReadonlySet<number>
} {
  // 按 section 收集 replace 请求(push 顺序即扁平序号升序 = 拓扑序)。
  const replacesBySection = new Map<string, FlatProgress[]>()
  for (const f of flat) {
    if (f.update.mode !== 'replace') continue
    const arr = replacesBySection.get(f.update.section)
    if (arr === undefined) {
      replacesBySection.set(f.update.section, [f])
    } else {
      arr.push(f)
    }
  }

  const conflicts: ProgressWritebackConflict[] = []
  const supersededIndexes = new Set<number>()
  for (const arr of replacesBySection.values()) {
    if (arr.length < 2) continue
    // arr 按扁平序号升序;最后一条是 winner(生效),其余每条落选。
    const winner = arr[arr.length - 1]
    if (winner === undefined) continue // 防御性(arr.length ≥ 2 确保存在)
    for (let i = 0; i < arr.length - 1; i++) {
      const loser = arr[i]
      if (loser === undefined) continue // 防御性
      supersededIndexes.add(loser.index)
      conflicts.push({
        section: loser.update.section,
        task_id: loser.task_id,
        content: loser.update.content,
        superseded_by: winner.task_id,
      })
    }
  }
  return { conflicts, supersededIndexes }
}

/** 从既有条目数组收集非空 id 集合(作为 id 分配去重基线)。 */
function collectExistingIds(entries: ReadonlyArray<{ id: string }>): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    if (e.id !== '') set.add(e.id)
  }
  return set
}

/* ============================================================ *
 * 公开 API
 * ============================================================ */

/**
 * 全局文档 section 回写编排(Readme.md §3.2 / §10)。
 *
 * 按输入顺序(调用方应排为 depends_on 合并拓扑序)串行回写三份全局文档:
 *
 *   - PROGRESS:重读 → 逐条 applyProgressUpdate(replace / append + section 合并,复用
 *     TASK-012)。落选的 replace(同 section 多条被覆盖)跳过不 apply;append 与未落选的
 *     replace 总 apply。合并后写回。冲突清单记录被覆盖的先写者(供置 blocked / 落 ISSUES)。
 *   - DECISIONS / ISSUES:重读 → 用 readDecisions / readIssues 取既有非空 id 集合 → 对每条
 *     提议项(id 空则经 idAllocator 分配新 id,非空则沿用)逐条 appendDecision / appendIssue
 *     (按 id 去重:命中既有同 id 则替换、否则文末追加)→ 写回。assigned id 列表记录分配结果。
 *
 * 单次调用串行处理(§3.2),无并发合并(任务 §12)。返回 WritebackOutcome:回写后文档 +
 * progress 冲突清单 + 本批次分配的决策 / 问题 id。冲突与 id 供 Orchestrator 置 blocked /
 * 落 ISSUES / 回填 .result.md(任务 §7 不在本编排仲裁)。
 *
 * @param globalRepo 全局文档读写与 section 合并 Port(经 application/ports.ts,不直接 import infra)。
 * @param orderedRequests 按合并拓扑序排列的回写请求(被依赖方在前)。
 * @param options.idAllocator id 分配器(DEC-XXX / ISS-XXX 单一分配点)。
 */
export function writebackGlobalDocs(
  globalRepo: GlobalDocRepositoryPort,
  orderedRequests: readonly WritebackRequest[],
  options: { idAllocator: IdAllocator },
): WritebackOutcome {
  // progress:扁平化 + 冲突检测(§3.2 同 section 多 replace 后写者覆盖先写者)。
  const flatProgress = flattenProgress(orderedRequests)
  const { conflicts: progressConflicts, supersededIndexes } =
    detectProgressConflicts(flatProgress)

  // ---------------- PROGRESS ----------------
  // 重读最新主分支文档;有 progress 请求才逐条合并并写回,无请求保留原文不写盘。
  let progressDoc = globalRepo.readGlobalDoc('progress')
  if (flatProgress.length > 0) {
    for (const f of flatProgress) {
      // 落选的 replace 跳过(先写者被后写者覆盖,其内容已入冲突清单);其余总 apply。
      if (f.update.mode === 'replace' && supersededIndexes.has(f.index)) continue
      progressDoc = globalRepo.applyProgressUpdate(progressDoc, f.update)
    }
    globalRepo.writeGlobalDoc('progress', progressDoc)
  }

  // ---------------- DECISIONS ----------------
  // 保持拓扑序收集各任务 decisions(同一任务按数组内顺序),供分配 id 后去重追加。
  const decisionReqs: ReadonlyArray<{ task_id: TaskId; decision: Decision }> =
    orderedRequests.flatMap((req) =>
      req.updates.decisions.map((decision) => ({ task_id: req.task_id, decision })),
    )
  const assignedDecisionIds: AssignedId[] = []
  let decisionsDoc = globalRepo.readGlobalDoc('decisions')
  if (decisionReqs.length > 0) {
    // usedIds = 既有非空 id ∪ 本批次已分配,保证不撞既有且批次内不重复。
    const usedDecisionIds = collectExistingIds(globalRepo.readDecisions(decisionsDoc))
    for (const { task_id, decision } of decisionReqs) {
      const id =
        decision.id !== ''
          ? decision.id
          : options.idAllocator.nextDecisionId(usedDecisionIds)
      usedDecisionIds.add(id)
      assignedDecisionIds.push({ task_id, id })
      decisionsDoc = globalRepo.appendDecision(decisionsDoc, { ...decision, id })
    }
    globalRepo.writeGlobalDoc('decisions', decisionsDoc)
  }

  // ---------------- ISSUES ----------------
  const issueReqs: ReadonlyArray<{ task_id: TaskId; issue: Issue }> =
    orderedRequests.flatMap((req) =>
      req.updates.issues.map((issue) => ({ task_id: req.task_id, issue })),
    )
  const assignedIssueIds: AssignedId[] = []
  let issuesDoc = globalRepo.readGlobalDoc('issues')
  if (issueReqs.length > 0) {
    const usedIssueIds = collectExistingIds(globalRepo.readIssues(issuesDoc))
    for (const { task_id, issue } of issueReqs) {
      const id =
        issue.id !== '' ? issue.id : options.idAllocator.nextIssueId(usedIssueIds)
      usedIssueIds.add(id)
      assignedIssueIds.push({ task_id, id })
      issuesDoc = globalRepo.appendIssue(issuesDoc, { ...issue, id })
    }
    globalRepo.writeGlobalDoc('issues', issuesDoc)
  }

  return {
    docs: { progress: progressDoc, decisions: decisionsDoc, issues: issuesDoc },
    progress_conflicts: progressConflicts,
    assigned_decision_ids: assignedDecisionIds,
    assigned_issue_ids: assignedIssueIds,
  }
}
