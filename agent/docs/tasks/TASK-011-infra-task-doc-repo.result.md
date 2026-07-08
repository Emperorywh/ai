---
task_id: TASK-011
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/fs/task-doc-repo.ts
  - test/infrastructure/fs/task-doc-repo.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/fs/task-doc-repo
    result: passed
    notes: "vitest run infrastructure/fs/task-doc-repo，1 文件 22 用例全通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 10 文件 320 用例全通过（新增 22 项，原 298 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-011（Infra 任务/结果/审查文档仓储）已完成：src/infrastructure/fs/task-doc-repo.ts 提供 TaskDocRepository（readTask/writeTask/readResult/writeResult/readReview/writeReview/listTasks），读取即用 core Schema 做 Zod 校验、写入即分离 frontmatter 与正文，22 项集成单测（临时目录）。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层推进：frontmatter 解析器 + 任务文档仓储就绪。TaskDocRepository（同步文件系统读写）统一任务 / .result.md / .review.md 三类文档入口——读取即 Zod 校验（文件不存在 / frontmatter 缺失 / 校验失败均抛带路径的 Error，不静默），写入即 frontmatter-parser 分离 frontmatter 与正文（仅更新 frontmatter 时保留正文，§12）；writeTask 仅更新已存在任务文件（不越界生成 slug），writeResult/writeReview 可新建（文件名按 §6 从任务文件 slug 派生），listTasks 只返回 TASK-XXX-*.md 的 id（排除 result/review，按数值排序）。frontmatter 解析 / 序列化以纯字符串工具提供。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析以纯函数提供（详见各条目）。工具链 npm run typecheck / npm test（320 项）/ npm run lint 全绿。仍无 CLI 命令、其余 infra（全局文档仓储、SQLite、git worktree、sdk）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/infrastructure/fs/task-doc-repo.ts 建立：依赖 node:fs/node:path 内置模块 + core 的 TaskFrontmatterSchema / ResultFrontmatterSchema / ReviewFrontmatterSchema（经 ../../core/index.js 聚合导出复用）+ 同层 frontmatter-parser（./frontmatter-parser.js），零反向依赖（不依赖 application / cli，不实现状态流转，不生成 slug——属 CLI task-create 职责）。沿用「同步 I/O + 纯辅助函数 + Result 抛错」模式：readAndValidate 用约束泛型 <S extends z.ZodTypeAny> + z.infer<S> 让返回类型由具体 schema 派生（绕开 z.ZodType<T> 会把 T 绑到 input 含 .default 可选字段的推断歧义，详见 DEC-008）；resolveTaskPath/resolveResultPath/resolveReviewPath 用 startsWith(id+'-')+endsWith 判定（无正则注入风险，多匹配抛歧义错、零匹配抛未找到）；writeTask/writeResult/writeWrite 走「resolve 路径 → body ?? readBodyIfExists → serializeDocument → writeFileSync」统一管线（body 未传则保留正文，§8/§12）；listTasks 用 /^(TASK-\\d+)-.+\\.md$/ 提取 id（先排除 .result.md/.review.md 后缀），按数字部分数值排序（鲁棒于补零）。noUncheckedIndexedAccess 下数组索引（matches[0]/matched[1]）显式 undefined 守卫。src/infrastructure/index.ts 经 ./fs/task-doc-repo.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "任务文档仓储复用要点（TASK-011）：TaskDocRepository(tasksDir) 构造传入 docs/tasks 路径（便于临时目录集成测试）。readTask/readResult/readReview 返回 Zod 校验后的 frontmatter（TaskFrontmatter/ResultFrontmatter/ReviewFrontmatter），文件不存在/缺 frontmatter/校验失败均抛 Error（不静默，上层须 try/catch）。writeTask(task, body?) 仅更新已存在任务文件——任务文件不存在抛错（新建任务文件含 slug 命名是 CLI task-create 的职责，仓储不越界）；body 传入整体写入、未传保留现有正文（§12 保留人工维护的 13 节正文）。writeResult(result, body?)/writeReview(review, body?) 可新建：文件名按 §6 从任务文件 slug 派生（先有任务才有结果，taskSlug 经 resolveTaskPath 提取），body 未传则保留现有 result/review 正文（用于 Orchestrator 仅回填 execution_commits）。listTasks() 扫描 docs/tasks 返回 TASK-XXX-*.md 的 id 数组（排除 .result.md/.review.md，按数值升序）。路径解析：同一 id 匹配多个同类文件 → 抛歧义错。技术注记：用 zod schema 作参数做「读取即校验」时，泛型签名须写 <S extends z.ZodTypeAny> + z.infer<S>，勿写 z.ZodType<T>（会把 T 绑到 schema 的 input，因 .default 使 input/output 不同源）——TASK-012 全局文档仓储复用 DecisionSchema/IssueSchema 校验时会遇同样模式。同步 I/O 系本任务选择（与 frontmatter-parser 同步风格一致），若 application 层 ports（TASK-015）定异步接口，需在适配层包 Promise（结构类型兼容，本类无需显式 implements）。写入语义（writeTask 仅更新 / result·review 可新建 / slug 派生）见 DEC-008，待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。TASK-011 无新 issue：仅依赖 node:fs/node:path 内置 + 既有 core/frontmatter-parser，未新增 npm 依赖，未触及 application/cli，无边界冲突。写入语义（writeTask 仅更新不新建、result/review 从任务 slug 派生路径可新建、body 可选保留正文）系 §8「frontmatter 替换 + 正文保留」+ §9「产物落盘」+ §6 文件命名的合理落地（DEC-008 proposed），非规格偏离；readAndValidate 的 zod 泛型签名（z.ZodTypeAny 约束）系类型推断 gotcha 的标准解法，已解决不另记 issue。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本仓储消费 ResultFrontmatterSchema（含 verification.result 字段）但不单独引用 VerificationResultSchema，未触发提升，ISS-004 维持现状不阻塞。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-012：Infra 全局文档仓储（layer: data，depends_on: TASK-004 / TASK-010 均已完成）。基于 frontmatter-parser + core 的 DecisionSchema / IssueSchema，落地 src/infrastructure/fs/global-doc-repo.ts（PROGRESS/DECISIONS/ISSUES 读写 + section 级合并），并复用本任务 readAndValidate 的 zod 泛型模式（<S extends z.ZodTypeAny> + z.infer<S>）。TASK-013（SQLite schema）/ TASK-014（SQLite 索引仓储）亦已解锁（depends_on 已满足）。"
  decisions:
    - id: ""
      title: "TaskDocRepository 写入语义与文件命名派生：writeTask 仅更新、result/review 可新建且从任务 slug 派生路径、body 可选保留正文"
      status: proposed
      scope: "infrastructure/fs"
      decision: "TASK-011 对 §2/§8/§9 未明文的写入语义与文件命名作如下解释并落地：（1）writeTask(task, body?) 仅更新「已存在」任务文件的 frontmatter——任务文件不存在即抛错；新建任务文件含 slug 命名（docs/tasks/TASK-XXX-<slug>.md 的 <slug>）是 CLI task-create（TASK-024）的命名决策，仓储不越界生成 slug（AGENTS.md §4 不提前实现后续任务逻辑）。（2）writeResult(result, body?)/writeReview(review, body?) 可新建——文件名按 §6 从任务文件 slug 派生（resolveSidecarPath：先扫现有 <id>-*<suffix>，唯一则复用、多个抛歧义、无则从任务文件 taskSlug 派生 <id>-<slug><suffix>），依据是 §6 文档树显式 result/review 与任务文件共用同一 slug，且「先有任务才有结果/审查」。（3）body 参数可选：传入则整体写入（frontmatter + body），未传则保留现有正文（readBodyIfExists，文件不存在返回空串），落地 §8「只更新 frontmatter 时做 frontmatter 替换 + 正文保留」、§12「避免抹掉人工维护的正文」——覆盖 Orchestrator 仅回填 execution_commits 的场景。（4）读取即 Zod 校验：readAndValidate 对文件不存在/缺 frontmatter/Zod 校验失败均抛带文件路径的 Error（不静默）。（5）listTasks 用 /^(TASK-\\d+)-.+\\.md$/ 提取 id（先排除 .result.md/.review.md），按数字部分数值排序（鲁棒于补零与否）。（6）readAndValidate 泛型签名用 <S extends z.ZodTypeAny> + z.infer<S>，不用 z.ZodType<T>（zod .default 使 schema 的 input/output 不同源——input 可选、output 必填——z.ZodType<T> 会把 T 绑到 input，导致 readTask 返回类型含可选字段、与 TaskFrontmatter 不兼容）。"
      rationale: "§8 明文「写入保留正文，只更新 frontmatter 时做 frontmatter 替换 + 正文保留」指向 writeTask 是「更新」语义；§9 明文「writeResult/writeReview 是 Executor/Reviewer 的产物落盘」指向可新建。二者职责不对称源于：任务文件命名需 slug 决策（CLI 职责），而 result/review 文件名可从任务文件 slug 派生（§6 三者共用 slug，无新决策）。body 可选保留正文是 §8/§12 的直接落地，也服务 Orchestrator 合并阶段仅改 frontmatter 的真实流程（§3.2 回填 execution_commits）。读取即校验 + 抛错不静默遵循 AGENTS.md「非法状态抛错、不静默」。zod 泛型用 ZodTypeAny 约束是 TS 推断 gotcha 的标准解法——zod 的 ZodType<Output, Def, Input> 三参数中，z.ZodType<T> 令 Def/Input 默认=Output=T，传入带 .default 的 ZodObject 时 T 被推断成 input（含可选字段），与 output 类型不兼容；ZodTypeAny 是 zod 自身导出的「任意 ZodType」别名（不含字面 any token，过 eslint no-explicit-any），配合 z.infer<S> 准确取 Output。同步 I/O（readFileSync/writeFileSync/readdirSync）与 frontmatter-parser 同步风格一致，CLI 场景可接受，测试简单；application 层 ports 若定异步接口，结构类型兼容、适配层包 Promise 即可。"
      consequences: "TASK-012 全局文档仓储复用本模式：读取即校验用 <S extends z.ZodTypeAny> + z.infer<S>（DecisionSchema/IssueSchema 校验同模式）；section 级合并需在 body 层面操作（parseDocument 拆 frontmatter+body → 改 body section → serializeDocument 回写，正文保留靠 readBodyIfExists）。CLI task-create（TASK-024）负责新建任务文件时命名 <slug>（title kebab 化等），仓储 writeTask 只更新不新建——若 Orchestrator 认为仓储应支持新建任务文件，需扩权并定义 slug 生成规则（届时改 writeTask + resolveTaskPath 新建分支 + DEC-008）。application 层（TASK-015 ports / TASK-017 编排）调用本仓储时：readXxx 须 try/catch 将 Error 转为业务结果（如「文档非法」转人工），writeXxx 写入失败（权限/磁盘）让 fs 错误冒泡或上层包装。若认为 result/review 文件名不应依赖任务文件 slug（如允许独立命名），改 resolveSidecarPath 的派生分支（当前从 taskSlug 派生）。同步 I/O 若需改异步，方法签名加 async/Promise，调用方相应调整。"
      created_from_task: TASK-011
  issues: []
next_action: review
---

# TASK-011 执行结果

## 1. 执行结论

任务完成。在 `src/infrastructure/fs/task-doc-repo.ts` 落地 `TaskDocRepository`：以同步文件系统读写统一任务文件 / `.result.md` / `.review.md` 三类文档入口——**读取即用 core Schema 做 Zod 校验**（`readTask`/`readResult`/`readReview`），**写入即用 frontmatter-parser 分离 frontmatter 与正文**（`writeTask`/`writeResult`/`writeWrite`），并提供 `listTasks()` 列举任务 id。`src/infrastructure/index.ts` 经 `./fs/task-doc-repo.js` 再导出。`test/infrastructure/fs/task-doc-repo.test.ts` 22 项集成用例（临时目录）覆盖 round-trip、正文保留、非法 frontmatter 抛错、listTasks 过滤排序、路径歧义。typecheck / test / lint 三项全绿，全量回归 320 项不受影响。

## 2. 完成内容

- `task-doc-repo.ts`：
  - `TaskDocRepository(tasksDir)` —— 构造传入 tasks 目录（`docs/tasks/`），所有路径在其下解析，便于临时目录集成测试。
  - `readTask(id): TaskFrontmatter` / `readResult(id): ResultFrontmatter` / `readReview(id): ReviewFrontmatter` —— 读取并 Zod 校验 frontmatter；文件不存在 / frontmatter 缺失 / 校验失败均抛带路径的 Error。
  - `writeTask(task, body?): void` —— 更新已存在任务文件（不存在抛错，不越界新建含 slug 的任务文件）；`body` 传入整体写入、未传保留现有正文。
  - `writeResult(result, body?): void` / `writeReview(review, body?): void` —— 产物落盘，可新建（文件名按 §6 从任务文件 slug 派生）；`body` 未传则保留现有正文。
  - `listTasks(): TaskId[]` —— 扫描返回 `TASK-XXX-*.md` 的 id（排除 `.result.md`/`.review.md`），按数值升序。
  - 内部辅助：`readAndValidate<S extends z.ZodTypeAny>(path, schema): z.infer<S>`（读取+校验+抛错）、`readBodyIfExists`（保留正文）、`resolveTaskPath`/`resolveResultPath`/`resolveReviewPath`（路径解析，多匹配抛歧义）、`taskSlug`/`deriveSidecarPath`（slug 派生）；模块级 `readdirSafe`（不存在目录返回 `[]`）、`byTaskNumber`/`numericPart`（数值排序）。
- 单测 22 项：任务文档（读取校验 / write round-trip / 未传 body 保留正文 / 传 body 替换正文 / 文件不存在抛错 / writeTask 不存在抛错 / 缺 frontmatter 抛错 / 缺必填字段抛错 / 枚举非法抛错）、执行结果（新建 round-trip / 文件名按 slug 派生 / 未传 body 保留正文 / 非法抛错 / 不存在抛错）、审查结论（新建 round-trip / 未传 body 保留正文）、listTasks（只返回 .md id / 数值排序 / 空目录 / 目录不存在）、路径歧义（多任务文件 / 多 result 文件）。

## 3. 修改文件

- `src/infrastructure/index.ts` —— 在 `./fs/frontmatter-parser.js` 导出后追加 `export * from './fs/task-doc-repo.js'`，注释「TASK-011：任务 / 结果 / 审查文档仓储」对齐。

## 4. 新增文件

- `src/infrastructure/fs/task-doc-repo.ts` —— 任务 / 结果 / 审查文档仓储（§6 / §9 / §10 / §15 文档协议的文件系统适配层）。
- `test/infrastructure/fs/task-doc-repo.test.ts` —— 读写 / 校验 / listTasks / 歧义集成测试（22 用例，临时目录）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-008）：`writeTask` 仅更新已存在文件（不越界生成 slug，新建任务文件属 CLI task-create）；`writeResult`/`writeReview` 可新建（文件名按 §6 从任务文件 slug 派生）；`body` 可选（未传保留正文，§8/§12）；读取即 Zod 校验抛错不静默；`listTasks` 按数值排序排除 result/review；`readAndValidate` 泛型用 `<S extends z.ZodTypeAny>` + `z.infer<S>`（不用 `z.ZodType<T>`，因 zod `.default` 使 input/output 不同源，后者会把 T 绑到 input 含可选字段）。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 7 个方法全部落地；§11 验收的「写入后读回 round-trip 通过」「非法 frontmatter 读取抛错」「listTasks 只返回 TASK-*.md 排除 result/review」「临时目录集成测试通过」「typecheck 0 错误」均有用例覆盖；§12 风险点「仅更新 frontmatter 时保留正文」以 `writeTask` 不传 body 保留正文 + 专项用例（未传 body 保留正文 / 传 body 替换正文 / writeResult·writeReview 保留正文）显式保障。写入语义与文件命名派生见 DEC-008，系 §2/§8/§9/§6 的合理落地而非规格偏离，不另开 issue。

## 8. 后续任务注意事项

- `readTask`/`readResult`/`readReview` 的 `id` 参数是 `TaskId`（= `string` 别名，形如 `TASK-011`）；仓储按 `<id>-` 前缀 + 后缀扫描定位文件，不假设 slug 内容。
- `writeTask` 不新建任务文件：CLI `task-create`（TASK-024）负责命名 `<slug>` 并首次写入；仓储仅服务「更新已存在任务 frontmatter」。
- `writeResult`/`writeReview` 新建时依赖任务文件先存在（`taskSlug` 经 `resolveTaskPath` 提取）——若无任务文件会抛「未找到任务文件」（合理：先有任务才有结果）。
- 读取校验失败抛普通 `Error`（非 ZodError），消息含文件路径 + zod 错误摘要；上层（application/cli）须 try/catch 转业务结果。
- 同步 I/O：本仓储全同步（`readFileSync`/`writeFileSync`/`readdirSync`）；application 层 ports 若定异步接口，适配层包 `Promise` 即可（结构类型兼容，本类无需 `implements`）。
- `readAndValidate` 的泛型签名是 zod + TS 推断的关键约束：`<S extends z.ZodTypeAny>` + `z.infer<S>`；TASK-012 全局文档仓储用 `DecisionSchema`/`IssueSchema` 校验时复用同模式，勿写 `z.ZodType<T>`。

## 9. 未解决问题

无新 issue。本任务边界清晰：仅依赖 `node:fs`/`node:path` 内置 + 既有 core/frontmatter-parser，未新增 npm 依赖，未触及 `application`/`cli`，无边界冲突。§12 正文保留风险点以 `readBodyIfExists` + 未传 body 保留正文专项用例显式覆盖。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不阻塞本任务——仓储消费 `ResultFrontmatterSchema`（其内嵌 `verification.result` 字段经 `ResultVerificationSchema` 校验）但不单独引用 `VerificationResultSchema`，未触发提升，ISS-004 维持 open。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- infrastructure/fs/task-doc-repo` | passed | vitest 1 文件 22 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 10 文件 320 用例全通过（含新增 22 项） |

## 11. 人工验收建议

- 复核 round-trip（§11）：`writeResult(result, body)` 新建 → `readResult(id)` frontmatter 深度相等 + 正文相等；`writeTask` 更新 frontmatter 后 `readTask` 读回一致。
- 复核正文保留（§12）：`writeTask(updatedTask)` 不传 body → 文件正文原样保留（读取原始文件验证 `endsWith(TASK_BODY)`）；`writeResult` 仅改 frontmatter（回填 execution_commits）→ 正文保留。
- 复核非法 frontmatter 抛错：缺必填字段（缺 `layer` 等）/ 枚举非法值（`layer: 'not-a-layer'`）/ 缺 frontmatter（纯 Markdown）读取均抛错。
- 复核 `listTasks`（§11）：混合 `.md`/`.result.md`/`.review.md` 只返回 `.md` 的 id；按数值排序（`TASK-2 < TASK-10`）；空目录 / 目录不存在返回 `[]`。
- 复核路径歧义：同一 id 多个任务文件 / 多个 `.result.md` → 抛歧义错。
- 复核 `writeTask` 不越界新建（文件不存在抛错，slug 命名归 CLI）。
- 确认 DEC-008 写入语义与文件命名派生是否符合 §2/§8/§9/§6。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：TaskDocRepository 写入语义与文件命名派生）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
