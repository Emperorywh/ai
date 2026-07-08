---
task_id: TASK-012
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/fs/global-doc-repo.ts
  - test/infrastructure/fs/global-doc-repo.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/fs/global-doc-repo
    result: passed
    notes: "vitest run infrastructure/fs/global-doc-repo，1 文件 25 用例全通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 11 文件 345 用例全通过（新增 25 项，原 320 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-012（Infra 全局文档仓储与 section 合并）已完成：src/infrastructure/fs/global-doc-repo.ts 提供 GlobalDocRepository（applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues），以文档正文纯变换实现 PROGRESS section 级合并（replace/append + 缺失视为新建）与 DECISIONS/ISSUES 按 id 去重追加（fenced yaml block），25 项单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层推进：frontmatter 解析器 + 任务文档仓储 + 全局文档仓储就绪。GlobalDocRepository（文档正文纯变换，无文件 I/O）提供全局文档 section 级合并底层操作——applyProgressUpdate(doc, {section,mode,content}) 按 mode(replace 整段替换 / append 末尾拼接) 定位 ##/### section 合并 PROGRESS（缺失 section 两种 mode 均视为新建），appendDecision/appendIssue 按 id 去重追加（命中既有 id 则替换「标题 + fenced yaml block」保留其后 prose，未命中文末追加；空 id 提议态总走追加），readDecisions/readIssues 解析正文 fenced yaml block 经 DecisionSchema/IssueSchema 校验返回数组（跳过非本类 / 损坏块）；frontmatter 经 parseDocument 拆出原样保留、只改正文。TaskDocRepository（同步文件系统读写）统一任务 / .result.md / .review.md 三类文档入口（读取即 Zod 校验、写入即 frontmatter + 正文分离）。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析以纯函数提供（详见各条目）。工具链 npm run typecheck / npm test（345 项）/ npm run lint 全绿。仍无 CLI 命令、其余 infra（SQLite、git worktree、sdk）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/infrastructure/fs/global-doc-repo.ts 建立：依赖 zod + 既有 yaml 库（parse/stringify）+ core 的 DecisionSchema/IssueSchema（经 ../../core/index.js 聚合导出）+ 同层 frontmatter-parser（parseDocument/serializeDocument），零反向依赖（不依赖 application/cli，不做文件 I/O，不实现合并编排——属 application 层 TASK-020；不分配 decision/issue id——属 TASK-020）。沿用「纯变换 + 模块级辅助函数」模式：5 方法均以 doc:string → string 工作，parseDocument 拆 frontmatter+body 后 frontmatter 原样保留、只改 body section/条目，serializeDocument 回写；readEntries 复用 DEC-008 的 <S extends z.ZodTypeAny> + z.infer<S> 泛型让返回元素类型由 schema 派生。section 定位用 matchHeading（#{1,6}+空白+文本，trim 比对）+ findSectionEnd（取下一个 level ≤ 当前的标题，§12 子节不截断父节）；条目定位用 findCodeBlocks（```yaml 围栏扫描）+ findPrecedingSectionHeading（找 yaml 开围栏前最近的 ## 标题）+ findEntrySpan（Schema 校验后按 id 匹配）；renderYamlFence（stringify 去 trailing 换行按行拆）。noUncheckedIndexedAccess 下 lines[i]/matched[1..2] 显式 undefined 守卫。src/infrastructure/index.ts 经 ./fs/global-doc-repo.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "全局文档仓储复用要点（TASK-012）：GlobalDocRepository 5 方法（applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues）均以文档完整内容字符串为输入输出（纯变换，无文件 I/O）——文件读取 / 写回与合并编排（按 depends_on 拓扑序串行、多条 replace 命中同 section 后写者覆盖 + 落 ISSUES）归 application 层 TASK-020，本仓储只提供底层 section/条目合并原语。applyProgressUpdate(doc, {section,mode,content})：mode=replace 整段替换目标 section 内容（标题保留），mode=append 拼接到 section 末尾；section 按 ##/### 标题层级定位（trim 后精确匹配，边界取下一个同级或更高级标题，子节 level 更深不截断父节）；section 不存在时两种 mode 均在文末新建 ## section（§8 缺失视为新建）。appendDecision/appendIssue(doc, item)：按 item.id 去重——命中既有同 id 则替换其「标题 + fenced yaml block」（保留其后人工 prose），未命中（含空 id 提议态）在文末追加 --- + ## <id> <title> + fenced yaml。readDecisions/readIssues(doc)：解析正文全部 ```yaml 围栏块，经 DecisionSchema/IssueSchema 校验返回数组（文档序），不能通过校验的块（非本类条目 / 损坏数据）被跳过——它们无法按 id 匹配，不参与去重（若需严格校验抛错，由 application 层调用前单独校验或扩 strict 变体，见 DEC-009）。frontmatter 经 parseDocument 拆出原样保留、只改正文。decisions/issues 用 fenced YAML block（§6.6/§6.7 接受的三种格式之一，与现有 DECISIONS.md/ISSUES.md 一致），round-trip：read(apply(x)) 含 x。详见 DEC-009（proposed），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。TASK-012 无新 issue：仅依赖既有 zod/yaml + core/frontmatter-parser，未新增 npm 依赖，未触及 application/cli，无边界冲突。section 合并与条目去重的关键解释（纯变换不做文件 I/O / section 标题层级精确匹配 + 子节不截断父节 / 缺失 section 两种 mode 均视为新建 / decisions·issues 用 fenced yaml block 沿用现有文件约定 / readDecisions·readIssues 跳过非本类损坏块 / 新建 section 默认 ##）系 §2/§3.2/§6.5/§6.6/§6.7/§8/§12 的合理落地（DEC-009 proposed），非规格偏离。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本仓储不引用该枚举，未触发提升，ISS-004 维持现状不阻塞。ISS-001/002/003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-013：Infra SQLite schema（layer: data，depends_on: TASK-004 已完成）。基于 core 的 Schema 落地 SQLite 建表 DDL（任务/决策/问题索引表），为 TASK-014 索引仓储铺路。TASK-014（SQLite 索引仓储）亦已解锁（depends_on TASK-013）。application 层 ports（TASK-015）已解锁（depends_on TASK-009/011/012 均已完成）。"
  decisions:
    - id: ""
      title: "GlobalDocRepository section 合并与条目去重的关键解释：纯变换不做文件 I/O、section 按标题层级精确匹配且子节不截断父节、缺失 section 两种 mode 均视为新建、decisions/issues 用 fenced yaml block 沿用现有约定、readDecisions/readIssues 跳过非本类损坏块"
      status: proposed
      scope: "infrastructure/fs"
      decision: "TASK-012 对 §2/§3.2/§6.5/§6.6/§6.7/§8/§12 未明文的合并语义作如下解释并落地：（1）5 方法（applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues）均以文档完整内容（含 frontmatter）字符串为输入、返回合并后的完整文档字符串——纯变换，不做文件 I/O；文件读取/写回与合并编排（按 depends_on 拓扑序串行、多条 replace 命中同 section 后写者覆盖先写者 + 落 ISSUES）归 application 层 TASK-020，本仓储只提供底层 section/条目合并原语（§9「底层操作」）。frontmatter 经 parseDocument 拆出后原样保留、只改正文 section/条目，serializeDocument 回写。（2）section 定位基于 Markdown 标题层级（##/###）：trim 后精确匹配标题文本（大小写敏感，避免近似名误并），section 边界取「下一个同级或更高级标题」（level ≤ 当前 section level），故 ### 子节属于其父 ## section、不截断父节（§12 避免误合并相邻 section）；section 不存在时两种 mode（replace/append）均在文末新建 ## section（§8「缺失 section 视为新建」推及两种 mode，避免 replace 静默 no-op）。（3）decisions/issues 用 fenced YAML block（```yaml ... ```）表达机器字段——§6.6/§6.7 明文接受「YAML frontmatter / fenced YAML block / 统一 YAML 列表」三选一，现有 DECISIONS.md/ISSUES.md 实际用 fenced YAML block（每条 ## DEC-XXX 标题 + fenced yaml + prose，--- 分隔），本仓储沿用之以保证 read(apply(x)) round-trip；appendDecision/appendIssue 按 item.id 去重——命中既有同 id 则替换其「标题 + fenced yaml block」（保留其后人工 prose），未命中（含空 id 提议态）在文末追加 --- + ## <id> <title> + fenced yaml（§11 同 id 再追加 = 更新）。（4）readDecisions/readIssues 解析正文全部 ```yaml 围栏块经 DecisionSchema/IssueSchema 校验返回数组（文档序），不能通过校验的块（非本类条目/损坏数据）被跳过——它们无法按 id 匹配、不参与去重；Schema 字段集不同天然区分 decision 与 issue 块（readDecisions 不误收 issue）。（5）新建 section / 条目标题层级默认 ##（PROGRESS.md 约定）。（6）readEntries 复用 DEC-008 的 <S extends z.ZodTypeAny> + z.infer<S> 泛型让返回元素类型由 schema 派生。"
      rationale: "§2 方法签名 applyProgressUpdate(doc, ...) / appendDecision(doc, ...) 以 doc 为参数 + §9「输入全局文档现状 + 一条 update → 输出合并后文档」明确这是纯变换；文件 I/O 与拓扑序串行回写是 §3.2 明文的 Orchestrator 职责（TASK-020），仓储不越界。frontmatter 原样保留靠 parseDocument/serializeDocument 的 frontmatter/body 分离（TASK-010），只改正文避免误改全局文档元信息。section 标题层级精确匹配 + 子节不截断是 §12「避免误合并相邻 section」的直接落地（### 是 ## 的子节，替换 ## 应含其子节）。缺失 section 两种 mode 均新建：§8 仅明文 append 缺失视为新建，replace 缺失若 no-op 会静默丢弃更新（违反 AGENTS.md「不静默」），故推及 replace 同样新建。fenced YAML block 沿用现有文件：§6.6/§6.7 三选一未指明用哪种，但仓库 DECISIONS.md/ISSUES.md 已用 fenced block，round-trip 要求 read 能解析 apply 的产物，故必须与现有格式一致。readDecisions 跳过非本类块：正文可能含非 decision 的 yaml 块（如 TESTING.md 风格命令声明），Schema 校验是天然过滤器；损坏的 decision 块无法按 id 匹配故跳过不阻塞合并（合并用 readDecisions 查既有 id 去重，损坏块本就匹配不上）——若需严格校验抛错，由 application 层调用前单独校验文档完整性（不在本仓储合并原语内）。"
      consequences: "TASK-020 合并编排调用本仓储：重读全局文档 → 逐条 applyProgressUpdate/appendDecision/appendIssue → 写回；多条 replace 命中同 section 的后写者覆盖 + 落 ISSUES 由 TASK-020 判定（不在本仓储）。application 层 ports（TASK-015）若定 GlobalDocRepositoryPort 含文件 I/O 方法，可在适配层包 fs 读写 + 调本仓储纯变换（结构类型兼容，本类无需 implements）。若 Orchestrator 认为：(a) readDecisions/readIssues 应对损坏块抛错而非跳过——加 strict 变体或改 readEntries 失败分支（届时同步改测试与 DEC-009）；(b) 缺失 section 的 replace 应 no-op 或抛错而非新建——改 applyProgressUpdate 的 createSection 分支（届时同步改测试）；(c) decisions/issues 应改用统一 YAML 列表而非 fenced block——需先迁移现有 DECISIONS.md/ISSUES.md 再改 read/append 格式（届时改 findCodeBlocks/renderYamlFence）；(d) 新建 section 应支持 ### 等深层级——createSection 标题层级需由调用方传入（当前固定 ##）。body 行尾在合并时规范化为 LF（frontmatter 字节级保留，body 按行 split/join）；现有全局文档均为 LF 不受影响，若未来需保 CRLF 需改 toLines/各 join 处。"
      created_from_task: TASK-012
  issues: []
next_action: review
---

# TASK-012 执行结果

## 1. 执行结论

任务完成。在 `src/infrastructure/fs/global-doc-repo.ts` 落地 `GlobalDocRepository`：以**文档正文纯变换**（`doc: string → string`，无文件 I/O）提供全局文档 section 级合并底层操作——`applyProgressUpdate` 按 mode(replace/append) + section 合并 PROGRESS（缺失 section 两种 mode 均视为新建），`appendDecision`/`appendIssue` 按 id 去重追加（命中既有 id 替换标题+yaml 块保留 prose，未命中文末追加），`readDecisions`/`readIssues` 解析 fenced yaml block 经 Schema 校验返回数组。`src/infrastructure/index.ts` 经 `./fs/global-doc-repo.js` 再导出。`test/infrastructure/fs/global-doc-repo.test.ts` 25 项单测覆盖 replace/append/缺失新建/section 匹配健壮性（### 子节不截断）/decisions·issues 去重与 round-trip/read 跳过非本类块。typecheck / test / lint 三项全绿，全量回归 345 项不受影响。

## 2. 完成内容

- `global-doc-repo.ts`：
  - `GlobalDocRepository`（无状态 class，5 个实例方法）——
    - `applyProgressUpdate(doc, update): string` —— 按 `update.mode`(replace 整段替换 / append 末尾拼接) 定位 `##`/`###` section 合并 PROGRESS 正文；section 不存在时两种 mode 均在文末新建。
    - `appendDecision(doc, decision): string` / `appendIssue(doc, issue): string` —— 按 `item.id` 去重：命中既有同 id 替换其「标题 + fenced yaml block」（保留其后人工 prose），未命中（含空 id 提议态）在文末追加 `---` + `## <id> <title>` + fenced yaml。
    - `readDecisions(doc): Decision[]` / `readIssues(doc): Issue[]` —— 解析正文全部 ```` ```yaml ```` 围栏块，经 `DecisionSchema`/`IssueSchema` 校验返回数组（文档序），跳过非本类/损坏块。
  - 内部辅助（私有方法）：`readEntries<S extends z.ZodTypeAny>(doc, schema): z.infer<S>[]`（解析+校验，复用 DEC-008 泛型模式）、`mergeEntry(doc, schema, id, blockLines)`（按 id 去重合并）。
  - 模块级纯函数：`toLines`（按行拆分，CRLF→LF）、`matchHeading`（`#{1,6}`+空白+文本）、`findSection`/`findSectionEnd`（标题精确匹配 + 子节不截断）、`replaceSection`/`appendSection`/`createSection`（三种合并分支）、`findCodeBlocks`（```` ```yaml ```` 围栏扫描）、`findPrecedingSectionHeading`（找 yaml 开围栏前最近的 `##` 标题）、`findEntrySpan`（Schema 校验后按 id 定位条目行范围）、`renderYamlFence`（stringify→按行）、`replaceEntry`/`appendEntryBlock`/`trimTrailingBlanks`。
- 单测 25 项：applyProgressUpdate replace（整段替换 / 不误改他节 / frontmatter 保留 / 多行内容）、append（拼接保留既有 / 落在目标 section 内）、缺失 section（replace 新建 / append 新建）、section 匹配健壮性（trim 空白 / ### 子节随父节替换不误并入相邻节 / append 到含子节父节落在子节后）、appendDecision（新 id 追加 / 同 id 更新保留 prose / 空 id 走追加 / frontmatter 保留 / round-trip）、appendIssue（新 id / 同 id 更新 / round-trip）、readDecisions（全量解析文档序 / 空文档 / 跳过非决策与缺字段块 / 纯正文无 frontmatter 亦可解析）、readIssues（解析 / readDecisions 不误收 issue）。

## 3. 修改文件

- `src/infrastructure/index.ts` —— 在 `./fs/task-doc-repo.js` 导出后追加 `export * from './fs/global-doc-repo.js'`，注释「TASK-012：全局文档（PROGRESS / DECISIONS / ISSUES）仓储与 section 合并」对齐。

## 4. 新增文件

- `src/infrastructure/fs/global-doc-repo.ts` —— 全局文档 section 级合并的纯变换仓储（§3.2 / §6.5 / §6.6 / §6.7）。
- `test/infrastructure/fs/global-doc-repo.test.ts` —— applyProgressUpdate / appendDecision·Issue / readDecisions·Issues 集成测试（25 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-009）：5 方法纯变换不做文件 I/O（文件读写与合并编排归 TASK-020）；section 按 `##`/`###` 标题层级 trim 后精确匹配、边界取同级或更高级标题（子节不截断父节，§12）；缺失 section 两种 mode 均视为新建（§8 推及 replace，避免静默 no-op）；decisions/issues 用 fenced YAML block 沿用现有 DECISIONS.md/ISSUES.md 约定（§6.6/§6.7 三选一）；按 id 去重（同 id 替换标题+yaml 块保留 prose）；readDecisions/readIssues 跳过非本类/损坏 yaml 块（无法按 id 匹配）。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 5 个方法全部落地；§11 验收的「replace/append 对存在/不存在 section 符合 §3.2」「decisions/issues 按 id 去重，同 id 再追加=更新」「round-trip read(apply(x)) 含 x」「typecheck 0 错误」均有用例覆盖；§12 风险点「section 标题匹配规范（trim/层级），避免误合并相邻 section」以 `matchHeading`（trim 比对）+ `findSectionEnd`（子节 level 更深不截断父节）+ 专项用例（### 子节随父节替换、append 到含子节父节落在子节后）显式保障。合并语义与条目去重见 DEC-009，系 §2/§3.2/§6.5/§6.6/§6.7/§8/§12 的合理落地而非规格偏离，不另开 issue。

## 8. 后续任务注意事项

- 本仓储**不做文件 I/O**：5 方法均 `doc: string → string`。文件读取 / 写回与合并编排（拓扑序串行、多条 replace 命中同 section 后写者覆盖 + 落 ISSUES、id 分配）归 application 层 TASK-020。
- `applyProgressUpdate` 的 `update` 参数类型是 core 的 `ProgressUpdateRequest`（`{section, mode, content}`，TASK-005）；`mode` 是 `ProgressMode`（`replace`/`append`）。
- section 定位是**首个**标题文本（trim 后）与 `section` 相等的 section；若文档有同名 section，匹配第一个（同名冲突由 Orchestrator 仲裁，不在本仓储）。
- 新建 section / 条目标题层级固定 `##`（PROGRESS.md 约定）；若需 `###` 等更深层级，`createSection` 标题需由调用方传入（见 DEC-009 后果）。
- `appendDecision`/`appendIssue` 更新既有条目时，**保留 yaml block 之后的人工 prose**（只替换标题 + yaml block）；标题文本随 `item.title` 更新。
- `readDecisions`/`readIssues` **跳过**不能通过 Schema 校验的 yaml 块（非本类条目 / 字段缺失 / 枚举非法）；若需严格校验抛错，由 application 层调用前单独校验文档完整性。
- body 行尾在合并时规范化为 LF（frontmatter 经 parseDocument/serializeDocument 字节级保留）；现有全局文档均为 LF 不受影响。
- 同 `TaskDocRepository`：application 层 ports（TASK-015）若定异步接口，适配层包 Promise 即可（结构类型兼容，本类无需 `implements`）。

## 9. 未解决问题

无新 issue。本任务边界清晰：仅依赖既有 `zod`/`yaml` + core/frontmatter-parser，未新增 npm 依赖，未触及 `application`/`cli`，无边界冲突。§12 section 匹配风险点以标题层级精确匹配 + 子节不截断 + 专项用例显式覆盖。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不阻塞本任务——本仓储不引用该枚举，未触发提升，ISS-004 维持 open。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- infrastructure/fs/global-doc-repo` | passed | vitest 1 文件 25 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 11 文件 345 用例全通过（含新增 25 项） |

## 11. 人工验收建议

- 复核 round-trip（§11）：`readDecisions(appendDecision(doc, d))` 含 `d`；`readIssues(appendIssue(doc, i))` 含 `i`。
- 复核 section 合并（§3.2）：replace 整段替换（旧内容消失、他节保留）；append 拼接到 section 末尾（既有保留、落在目标 section 内下一节之前）。
- 复核缺失 section（§8）：replace / append 不存在 section 均在文末新建 `## <section>`。
- 复核 section 匹配健壮性（§12）：`###` 子节随父 `##` section 一并替换（不误并入相邻 section）；append 到含子节父节落在子节之后、相邻节之前；section 名前后空白被 trim。
- 复核 decisions/issues 去重（§11）：同 id 再追加 = 更新（标题 + yaml 块替换、prose 保留）；空 id 提议态走文末追加。
- 复核 readDecisions/readIssues：解析全部条目（文档序）；跳过非本类 / 缺字段 yaml 块；`readDecisions` 不误收 issue 块。
- 确认 DEC-009 合并语义（纯变换不做文件 I/O / section 标题层级精确匹配 + 子节不截断 / 缺失两种 mode 均新建 / fenced yaml block 沿用现有约定 / 跳过非本类损坏块）是否符合 §2/§3.2/§6.5/§6.6/§6.7/§8/§12。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：GlobalDocRepository section 合并与条目去重关键解释）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
