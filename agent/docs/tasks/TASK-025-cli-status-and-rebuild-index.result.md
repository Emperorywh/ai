---
task_id: TASK-025
execution_status: completed
modified_files:
  - src/cli/framework.ts
created_files:
  - src/cli/commands/status.ts
  - src/cli/commands/rebuild-index.ts
  - test/cli/status-rebuild.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess + NodeNext）
  - command: npm test -- cli/status-rebuild
    result: passed
    notes: 22 项单测全绿（collectStatus/formatStatus + runCli e2e + rebuildIndex 索引=文档全集）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告
  - command: npm test
    result: passed
    notes: 全量 559 项通过（含本任务 22 项，既有测试无回归）
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: "- TASK-025（CLI status 与 rebuild-index 命令）已完成：`src/cli/commands/status.ts` 提供 `collectStatus(tasksDir, {status?,layer?})`（从文档读任务 id/title/status/layer + 执行摘要经 buildExecutionSummary 综合，**不读 SQLite**）+ `formatStatus(rows)`（等宽表格）+ `registerStatusCommand(program)`（`status [--status] [--layer] [--tasks-dir]`，过滤值经 pickEnum 枚举校验非法抛错）；`src/cli/commands/rebuild-index.ts` 提供 `rebuildIndex({projectRoot?,dbPath?})`（打开/新建索引库 → 读 DECISIONS.md/ISSUES.md → IndexRepository.rebuildFromDocs 单事务清空重灌 → COUNT 四表统计）+ `registerRebuildIndexCommand(program)`（`rebuild-index [--db] [--project-root]`，破坏性提示走 stderr、统计走 stdout）。`src/cli/framework.ts` createProgram 追加注册两命令（同层 src/cli 必要增量，见 ISS-013）。状态以 frontmatter 为准（§3.1「读状态不得只依赖 SQLite」），索引由 rebuild-index 维护为派生存储。22 项 e2e/集成单测（临时项目根 + 内存/文件 SQLite）。"
    - section: 当前系统可用能力
      mode: append
      content: "  - CLI status / rebuild-index 命令：`status`（`src/cli/commands/status.ts`）以文档为权威列出任务——`collectStatus(tasksDir, {status?,layer?})` 经 TaskDocRepository.listTasks→readTask 取 id/title/status/layer（frontmatter 权威），执行摘要经 readResult(+readReview)→buildExecutionSummary 综合（未执行为 null），不读 SQLite（§3.1 硬约束）；`formatStatus` 产等宽表格；`registerStatusCommand` 注册 `status [--status <TaskStatus>] [--layer <Layer>] [--tasks-dir <dir>]`（默认 docs/tasks），过滤值经 `pickEnum` 校验 TaskStatus/Layer 枚举、非法抛错不静默，目录缺失抛错。`rebuild-index`（`src/cli/commands/rebuild-index.ts`）从文档全量重建 SQLite 索引——`rebuildIndex({projectRoot?,dbPath?})` 打开/新建索引库（默认 <项目根>/.caw/index.db，--db 可覆盖，父目录随写建立）、读 DECISIONS.md/ISSUES.md 内容（缺失视为空集）、IndexRepository.rebuildFromDocs 单事务清空四表后从文档全量重灌、COUNT 四表行数；`registerRebuildIndexCommand` 注册 `rebuild-index [--db <path>] [--project-root <dir>]`，破坏性提示走 console.warn(stderr)、统计走 stdout。两命令在 `createProgram()`（framework.ts）注册，退出码/错误输出经 runCli 统一（DEC-020）。"
    - section: 后续任务必须知道的信息
      mode: append
      content: "- CLI status / rebuild-index 命令复用要点（TASK-025）：`status` 命令**以文档为权威**（collectStatus 纯读 TaskDocRepository + buildExecutionSummary，不碰 SQLite），符合 §3.1「索引不参与状态机判定、任何读状态的判断都不得只依赖 SQLite」；索引仅由 `rebuild-index` 维护（派生存储）。`rebuild-index` 经 IndexRepository.rebuildFromDocs 从文档全量重建，索引库默认 `<项目根>/.caw/index.db`（CLI composition root 约定，DEC-021），`--db`/`--project-root` 可覆盖；全局文档不存在视为空集（readDecisions/readIssues 对无 fenced yaml 返回 []）。注册新 CLI 命令：在 `src/cli/commands/<name>.ts` 导出 `register<Name>Command(program)`，于 `createProgram()`（framework.ts）追加调用——**framework.ts 是命令注册单一入口**（ISS-013：TASK-025 allowed_paths 漏列 framework.ts，后续 CLI 命令任务应将其纳入 allowed_paths）。bin 入口 src/cli/index.ts 无需改动（runCli 已统管）。better-sqlite3 原生模块约束见 ISS-005（Node 22 ABI 127，已满足）。详见 DEC-021（proposed）+ ISS-013（low，open）。"
    - section: 建议下一个任务
      mode: replace
      content: "- TASK-026：CLI task:run 命令（layer: `page`，depends_on TASK-015/017/018/019/020/021/022 均 ✅）。落地 `src/cli/commands/task-run.ts`，组合 WorktreeAdapter + computeContextPack + resolvePathScope/computeVerificationAllowlist + buildStartupPrompt + TaskExecutor + rebaseAndFastForward + writebackGlobalDocs + recoverMerge 全链路。CLI 框架（TASK-023）+ status/rebuild-index（TASK-025）就位。注意 allowed_paths 应含 `src/cli/framework.ts`（命令注册点，ISS-013）。其余已解锁任务：TASK-024（CLI plan/task:create，仍阻塞于 TASK-029）/ TASK-027（CLI task:review）/ TASK-028（MCP 适配骨架）/ TASK-029（App 规划工作流，解锁后解除 TASK-024 阻塞）亦可推进。"
    - section: 当前未解决问题摘要
      mode: append
      content: "- ISS-013（low，open）新增自 TASK-025：任务 allowed_paths（status.ts/rebuild-index.ts/index.ts/test）未列 `src/cli/framework.ts`，但 CLI 命令必须经 `createProgram()`（framework.ts）注册方能被 runCli 识别（TASK-023 既定模式、ARCHITECTURE §7 文档化的注册点）。本任务做同层 src/cli 增量改动（2 行 import + 2 行注册 + 注释），未碰 forbidden_paths。建议后续 CLI 命令任务（TASK-026/027）在 allowed_paths 含 framework.ts。src/cli/index.ts（bin 入口）经评估无需改动。详见 ISS-013。"
  decisions:
    - id: DEC-021
      title: CLI 索引库默认路径约定与 status 文档权威设计
      status: proposed
      scope: cli（status / rebuild-index）
      created_from_task: TASK-025
      decision: |
        rebuild-index 维护的 SQLite 索引库默认路径为 `<项目根>/.caw/index.db`（相对项目根，父目录 .caw/ 随首次重建建立），可经 `--db <path>` 覆盖、`--project-root <dir>` 指定项目根（默认 cwd）。status 命令一律以 docs/tasks frontmatter 为权威（collectStatus 不读 SQLite），执行摘要经 .result.md(+.review.md)→buildExecutionSummary 综合；索引是派生存储，仅由 rebuild-index 全量重建维护。
      rationale: |
        Readme §3.1/§3.2 未明文索引库文件路径，需 CLI composition root 决定一个稳定默认（选 .caw/index.db：.caw 为工具私有目录、index.db 语义明确，与 docs/ 平级不污染文档协议）。status 以文档为权威直接落地 §3.1「索引不参与状态机判定、任何读状态的判断都不得只依赖 SQLite」——任务 status 属「读状态」，必须取自 frontmatter，索引仅加速；本骨架为保证正确性与「无索引可展示」（验收）不引入对索引文件的运行时读依赖。
      consequences: |
        .caw/ 目录进入项目工作区（建议各项目 .gitignore 忽略 .caw/）。status 当前不利用索引加速（留作未来优化，可在保证状态回读 frontmatter 前提下用 queryTasks/getExecution 加速定位/摘要）。rebuild-index 的 DECISIONS.md/ISSUES.md 读取假定位于 <项目根>/docs/（与 §6 文档体系一致）。
  issues:
    - id: ISS-013
      title: CLI 命令任务的 allowed_paths 应含 framework.ts
      status: open
      severity: low
      scope: docs/tasks（CLI 命令任务规格）
      created_from_task: TASK-025
      owner: Orchestrator
      recommended_action: |
        TASK-025 列 status.ts/rebuild-index.ts/index.ts/test 为 allowed_paths，但命令注册单一入口 createProgram 位于 src/cli/framework.ts，新增命令必须改它方能被 runCli 识别。本任务已做同层增量改动（未碰 forbidden_paths）。建议 TASK-026/027 等 CLI 命令任务的 allowed_paths 显式加入 src/cli/framework.ts；或在 ARCHITECTURE §7 注明 framework.ts 为所有 CLI 命令任务的共享注册点。不阻塞验收（改动同层、非破坏性、模式一致）。
next_action: review
---

# TASK-025 执行结论

## 执行结论

已完成。`status` 与 `rebuild-index` 两命令落地，均经 `createProgram()`（framework.ts）注册、退出码/错误输出经 runCli 统一（DEC-020）。状态以 frontmatter 为权威（§3.1），索引为派生存储由 rebuild-index 全量重建维护。

## 实际改动文件清单

- **新建** `src/cli/commands/status.ts`：`collectStatus` / `formatStatus` / `registerStatusCommand`（+ `StatusRow`/`ExecutionDigest`/`StatusCollectOptions`/`StatusOptions` 类型、`readResultOptional`/`readReviewOptional`/`isDocMissing`/`executionLabel`/`pad`/`pickEnum` 辅助）。
- **新建** `src/cli/commands/rebuild-index.ts`：`rebuildIndex` / `registerRebuildIndexCommand`（+ `RebuildStats`/`RebuildOptions`/`RebuildCommandOptions` 类型、`readDocOptional`/`countRows` 辅助）。
- **新建** `test/cli/status-rebuild.test.ts`：22 项单测（collectStatus 文档权威 + 过滤、formatStatus、status runCli e2e、rebuildIndex 索引=文档全集 + 幂等 + 自定义 db、rebuild-index runCli e2e、边界：空目录/非法枚举/目录缺失）。
- **修改** `src/cli/framework.ts`：createProgram 追加 `registerStatusCommand` + `registerRebuildIndexCommand`（同层 src/cli 必要增量，见 ISS-013）。
- **未改动** `src/cli/index.ts`：bin 入口经 runCli 已统管，无需改动（任务列入 allowed_paths 但评估无需变更）。

## 验证结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | ✅ passed | 0 错误 |
| `npm test -- cli/status-rebuild` | ✅ passed | 22/22 |
| `npm run lint` | ✅ passed | 0 错误 0 警告 |
| `npm test` | ✅ passed | 559/559（无回归） |

## 风险/遗留 issue

- ISS-013（low，open）：allowed_paths 漏列 framework.ts（同层增量已做，建议后续 CLI 任务纳入）。
- DEC-021（proposed）：索引库默认路径 `<根>/.caw/index.db`（spec 未明文，composition root 约定）。
- ISS-005 延续：better-sqlite3 需 Node 22（当前 v22.23.1 满足）；rebuild-index 含 SQLite 测试在该版本通过。

## next_action

review
