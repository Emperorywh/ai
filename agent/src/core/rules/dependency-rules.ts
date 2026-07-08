/**
 * Core 依赖级联规则（Readme.md §7 依赖级联 / 传递闭包）。
 *
 * 以纯函数表达任务依赖图上的两条领域规则：
 *   - transitiveDependents：计算某任务的全部后继（传递闭包）——所有直接或间接
 *     depends_on 到该任务的任务。
 *   - cascadeBlock：当某任务进入 rejected / failed / blocked 时，按 §7 依赖级联，
 *     其全部后继应自动进入 blocked。
 *
 * 本模块只产出「应被级联的集合」，不做状态写回（写回由 application 层 TASK-017
 * 编排）；也不校验后继当前能否合法流转到 blocked（如已 done 的后继需人工确认才能
 * reopen），该合法性由调用方经状态机（TASK-007 validateTransition）再过一道闸门。
 *
 * 任务依赖必须构成 DAG。本模块对环形依赖做防御性检测——发现环即抛错，绝不死循环
 * （任务 §12）。环是非法任务定义，应由人工修正，不在此自动消环。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：零反向依赖，仅依赖同层 enums
 * 的 TaskStatus 类型（不引入 zod，输入由上层以已校验的任务对象传入）。
 *
 * 权威来源：根目录 Readme.md §7（依赖级联：取传递闭包）。
 */
import type { TaskStatus } from '../enums.js'

/* ============================================================ *
 * 触发态与最小任务投影
 * ============================================================ */

/**
 * 触发依赖级联的「失败族」状态（Readme.md §7）。
 *
 * 当任务处于这三种状态之一时，其全部后继自动进入 blocked。
 * done / ready / running / draft / reviewing / cancelled 均不触发级联。
 */
const CASCADE_TRIGGERING_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'rejected',
  'failed',
  'blocked',
])

/**
 * 依赖级联计算所需的最小任务投影。
 *
 * 只取 id / depends_on / status 三字段：id 与 depends_on 用于构建依赖图，
 * status 用于 cascadeBlock 判断是否触发级联。结构类型——任意同时具备这三字段
 * 的对象（如 TaskFrontmatter，见 src/core/schemas/task-schema.ts）均可直接传入，
 * 无需显式转换，应用层不必为级联计算另行装配数据。
 */
export interface CascadeTask {
  readonly id: string
  readonly depends_on: readonly string[]
  readonly status: TaskStatus
}

/* ============================================================ *
 * 环形依赖检测
 * ============================================================ */

/**
 * 环形依赖检测：返回依赖图中任一环上的节点 id 序列（闭合环，首尾相同）；无环返回 null。
 *
 * 采用 DFS 三色标记（0 未访问 / 1 访问中即当前 DFS 栈内 / 2 已完成）：若遍历中遇到
 * 「访问中」节点，说明存在回到祖先的回边，沿父指针回溯即可取出环上节点序列。
 * O(V + E)。检测结果只保证「是一个环」，不保证是最小环或全图所有环。
 *
 * 边方向约定：X.depends_on 含 Y ⟺ 图中有边 X -> Y（X 依赖 Y）。故返回序列
 * `a -> b -> ... -> a` 表示 a 依赖 b、b 依赖 ... 、最终依赖回 a 的循环。
 *
 * 依赖指向任务集合之外的未知任务时，不视为环（存在性校验属解析阶段职责），
 * 直接跳过——本函数只关心集合内部的拓扑结构。
 */
export function detectDependencyCycle(
  allTasks: readonly CascadeTask[],
): string[] | null {
  // 颜色：0 未访问、1 访问中（在当前 DFS 栈内）、2 已完成。
  const color = new Map<string, 0 | 1 | 2>()
  // DFS 父指针，用于在发现回边时回溯取出环路径。
  const parent = new Map<string, string | null>()
  // id -> 直接依赖（depends_on 原方向）。
  const depsOf = new Map<string, readonly string[]>()
  for (const t of allTasks) {
    color.set(t.id, 0)
    parent.set(t.id, null)
    depsOf.set(t.id, t.depends_on)
  }

  let cycle: string[] | null = null

  const visit = (u: string): void => {
    if (cycle !== null) return
    color.set(u, 1)
    const deps = depsOf.get(u) ?? []
    for (const v of deps) {
      if (!color.has(v)) {
        // 依赖指向集合外任务——不构成集合内环，跳过（存在性由上层校验）。
        continue
      }
      const cv = color.get(v)
      if (cv === 0) {
        parent.set(v, u)
        visit(v)
        if (cycle !== null) return
      } else if (cv === 1) {
        // 遇到访问中节点 v：v ->(DFS 后代)-> u -> v 构成环。沿父指针从 u 回溯到 v。
        const ring: string[] = []
        let cur: string | null = u
        while (cur !== null && cur !== v) {
          ring.push(cur)
          cur = parent.get(cur) ?? null
        }
        ring.push(v) // 起点 v 放末尾
        ring.reverse() // -> [v, ..., u]
        ring.push(v) // 闭合 -> [v, ..., u, v]
        cycle = ring
        return
      }
      // cv === 2：已完成，无环，跳过。
    }
    color.set(u, 2)
  }

  for (const t of allTasks) {
    if (color.get(t.id) === 0) {
      visit(t.id)
      if (cycle !== null) return cycle
    }
  }
  return null
}

/**
 * 断言任务集合无环，有环则抛错（任务 §12：检测到环应抛错而非死循环）。
 */
function assertAcyclic(allTasks: readonly CascadeTask[]): void {
  const cycle = detectDependencyCycle(allTasks)
  if (cycle !== null) {
    throw new Error(
      `依赖级联：检测到环形依赖（${cycle.join(' -> ')}），任务依赖必须构成 DAG`,
    )
  }
}

/**
 * 在集合中定位指定任务，缺失则抛错（显式暴露输入错误，不静默返回空）。
 */
function requireTask(
  taskId: string,
  allTasks: readonly CascadeTask[],
): CascadeTask {
  const task = allTasks.find((t) => t.id === taskId)
  if (task === undefined) {
    throw new Error(`依赖级联：任务 ${taskId} 不在任务集合中`)
  }
  return task
}

/* ============================================================ *
 * 传递闭包
 * ============================================================ */

/**
 * 计算某任务的全部后继（传递闭包）——所有直接或间接 depends_on 到 taskId 的任务 id。
 *
 * 方向约定：X.depends_on 含 Y ⟺ X 是 Y 的后继（X 等 Y 完成）。故 taskId 的
 * 「后继」= 所有传递依赖 taskId 的任务，不含 taskId 自身；taskId 无后继时返回空数组。
 *
 * 实现：先 assertAcyclic 保证 DAG 性质，再构建 depends_on 的反向邻接（被依赖者 ->
 * 依赖方），从 taskId 做广度优先扩散，visited 去重保证 O(V+E)。返回顺序为 BFS 发现
 * 顺序（稳定，便于测试断言与上层确定性写回）。
 *
 * 依赖指向集合外任务的边在反向邻接构建时被忽略（不构成集合内可达后继）。
 */
export function transitiveDependents(
  taskId: string,
  allTasks: readonly CascadeTask[],
): string[] {
  // taskId 必须在集合内——未知 id 视为调用方输入错误，显式抛错（AGENTS.md §3 不静默）。
  requireTask(taskId, allTasks)
  assertAcyclic(allTasks)

  // 反向邻接：被依赖者 -> 直接依赖它的任务列表。
  const knownIds = new Set<string>()
  for (const t of allTasks) {
    knownIds.add(t.id)
  }
  const reverseAdj = new Map<string, string[]>()
  for (const t of allTasks) {
    for (const dep of t.depends_on) {
      if (!knownIds.has(dep)) continue
      const list = reverseAdj.get(dep)
      if (list === undefined) {
        reverseAdj.set(dep, [t.id])
      } else {
        list.push(t.id)
      }
    }
  }

  const result: string[] = []
  const visited = new Set<string>([taskId])
  const queue: string[] = [taskId]
  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur === undefined) break
    const dependents = reverseAdj.get(cur)
    if (dependents === undefined) continue
    for (const d of dependents) {
      if (visited.has(d)) continue
      visited.add(d)
      result.push(d)
      queue.push(d)
    }
  }
  return result
}

/* ============================================================ *
 * 依赖级联（§7）
 * ============================================================ */

/**
 * 依赖级联：当 taskId 处于 rejected / failed / blocked 时，返回其应被置 blocked 的
 * 全部后继（传递闭包）；其余状态返回空数组（不触发级联）。
 *
 * §7：当 TASK-A 处于 rejected/failed/blocked 时，所有直接或间接 depends_on 到
 * TASK-A 的后继任务自动进入 blocked。后继只有在 TASK-A 到达 done、依赖被 Orchestrator
 * 改写到替代任务、或人工取消该依赖后才能恢复——恢复由上层（TASK-017）编排，本函数
 * 只产出「应 blocked」集合，不判定后继当前状态能否合法流转到 blocked。
 *
 * 返回顺序同 transitiveDependents（BFS 发现顺序）。taskId 不在集合中时抛错。
 */
export function cascadeBlock(
  taskId: string,
  allTasks: readonly CascadeTask[],
): string[] {
  const task = requireTask(taskId, allTasks)
  if (!CASCADE_TRIGGERING_STATUSES.has(task.status)) {
    return []
  }
  return transitiveDependents(taskId, allTasks)
}
