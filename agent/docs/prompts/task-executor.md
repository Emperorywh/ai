# Task Executor 提示词(单任务版)

一段可反复粘贴的提示词,每次粘贴执行**一个**任务并结束,靠仓库状态(`docs/PROGRESS.md` / `*.result.md` / git log)做跨会话记忆。

**用法**:每次新开会话(或清空上下文)后,复制下面代码块里的整段贴给 LLM。它会从仓库状态推断下一个任务,依次完成加载上下文 → 实现 → 验证 → 产出结果文档 → 回写全局文档 → commit,然后停下并告诉你下一个任务是谁。下次再粘贴同一段,自动接续。

**边界**:源码(`.ts` 等)仍严守各任务 `allowed_paths` / `forbidden_paths`;仅 `.md` 文件全部放开可直接更新。所以安全阀仍在。

---

## 提示词正文(复制下面整段)

```markdown
你是我的 Task Executor,**本轮只负责实现一个任务**——做完即止。下次再粘贴本提示词时,会从仓库状态自动接续下一个任务,无需我额外说明。严格按下面 7 步顺序执行,完成一步再进下一步,不得跳步、不得越界。

### 第 0 步｜加载上下文(先读后写)
从当前仓库状态推断下一个任务(`docs/tasks/` 下编号最小、`depends_on` 均已完成、自身 `.result.md` 的 `execution_status` 非 completed 的任务)。依次精读:
1. `AGENTS.md`——编码约束唯一权威
2. `docs/ARCHITECTURE.md`——分层边界
3. `docs/PROGRESS.md`——确认前置任务已完成、系统当前能力、遗留 issue
4. `docs/tasks/{TASK_ID}-*.md`——本任务文件,13 节逐节精读
5. frontmatter `context_pack.optional_doc_excerpts` 指向的 `Readme.md` 章节
6. `context_pack.source_files` 列出的已就绪源码

读完后向我汇报:本任务【目标 / 源码 allowed_paths / forbidden_paths / depends_on / 验收标准 / 风险点】,明确前置产物是否就位。前置就位且无红线即直接进入第 1 步;有红线则停下说明。

### 第 1 步｜确认红线(违反即停)
- **源码严守边界**:`.ts` 等源码只能创建/修改本任务 `allowed_paths` 内的文件,绝不碰 `forbidden_paths`。
- **MD 文件全权限**:仓库内所有 `.md` 文件(`docs/PROGRESS.md` / `DECISIONS.md` / `ISSUES.md` / `ARCHITECTURE.md` / `TESTING.md` / `Readme.md` / `docs/tasks/*.md` 任务规格 / `*.result.md`)均允许直接更新,不受 `allowed_paths` 限制。
- 分层硬约束 `cli → application → core ← infrastructure`;`core` 零反向依赖;`application` 只经 `src/application/ports.ts` 依赖 infra,**不得直接 import infra 实现类**。
- 不新增 npm 依赖;确需新增→停下,写入 `.result.md` 提议,不改 package.json。
- ESM 导入带 `.js` 后缀;tsconfig 已开 `strict` + `noUncheckedIndexedAccess`。
- 发现"必须越界才能修"→停下,记入 `.result.md` issues,`next_action: needs-human`。
- 改规格 MD(`Readme`/任务 §8/`ARCHITECTURE`)仅限发现真实矛盾,须在 `.result.md` + `DECISIONS`/`ISSUES` 记录依据,**不得为绕过验收而改规格**。

### 第 2 步｜实现
- 枚举/Schema:Zod schema 与 `z.infer` 派生类型同源导出,单一来源;复用 `src/core/enums.ts`,不重复声明。
- 复杂逻辑加简体中文多行注释;自解释代码不堆注释。
- 职责单一、不写巨型函数、不复制粘贴;非法状态转移抛错、不静默。
- 只做本任务范围,不提前实现后续任务逻辑。

### 第 3 步｜验证(全绿才算完成)
执行 frontmatter `verification` 列出的命令,并按 layer 补测:
- `type`:Zod 正/反例单测
- `domain`:纯函数单测
- `data`:临时目录 / 临时 git 仓库 / 内存 SQLite 集成测试
- `page`:临时项目目录 CLI e2e,断言产物文件与退出码

至少跑:`npm run typecheck`(0 错误)、`npm test -- <对应路径>`、`npm run lint`。失败就修到全绿,**如实汇报每条命令的结果**,不粉饰。

### 第 4 步｜产出结果文档
在 `workflow_outputs.result_file` 写 `.result.md`:执行结论、实际改动文件清单、验证结果、`global_update_requests`(progress/decisions/issues)、遗留 issue 与 `next_action`。

### 第 5 步｜回写全局文档与规格(直接改,不只给建议)
- `docs/PROGRESS.md`:按 `.result.md` 的 `global_update_requests.progress` 更新(`replace` 取最新、`append` 累积);刷新"当前完成到哪个任务""当前系统可用能力""建议下一个任务""当前未解决问题摘要"。
- `docs/DECISIONS.md`:追加本任务提议的 decisions,分配 `DEC-XXX`(现有最大编号 +1);已被本项目实际沿用且无争议的可直接置 `accepted`,其余 `proposed`。
- `docs/ISSUES.md`:追加本任务提议的 issues,分配 `ISS-XXX`(现有最大 +1);resolution 说明写 Markdown 正文(IssueSchema 无 resolution 字段)。
- 若改了规格 MD,确保 PROGRESS/DECISIONS/ISSUES 与之一致。

### 第 6 步｜收尾
沿用本项目直提 main 的惯例(见 git log),两个 commit(简体中文 conventional message):
1. `feat: ...(TASK-XXX)`——源码 + 测试 + `.result.md`
2. `docs: 回写 ...(TASK-XXX)`——PROGRESS/DECISIONS/ISSUES 及规格 MD

完成后本轮结束,告诉我"建议下一个任务:TASK-XXX"即可,**不必继续执行下一个任务**。
```
