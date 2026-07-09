---
task_id: TASK-023
execution_status: completed
modified_files:
  - package.json
  - src/cli/index.ts
created_files:
  - src/cli/framework.ts
  - src/cli/commands/init.ts
  - test/cli/init.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- cli/init
    result: passed
    notes: "9 项 e2e 单测全过（scaffoldProject 文档生成/§6.1 约束/幂等不覆盖/非目录抛错/不越界写文件 5 + runCli 退出码约定 init 成功/幂等/--help/未知命令 4）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误（src + test）"
  - command: npm test
    result: passed
    notes: "全量 537 项无回归（原 528 + cli/init 9），Node 22（ABI 127）下 SQLite 原生模块正常"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-023（CLI 框架与 init 命令）已完成：`src/cli/framework.ts` 提供 `runCli(argv): Promise<number>`（命令入口 + 退出码约定 + 错误输出格式）+ `createProgram()`（commander program 工厂：exitOverride 把 --help/用法错误转可捕获 CommanderError，未知命令交回 commander 默认报错，空 argv 显式 outputHelp）+ `CliExitCode`（Success=0 / GeneralError=1）；`src/cli/commands/init.ts` 提供 `scaffoldProject(targetDir)`（在目标目录幂等生成 §6 文档体系骨架：AGENTS.md + docs/{SPEC,ARCHITECTURE,PLAN,PROGRESS,DECISIONS,ISSUES,TESTING}.md + docs/tasks/.gitkeep，模板内嵌、已存在不覆盖、父目录随写建立）+ `registerInitCommand(program)`（commander 子命令 `init [targetDir]`，默认 cwd）+ `DOC_FILES`（文件清单单一来源）；`src/cli/index.ts` 为 bin 入口（runCli → process.exit）；package.json 追加 `bin.caw → ./dist/cli/index.js`。9 项 e2e 单测（临时目录）。CLI 层自此开启。"
    - section: "当前系统可用能力"
      mode: append
      content: "- CLI 框架与 init 命令：`framework.ts`（`src/cli/framework.ts`）是 CLI 交互入口与命令注册骨架，commander 驱动。`runCli(argv)`（argv 已剥离 node/脚本名）解析参数、执行命令、返回退出码（不自行 process.exit，bin 与测试共用）：commander 的 --help/--version/用法错误经 `exitOverride((err) => { throw err })` 转 `CommanderError`，runCli 透传其 exitCode（help/version 内容已写 stdout 不重复输出、其余用法错误输出 message 到 stderr）；命令业务错误（如 init 目标非目录）统一 `GeneralError=1`，带 `error:` 前缀输出 stderr。`createProgram()` 注册全部子命令（当前 init），program 不设默认 action（避免吞未知命令），空 argv 由 runCli 显式 `outputHelp`。`init` 命令（`src/cli/commands/init.ts`）的 `scaffoldProject(targetDir)` 在目标目录幂等生成 §6 全部文档骨架（模板内嵌于 DOC_FILES 单一来源，含 §6.1 AGENTS 通用约束项 + §6.2-6.8 各文档章节占位），已存在文件不覆盖（返回 created/skipped 清单），docs/ 与 docs/tasks/ 随文件写入由 mkdirSync recursive 建立；`registerInitCommand` 以 `init [targetDir]`（默认 cwd）注册，stdout 输出新建/跳过清单。纯模板写盘，零领域依赖（不 import core/application/infrastructure）。bin 入口 `caw → ./dist/cli/index.js`（package.json），需 build 产出 dist 后作为全局命令运行。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/cli/framework.ts` 建立：值 import commander 的 `Command`/`CommanderError` + 值 import `./commands/init.js` 的 `registerInitCommand`，零反向依赖（不 import core/application/infrastructure，TASK-023 §6 init 只写模板；commander 已在 package.json）。沿用「命令入口 + 退出码约定 + 错误输出格式」模式：`CliExitCode` 枚举（Success=0 / GeneralError=1）；`exitOverride((err) => throw err)` 取代 commander 默认 process.exit，使退出意图可控可测；不设 program 默认 action（否则未知命令被默认 action 吞），空 argv 在 runCli 显式 outputHelp、未知命令交 commander 默认报错。`src/cli/commands/init.ts` 建立：值 import commander `Command` + node:fs/node:path 内置 + 零领域依赖，沿用「模板常量 + 纯 I/O 函数 + Result 抛错」模式：`DOC_FILES`（readonly ScaffoldFile[]）为文件清单单一来源，`scaffoldProject` 幂等（existsSync 跳过 / writeFileSync 新建，父目录 mkdirSync recursive），`ensureProjectRoot` 目标非目录抛错不静默。模板内容为目标项目通用骨架（§6.1-6.8 章节占位，非本项目自身 AGENTS 副本，§12 风险点）。`src/cli/index.ts` 改为 bin 入口（runCli().then(process.exit)）。`noUncheckedIndexedAccess` 下 for...of 遍历 readonly 数组安全。package.json 追加 `bin.caw`（仅 bin + 命令名，不动 scripts/dependencies）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- CLI 框架与 init 命令复用要点（TASK-023）：`runCli(argv)`（`src/cli/framework.ts`）是 CLI 主入口，返回退出码（不 process.exit），bin（`src/cli/index.ts`）与测试共用——后续 CLI 命令测试经 `runCli([...])` 断言退出码、经对应命令模块的纯函数断言产物。新命令注册：在 `src/cli/commands/<name>.ts` 导出 `register<Name>Command(program)`，于 `createProgram()` 追加调用（保持 createProgram 为命令注册单一入口）。退出码约定（DEC-020）：0 成功（含 commander --help/version 正常退出 + init 幂等跳过）、1 业务错误（命令执行抛错统一 GeneralError）、commander 用法错误（未知命令/参数错误）经 exitOverride 透传其 exitCode（commander 默认 1）；错误输出统一 stderr，业务错误带 `error:` 前缀。命令名 `caw`（package.json bin + program.name 一致，DEC-020）。init 生成的是**目标项目**骨架（通用模板），勿与本项目自身文档混淆（§12）；模板内嵌于 `DOC_FILES` 单一来源，改模板改 DOC_FILES。init 零领域依赖——后续 CLI 命令需领域逻辑时经 application ports + composition root wiring 注入（TASK-025+），不在 init 模式内混入。bin 需 `npm run build` 产出 dist/cli/index.js 后方作为 `caw` 全局命令运行（验收不含 build）。详见 DEC-020（proposed），待 Orchestrator 确认。"
    - section: "建议下一个任务"
      mode: replace
      content: "- TASK-025：CLI status + rebuild-index 命令（layer: `page`，depends_on TASK-014 ✅）。落地 `src/cli/commands/status.ts` + `rebuild-index.ts`，在已就位的 CLI 框架（TASK-023 `createProgram`/`runCli`，命令经 `register<Name>Command(program)` 注册）上接入 SQLite 索引仓储（TASK-014 IndexRepository）与文档仓储。是编号最小、前置完成的未完成任务（TASK-024 依赖 TASK-029 仍阻塞）。CLI 框架（TASK-023）已就位，application 合并三联画（TASK-019/020/021）+ SDK 适配器（TASK-022）齐备。其余已解锁任务：TASK-026（CLI task:run，前置含 TASK-022 ✅）/ TASK-027（CLI task:review）/ TASK-028（MCP 适配骨架）/ TASK-029（App 规划工作流）亦可推进。"
  decisions:
    - id: ""
      title: "CLI 命令名 caw + commander exitOverride 透传退出码 + 业务错误统一 GeneralError=1 + init 幂等不覆盖 + init 零领域依赖"
      status: proposed
      scope: cli
      created_from_task: TASK-023
      decision: "TASK-023 对 Readme §3.1（CLI 为第一阶段主入口）/ §6 文档体系 / §6.1 AGENTS / 任务 §2 §8 §11 §12 未明文的 CLI 框架与 init 设计作如下解释并落地：（1）命令名——package.json name 为 `coding-agent-workflow`，bin 与 `program.name()` 统一取短名 `caw`（命令调用 `caw init <dir>` 等），bin 指向编译产物 `./dist/cli/index.js`。（2）退出码约定——`CliExitCode`：Success=0（成功，含 commander --help/--version 正常退出、init 全新建、init 幂等跳过）、GeneralError=1（命令业务执行错误）；commander 用法错误（未知命令 / 参数缺失 / 非法参数）经 `exitOverride((err) => { throw err })` 转 `CommanderError`，runCli 透传其 `exitCode`（commander 默认 1），不另行分类。（3）exitOverride 取代 commander 默认 process.exit——commander 默认在 --help/用法错误时 `process.exit`，会直接终止测试进程且无法由调用方控制退出码；改 `exitOverride` 把退出意图抛成可捕获的 CommanderError，runCli 统一管控退出码、且使 `runCli` 可被单元测试断言退出码（不真退进程）。（4）program 不设默认 action——commander 在 program 同时拥有子命令与自身 action 时，会把未匹配子命令的 token 当作默认 action 的参数吞掉（实测未知命令返回 0），故不设 program 默认 action；空 argv 的帮助展示由 runCli 显式 `program.outputHelp()` 处理（outputHelp 只写 stdout、不触发 exit），未知命令交回 commander 默认报错（返回非零）。（5）init 幂等——已存在的目标文件一律 `existsSync` 跳过不覆盖（含用户已修改的文件），返回 `{created, skipped, projectRoot}`；全新与全部跳过均返回 Success=0（幂等是预期行为，非错误）。（6）init 零领域依赖——init 只写模板文件，不 import core/application/infrastructure（任务 §6 硬约束），模板内嵌于 `DOC_FILES` 常量单一来源，内容为目标项目通用骨架（§6.1-6.8 章节占位），非本项目自身 AGENTS 副本（§12 风险点）。沿用「命令入口 + 退出码约定 + 错误输出格式 + 模板常量 + 纯 I/O 函数 + Result 抛错」模式。"
      rationale: "命令名 caw：package.json name 全名过长不便命令行输入，短名 caw（coding-agent-workflow 首字母）简洁且 bin 与 program.name 一一对应避免分裂；后续 CLI 任务（TASK-024-027）统一用 `caw <command>`。退出码约定：任务 §8「0 成功、非 0 失败，细分码在 framework 约定」要求 framework 固化退出码；commander 自身已有成熟的退出码语义（--help/version=0、用法错误=1），透传其 exitCode 比另行发明一套更一致、更少惊喜；业务错误统一 1 而非细分多码——本阶段无需求区分「目标非目录 / 权限不足 / I/O 错误」等子类，细分码属过度设计（AGENTS 不制造隐式状态），失败信息经 stderr message 区分即可，未来确需细分再扩 CliExitCode。exitOverride：runCli 返回退出码而非 process.exit 是为了让 bin（src/cli/index.ts）与单元测试共用同一入口——测试断言 `await runCli([...])` 的返回值，无需 spawn 子进程跑 dist（dist 需 build 且慢、且 Windows 路径 / 退出码采集复杂），e2e 测试直接在进程内跑 commander 更快更可靠（AGENTS §5 CLI e2e 在临时目录验证）。不设默认 action：实测 commander v12 在 program 有 action 时吞未知命令返回 0，与「未知命令应非零退出」的预期矛盾，去掉 action + runCli 拦截空 argv 是最小修复（不引入额外配置）。init 幂等：任务 §11「重复执行不覆盖既有文件」是硬性验收，existsSync 跳过是标准做法；幂等跳过返回 0 而非非零——重跑 init 是合法的「补全缺失文件」操作，非错误（§8 幂等语义）。零领域依赖：任务 §6 明文 init 不碰 core/application/infrastructure，且 init 生成目标项目骨架与本项目领域无关，引入领域依赖会制造 cli→core 的不必要耦合（ARCHITECTURE §3 允许 cli→application→core，但 init 不需要），保持 init 为纯模板生成器使职责单一、可独立测试。模板内嵌单一来源 DOC_FILES：避免模板内容散落，改一处即可。"
      consequences: "后续 CLI 任务（TASK-024-027）沿用本约定：（a）命令名统一 `caw`，新命令在 `src/cli/commands/<name>.ts` 导出 `register<Name>Command(program)`，于 `createProgram()` 追加调用（createProgram 为命令注册单一入口）。（b）退出码：业务错误抛错由 runCli 统一 catch 返回 GeneralError=1，命令内只需正常抛错（如状态校验失败 / 文档不存在），不需自行 process.exit；用法错误透传 commander exitCode；测试经 `runCli([...])` 断言退出码 + 经命令模块纯函数断言产物。（c）需要领域逻辑的 CLI 命令（status/rebuild-index/task:run/task:review）经 application ports + composition root wiring 注入 infra（TASK-025+），不在 init 模式内混入——init 保持零依赖。（d）bin 需 `npm run build` 产出 dist/cli/index.js 后方作为 `caw` 全局命令运行（本任务验收不含 build，bin 字段先注册；测试不依赖 bin、直接调 runCli）。若 Orchestrator 认为：(1) 命令名应取全名 `coding-agent-workflow` 或其他——改 bin + program.name 一处即可，影响小；(2) 应细分更多退出码（如目标非目录=2、I/O 错误=3）——扩 CliExitCode 枚举 + 命令抛带码的自定义错误，本任务保持最小集；(3) init 应注入 SPEC/ARCHITECTURE 具体内容——任务 §7 明文「不强制注入，只生成空骨架，内容由用户/Orchestrator 填」，故保持占位；(4) 模板内容应更丰富——可在 DOC_FILES 调整，但需与 §6 各文档「应包含」清单对齐。本任务 9 项 e2e 单测覆盖：文档生成 / §6.1 约束关键词 / 幂等不覆盖（含篡改后不覆盖）/ 目标非目录抛错 / 不越界写文件 / runCli 成功 / 幂等成功 / --help 成功 / 未知命令非零。"
  issues: []
next_action: review
---

# TASK-023 执行结果

## 1. 执行结论

任务完成。落地 CLI 框架（commander）与 `init` 命令：

- `src/cli/framework.ts`：`runCli(argv): Promise<number>`（命令入口 + 退出码约定 + 错误输出格式）+ `createProgram()`（commander program 工厂）+ `CliExitCode`（Success=0 / GeneralError=1）。
- `src/cli/commands/init.ts`：`scaffoldProject(targetDir)`（幂等生成 §6 文档体系骨架）+ `registerInitCommand(program)`（`init [targetDir]`）+ `DOC_FILES`（文件清单单一来源）。
- `src/cli/index.ts`：bin 入口（runCli → process.exit）。
- `package.json`：追加 `bin.caw → ./dist/cli/index.js`（仅 bin + 命令名）。
- `test/cli/init.test.ts`：9 项 e2e 单测。

实现中修正一处：最初给 program 设 `.action(outputHelp)`，导致 commander 把「未知命令」当作默认 action 的参数吞掉、返回 0；改为不设 program 默认 action + runCli 显式拦截空 argv 输出帮助、未知命令交回 commander 默认报错（返回非零）。修正后 9 项全绿。

## 2. 完成内容

- CLI 命令入口骨架（commander 驱动，命令注册 / 退出码 / 错误输出统一）。
- `init` 命令：目标目录生成 §6 全部文档（AGENTS.md + docs/{SPEC,ARCHITECTURE,PLAN,PROGRESS,DECISIONS,ISSUES,TESTING}.md + docs/tasks/.gitkeep），模板内嵌、幂等不覆盖。

## 3. 修改文件

- `package.json`：追加 `bin.caw` 字段（不动 scripts/dependencies）。
- `src/cli/index.ts`：由 `export {}` 占位改为 bin 入口（runCli → process.exit）。

## 4. 新增文件

- `src/cli/framework.ts`：CLI 框架层（runCli / createProgram / CliExitCode）。
- `src/cli/commands/init.ts`：init 命令（scaffoldProject / registerInitCommand / DOC_FILES）。
- `test/cli/init.test.ts`：9 项 e2e 单测（临时目录）。

## 5. 删除文件

无。

## 6. 架构决策

见 `global_update_requests.decisions` 提议的 DEC-020：CLI 命令名 `caw` + commander exitOverride 透传退出码 + 业务错误统一 GeneralError=1 + init 幂等不覆盖 + init 零领域依赖。

## 7. 偏离计划

无偏离。实现中修正「program 默认 action 吞未知命令」一处属框架正确性修正，非规格偏离，已记入 DEC-020 rationale。

## 8. 后续任务注意事项

- 后续 CLI 命令（TASK-024-027）在 `src/cli/commands/<name>.ts` 导出 `register<Name>Command(program)`，于 `createProgram()` 追加注册。
- 命令名统一 `caw`；退出码约定见 DEC-020。
- 需领域逻辑的 CLI 命令经 application ports + composition root wiring 注入 infra（TASK-025+），init 保持零依赖。
- bin 需 `npm run build` 产出 dist/cli/index.js 后方作为全局 `caw` 命令运行（本任务验收不含 build；测试直接调 `runCli`，不经 bin）。

## 9. 未解决问题

本任务无新增 issue。`forbidden_paths`（src/core、src/application、src/infrastructure）守住，init 零领域依赖。未新增 npm 依赖（commander 已在 package.json）。

## 10. 验证结果

- `npm run typecheck`：通过（0 错误）。
- `npm test -- cli/init`：通过（9 项 e2e 单测）。
- `npm run lint`：通过（eslint 0 错误）。
- `npm test`（全量）：通过（537 项，原 528 + cli/init 9，无回归）。

## 11. 人工验收建议

可在临时目录手动验证 init 产物与幂等性，例如：

```bash
npm run build && npx caw init /tmp/proj && ls -R /tmp/proj
```

（`npx caw init` 需 build 产出 dist；或在 Node 中 `import { scaffoldProject } from './src/cli/commands/init.js'` 直接调用。）

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（4 处 append + 1 处 replace）、decisions（DEC-020 proposed）、issues（无）。本步执行后已直接回写 PROGRESS / DECISIONS / ARCHITECTURE §7。
