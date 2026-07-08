---
task_id: TASK-010
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/fs/frontmatter-parser.ts
  - test/infrastructure/fs/frontmatter-parser.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/fs/frontmatter-parser
    result: passed
    notes: "vitest run infrastructure/fs/frontmatter-parser，1 文件 25 用例全通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 9 文件 298 用例全通过（新增 25 项，原 273 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-010（Infra frontmatter 解析器）已完成：src/infrastructure/fs/frontmatter-parser.ts 提供 parseDocument（识别首部 --- 围栏 + YAML 解析 + 正文原样保留）/ serializeDocument（---\\n<yaml>\\n---\\n<body>），CRLF/LF 兼容、round-trip 稳定，25 项单测。自此开启 infrastructure 层。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层起步：frontmatter 解析器就绪。parseDocument(raw) 拆分首部 YAML 围栏与 Markdown 正文（无 frontmatter → frontmatter=null、body=原文；正文内 --- 不被误判；CRLF/LF 兼容；非法 YAML 抛错不静默），serializeDocument(frontmatter, body) 稳定产出 ---\\n<yaml>\\n---\\n<body>，parse ∘ serialize 深度相等；只做结构解析、不绑定 Schema、不做文件 I/O。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析以纯函数提供（详见各条目）。工具链 npm run typecheck / npm test（298 项）/ npm run lint 全绿。仍无 CLI 命令、其余 infra（任务/全局文档仓储、SQLite、git worktree、sdk）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/infrastructure/fs/frontmatter-parser.ts 建立：仅依赖既有 yaml 库（parse / stringify），零反向依赖（不依赖 core / application / cli，任务 §8「不依赖 core」）。沿用「纯字符串工具 + JSDoc 约束」模式：toLines 手写按行扫描保留行尾换行（规避可匹配空串正则的全局匹配怪异，保证 body 精确还原），lineContent 剥离 \\r\\n/\\n 做围栏行比对（CRLF/LF 兼容，§12），parseDocument 只认首部围栏（首行恰为 --- 才视为开围栏，其后第一个 --- 为闭合；开而无闭 → 整篇作 body），serializeDocument 以 null/undefined 表「无 frontmatter」不输出围栏（与解析对称保 round-trip）。noUncheckedIndexedAccess 下数组索引（lines[0]/lines[i]）显式 undefined 守卫。src/infrastructure/index.ts 经 ./fs/frontmatter-parser.js 再导出（NodeNext 需 .js 后缀），infrastructure 层自此开启。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "frontmatter 解析器复用要点（TASK-010）：parseDocument(raw) 返回 {frontmatter, body}——frontmatter 为首部 YAML 解析值（无 frontmatter / 空围栏 / 开而无闭 均为 null），body 为闭合围栏后的正文原文（含原始换行，不裁剪）。只认首部围栏（首行恰为 --- 才算开围栏；正文内 --- 不误判）。CRLF/LF 均支持（body 保留 CRLF）。YAML 非法时 yaml 库抛错（仓储层 TASK-011/012 须 try/catch 后用对应 core Schema 校验 frontmatter）。serializeDocument(frontmatter, body)：null/undefined → 不输出围栏直接返回 body；否则 ---\\n<yaml>\\n---\\n<body>。parse ∘ serialize 深度相等（round-trip 稳定）。TASK-011（任务/结果/审查文档仓储）/ TASK-012（全局文档仓储）应先 parseDocument 拆出 frontmatter → 用 TaskFrontmatterSchema / ResultFrontmatterSchema / ReviewFrontmatterSchema / DecisionSchema / IssueSchema 校验 → 按需修改 body → serializeDocument 回写；frontmatter 为 null 或 Zod 校验失败即视为文档非法。解析边界语义（开而无闭、空围栏→null、CRLF 兼容、非法抛错）见 DEC-007，待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "无新 issue。TASK-010 无新 issue：仅依赖既有 yaml 库，未触及 core/application/cli，未新增依赖，无边界冲突。解析边界语义（只认首部围栏 / 开而无闭→无 frontmatter / 空围栏→null / CRLF 兼容 / 非法 YAML 抛错）系 §9/§10 模板未明文的标准 frontmatter 语义（DEC-007 proposed），非规格偏离。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts，本任务不消费 .result.md，未触发提升，维持现状不阻塞。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-011：Infra 任务/结果/审查文档仓储（layer: data，depends_on: TASK-003 / TASK-005 / TASK-006 / TASK-010 均已完成）。基于本任务 parseDocument / serializeDocument + core 的 TaskFrontmatterSchema / ResultFrontmatterSchema / ReviewFrontmatterSchema，落地 src/infrastructure/fs/task-doc-repo.ts（读 + Zod 校验 + 写）。TASK-012（全局文档仓储，depends_on: TASK-004 / TASK-010 均已完成）亦已解锁，可紧随其后。"
  decisions:
    - id: ""
      title: "frontmatter 解析边界语义：只认首部围栏、开而无闭或空围栏 → frontmatter=null、CRLF/LF 兼容、非法 YAML 抛错不静默"
      status: proposed
      scope: "infrastructure/fs"
      decision: "TASK-010 对 §9/§10 frontmatter 模板未明文的解析边界作如下解释并落地：（1）只认首部围栏——opening fence 必须是文档第一行且内容恰为 ---；其后的正文内出现的 ---（如 Markdown 水平线）不被误判，closing fence 取开围栏之后第一个内容恰为 --- 的行；（2）有开围栏但无闭合围栏（--- 起手但全文无第二个 ---）→ 不报错、整篇作为 body、frontmatter=null（与「无 frontmatter」对称，避免把残缺围栏后的正文当 YAML）；（3）空围栏（---\\n---）→ frontmatter=null；（4）CRLF/LF 兼容——行内容比对统一剥离行尾 \\r\\n / \\n，body 保留原始换行不规范化；（5）围栏内 YAML 语法非法时由 yaml 库抛错，不静默吞错（交上层仓储 catch + Zod 校验）。serializeDocument 以 frontmatter===null/undefined 表「无 frontmatter」，不输出围栏直接返回 body，保证 parse ∘ serialize 深度相等。"
      rationale: "§8「只认首部围栏」与 §11「正文内 --- 不被误判」、§12「CRLF/LF 兼容」是明文要求；但「开而无闭」「空围栏」「非法 YAML」三处未明文。沿用业界 frontmatter 事实标准（gray-matter 约定）：开而无闭不抢正文（更安全，避免把一段以 --- 起手的正文误吞为 YAML）、空围栏等同无内容（null）、非法 YAML 抛错交上层处理（AGENTS.md「非法状态抛错、不静默」）。这几处选择对下游 TASK-011/012 仓储是稳定契约：仓储层据此先 parseDocument 拆结构，再用 core Schema 校验 frontmatter（null 或结构不符由 Zod 拒，天然把「无 frontmatter 的文档」判为非法）。round-trip 稳定性靠 yaml 库 stringify/parse 的互逆性 + serialize 对 null/undefined 的围栏省略对称处理共同保证。"
      consequences: "TASK-011/012 仓储读取流程：parseDocument → frontmatter 为 null 或 Zod 校验失败即判文档非法（throw / 返回错误）；合法则按需改 body 与 frontmatter 后 serializeDocument 回写。若 Orchestrator 认为「开而无闭」应改为抛错（而非整篇作 body），改 parseDocument 的 closeIdx===-1 分支一行（届时同步改测试与 DEC-007）；若认为应规范化 body 换行（CRLF→LF），改 body 拼接处（当前保留原样，与 §「保留正文原样」一致）。新增文档类型（未来 review/task）复用同一解析器，无需另起围栏逻辑。"
      created_from_task: TASK-010
  issues: []
next_action: review
---

# TASK-010 执行结果

## 1. 执行结论

任务完成。在 `src/infrastructure/fs/frontmatter-parser.ts` 落地文档协议的 frontmatter 结构解析 / 序列化：`parseDocument(raw)` 识别首部 `---\n...\n---` 围栏、围栏内 YAML 委托 `yaml` 库解析、围栏后正文原样保留；`serializeDocument(frontmatter, body)` 稳定产出 `---\n<yaml>\n---\n<body>`。`src/infrastructure/index.ts` 经 `./fs/frontmatter-parser.js` 再导出，infrastructure 层自此开启。`test/infrastructure/fs/frontmatter-parser.test.ts` 25 项用例覆盖含/不含 frontmatter 解析、正文内 `---` 不误判、CRLF 兼容、非法 YAML 抛错、serialize 格式与 round-trip 深度相等。typecheck / test / lint 三项验证全绿，全量回归 298 项不受影响。

## 2. 完成内容

- `frontmatter-parser.ts`：
  - `parseDocument(raw): { frontmatter: unknown; body: string }` —— 识别首部围栏：首行内容恰为 `---` 才视为开围栏，其后第一个内容恰为 `---` 的行为闭合围栏；围栏内 YAML 用 `yaml.parse` 解析，闭合围栏后正文原样拼接（含原始换行）。无 frontmatter（空文档 / 首行非 `---` / 开而无闭）/ 空围栏 → `frontmatter: null`、`body: 原文`。YAML 非法 → `yaml` 库抛错不静默。
  - `serializeDocument(frontmatter, body): string` —— `null` / `undefined` 不输出围栏、直接返回 `body`；否则 `---\n<yaml.stringify(frontmatter)>\n---\n<body>`，确保围栏内 YAML 以换行结尾使闭合围栏独占一行。
  - `ParsedDocument` 接口（`{ frontmatter, body }`，readonly）；内部 `toLines`（手写按行扫描保留行尾换行，规避可匹配空串正则的全局匹配怪异）、`lineContent`（剥离 `\r\n` / `\n`，CRLF/LF 兼容）。
- 单测 25 项：含 frontmatter（典型任务 frontmatter round-trip / 列表·布尔·嵌套 / 空围栏→null / 无正文 body 空 / 闭合后无换行）、不含 frontmatter（纯 Markdown / 空文档 / 首行非 --- / 开而无闭）、正文内 --- 不误判（水平线保留 / 水平线起手整篇为 body / frontmatter 后正文以 --- 开头仍属正文）、CRLF（行尾 CRLF 解析 + body 保留 CRLF / 首行 ---\r\n 识别 / CRLF 空围栏）、非法 YAML 抛错（未闭合流式集合）、serialize 格式（结构 / null 不输出围栏 / undefined 同 null）、round-trip 深度相等（典型 / 无尾换行 / 空正文 / null frontmatter / 列表嵌套 / 空对象）。

## 3. 修改文件

- `src/infrastructure/index.ts` —— 将原 `export {}` 替换为 `export * from './fs/frontmatter-parser.js'`，注释「后续任务（TASK-010 起）在此导出」对齐。

## 4. 新增文件

- `src/infrastructure/fs/frontmatter-parser.ts` —— frontmatter 结构解析 / 序列化（§9 / §10 文档协议底层组件）。
- `test/infrastructure/fs/frontmatter-parser.test.ts` —— 解析 / 序列化 / round-trip 单测（25 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：TASK-010 对 §9/§10 frontmatter 模板未明文的解析边界作解释并落地——（1）只认首部围栏（首行恰为 --- 才算开围栏；正文内 --- 不误判；closing 取开围栏后第一个 ---）；（2）开而无闭 → 整篇作 body、frontmatter=null；（3）空围栏 → null；（4）CRLF/LF 兼容（body 保留原始换行）；（5）非法 YAML 抛错不静默；serialize 以 null/undefined 表「无 frontmatter」不输出围栏，保证 round-trip。沿用业界 frontmatter 事实标准（gray-matter 约定）。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 `parseDocument` / `serializeDocument` 全部落地；§11 验收的「含/不含 frontmatter 均正确解析」「round-trip 用例通过」「正文内 --- 不被误判」「typecheck 0 错误」均有用例覆盖；§12 风险点「CRLF/LF 换行差异」以 `lineContent` 剥离行尾比对 + CRLF 专项用例显式保障。五处解析边界语义（只认首部 / 开而无闭 / 空围栏 / CRLF 兼容 / 非法抛错）见 DEC-007，均为标准 frontmatter 语义而非规格偏离，不另开 issue。

## 8. 后续任务注意事项

- `parseDocument` 返回的 `frontmatter` 类型为 `unknown`：TASK-011/012 仓储须用对应 core Schema（`TaskFrontmatterSchema` / `ResultFrontmatterSchema` / `ReviewFrontmatterSchema` / `DecisionSchema` / `IssueSchema`）做 Zod 校验后才能当强类型用；`frontmatter === null` 或校验失败即判文档非法。
- `body` 原样保留（含 CRLF / 前导空行），仓储层回写时若需规范化换行应显式处理，本解析器不裁剪。
- 围栏内 YAML 非法时 `parseDocument` 抛 `YAMLParseError`，仓储层须 try/catch 转为业务错误（如「文档损坏」），不得让其冒泡中断编排。
- `serializeDocument` 的 `frontmatter` 为 `null` / `undefined` 时不输出围栏——仓储层回写时若文档必须有 frontmatter，应确保传入非空对象。
- round-trip 仅保证 `parse(serialize(f, b))` 与 `(f, b)` 深度相等；不保证 `serialize(parse(x))` 与 `x` 字节相等（YAML 序列化风格、围栏省略、原 frontmatter 字面格式可能变化）——仓储层若需原地最小改动，应保留原 body 字符串、仅替换 frontmatter 后整体 serialize。

## 9. 未解决问题

无新 issue。本任务边界清晰：仅依赖既有 `yaml` 库（`parse` / `stringify`），未触及 `core` / `application` / `cli`（任务 §8「不依赖 core」），未新增依赖，无边界冲突。§12 CRLF/LF 风险点以 `lineContent` 行尾剥离 + CRLF 专项用例（行尾 CRLF 解析 + body 保留 CRLF + 首行 `---\r\n` 识别 + CRLF 空围栏）显式覆盖。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不涉及本任务——frontmatter 解析器不消费 `.result.md` 的 `verification.result` 字段，ISS-004 维持 open、不阻塞。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- infrastructure/fs/frontmatter-parser` | passed | vitest 1 文件 25 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 9 文件 298 用例全通过（含新增 25 项） |

## 11. 人工验收建议

- 复核 `parseDocument` 与 §8「只认首部围栏」一致：首行恰为 `---` 才算开围栏；正文内 `---`（水平线）不被误判（用例「正文中的 Markdown 水平线保留」「frontmatter 后正文以 --- 开头仍属正文」）。
- 复核 round-trip：典型任务 frontmatter（含列表 / 嵌套 / 布尔 / 空数组）+ 正文经 serialize → parse 深度相等；正文无尾换行 / 空正文 / null frontmatter 均稳定。
- 复核 CRLF 兼容（§12）：行尾 `\r\n` 的 frontmatter 正确解析、body 保留 CRLF 原样、首行 `---\r\n` 被识别。
- 复核非法 YAML 抛错不静默（未闭合流式集合用例）。
- 复核边界：开而无闭 → 整篇作 body（不抢正文）、空围栏 → frontmatter=null、serialize(null) 不输出围栏。
- 确认 DEC-007 五处解析边界语义（只认首部 / 开而无闭 / 空围栏 / CRLF 兼容 / 非法抛错）是否符合 §9/§10 与业界 frontmatter 惯例。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：frontmatter 解析边界语义）、issues（无）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md`。
