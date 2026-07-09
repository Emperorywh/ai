---
task_id: TASK-016
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/scheduler.ts
  - test/application/scheduler.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess），Node v22.0.0"
  - command: npm test -- application/scheduler
    result: passed
    notes: "vitest run application/scheduler，1 文件 32 用例全通过（纯函数单测）"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 15 文件 437 用例全通过（新增 32 项，原 405 不受影响；SQLite 测试在 Node 22 下通过）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-016（App 拓扑排序与并行检测）已完成：src/application/scheduler.ts 提供 topologicalOrder（被依赖方在前、环抛错）/ mergeOrder（合并回收拓扑序）/ detectParallelizable（拓扑分层 + allowed_paths 不重叠贪心分组的可并行批次），32 项单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层：frontmatter 解析器 + 任务文档仓储 + 全局文档仓储 + SQLite schema/迁移 + SQLite 索引仓储就绪；application 层：Context Pack 生成器 + application→infra 窄接口（Ports）+ 调度器就绪。scheduler.ts（src/application/scheduler.ts）以纯函数表达任务依赖图调度计算——topologicalOrder(tasks)（Kahn 入度分层扁平化，被依赖方在前，id 数值升序解并列保证确定性，环 = 排序失败抛错）/ mergeOrder(tasks)（合并回收拓扑序，§3.2「先合并被依赖方」，当前与 topologicalOrder 同向，独立导出供未来合并侧分化）/ detectParallelizable(tasks)（拓扑分层 + 层内 allowed_paths 不重叠最早适配贪心分组，产出可并行批次 TaskId[][]；空 allowed_paths 视为不与任何任务冲突）。SchedulerTask 为最小投影结构类型（id/depends_on/allowed_paths，兼容 TaskFrontmatter）；外部依赖（指向集合外任务）忽略不报错；重复 id / 环 / 自环均抛错不静默。三函数纯计算，不实际调度执行（归 TASK-026）、不创建 worktree（归 TASK-018）。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析 / frontmatter 解析 / 文档仓储 / SQLite 索引 / Context Pack 生成 / Ports 同前。工具链 npm run typecheck / npm test（437 项）/ npm run lint 全绿（注：better-sqlite3 原生模块需 Node 22 ABI 127 预编译，见 ISS-005）。仍无 CLI 命令；其余 infra（git worktree、sdk、mcp）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/application/scheduler.ts 建立：仅 type-only import core 的 TaskId，零运行时依赖、零反向依赖（不依赖 infrastructure/cli；不 import core 的运行时规则函数——环检测作为 Kahn 排序副产物自包含完成，SchedulerTask 无需 status 字段，避免与 core detectDependencyCycle 的 CascadeTask 投影耦合）。沿用「数据结构 + 纯函数 + Result 抛错」模式：buildGraph 构建 id→任务索引 + 入度表 + 反向邻接（仅计集合内依赖边，外部依赖跳过）；topoLayers 做 Kahn 分层（每轮入度 0 节点为一层，id 数值升序解并列），processed < total 即判环，同时服务 topologicalOrder（flat 扁平化）与 detectParallelizable（层内分组）共享图构建避免重复（AGENTS §3）。路径重叠（pathsOverlap）保守判定：normalizePath 统一反斜杠/正斜杠与尾部斜杠，literalPrefix 取首个通配符前字面目录前缀，isAncestorOrSame 做路径段包含，相等 / 任一字面前缀为空（根级通配如 *.ts）/ 前缀祖先关系 → 重叠（倾向不并行，§3.2 默认串行）；tasksPathOverlap 对空 allowed_paths 任务直接返回不重叠（.result.md 不计入 allowed_paths，只读任务可并行）。detectParallelizable 层内最早适配贪心分组：节点（id 升序）放入第一个路径不冲突的已有组否则新组，单元素批次表示该任务无法与同层任何任务并行。noUncheckedIndexedAccess 下 Map.get 返回值用 ?? / undefined 守卫、数组索引显式守卫。src/application/index.ts 经 ./scheduler.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "调度器复用要点（TASK-016）：topologicalOrder(tasks) 返回被依赖方在前的拓扑序（任一任务在其全部依赖之后），环 / 自环 / 重复 id 抛错；输出确定性（id 数值升序解并列，鲁棒于补零）。mergeOrder(tasks) 当前 = topologicalOrder（§3.2 合并序与执行序同向），独立导出便于未来在合并侧引入额外约束（如 worktree 基线对齐）时分化。detectParallelizable(tasks) 返回 TaskId[][]——外层按拓扑依赖序（批次 i 只依赖 < i 批次），内层为可安全并行任务（互无依赖且路径不重叠）；同层路径冲突者拆分，单元素批次表无法并行。SchedulerTask 为最小投影（id/depends_on/allowed_paths），TaskFrontmatter 可直接传入（结构类型兼容）。TASK-017 状态编排用 topologicalOrder 决定执行序 / mergeOrder 决定合并序（§3.2「先合并被依赖方」）；detectParallelizable 供 Orchestrator 判定可并行任务子集（§3.2「互无依赖且路径不重叠才并行」）。路径重叠保守判定（DEC-013）：相等 / 目录包含 / glob 字面前缀相交 / 根级通配 → 重叠；兄弟文件 / 不相交目录 / 空 allowed_paths → 不并行冲突。外部依赖（指向集合外任务）不影响内部拓扑、不报错（存在性校验属解析阶段）。技术注记：scheduler 不 import core 运行时规则函数，环检测自包含于 Kahn（与 core detectDependencyCycle 的 DFS 三色是不同算法服务不同入口，非重复）。详见 DEC-013（proposed），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "TASK-016 无新 issue：仅 type-only import core 的 TaskId，未新增 npm 依赖，未触及 core/infrastructure/cli（forbidden 守住），无边界冲突。调度器设计（mergeOrder 与 topologicalOrder 同向 / detectParallelizable 返回可并行批次而非裸拓扑层 / 保守路径重叠判定 / 环检测自包含于 Kahn 不复用 core / SchedulerTask 最小投影 / 空 allowed_paths 不冲突 / 确定性输出）系 §3.2/§11/任务 §7/§8 的合理落地（DEC-013 proposed），非规格偏离。ISS-005（low，open）延续：better-sqlite3@11.10.0 原生模块 Node 版本兼容——本任务纯计算不依赖 SQLite，但全量回归含 SQLite 测试在 Node 22（ABI 127）下通过；后续依赖 SQLite 的 CLI 任务（TASK-025 rebuild-index）仍受此约束。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务未引用该枚举，维持现状不阻塞。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-017：App 状态流转编排器（layer: domain，depends_on TASK-007/008/011/015 均已完成，随 TASK-015 解锁）。落地 src/application/state-orchestrator.ts，直接消费 ports.ts + 状态机 + 依赖级联 + 状态映射 + 调度器，是 application 层首个完整用例（ready→running→reviewing→done/rejected/blocked 全链路）。是编号最小的已解锁未完成任务，可优先推进。其余已解锁任务：TASK-018（infra git worktree）亦可并行推进。"
  decisions:
    - id: ""
      title: "调度器设计：mergeOrder 与 topologicalOrder 同向、detectParallelizable 返回可并行批次、保守路径重叠判定、环检测自包含于 Kahn、SchedulerTask 最小投影、空 allowed_paths 不冲突、确定性输出"
      status: proposed
      scope: "application/scheduler"
      created_from_task: TASK-016
      decision: "TASK-016 对 §3.2/§11 与任务 §7/§8 未明文的设计点作如下解释并落地：（1）mergeOrder 与 topologicalOrder 同向——§3.2「合并顺序按 depends_on 拓扑序，先合并被依赖方，再合并依赖方」与执行序（依赖完成后才执行后继）在拓扑意义下同向（均被依赖方在前），故 mergeOrder 当前复用 topologicalOrder 算法；独立导出以表达合并场景语义，便于未来在合并侧引入额外约束（如 worktree 基线对齐 / execution_commits 回填顺序）时与执行序分化解耦。（2）detectParallelizable 返回「可并行批次」TaskId[][] 而非裸拓扑层——§3.2「只有互无 depends_on 依赖、且 allowed_paths 不重叠才允许并行」要求分组必须处理路径冲突：先 Kahn 分层（层内互无依赖），再层内按 allowed_paths 不重叠做最早适配贪心分组，每个分组是一个可安全并行批次；同层路径冲突者拆成多批，单元素批次表示无法与同层任何任务并行。返回按拓扑依赖序排列（批次 i 只依赖 < i 批次），Orchestrator 按批次调度。（3）保守路径重叠判定（pathsOverlap）——任务 §7「前缀包含或 glob 相交视为重叠（保守，倾向不并行）」+ §8：normalizePath 统一分隔符 / 尾部斜杠后，相等 / 目录段包含（祖先关系）/ glob 字面前缀相交 / 任一字面前缀为空（根级通配如 *.ts 或起首即通配）→ 判重叠；兄弟文件 / 不相交目录 → 不重叠。取 glob 首个通配符前的字面目录前缀做段包含比较，避免实现完整 glob 交集（NP-hard，任务 §7「不判定细粒度」）。（4）环检测自包含于 Kahn——Kahn 排序完成节点数 < 总数即存在入度永不为 0 的节点（环上或依赖环），返回 cyclic 供调用方抛错；不 import core 的 detectDependencyCycle，因为环检测是拓扑排序的自然副产物，自包含内聚，且 SchedulerTask 投影无需 status 字段（core 的 detectDependencyCycle 需 CascadeTask 含 status）。与 core 的 DFS 三色环检测是不同算法服务不同入口，非重复逻辑。（5）SchedulerTask 最小投影（id/depends_on/allowed_paths）——结构类型兼容 TaskFrontmatter，应用层不必为调度另行装配。（6）空 allowed_paths 视为不与任何任务路径重叠——§3.2「.result.md 是内置产物不计入 allowed_paths」，故无写路径的只读 / 纯计算任务不与他任务文件冲突，可并行。（7）确定性输出——Kahn 入度 0 节点按 id 数值升序解并列，层内分组按 id 升序遍历，结果稳定可复现。"
      rationale: "mergeOrder 同向：§3.2 明文合并序 = depends_on 拓扑序（被依赖方在前），与执行序无方向差异；分两个函数是为语义清晰 + 未来分化点，当前共享算法避免重复。可并行批次而非裸层：§3.2 的并行条件同时含「互无依赖」与「路径不重叠」两个维度，仅返回拓扑层会把路径冲突的任务混在同一层（调用方仍需自判），返回可并行批次让 Orchestrator 直接按批次调度、组内并行、组间串行。保守重叠：任务 §7 明示「保守策略，倾向不并行」与 §3.2「默认串行」一致，宁可低估并行度也不冒险并发写同文件；glob 交集精确判定是 NP-hard，任务 §7「用 glob/prefix 相交判定即可」授权用字面前缀近似。环检测自包含：Kahn 天然检测环（无需额外 DFS 前置），scheduler 的核心是拓扑排序、环是其副产物，一体化更内聚；不耦合 core detectDependencyCycle 的 CascadeTask 投影（需 status），SchedulerTask 更最小。空 allowed_paths 不冲突：.result.md 不计入 allowed_paths（§3.2），纯计算任务无业务写路径，与任何任务都不文件冲突，禁止其并行会无谓降低并行度。确定性：拓扑排序本有多解（并列任务任意序），固定 id 数值升序使输出可复现，便于测试断言与上层确定性调度 / 合并。"
      consequences: "TASK-017 状态编排复用：topologicalOrder 决定执行序 / mergeOrder 决定合并序（§3.2 先合并被依赖方）；detectParallelizable 供 Orchestrator 选可并行任务子集调度多 worktree。TASK-026 CLI task:run 经调度器取执行序编排。TASK-019 合并回填用 mergeOrder。保守重叠判定可能低估并行度（如两个 glob 实际不相交但字面前缀被判相交），但安全优先、可通过细化 glob 判定（未来任务）提升。mergeOrder 当前 = topologicalOrder，若未来合并序需分化（如 audit commit 顺序约束），改 mergeOrder 独立实现不影响 topologicalOrder。若 Orchestrator 认为：(a) detectParallelizable 应返回裸拓扑层（路径冲突由上层再判）——改返回 layers 直接输出（但与 §3.2「路径不重叠才并行」张力）；(b) 路径重叠应精确判定 glob 交集——引入 glob 匹配库（新增依赖，需扩权）或自实现 minimatch 逻辑；(c) 环检测应复用 core detectDependencyCycle——补 status 投影或泛化 core 接口（改 core，需扩权）；(d) 空 allowed_paths 应视为与一切冲突（保守）——改 tasksPathOverlap 对空数组返回 true（降低并行度）。"
      created_from_task: TASK-016
  issues: []
next_action: review
---

# TASK-016 执行结果

## 1. 执行结论

任务完成。在 `src/application/scheduler.ts` 落地三个纯函数：`topologicalOrder(tasks)`（Kahn 入度分层扁平化，被依赖方在前，环 / 自环 / 重复 id 抛错，id 数值升序解并列保证确定性）、`mergeOrder(tasks)`（合并回收拓扑序，§3.2「先合并被依赖方」，当前与 topologicalOrder 同向）、`detectParallelizable(tasks)`（拓扑分层 + 层内 `allowed_paths` 不重叠最早适配贪心分组，产出可并行批次 `TaskId[][]`）。`src/application/index.ts` 再导出 scheduler 模块。`test/application/scheduler.test.ts` 32 项单测覆盖线性 / 菱形 / 无依赖排序、环与自环与三元环抛错、外部依赖忽略、重复 id 抛错、mergeOrder 同向、并行分层、路径重叠保守剔除（相等 / 目录包含 / glob 相交 / 根级通配 / Windows 反斜杠）、兄弟文件与不相交目录可并行、空 allowed_paths 不冲突、批次拓扑依赖序不变量。typecheck / test / lint 三项全绿，全量回归 437 项不受影响。

## 2. 完成内容

- `topologicalOrder(tasks): TaskId[]`：Kahn 入度 BFS 扁平化，被依赖方在前（任一任务出现在其全部依赖之后）；id 数值升序解并列；环 / 自环 / 重复 id 抛错；外部依赖忽略不报错。
- `mergeOrder(tasks): TaskId[]`：合并回收拓扑序（§3.2「先合并被依赖方，再合并依赖方」），当前与 topologicalOrder 算法一致，独立导出供未来分化。
- `detectParallelizable(tasks): TaskId[][]`：Kahn 分层 + 层内 `allowed_paths` 不重叠最早适配贪心分组；外层按拓扑依赖序（批次 i 只依赖 < i 批次），内层为可安全并行任务（互无依赖且路径不重叠）；单元素批次表无法与同层任务并行；环 / 重复 id 抛错。
- 模块级导出：`SchedulerTask`（最小投影结构类型 `id` / `depends_on` / `allowed_paths`，兼容 `TaskFrontmatter`）。
- 路径重叠保守判定：相等 / 目录段包含（祖先关系）/ glob 字面前缀相交 / 任一前缀为空（根级通配）→ 重叠；兄弟文件 / 不相交目录 / 空 allowed_paths → 不冲突。
- 单测 32 项：topologicalOrder（线性 / 菱形 / 无依赖升序 / 空 / 确定性 / 外部依赖 / 多依赖在后 + 环 4 例 + 重复 id）、mergeOrder（同向 / 环抛错 / 空）、detectParallelizable 分层（线性 / 菱形 B-C 并行 / 空 / 单任务）、路径重叠剔除（相同文件 / 目录包含 / glob 相交 / 兄弟文件并行 / 不相交目录并行 / 空 allowed_paths 不冲突 / 两空并行 / Windows 反斜杠 / 根级通配 / 同层三任务冲突拆分）、批次拓扑依赖序 + 环抛错 + 重复 id。

## 3. 修改文件

- `src/application/index.ts` —— 追加 `export * from './scheduler.js'`，注释「TASK-016：拓扑排序与并行检测（调度计算）」。

## 4. 新增文件

- `src/application/scheduler.ts` —— 调度器（topologicalOrder + mergeOrder + detectParallelizable，§3.2/§11）。
- `test/application/scheduler.test.ts` —— 纯函数单测（32 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-013）：mergeOrder 与 topologicalOrder 同向、detectParallelizable 返回可并行批次、保守路径重叠判定、环检测自包含于 Kahn、SchedulerTask 最小投影、空 allowed_paths 不冲突、确定性输出。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无规格偏离。任务 §2 要求的三项（`topologicalOrder` / `detectParallelizable` / `mergeOrder`）与 §11 验收（拓扑序合法 + 环抛错 + 路径重叠候选剔除 + typecheck 0 错误）逐条落地有用例覆盖。mergeOrder 与 topologicalOrder 同向、detectParallelizable 返回可并行批次、保守路径重叠判定、环检测自包含于 Kahn 是 §3.2/§11/任务 §7/§8 未明文处的合理解释（DEC-013），不越界、不改规格、不新增依赖。

## 8. 后续任务注意事项

- `topologicalOrder(tasks)` 返回被依赖方在前的执行序；`mergeOrder(tasks)` 返回合并序（当前同向）。
- `detectParallelizable(tasks)` 返回 `TaskId[][]` 可并行批次，Orchestrator 按批次调度（组内并行、组间串行）。
- `SchedulerTask` 为最小投影，`TaskFrontmatter` 可直接传入。
- 路径重叠保守判定（DEC-013）：可能低估并行度，安全优先。
- 外部依赖（指向集合外任务）忽略不报错；环 / 自环 / 重复 id 抛错。
- scheduler 不 import core 运行时规则函数，环检测自包含于 Kahn。

## 9. 未解决问题

无新 issue。调度器设计（DEC-013 proposed）系 §3.2/§11/任务 §7/§8 的合理落地，无边界冲突、无新增依赖、未触及 core/infrastructure/cli（forbidden 守住）。ISS-005（better-sqlite3 Node 版本兼容）延续：本任务纯计算不依赖 SQLite，全量回归含 SQLite 测试在 Node 22 下通过。ISS-004（VerificationResultSchema 位置）不阻塞本任务——本任务未引用该枚举。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误（Node v22.0.0） |
| `npm test -- application/scheduler` | passed | vitest 1 文件 32 用例全通过（纯函数单测） |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 15 文件 437 用例全通过（含新增 32 项，SQLite 测试 Node 22 通过） |

## 11. 人工验收建议

- 复核拓扑序合法（§11）：任一任务出现在其全部依赖之后，环 / 自环 / 三元环 / 重复 id 抛错（见「topologicalOrder」+「环形依赖抛错」+「输入校验」测试组）。
- 复核路径重叠候选剔除（§11 / §7）：相同文件 / 目录包含 / glob 相交 / 根级通配判重叠并拆分；兄弟文件 / 不相交目录 / 空 allowed_paths 可并行（见「detectParallelizable：路径重叠剔除」测试组）。
- 复核可并行批次拓扑依赖序（§3.2）：批次 i 的任务只依赖更早批次（见「批次拓扑依赖序」测试组 + `expectBatchesRespectDependencies` 不变量）。
- 复核 mergeOrder 与 topologicalOrder 同向（§3.2 先合并被依赖方）。
- 确认 DEC-013 设计点（mergeOrder 同向 / 可并行批次语义 / 保守重叠 / 环自包含 / SchedulerTask 投影 / 空 allowed_paths 不冲突 / 确定性）是否符合 §3.2/§11/任务 §7/§8。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：DEC-013 调度器设计）、issues（无新增，ISS-005 / ISS-004 延续）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
