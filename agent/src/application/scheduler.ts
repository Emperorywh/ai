/**
 * Application 拓扑排序与并行检测（Readme.md §3.2 并行执行与 worktree 合并策略 / §11 执行流程）。
 *
 * 以纯函数表达任务依赖图上的调度计算：
 *   - topologicalOrder：被依赖方在前（任一任务出现在其全部依赖之后）的合法拓扑序；
 *     环形依赖抛错。
 *   - mergeOrder：合并回收的拓扑序（§3.2「先合并被依赖方，再合并依赖方」）。当前与
 *     topologicalOrder 算法一致——执行序与合并序在拓扑意义下同向（被依赖方在前），
 *     独立导出以表达合并场景语义，便于未来在合并侧引入额外约束时分化解耦。
 *   - detectParallelizable：按拓扑分层 + allowed_paths 不重叠贪心分组，产出可并行批次。
 *
 * 不实际调度执行（CLI task:run 编排归 TASK-026）；不做 worktree 创建（归 TASK-018）。
 * 路径重叠采用保守策略（任务 §7/§8：前缀包含或 glob 相交视为重叠，倾向不并行），
 * 与 §3.2「默认串行，路径不重叠才允许并行」一致。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：纯函数，仅 type-only import core 的
 * TaskId 类型，零运行时依赖、零反向依赖（不依赖 infrastructure / cli；不 import core 的
 * 运行时规则函数——环检测作为 Kahn 排序的副产物自包含完成）。
 *
 * 权威来源：根目录 Readme.md §3.2 / §11。
 */
import type { TaskId } from '../core/index.js'

/* ============================================================ *
 * 最小任务投影
 * ============================================================ */

/**
 * 调度计算所需的最小任务投影。
 *
 * 只取 id / depends_on / allowed_paths 三字段：id 与 depends_on 构建依赖图，
 * allowed_paths 做并行分组的路径重叠判定。结构类型——任意同时具备这三字段的对象
 * （如 TaskFrontmatter，见 src/core/schemas/task-schema.ts）均可直接传入，
 * 无需显式转换，应用层不必为调度计算另行装配数据。
 */
export interface SchedulerTask {
  readonly id: TaskId
  readonly depends_on: readonly TaskId[]
  readonly allowed_paths: readonly string[]
}

/* ============================================================ *
 * 图构建与排序辅助
 * ============================================================ */

/**
 * 依赖图：id→任务索引、入度表、反向邻接（被依赖者 -> 依赖方）。
 *
 * 入度表与反向邻接仅计「依赖指向集合内任务」的边——外部依赖（指向集合外任务）
 * 不影响集合内拓扑结构，予以忽略，存在性校验属解析阶段职责。
 */
interface DependencyGraph {
  readonly byId: Map<TaskId, SchedulerTask>
  readonly indegree: Map<TaskId, number>
  readonly dependents: Map<TaskId, TaskId[]>
}

/**
 * 从 TASK-XXX 提取数字部分，用于排序的确定性。
 *
 * 数值升序鲁棒于补零差异（TASK-2 < TASK-010）；非法格式退化为最大值排末尾
 * （id 格式合法性由 core TaskIdSchema 保证，本模块不重复校验）。
 */
function numericId(id: TaskId): number {
  const m = /^TASK-(\d+)$/.exec(id)
  return m === null || m[1] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[1])
}

/** 按 id 数值升序排序的比较器。 */
function byNumericId(a: TaskId, b: TaskId): number {
  return numericId(a) - numericId(b)
}

/**
 * 校验输入无重复 id——重复 id 会让入度 / 邻接构建产生歧义，显式抛错不静默。
 */
function assertUniqueIds(tasks: readonly SchedulerTask[]): void {
  const seen = new Set<TaskId>()
  for (const t of tasks) {
    if (seen.has(t.id)) {
      throw new Error(`调度输入含重复任务 id：${t.id}`)
    }
    seen.add(t.id)
  }
}

/**
 * 构建依赖图（id→任务索引 + 入度 + 反向邻接）。返回的 Map 为独立副本，调用方可安全修改。
 */
function buildGraph(tasks: readonly SchedulerTask[]): DependencyGraph {
  const byId = new Map<TaskId, SchedulerTask>()
  const indegree = new Map<TaskId, number>()
  for (const t of tasks) {
    byId.set(t.id, t)
    indegree.set(t.id, 0)
  }
  const knownIds = new Set<TaskId>(byId.keys())
  const dependents = new Map<TaskId, TaskId[]>()
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!knownIds.has(dep)) continue // 外部依赖跳过
      const list = dependents.get(dep)
      if (list === undefined) {
        dependents.set(dep, [t.id])
      } else {
        list.push(t.id)
      }
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1)
    }
  }
  return { byId, indegree, dependents }
}

/**
 * Kahn 分层拓扑排序：每「轮」取出当前入度 0 的节点构成一层（层内任务的所有依赖
 * 均在更早层完成），层内按 id 数值升序解并列以保证确定性输出。
 *
 * 同时服务 topologicalOrder（扁平化为序）与 detectParallelizable（层内分组）——
 * 图构建与入度消费在此共享，避免重复实现（AGENTS.md §3）。
 *
 * 若分层结束后已处理节点数 < 总节点数，说明存在入度永不为 0 的节点（处于环上或
 * 依赖环），返回 cyclic:true 供调用方抛错（§11 环形依赖非法，不静默）。
 */
function topoLayers(tasks: readonly SchedulerTask[]): {
  layers: TaskId[][]
  cyclic: boolean
} {
  const { indegree, dependents } = buildGraph(tasks)
  const layers: TaskId[][] = []

  // 初始层：入度 0 的节点。
  let current: TaskId[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) current.push(id)
  }
  current.sort(byNumericId)

  let processed = 0
  while (current.length > 0) {
    layers.push(current)
    processed += current.length
    // 消费本层节点：对其每个后继入度 -1，归零者进入下一层。
    const next: TaskId[] = []
    for (const id of current) {
      const ds = dependents.get(id)
      if (ds === undefined) continue
      for (const d of ds) {
        const deg = (indegree.get(d) ?? 0) - 1
        indegree.set(d, deg)
        if (deg === 0) next.push(d)
      }
    }
    current = next.sort(byNumericId)
  }

  return { layers, cyclic: processed < tasks.length }
}

/* ============================================================ *
 * 路径重叠判定（保守，§3.2/§8）
 * ============================================================ */

/** glob 通配符字符检测正则：`*` / `?` / `[`。 */
const GLOB_CHARS = /[*?[]/

/**
 * 标准化路径：反斜杠转正斜杠、去首尾空白、去 `./` 前缀与尾部冗余斜杠。
 *
 * 统一 Windows / POSIX 风格差异，保证前缀比较在两种分隔符下一致。
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * 取路径中首个通配符之前的「字面目录前缀」（按 `/` 段对齐）。
 *
 * 例如：递归匹配 src/core 下 .ts 的目录级 glob（路径段含通配）→ `src/core`；
 * `docs/*` → `docs`；仅 `*.ts` → `''`；`src/a.ts` → `src/a.ts`。
 * 返回值不含任何通配符，可安全做段包含比较。
 */
function literalPrefix(p: string): string {
  const segs = p.split('/')
  const out: string[] = []
  for (const seg of segs) {
    if (GLOB_CHARS.test(seg)) break
    out.push(seg)
  }
  return out.join('/')
}

/**
 * a 是否为 b 的祖先路径段或与 b 相等（路径段包含，非裸字符串前缀）。
 *
 * 空串 a 视为根级，包含一切 b——用于通配符字面前缀为根级时的保守判定。
 */
function isAncestorOrSame(a: string, b: string): boolean {
  if (a === b) return true
  if (a === '') return true
  return b.startsWith(a + '/')
}

/**
 * 两条路径是否重叠（§3.2/§8 保守判定：前缀包含或 glob 相交视为重叠）。
 *
 * 规则：
 *   1. 标准化后相等 → 重叠。
 *   2. 取各自字面前缀；任一前缀为空（根级通配如 `*.ts` 或起首即通配）→ 保守判重叠。
 *   3. 两前缀有祖先 / 相等关系 → 重叠；否则不重叠。
 *
 * 保守策略倾向「判重叠」，宁可低估并行度（安全优先，与 §3.2 默认串行一致）。
 */
function pathsOverlap(a: string, b: string): boolean {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  if (na === nb) return true
  const la = literalPrefix(na)
  const lb = literalPrefix(nb)
  if (la === '' || lb === '') return true
  return isAncestorOrSame(la, lb) || isAncestorOrSame(lb, la)
}

/**
 * 两个任务的 allowed_paths 是否重叠——任一对路径重叠即判任务重叠。
 *
 * 空 allowed_paths（无写路径）的任务视为与任何任务都不路径重叠：`.result.md` 是
 * 内置产物不计入 allowed_paths（§3.2），不参与冲突判定，故只读 / 纯计算任务可与
 * 其他任务并行。
 */
function tasksPathOverlap(a: SchedulerTask, b: SchedulerTask): boolean {
  if (a.allowed_paths.length === 0 || b.allowed_paths.length === 0) return false
  for (const pa of a.allowed_paths) {
    for (const pb of b.allowed_paths) {
      if (pathsOverlap(pa, pb)) return true
    }
  }
  return false
}

/* ============================================================ *
 * 公开 API
 * ============================================================ */

/**
 * 拓扑排序：被依赖方在前（任一任务出现在其全部依赖之后），环形依赖抛错。
 *
 * 用途：执行序——依赖完成后才可执行后继（§11）。输出确定性（id 数值升序解并列），
 * 便于测试断言与上层确定性调度。仅解析集合内依赖边；外部依赖不影响内部拓扑。
 */
export function topologicalOrder(tasks: readonly SchedulerTask[]): TaskId[] {
  assertUniqueIds(tasks)
  const { layers, cyclic } = topoLayers(tasks)
  if (cyclic) {
    throw new Error('拓扑排序：检测到环形依赖，任务依赖必须构成 DAG')
  }
  return layers.flat()
}

/**
 * 合并回收的拓扑序（§3.2「先合并被依赖方，再合并依赖方」）。
 *
 * 当前与 topologicalOrder 算法一致——执行序与合并序在拓扑意义下同向（被依赖方在前）。
 * 独立导出以表达合并场景语义，便于未来在合并侧引入额外约束（如 worktree 基线对齐）
 * 时与执行序分化解耦。
 */
export function mergeOrder(tasks: readonly SchedulerTask[]): TaskId[] {
  return topologicalOrder(tasks)
}

/**
 * 检测可并行执行的任务分组（§3.2：互无 depends_on 依赖且 allowed_paths 不重叠）。
 *
 * 算法：
 *   1. Kahn 分层——每层任务的所有依赖均在更早层完成，层内互无依赖。
 *   2. 层内按 allowed_paths 不重叠做最早适配贪心分组——每个节点放入第一个与之路径
 *      不冲突的已有组，否则新建一组；同一组内任意两任务路径互不重叠。
 *   3. 各层分组按拓扑层序拼接，每个分组作为一个「可并行批次」返回。
 *
 * 返回 TaskId[][]：外层按拓扑依赖序排列（批次 i 的任务只依赖批次 < i 的任务），
 * 内层为可安全并行执行的任务集合（互无依赖且路径不重叠）。单元素批次表示该任务
 * 无法与同层任何任务并行（存在路径冲突）。空任务集合返回空数组。环形依赖抛错。
 *
 * 保守重叠判定（pathsOverlap）可能低估并行度，但安全优先（§3.2 默认串行）。
 */
export function detectParallelizable(tasks: readonly SchedulerTask[]): TaskId[][] {
  assertUniqueIds(tasks)
  const { byId } = buildGraph(tasks)
  const { layers, cyclic } = topoLayers(tasks)
  if (cyclic) {
    throw new Error('并行检测：检测到环形依赖，任务依赖必须构成 DAG')
  }

  const batches: TaskId[][] = []
  for (const layer of layers) {
    // 层内最早适配贪心分组：节点（已按 id 升序）依次放入第一个路径不冲突的组。
    const groups: TaskId[][] = []
    for (const id of layer) {
      const task = byId.get(id)
      if (task === undefined) continue
      let placed = false
      for (const g of groups) {
        // 与组内所有成员路径都不重叠才可放入。
        let conflict = false
        for (const member of g) {
          const m = byId.get(member)
          if (m !== undefined && tasksPathOverlap(task, m)) {
            conflict = true
            break
          }
        }
        if (!conflict) {
          g.push(id)
          placed = true
          break
        }
      }
      if (!placed) groups.push([id])
    }
    // 各组作为可并行批次，按组创建顺序（首成员 id 升序）输出。
    for (const g of groups) batches.push(g)
  }
  return batches
}
