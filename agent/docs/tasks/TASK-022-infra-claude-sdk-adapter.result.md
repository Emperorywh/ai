---
task_id: TASK-022
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sdk/executor-contract.ts
  - src/infrastructure/sdk/claude-sdk-adapter.ts
  - test/infrastructure/sdk/claude-sdk-adapter.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- infrastructure/sdk
    result: passed
    notes: "14 项测试全过（buildStartupPrompt 占位替换 2 / DryRunLocalExecutor 5 / ClaudeSdkExecutor 7）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test
    result: passed
    notes: "全量 528 项无回归（原 514 + sdk 14）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-022（Infra Claude Agent SDK 适配器）已完成：`src/infrastructure/sdk/executor-contract.ts` 定义 `TaskExecutor` 契约（输入 ExecuteInput = task_id / worktree_path / result_file / context_pack / permission_boundary / startup_prompt，输出 ExecuteOutcome = result_file + execution_status）+ `ExecutorPermissionBoundary`（§16 TASK-009 解析结果：allowed/forbidden/permissions/verification_commands）+ `buildStartupPrompt`（§18 模板占位替换纯函数）+ `ExecutorError`；`src/infrastructure/sdk/claude-sdk-adapter.ts` 实现两执行器——`DryRunLocalExecutor`（SDK 未就位兜底，不调用模型，产出占位 .result.md：completed + 验证命令全 skipped + global_update_requests 三空 + next_action=review，过 ResultFrontmatterSchema）+ `ClaudeSdkExecutor`（注入式 SDK 编排骨架：构造接收 `ClaudeSdkInvocation | null`，非 null 时调 run 取 SdkRunReport 组装 .result.md，null 时抛 `ExecutorNotConfiguredError` 不伪造调用）。`ClaudeSdkInvocation` / `SdkRunInput` / `SdkRunReport` 为接口隔离的注入句柄（编排层与 SDK 具体 API 解耦）。14 项单测。SDK 未安装 / API 未确认（R1），以「接口 + DryRun + 注入骨架」交付，不引入 npm 依赖、不伪造 SDK 调用（ISS-012 / DEC-019）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- Task Executor 契约 + Claude Agent SDK 适配器：`executor-contract.ts`（`src/infrastructure/sdk/executor-contract.ts`）定义执行引擎适配层与调用方（cli task:run / task:review）的稳定契约，仅被 cli 依赖、不经 application（ARCHITECTURE §4）。`TaskExecutor.execute(ExecuteInput): Promise<ExecuteOutcome>` 为单一执行入口；`ExecuteInput` = { task_id, worktree_path, result_file, context_pack, permission_boundary, startup_prompt }（§9 数据流：Context Pack + 权限 → Executor → .result.md）；`ExecutorPermissionBoundary` = { allowed_paths, forbidden_paths, permissions, verification_commands }（cli 启动前用 TASK-009 resolvePathScope 检测重叠 + computeVerificationAllowlist 产出验证 allowlist 后注入）；`buildStartupPrompt({taskId, taskFile, resultFile})` 把 §18 模板占位（docs/tasks/TASK-XXX-xxx.md / .result.md）替换为实际值（模板文本唯一来源 §18，不在他处复制）；`ExecutorError` 为执行错误基类。`claude-sdk-adapter.ts`（`src/infrastructure/sdk/claude-sdk-adapter.ts`）实现契约两执行器：`DryRunLocalExecutor`（name='dry-run-local'）不调用模型 / 不执行验证命令，产出占位 .result.md 供前置阶段（状态流转 / 合并 / 全局文档回写）联调，verification 按验证 allowlist 占位 skipped、保持输入顺序，过 ResultFrontmatterSchema 可被 TaskDocRepository.readResult 读取；`ClaudeSdkExecutor`（name='claude-sdk'）构造接收 `ClaudeSdkInvocation | null`——null 时 execute 抛 `ExecutorNotConfiguredError`（extends ExecutorError，不伪造 SDK 调用），非 null 时调 `invocation.run(SdkRunInput)` 取 `SdkRunReport` 组装 ResultFrontmatter（execution_commits 留空待 Orchestrator 回填）经 `persistResult`（safeParse 校验 + serializeDocument + 写盘）落盘。`ClaudeSdkInvocation`（{ name, run(SdkRunInput): Promise<SdkRunReport> }）为接口隔离注入句柄——把「依赖具体 SDK API 的调用 + 输出解析」隔离于此接口实现，编排层只经抽象消费 SDK，core/application 不感知 SDK 类型；`SdkRunReport`（executionStatus / 三类文件清单 / verification / globalUpdateRequests / nextAction / summary）对齐 §10 frontmatter 机器字段。两执行器共用模块级 `persistResult`（校验 + 序列化 + 写盘）。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/infrastructure/sdk/executor-contract.ts` 建立：仅 type-only import core 的 `ContextPack`/`ExecutionStatus`/`Permission`/`TaskId`/`VerificationCommand`（经 `../../core/index.js` 聚合），零运行时依赖、零反向依赖（不依赖 application/cli；不 import 具体 Claude Agent SDK——SDK API 未确认 ISS-012 / DEC-019）。沿用「契约接口 + 纯函数 + Result 错误」模式：`TaskExecutor` 单方法 execute（异步，SDK 调用为异步，DryRun 同步完成但统一 Promise）；`buildStartupPrompt` 以 `STARTUP_PROMPT_TEMPLATE` 常量承载 §18 原文（仅两处占位 .md / .result.md），replace 先长串（.result.md）后短串（.md）避免误伤；`ExecutorError` extends Error。ARCHITECTURE §4 定位：本契约仅被 cli 依赖、不经 application，core/application 不 import 本文件（SDK 适配属 cli composition root 职责）。`src/infrastructure/sdk/claude-sdk-adapter.ts` 建立：值 import core 的 `ResultFrontmatterSchema`（运行时校验产物合法性）+ type-only import core 的 `ContextPack`/`ExecutionStatus`/`GlobalUpdateRequests`/`NextAction`/`ResultFrontmatter`/`ResultVerification` + 值 import 同层 `../fs/frontmatter-parser.js` 的 `serializeDocument`（复用 .result.md 序列化，DEC-007 round-trip 一致）+ 值 import `./executor-contract.js` 的契约类型与 `ExecutorError`，零反向依赖（不 import application/cli；不 import 具体 SDK）。沿用「类 + 注入式句柄 + 共享 persistResult」模式：`DryRunLocalExecutor` / `ClaudeSdkExecutor` 各 implements `TaskExecutor`，构造显式字段赋值（避免 parameter property），模块级 `persistResult`（safeParse 失败抛 ExecutorError 不静默 + mkdirSync 父目录 + writeFileSync）+ `dryRunBody` / `sdkBody` 正文生成器被两执行器复用避免重复。`ClaudeSdkInvocation` 接口隔离 SDK（注入式，DEC-019）：编排层组装 SdkRunInput、落 SdkRunReport，SDK 真实 API 映射封装在 invocation 实现内（待 SDK 就位 ISS-012）。`noUncheckedIndexedAccess` 下 report 只读数组用 `[...spread]` 转 mutable 赋 frontmatter。`src/infrastructure/index.ts` 追加 `./sdk/executor-contract.js` + `./sdk/claude-sdk-adapter.js` 再导出（NodeNext 需 `.js` 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- Task Executor 契约 + SDK 适配器复用要点（TASK-022）：`TaskExecutor` 契约（`src/infrastructure/sdk/executor-contract.ts`）是 cli task:run / task:review 调用执行引擎的唯一入口，仅被 cli 依赖（ARCHITECTURE §4，application 不感知）。cli 在 worktree 创建（TASK-018 WorktreeAdapter）+ Context Pack 计算（TASK-015 computeContextPack）+ 权限解析（TASK-009 resolvePathScope 检测重叠拒绝启动 + computeVerificationAllowlist）+ §18 启动提示组装（buildStartupPrompt）后，构造 `ExecuteInput` 调 `executor.execute(input)`。`DryRunLocalExecutor`：SDK 未就位兜底，产出占位 .result.md（completed + 验证 skipped + 全局更新空 + review），供前置链路（TASK-017 状态流转 / TASK-019 合并 / TASK-020 回写）在无模型环境联调。`ClaudeSdkExecutor`：构造注入 `ClaudeSdkInvocation`（SDK 就位时由 cli composition root 提供），未注入抛 `ExecutorNotConfiguredError`（不伪造）。`ClaudeSdkInvocation.run(SdkRunInput)` 返回 `SdkRunReport`——句柄负责「调用模型 + 把输出解析为可落 .result.md 的报告」（依赖 SDK 真实 API），编排层据此组装 ResultFrontmatter。关键：当前 SDK 未安装（package.json 无 @anthropic-ai/claude-agent-sdk）、API 未确认（R1，ISS-012），故无真实 invocation 实现；待 SDK 选型确认后由专门任务实现真实 ClaudeSdkInvocation 并注入 ClaudeSdkExecutor。`ExecutorPermissionBoundary` 由 cli 用 TASK-009 解析结果组装（已过 resolvePathScope 无重叠）。`buildStartupPrompt({taskId, taskFile, resultFile})` 替换 §18 模板占位，taskFile / resultFile 从 frontmatter 派生（result_file 去 .result.md 加 .md 得任务文件，DEC-012）。execution_commits 始终留空（Orchestrator 在 rebase 后 / ff 前回填，§3.2）。不引入 npm 依赖（红线）、不伪造 SDK 调用（§7）、不承载工作流领域逻辑（§3.1，状态映射 / 编排 / 合并 / 回写归 core/application）。详见 DEC-019（proposed）+ ISS-012（medium，open），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-012（medium，open）新增自 TASK-022：Claude Agent SDK 未安装、API 未确认（Readme §12 R1「SDK API 未确认是本计划最高风险」）。package.json 无 `@anthropic-ai/claude-agent-sdk`、node_modules 无该包；红线禁止新增 npm 依赖（确需新增须停下入 .result.md 提议）。故 TASK-022 以「接口 + DryRun + 注入骨架」交付：`ClaudeSdkInvocation` 无真实实现，`ClaudeSdkExecutor` 需 SDK 就位（安装 SDK + 确认版本 / 子 agent 派发 / Context Pack 注入方式 / 权限与 hooks 注入点 + 提供 invocation 实现）才能调用模型，当前未注入时 execute 抛 `ExecutorNotConfiguredError` 不伪造。不阻塞验收（§11 允许「确认 + 接口 + DryRun」收尾、§12 R1 允许 DryRun 交付），DryRunLocalExecutor 已支撑前置链路联调。待 Orchestrator 裁定 SDK 选型后，由专门任务实现真实 ClaudeSdkInvocation（含 SDK 版本 / 注入方式决策，DEC-019）。详见 ISS-012 / DEC-019。"
    - section: "建议下一个任务"
      mode: replace
      content: "- TASK-023：CLI 框架与 init 命令（layer: `page`，depends_on 仅 TASK-001 ✅）。落地 `src/cli/framework.ts` + `commands/init.ts`，建立 CLI 命令入口骨架（commander）与项目初始化命令。是编号最小、前置完成的未完成任务，可优先推进。SDK 适配器（TASK-022）已就位，application 合并三联画（TASK-019/020/021）齐备。其余已解锁任务：TASK-025（CLI status + rebuild-index，depends_on TASK-014 ✅）/ TASK-026（CLI task:run，前置含 TASK-022 现 ✅）/ TASK-027（CLI task:review）/ TASK-028（MCP 适配骨架）/ TASK-029（App 规划工作流）亦可推进；TASK-024（plan + task:create）依赖 TASK-029 仍阻塞。"
  decisions:
    - id: ""
      title: "Claude Agent SDK 适配器设计——接口隔离 + 注入式 SDK 句柄 + DryRun 兜底 + 不引入 SDK 依赖 + 被 cli 依赖不经 application"
      status: proposed
      scope: infrastructure/sdk
      created_from_task: TASK-022
      decision: "TASK-022 对 Readme §3.1（SDK 为执行引擎适配层）/ §5.2（Task Executor）/ §12 R1（SDK API 未确认）/ 任务 §1 §2 §7 §8 §11 §12 未明文的 SDK 适配设计作如下解释并落地：（1）接口隔离——`executor-contract.ts` 定义与具体 SDK 无关的 `TaskExecutor` 契约（execute(ExecuteInput): Promise<ExecuteOutcome>），core/application 不 import 本文件（ARCHITECTURE §4：executor-contract 仅被 cli 依赖、不经 application，不构成反向依赖），SDK 类型不外泄到 core/application。（2）注入式 SDK 句柄 `ClaudeSdkInvocation`——编排层（ClaudeSdkExecutor）与「依赖具体 SDK API 的调用 + 输出解析」解耦：句柄 `run(SdkRunInput): Promise<SdkRunReport>` 负责调用模型并把输出解析为可落 .result.md 的 SdkRunReport，编排层只组装入参 / 落盘报告，不猜测 SDK 具体 API。这把 R1「SDK API 未确认」的未知面收敛到单个可替换的注入点，SDK 就位时只需提供 invocation 实现并注入 ClaudeSdkExecutor。（3）DryRun 兜底——`DryRunLocalExecutor` 在 SDK 未就位时产出占位 .result.md（completed + 验证 skipped + 全局更新空 + review，过 ResultFrontmatterSchema），供 cli / application 前置链路（状态流转 / 合并 / 回写）无模型联调，§11「确认 + 接口 + DryRun 收尾」的直接落地。（4）不引入 SDK 依赖（红线）——package.json 无 @anthropic-ai/claude-agent-sdk、AGENTS / 任务红线禁新增 npm 依赖，故不 import 具体 SDK；ClaudeSdkExecutor 构造接收 `ClaudeSdkInvocation | null`，null 时 execute 抛 `ExecutorNotConfiguredError`，**不伪造 SDK 调用**（§7 明文「若 SDK API 无法在本次确认，落 ISSUES 并以 DryRun 交付，不得伪造 SDK 调用」）。（5）被 cli 依赖不经 application——契约 + 两执行器均属 cli composition root 职责，application 经 ports 访问 infra（TaskDocRepositoryPort 等读 .result.md），不感知执行引擎；cli task:run 在 worktree 创建 + Context Pack 计算 + 权限解析 + §18 提示组装后构造 ExecuteInput 调 execute。（6）权限注入用 TASK-009 解析结果——`ExecutorPermissionBoundary`（allowed/forbidden/permissions/verification_commands）由 cli 用 resolvePathScope（启动前检测重叠拒绝启动）+ computeVerificationAllowlist 产出后注入，Executor 不二次解析 frontmatter。沿用「契约接口 + 纯函数 + 注入式句柄 + 共享 persistResult」模式。"
      rationale: "接口隔离（§1 / §8 / ARCHITECTURE §4）：core 不依赖 SDK 是硬约束，把 SDK 适配放 infrastructure/sdk 并以契约接口暴露，使 application / cli 的上层逻辑不绑定具体 SDK，SDK 可替换（未来可换其他模型 / 本地模型）。注入式句柄：R1「SDK API 未确认」是本计划最高风险——与其在编排层硬编码 SDK 调用（一旦 API 变动需改编排 + 重测全链路），不如把「调用 + 解析」隔离为 ClaudeSdkInvocation 注入点，编排层只做稳定的「组装入参 / 落盘报告」，二者独立演进、独立测试（编排用 fake invocation 测）。DryRun 兜底：§11 明文允许「确认 + 接口 + DryRun 收尾」，前置任务（合并 / 回写 / 状态流转）需要 .result.md 产物驱动联调，DryRun 提供无需模型的合法产物，避免前置链路被 SDK 阻塞。不引入依赖：AGENTS / 任务红线禁新增 npm 依赖，且 SDK API 未确认时引入依赖是赌博（版本 / 接口都可能变），故以「红线 + 风险」双重理由不引入；ExecutorNotConfiguredError 使「SDK 未就位」成为显式失败而非静默 fallback（§4 不保留隐式 fallback）。不伪造：§7 明文，伪造 SDK 调用会产出虚假 .result.md 污染下游状态流转 / 合并，违反「不静默」「状态显式可追踪」。被 cli 依赖不经 application：保持 application 经 ports 访问 infra 的纯净边界，SDK 适配是「如何执行」的 infra / cli 细节，application 只关心「执行后读 .result.md」的文档协议。权限用 TASK-009 解析结果：单一来源——路径重叠 / 验证 allowlist 已在 core 解析，Executor 消费解析后边界快照不重复实现。"
      consequences: "SDK 就位后（待 Orchestrator 裁定选型）：由专门任务实现真实 `ClaudeSdkInvocation`（含 SDK 版本 / 子 agent 派发 / Context Pack 注入方式 / 权限与 hooks 注入点的确认，落 DECISIONS），cli composition root（TASK-025/026）构造该 invocation 注入 ClaudeSdkExecutor。`SdkRunReport` 的精确形态（如何把模型输出映射为 executionStatus / 文件清单 / verification / globalUpdateRequests / nextAction）依赖 SDK 真实 API，待 SDK 就位时确认——若 SDK 输出形态与当前 SdkRunReport 差异大，可能需调整 SdkRunReport 字段或加 invocation 内转换层（不破坏 TaskExecutor 契约，只影响 ClaudeSdkInvocation 实现）。DryRunLocalExecutor 长期保留：作为本地联调 / 测试夹具（前置任务测试可用 DryRun 产 .result.md 驱动），不随 SDK 就位移除。cli task:run（TASK-026）wiring：选 DryRun 或 ClaudeSdkExecutor 由 CLI 参数 / 配置决定（如 `--dry-run` 或无 SDK 时默认 DryRun + 告警）。若 Orchestrator 认为：(a) 应在本任务引入 SDK 依赖——需先扩权（改 package.json 非本任务 allowed，红线，不推荐）；(b) ClaudeSdkExecutor 应在编排层直接调 SDK（去 invocation 注入）——失去接口隔离与可测性，SDK API 变动需重测全链路（不推荐）；(c) DryRun 应执行验证命令而非全 skipped——偏离「占位」语义，引入 shell exec + 权限校验复杂度，且验证命令执行更适合放 cli 编排层（task:run 在 Executor 返回后跑验证记录到 .result.md，待 TASK-026 确认）。execution_commits 始终留空（Orchestrator 回填，§3.2），两执行器一致。新增 TaskExecutor 实现时须保证 execute 返回时 .result.md 已落盘且过 Schema（persistResult 守卫）。"
  issues:
    - id: ""
      title: "Claude Agent SDK 未安装 / API 未确认（R1）——ClaudeSdkInvocation 无真实实现，ClaudeSdkExecutor 需 SDK 就位才能调用模型"
      status: open
      severity: medium
      scope: infrastructure/sdk
      created_from_task: TASK-022
      owner: ""
      recommended_action: "Readme §3.1 把 Claude Agent SDK 列为执行引擎适配层、§12 R1 明文「SDK API 未确认是本计划最高风险」、任务 §1 §2 要求「先确认 SDK 版本与接口，再以接口隔离方式实现」。但本仓库 package.json 无 `@anthropic-ai/claude-agent-sdk`、node_modules 无该包；AGENTS / 任务红线禁止新增 npm 依赖（确需新增须停下提议，不改 package.json）。故 TASK-022 无法在本任务安装 / 确认 SDK，以「接口 + DryRun + 注入骨架」交付：`ClaudeSdkInvocation` 为接口隔离的注入句柄但无真实实现，`ClaudeSdkExecutor` 构造注入 null 时 execute 抛 `ExecutorNotConfiguredError`（不伪造调用）；`DryRunLocalExecutor` 提供占位 .result.md 供前置链路联调。不阻塞验收（§11 允许 DryRun 交付、§12 R1 允许接口 + DryRun 收尾），但 TASK-026 task:run 真正调用模型前必须解决。建议（待 Orchestrator 裁定）：(A) 单独立一个 SDK 选型任务——确认 Claude Agent SDK 版本（当前最新 `@anthropic-ai/claude-agent-sdk`）、子 agent 派发方式、Context Pack 注入方式（system prompt / 文件注入 / tool use）、权限与 hooks 注入点，落 DECISIONS，并扩权新增依赖后实现真实 ClaudeSdkInvocation（推荐，符合「先确认再实现」）；(B) 暂以 DryRun 跑通全链路，SDK 接入延后到 CLI 全部就位后统一接入；(C) 若确认使用其他执行引擎（如直接 Claude API / 本地模型），改 ClaudeSdkInvocation 适配（契约不变）。本任务的 ClaudeSdkExecutor 编排逻辑 + DryRun + 契约均经测试（14 项），SDK 就位时只需补 invocation 实现。详见 DEC-019。"
next_action: review
---

# TASK-022 执行结果

## 1. 执行结论

任务完成。确认 Claude Agent SDK 当前**未安装且 API 未确认**（Readme §12 R1 最高风险），按任务 §11 / §12 允许的「确认 + 接口 + DryRun」收尾：

- `executor-contract.ts` 定义与 SDK 无关的 `TaskExecutor` 契约（输入 Context Pack + 权限边界 + §18 启动提示，输出 .result.md 路径与执行状态），仅被 cli 依赖、不经 application（ARCHITECTURE §4）。
- `DryRunLocalExecutor` 产出占位 .result.md（过 `ResultFrontmatterSchema`），供前置链路无模型联调。
- `ClaudeSdkExecutor` 以注入式 `ClaudeSdkInvocation` 句柄骨架交付——SDK 未注入时 `execute()` 抛 `ExecutorNotConfiguredError`，**不伪造 SDK 调用**（§7）。

不引入 npm 依赖（红线），SDK 未决项落 ISS-012 / DEC-019。14 项单测全绿，typecheck / lint 0 错误，全量 528 项无回归。

## 2. 完成内容

- 新建 `src/infrastructure/sdk/executor-contract.ts`（契约层）：
  - `TaskExecutor` 接口（`execute(input): Promise<ExecuteOutcome>`，含 `name`）。
  - `ExecuteInput`（task_id / worktree_path / result_file / context_pack / permission_boundary / startup_prompt）。
  - `ExecuteOutcome`（result_file + execution_status）。
  - `ExecutorPermissionBoundary`（allowed_paths / forbidden_paths / permissions / verification_commands——§16 TASK-009 解析结果）。
  - `buildStartupPrompt({taskId, taskFile, resultFile})`——§18 模板占位替换纯函数。
  - `ExecutorError` 执行错误基类。
- 新建 `src/infrastructure/sdk/claude-sdk-adapter.ts`（适配层）：
  - `DryRunLocalExecutor`（implements TaskExecutor，name='dry-run-local'）：不调用模型，产出占位 .result.md（completed + 验证命令全 skipped + global_update_requests 三空 + next_action=review）。
  - `ClaudeSdkExecutor`（implements TaskExecutor，name='claude-sdk'）：构造接收 `ClaudeSdkInvocation | null`；null 抛 `ExecutorNotConfiguredError`，非 null 调 `invocation.run` 取 `SdkRunReport` 组装 .result.md。
  - `ClaudeSdkInvocation` / `SdkRunInput` / `SdkRunReport`——接口隔离的注入句柄（编排层与 SDK 具体 API 解耦）。
  - `ExecutorNotConfiguredError`（extends ExecutorError）。
  - 模块级共享 `persistResult`（safeParse 校验 + serializeDocument + 写盘）。
- `src/infrastructure/index.ts` 追加两模块再导出。
- 新建 `test/infrastructure/sdk/claude-sdk-adapter.test.ts`（14 项）。

## 3. 修改文件

- `src/infrastructure/index.ts`（追加两行 sdk 导出）

## 4. 新增文件

- `src/infrastructure/sdk/executor-contract.ts`
- `src/infrastructure/sdk/claude-sdk-adapter.ts`
- `test/infrastructure/sdk/claude-sdk-adapter.test.ts`
- `docs/tasks/TASK-022-infra-claude-sdk-adapter.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-019（proposed）：Claude Agent SDK 适配器设计六要点——接口隔离（契约与 SDK 无关）/ 注入式 SDK 句柄 ClaudeSdkInvocation（编排层与 SDK API 解耦）/ DryRun 兜底（SDK 未就位产占位 result）/ 不引入 SDK 依赖（红线，未注入抛错不伪造）/ 被 cli 依赖不经 application（ARCHITECTURE §4）/ 权限注入用 TASK-009 解析结果。详见 frontmatter `global_update_requests.decisions`。

## 7. 偏离计划

无规格偏离。SDK 因未安装 / API 未确认（R1）按 §11 / §12 允许的「确认 + 接口 + DryRun」交付，不强行实现不确定的集成（§12 R1）、不伪造 SDK 调用（§7）、不引入 npm 依赖（红线）。契约与两执行器设计依据 §2（输入 Context Pack + 权限 + §18 提示，输出 .result.md 路径与执行状态）、§8（契约放 infrastructure、权限用 TASK-009 解析结果、启动提示套 §18 模板）、§9（数据流 Context Pack + 权限 → Executor → .result.md）。`ClaudeSdkExecutor` 编排逻辑（入参组装 / 报告落盘）已实现并经 fake invocation 测试覆盖，仅 `ClaudeSdkInvocation` 的真实实现待 SDK 就位（ISS-012）。

## 8. 后续任务注意事项

- **SDK 选型未决**（ISS-012）：当前 `ClaudeSdkInvocation` 无真实实现，`ClaudeSdkExecutor` 需 SDK 就位（安装 + 确认 API + 提供 invocation）才能调用模型。TASK-026 task:run 真正跑模型前必须解决，建议单立 SDK 选型任务（DEC-019 consequence A）。
- **DryRun 长期保留**：作为本地联调 / 测试夹具，前置任务测试可用 DryRun 产 .result.md 驱动，不随 SDK 就位移除。
- **cli task:run wiring**（TASK-026）：选 DryRun 或 ClaudeSdkExecutor 由 CLI 参数 / 配置决定（如 `--dry-run` 或无 SDK 时默认 DryRun + 告警）。
- **verification 执行归属**：DryRun 把验证命令占位 skipped（不执行）；真实验证命令执行更适合放 cli 编排层（task:run 在 Executor 返回后跑验证记录到 .result.md），待 TASK-026 确认（DEC-019 consequence c）。
- **execution_commits 始终留空**：两执行器一致，由 Orchestrator 在 rebase 后 / ff 前回填（§3.2）。
- **SdkRunReport 形态待 SDK 确认**：当前为接口隔离的合理抽象，SDK 就位时若输出形态差异大可调整 report 字段或加 invocation 内转换层（不破坏 TaskExecutor 契约）。

## 9. 未解决问题

- ISS-012（medium，open）：Claude Agent SDK 未安装 / API 未确认（R1），`ClaudeSdkInvocation` 无真实实现，`ClaudeSdkExecutor` 需 SDK 就位才能调用模型。不阻塞验收（§11/§12 允许 DryRun 交付），详见 frontmatter issues / DEC-019。
- 已有 issue（ISS-005 better-sqlite3 / ISS-006 级联张力 / ISS-007 git 身份 / ISS-008 reset 基线跨进程 / ISS-009 docs 多 worktree 路由 / ISS-010 append/replace 混合 / ISS-011 补做回写 append 重复）均与本任务无直接触发：本任务纯 infrastructure 适配（契约 + 两执行器），不依赖 SQLite、不改状态机、不触发级联 / 合并；本机 Node 已为 v22（ISS-005 约束满足），typecheck / test / lint 全绿。

## 10. 验证结果

- `npm run typecheck`：0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）。
- `npm test -- infrastructure/sdk`：14 项全过（buildStartupPrompt 占位替换 2 / DryRunLocalExecutor 5 / ClaudeSdkExecutor 7，含端到端 TaskDocRepository.readResult 读取）。
- `npm run lint`：0 错误。
- `npm test`：全量 528 项全过（原 514 + sdk 14，无回归）。

本任务不依赖 SQLite 原生模块（SDK 适配纯 TypeScript + fs 写盘），typecheck / test / lint 在当前 Node（已为 v22）下全绿。

## 11. 人工验收建议

- 重点检查接口隔离：`executor-contract.ts` 仅 type-only import core 类型，不 import 具体 SDK；core/application 不 import 本文件（ARCHITECTURE §4 边界）。
- 检查 DryRun 产物合法性：`DryRunLocalExecutor` 产出的 .result.md 过 `ResultFrontmatterSchema` 且可被 `TaskDocRepository.readResult` 读取（端到端测试覆盖）。
- 检查「不伪造 SDK 调用」：`ClaudeSdkExecutor(null).execute()` 抛 `ExecutorNotConfiguredError`（非伪造结果）。
- 检查注入式编排：fake invocation 注入时，`ClaudeSdkExecutor` 正确投影 ExecuteInput → SdkRunInput、SdkRunReport → ResultFrontmatter（测试覆盖入参与产物）。
- 检查 §18 模板占位替换：`buildStartupPrompt` 正确替换 .md（两处）与 .result.md（一处）占位，无残留 TASK-XXX-xxx。
- 检查 ISS-012 / DEC-019 的 SDK 未决项表述是否符合预期（是否同意「单立 SDK 选型任务」的后续处理路径）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress 六条 section 更新（完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-023）、DEC-019（proposed）、ISS-012（medium，open）。
