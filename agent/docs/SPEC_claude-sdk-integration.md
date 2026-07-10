---
spec_id: SPEC_claude-sdk-integration
title: 接入 Claude Agent SDK 作为 Task Executor / Reviewer 执行引擎
source: 用户访谈(2026-07-10) + Readme.md §5.2/§5.3/§8/§10/§15/§16/§18 + 现有 executor-contract.ts / claude-sdk-adapter.ts / task-run.ts / task-review.ts / result-schema.ts / review-schema.ts
status: draft
created: 2026-07-10
owner: Orchestrator
---

# SPEC — 接入 Claude Agent SDK 作为 Task Executor / Reviewer 执行引擎

> 本规格把 `infrastructure/sdk` 的 `ClaudeSdkInvocation` 从「接口骨架」落地为「真实调用
> `@anthropic-ai/claude-agent-sdk` 的执行引擎」,并对称地为 `task:review` 提供一个 SDK 版
> `Reviewer`,使 `task:run` 与 `task:review` 从 DryRun / Local 兜底升级为真实模型自主执行。
> 基于现有 `executor-contract.ts`(TaskExecutor 契约)与 `claude-sdk-adapter.ts`(注入式句柄
> `ClaudeSdkInvocation`)增量实现,**不推翻既有分层、不改动 TaskExecutor / ClaudeSdkInvocation
> 的对外契约**,只新增真实实现 + CLI 注入接线 + 配置/鉴权 + 可观测性。
>
> 权威来源:根目录 `Readme.md` §5.2(Task Executor)/ §5.3(Reviewer)/ §8(Context Pack)/
> §10(.result.md)/ §15(审查)/ §16(权限)/ §18(启动提示)。

---

## 0. 核心设计哲学(贯穿全规格,所有冲突以此为准)

用户在访谈中确立了**一条贯穿性原则**,所有技术决策均服从于它:

> **最大化模型自主性,最小化软件侧约束,信任模型而不是用代码去限制它。**

由此衍生的硬性取向(后文每处决策都回指本节):

- **F1 自主执行**:用 SDK 的自主 agent loop(`query()`),一次调用让模型自驱到完成,不手动驱动 tool-use、不逐步审批。
- **F2 全结构化字段由模型产出**:`.result.md` / `.review.md` 的全部机器字段由模型在任务结束时产出为 JSON,软件侧只做 `safeParse` 校验,不做客观字段推断(如不查 git diff 反推 modified_files)。
- **F3 纯软约束边界**:`forbidden_paths` / `allowed_paths` 仅经 prompt 声明 + 模型自律执行;**不挂 `canUseTool` 拦截、不做 OS 沙箱、不做执行后越界自动检测**。模型若需越界,应自主判断并在 `global_update_requests.issues` 中提出、把 `next_action` 设为 `needs-human`(把 Readme §7 / AGENTS §2 的 needs-human 机制从「软件强制」转为「模型自主报告」)。
- **F4 无硬执行上限**:不设墙钟超时 / 最大轮次 / token 预算硬阈值;靠模型自律判断完成或阻塞,靠 Ctrl+C 兜底中断。
- **F5 软件只做「可见性 + 校验 + 容错」三件事**:既然放弃执行期控制,软件侧的价值集中在——实时流式输出与日志(可见性)、frontmatter Schema 校验与 JSON 重试(校验)、技术故障分类处理(容错)。

**与 AGENTS.md §2 的张力(已知、经用户裁定接受)**:AGENTS 原文「修复需要越过 forbidden_paths……应……不自行越界」是强约束语义。本规格在 F3 下将其实现为「模型自主越界判断 + 自主报告」,不做软件级强制。风险:若模型越界且未自报,系统无手段发现。该风险记入 §15,由 §7 可观测性(完整工具调用日志)作为事后审计兜底,不在执行期阻断。

---

## 1. 背景与现状

| 维度 | 现状 |
|------|------|
| Executor 契约 | `executor-contract.ts` 定义 `TaskExecutor` / `ExecuteInput` / `ExecuteOutcome` / `ExecutorPermissionBoundary` / `buildStartupPrompt`,已与 SDK 无关地稳定 |
| SDK 适配骨架 | `claude-sdk-adapter.ts` 有 `DryRunLocalExecutor`(兜底,不调模型)+ `ClaudeSdkExecutor`(注入式编排骨架)+ `ClaudeSdkInvocation` 接口(**当前无真实实现**) |
| 注入式句柄 | `ClaudeSdkInvocation.run(SdkRunInput) → SdkRunReport`,隔离具体 SDK API;`ClaudeSdkExecutor` 构造接收 `ClaudeSdkInvocation \| null`,null 时抛 `ExecutorNotConfiguredError` |
| task:run 接线 | `task-run.ts:161` `options.executor ?? new DryRunLocalExecutor()`;CLI action(`task-run.ts:689`)未传 executor → 默认 DryRun |
| task:review 接线 | `task-review.ts` 用**独立**的 `Reviewer` 接口(`:107`,非 TaskExecutor);`:200` `options.reviewer ?? new LocalReviewer()`;`LocalReviewer` 确定性产 `approved`(兜底) |
| .result.md Schema | `ResultFrontmatterSchema`(`result-schema.ts:147`):task_id / execution_status(completed\|blocked\|failed)/ modified_files / created_files / deleted_files / execution_commits([]由 Orchestrator 回填)/ verification[] / global_update_requests / next_action |
| .review.md Schema | `ReviewFrontmatterSchema`(`review-schema.ts:48`):task_id / review_result(approved\|rejected\|needs-human-confirmation\|skipped)/ reviewer / reviewed_at / required_changes[] / findings[] |
| 依赖红线 | `package.json` 仅 `better-sqlite3 / commander / yaml / zod`;AGENTS / TASK-001 规定不得临时新增依赖,新增须扩权 |
| node_modules 恢复 | `task-run.ts:442 restoreNodeModules` 已实现(R7):默认 junction 复用主工作区 `node_modules`,声明 `install_dependencies` 时 worktree 内重装 |

本规格的接入 = 在上述骨架上「补真实实现 + 接线 + 配置」,不重写既有链路。

---

## 2. 目标与非目标

### 2.1 目标
1. 新增 `@anthropic-ai/claude-agent-sdk` 真实依赖,实现 `ClaudeSdkInvocation` 的真实实现类(供 `task:run`)。
2. 新增一个 SDK 版 `Reviewer` 实现(供 `task:review`)。
3. CLI 层接线:`task:run` / `task:review` 从配置 + 命令行参数装配 executor / reviewer 并注入。
4. 鉴权(`ANTHROPIC_API_KEY`)+ 模型配置(`caw init` 生成,`--model` 覆盖)。
5. 可观测性:实时流式输出 + 完整日志文件 + cost/usage 摘要。
6. 容错:技术故障分类处理;JSON 产出重试 + 降级。
7. 测试:编排逻辑用 fake invocation 单测;CI 跑真实 API、断言契约不断言文本。

### 2.2 非目标(显式排除)
- ❌ `canUseTool` / 路径白名单等执行期权限拦截(F3)。
- ❌ OS 级沙箱、chroot、只读挂载(F3)。
- ❌ 执行后 git diff 越界自动检测与自动回滚(F3)。
- ❌ 断点续跑 / SDK 会话持久化恢复(F4;崩溃一律按 `restart_on_retry` 从头重来)。
- ❌ 多任务并发编排(`task:run` 单任务;并发由外部多次调用实现,见访谈结论)。
- ❌ 改动 `TaskExecutor` / `ClaudeSdkInvocation` / `Reviewer` 的对外契约(只新增实现)。
- ❌ context 超长主动分片 / 预估告警(依赖 SDK 自管理,F1)。
- ❌ Tauri/React UI。

---

## 3. 现有架构衔接(契约不变)

接入严格遵循既有分层(`AGENTS.md §2`:`cli → application → core ← infrastructure`):

```
新增点全部落在 infrastructure/sdk/ 与 cli/commands/,core 与 application 零改动。
```

| 既有契约 | 本规格处置 |
|----------|-----------|
| `TaskExecutor`(`executor-contract.ts`) | **不改** |
| `ClaudeSdkInvocation` 接口 + `SdkRunInput` / `SdkRunReport`(`claude-sdk-adapter.ts`) | **不改**;新增其真实实现类 |
| `ClaudeSdkExecutor`(注入 `invocation: ClaudeSdkInvocation \| null`) | **不改**;CLI 注入非 null 实例即激活 |
| `Reviewer` 接口 + `ReviewInput` / `ReviewOutcome`(`task-review.ts`) | **不改**;新增 SDK 版实现类 |
| `buildStartupPrompt`(§18 模板) | **不改**;作为 SDK 调用的初始 prompt |
| `ResultFrontmatterSchema` / `ReviewFrontmatterSchema` | **不改**;作为 JSON 产出的校验目标 |

---

## 4. 执行模型(task:run 侧)

### 4.1 自主执行(F1)
真实 `ClaudeSdkInvocation` 实现内部用 SDK 的自主 `query()`:把 `startup_prompt`(§18 模板,已含必读核心 + 任务文件 + 边界声明)+ `context_pack` 清单 + `permission_boundary` 组装为一次自主调用,在 `worktree_path`(`cwd`)下让模型自驱读写文件、跑 bash、直到它判定完成/阻塞/失败。**不手动驱动 tool-use、不逐步审批工具调用。**

### 4.2 输出契约——模型产全部 frontmatter JSON(F2)
任务结束时,要求模型在其输出的**最后**产出一个结构化 JSON,字段对齐 `SdkRunReport`(`claude-sdk-adapter.ts:172`,即 `ResultFrontmatterSchema` 中 Executor 可产的子集——`execution_commits` 始终留空由 Orchestrator 回填):

```jsonc
// 模型在末尾产出的 fenced 块(标记名待实现时定,建议 ```result-frontmatter)
{
  "executionStatus": "completed",            // completed | blocked | failed
  "modifiedFiles": ["src/..."],
  "createdFiles": ["docs/..."],
  "deletedFiles": [],
  "verification": [
    { "command": "npm run typecheck", "result": "passed", "notes": "" }
  ],
  "globalUpdateRequests": {
    "progress": [], "decisions": [], "issues": []
  },
  "nextAction": "review",                     // review | retry | needs-human | cancel
  "summary": "可选的人工可读摘要"
}
```

- **verification 全字段由模型产**(含其声称的 command/result/notes)——模型实际跑过验证命令后自报结果(F2)。风险见 §15。
- **execution_commits 不产**(Executor 契约本就留空,由 Orchestrator 合并前回填,`claude-sdk-adapter.ts:265`)。
- fenced 块的**标记名**、JSON 在模型自然语言输出中的**定位规则**(如「最后一块 ```result-frontmatter」),由实现任务固定并写入启动提示的产出指令段。

### 4.3 JSON 健壮性——重试 + 降级(访谈结论)
模型产出经 `ResultFrontmatterSchema.safeParse`(及与 `SdkRunReport` 的映射校验):

1. **成功** → 组装 frontmatter,落 `.result.md`。
2. **parse 失败 / 缺字段 / 多余文本干扰定位** → 把 `safeParse.error` 作为反馈追加进对话,**最多重试 N 次(建议 N=2,即首次 + 2 次重试)**,要求模型只补一个合法 JSON 块。
3. **重试耗尽仍失败** → 不伪造、不补默认。产出 `execution_status: 'failed'`、`next_action: 'needs-human'` 的降级 `.result.md`,verification 标 skipped,把 parse 错误摘要写入 `global_update_requests.issues`;后续状态流转由 Orchestrator 按 `failed + needs-human` 处理(`running → failed` 经 Orchestrator,§7 状态机)。

重试计数与降级产出在 `ClaudeSdkInvocation` 真实实现内部完成;`ClaudeSdkExecutor` 编排逻辑(`claude-sdk-adapter.ts:248`)不变,只消费最终 `SdkRunReport`。

### 4.4 权限软约束(F3)
- **执行期无拦截**:不传 `canUseTool`,不做路径校验回调。`permission_boundary`(`allowed_paths` / `forbidden_paths` / `permissions` / `verification_commands`)的全部信息经 **prompt 声明**注入(在 `startup_prompt` 或 `systemPrompt.append` 中明确告知,字段名见 §12)。
- **越界处置由模型自主**:模型若判定必须越过 `forbidden_paths`,应**自主**在 `global_update_requests.issues` 提出问题并把 `nextAction` 设为 `needs-human`,由 Orchestrator 扩权后续跑(Readme §7 / AGENTS §2 的自主版本)。
- **不做执行后 git diff 越界检测**(用户明确不要软件硬约束)。事后审计依赖 §7 的完整工具调用日志。

> ⚠ 见 §15 R-BOUND:这是与 AGENTS §2 强约束语义的已知张力,经用户裁定接受。

### 4.5 执行边界——无硬上限(F4)
- 不设 `maxTurns` 硬上限(**不传该 option**;SDK 默认 `undefined` = 不限)、不设墙钟执行超时、不设 token 预算阈值。靠模型自律判断「完成 / 阻塞 / 失败」;靠 Ctrl+C(§9)兜底中断;靠 §7 流式输出让人类及时介入。
- 唯一的「软观测」:每轮打印当前轮次(result 消息的 `num_turns`)+ 累计 token(§7),供人类判断是否 Ctrl+C。
- **传输层超时 ≠ 执行上限**:第三方 provider profile 的 `API_TIMEOUT_MS`(§6 extraEnv)是**单次 HTTP 请求**的传输超时(第三方端点必需),**不是** F4 说的执行墙钟上限——二者不同层面,F4 只约束后者(不设)。勿把传输超时误当执行上限关闭。

### 4.6 上下文注入——清单 + SDK 自读(访谈结论)
- `startup_prompt` / `systemPrompt.append`(字段名见 §12)只注入**文件清单**(必读核心 + required_docs + source_files 路径列表)与任务边界,不预读文件内容塞 prompt。
- 模型在 worktree(`cwd`)内用 SDK 内置 Read 工具按清单自读(worktree 含 git 跟踪的 docs/src,清单内文件均存在)。
- 依赖 SDK 自身 context 管理(自动压缩/截断)处理超长(F1);**不做预估告警、不做分片**。
- `optional_doc_excerpts` 的摘录文本可由实现决定是否直接注入(这是「摘录」本意,非全文),实现任务定。

---

## 5. 审查模型(task:review 侧)

对称地接 SDK,但走 `Reviewer` 契约(独立于 `TaskExecutor`):

- 新增 **SDK 版 `Reviewer` 实现**(建议命名 `ClaudeSdkReviewer`,放 `infrastructure/sdk/` 或 `cli/commands/task-review.ts` 旁,实现时按 allowed_paths 定)。
- `review(input)` 内部起一次独立 SDK 会话:以 `input.result`(`.result.md` frontmatter)+ worktree 内实际改动(模型用 Read/Bash/diff 自读)为审查对象,prompt 要求模型对照 §15 审查清单产出结论。
- 模型产出 JSON → `ReviewOutcome`(`task-review.ts:89`):
  ```jsonc
  {
    "review_result": "approved",              // approved | rejected | needs-human-confirmation
    "required_changes": ["..."],              // rejected/needs-human 时填
    "findings": ["..."]
  }
  ```
  (`skipped` 仍由 Orchestrator 为 `no_review` 任务生成,不经 Reviewer。)
- JSON parse 重试 + 降级策略同 §4.3:parse 失败重试 N 次,耗尽则降级为 `review_result: 'needs-human-confirmation'`(不伪造 approved),`findings` 记 parse 错误。
- `task-review.ts:200` 改为按配置注入 SDK 版 Reviewer;`LocalReviewer` 保留作兜底(SDK 未配置/key 缺失时)。

> 注:`ClaudeSdkReviewer` 与 `ClaudeSdkInvocation` 是**两个独立会话**(执行与审查职责分离,Readme §5.2/§5.3),不共享对话历史。

---

## 6. 鉴权与配置——Provider Profile(多模型接入,P0)

> **核心机制**(用户验证):SDK 经 `options.env` 切换 provider——`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` 指向任何 Anthropic Messages 兼容端点(智谱 GLM / DeepSeek / 官方),`ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` 把 Claude Code 内部按任务复杂度的档位选择映射到真实存在的第三方模型。详见 §12 `env` 项。本规格把多 provider 接入列为 **P0**(§16)。

配置以 **Provider Profile** 为单位组织(替代原先单一 `model` + `ANTHROPIC_API_KEY`):

```jsonc
// .caw/config.json(或既有 init 产物扩展)示意
{
  "provider": "glm",                    // 当前启用的 profile 名
  "profiles": {
    "anthropic": {
      "baseUrl": null,                  // null = 用 SDK 默认(官方端点)
      "authTokenEnv": "ANTHROPIC_API_KEY",  // 官方:从该变量读,注入 ANTHROPIC_API_KEY
      "modelMapping": {                 // 三档全映射(Claude Code 内部按任务复杂度选档)
        "haiku":  "claude-haiku-4-5",
        "sonnet":"claude-sonnet-5",
        "opus":  "claude-opus-4-8"
      },
      "extraEnv": {}                    // 追加到 SDK env
    },
    "glm": {
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "authTokenEnv": "ZHIPU_API_KEY",  // 第三方:从该变量读,注入 ANTHROPIC_AUTH_TOKEN
      "modelMapping": {
        "haiku":  "glm-4.7",
        "sonnet":"glm-5.2",
        "opus":  "glm-5.2"
      },
      "extraEnv": {
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "API_TIMEOUT_MS": "3000000"     // 第三方端点长超时(传输层,非 F4 执行上限,见 §4.5)
      }
    }
    // deepseek 同理(provider 接 DeepSeek 的 Anthropic 兼容端点);P1 在 init 交互式添加
  }
}
```

| 项 | 决策 |
|----|------|
| 启用 profile | `config.provider` 默认值;`task:run` / `task:review` 支持 `--provider` 覆盖;`--model` 覆盖具体模型(写入 `options.model`) |
| 鉴权 token | 从 profile 的 `authTokenEnv` 指定的环境变量读 token。**官方 anthropic profile 注入 `ANTHROPIC_API_KEY`;第三方 profile 注入 `ANTHROPIC_AUTH_TOKEN`**——token 注入键随 provider 不同(R-PROVIDER) |
| key 缺失 | 启动前检测 profile 的 token 环境变量;缺失则显式 `--executor dry-run` 才兜底,否则报错不静默(倾向) |
| 档位映射 | **三档(haiku/sonnet/opus)必须全部映射**到 provider 实际存在的模型——Claude Code 内部按任务复杂度自动选档,未映射的档位会使内部调用失败 |
| SDK env 组装 | 实现:`{ ...process.env, <token注入键>: <token>, ...(baseUrl? {ANTHROPIC_BASE_URL: baseUrl}:{}), ANTHROPIC_DEFAULT_HAIKU_MODEL, ...SONNET..., ...OPUS..., ...extraEnv }`——**必须展开 `...process.env`**(传 `env` 整体替换子进程环境,见 §12) |
| SDK 版本 | `@anthropic-ai/claude-agent-sdk` 最新稳定版;版号在实现任务 `package.json` 锁定 |
| `caw init` 预置 | 预置 `anthropic`(官方)+ `glm`(智谱)两个 profile;deepseek 在文档列出生成方式 |

> ⚠ `ANTHROPIC_AUTH_TOKEN`(第三方兼容端点)与 `ANTHROPIC_API_KEY`(官方)是**不同**的 env 注入键——SDK 对兼容端点走 `ANTHROPIC_AUTH_TOKEN`(bearer),官方走 `ANTHROPIC_API_KEY`。实现须按 profile 选用正确的注入键。

---

## 7. 可观测性(F5,全自主方案的安全绳)

既然放弃执行期控制,「看得见」是唯一保障,务必做实:

1. **实时流式输出**:SDK 的 assistant 消息(text / tool_use)、user 消息(tool_result)实时打印到终端(工具调用名 + 路径/命令摘要 + 结果状态),让人类随时看到模型在做什么。
2. **完整日志文件**:每次 `task:run` / `task:review` 在 worktree 或项目日志目录(建议 `.worktrees/<task>/.caw/logs/` 或 `<root>/.caw/logs/`)落一份**完整**的逐消息日志(含时间戳、轮次、token),供事后审计——这是 §15 R-BOUND 越界事后追溯的唯一依据。
3. **cost / usage 摘要**:执行结束打印 `total_cost_usd`、input/output token、轮次、duration(取自 SDK result 消息;字段名以 SDK 安装版类型为准)。同时写入 `TaskRunOutcome` 供 CLI 输出与测试断言(需扩展 `TaskRunOutcome`,见 §13)。

实现层:经 SDK 的流式(`includePartialMessages` 或 for-await message 增量)驱动终端输出;日志经文件流追加。

---

## 8. 容错——技术故障分类处理(AGENTS §3 显式化)

区分于「模型自主跑多久」(F4 不限),SDK 调用本身的**技术性失败**按类型分类(AGENTS §3「运行时容错必须作为显式错误处理」):

| 故障类型 | 处置 |
|----------|------|
| 鉴权失败 / 配置错(key 无效、模型 id 不存在) | **立即** `execution_status: failed` + `next_action: needs-human`,不重试 |
| 网络 / API 5xx / 限流(429) | **有限指数退避重试**(如最多 3 次,基础 1s × 2^n,带抖动);耗尽则降级 failed + needs-human |
| 模型 safety 拒绝执行任务 | 记入 `global_update_requests.issues` + `next_action: needs-human`,不重试(safety 拒绝重试通常无效) |
| JSON 产出非法(§4.3) | 重试 N 次(带错误反馈),耗尽降级 failed + needs-human |
| 中断(§9) | 捕获中断信号,产出降级 result(blocked/failed),保留 worktree 供续看 |

重试须**幂等**:同一任务重试不产生重复 frontmatter / 重复文件写入;重试上限耗尽必显式降级,不静默吞错。容错逻辑收敛在 `ClaudeSdkInvocation` 真实实现内,`ClaudeSdkExecutor` 不感知。

---

## 9. 中断(Ctrl+C)

- 经 SDK 的 `abortController` option(传入 `AbortController` 实例)接入进程 SIGINT:Ctrl+C → `controller.abort()`(SDK 随后抛 `AbortError`,字段名校准见 §12)。
- 中断后 `query()` 的结束方式(抛 `AbortError` 还是正常返回 result)以 SDK 安装版行为为准;实现须两种都兼容(try/catch `AbortError` + 正常分支)。
- 中断后:**保留 worktree 与已做的文件改动**(不自动回滚,F3),产出降级 `.result.md`(`execution_status: failed` 或 `blocked`、`next_action: retry` 或 `needs-human`),由 Orchestrator 按 `restart_on_retry` 决定从头重来。
- 不做断点续跑(§2.2 非目标)。

---

## 10. 验证环境(复用既有实现)

- 直接复用 `task-run.ts:442 restoreNodeModules`(已实现 R7):默认 junction 复用主工作区 `node_modules`,声明 `install_dependencies` 时 worktree 内 `npm install`。
- `verification_commands`(模型在 §4.2 JSON 中自报结果)由模型在 worktree 内用 SDK Bash 工具实跑后自报。**不另外由软件再跑一遍**(F2 全模型产)。
- worktree 装依赖发生在 `executor.execute` 之前(`task-run.ts:212` restorer 已在 executor 前),无需改链路顺序。

---

## 11. 测试策略

| 层 | 策略 |
|----|------|
| `ClaudeSdkInvocation` 编排逻辑(组装入参、JSON parse、重试、降级、容错分类) | **fake invocation 单测**(沿用 `claude-sdk-adapter.ts` 测试已有的 fake 模式):注入返回各种 report / 抛各种错误的 fake,断言编排与降级路径。零真实 API、CI 稳定免费。 |
| `ClaudeSdkReviewer` 同理 | fake SDK 会话注入单测。 |
| 真实 SDK 集成 | **CI 里调真实 API**(访谈结论),但**断言契约不断言文本**:断言 `.result.md` 过 `ResultFrontmatterSchema`、`executionStatus` 合法、`modified_files` 非法路径拒绝、状态流转合法、`review_result` ∈ 合法枚举;**不断言**模型正文措辞。受非确定性影响最小。 |
| 真实 API 的成本/稳定性 | 真实集成测试用**最小固定任务**(如「在指定文件追加一行注释」),控成本;CI 需 `ANTHROPIC_API_KEY` secret;无 key 时该子集 skip 并显式标注(不静默通过)。 |
| 模拟器/mock 真 SDK | 可选 P1:用 SDK 的拦截/mock 能力(若有)替代真 API,降低 CI 成本。 |

---

## 12. SDK API 用法(已对照官方 TypeScript 类型校准)

> **校准来源**:`@anthropic-ai/claude-agent-sdk` 官方类型参考(docs.claude.com/en/api/agent-sdk/typescript)+ 用户验证过的 GLM 接入示例。下列字段名为本文档写作时的真实类型;实现时仍以**安装版 `.d.ts`** 为最终准绳(R-API)。

1. **自主调用**:`query({ prompt, options }) → Query`,其中 `Query extends AsyncGenerator<SDKMessage, void>`,另带 `interrupt()` / `setPermissionMode()` 方法。`prompt` 为 `string`(本规格用 string,非流式输入)。一次调用让模型自驱到产出 result 消息。

2. **关键 options**(字段名已校准,以下为本规格实际使用项):

   | option | 类型 | 本规格取值 | 说明 |
   |--------|------|-----------|------|
   | `cwd` | `string` | `worktree_path` | 模型在此目录读写 / 跑 bash |
   | `model` | `string` | provider profile 映射值(§6) | 模型 id;第三方 provider 配合 `env` 档位映射 |
   | `env` | `Dict<string>` | `{ ...process.env, ...providerEnv }` | **多 provider 切换的核心**(§6):注入 `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`/三档映射/extraEnv。⚠ 传 `env` **整体替换**子进程环境,必须展开 `...process.env` |
   | `permissionMode` | `'default'\|'acceptEdits'\|'bypassPermissions'\|'plan'` | `'bypassPermissions'` | F3 无拦截的最宽模式 |
   | `systemPrompt` | `string \| { type:'preset', preset:'claude_code', append?:string }` | `{ type:'preset', preset:'claude_code', append: <任务边界+权限清单+§4.2产出指令> }` | ⚠ **不是** `customSystemPrompt`/`appendSystemPrompt`。用 preset 复用 Claude Code 内置系统提示,`append` 追加本规格边界声明 |
   | `settingSources` | `('user'\|'project'\|'local')[]` | `['project']`(或 `[]`,见说明) | ⚠ **默认 `[]` 不加载任何文件配置**;须显式含 `'project'` 才加载 worktree 内 `CLAUDE.md` / `.claude/settings.json`。本规格任务上下文已由 startup_prompt 显式注入,是否额外加载 CLAUDE.md 由实现权衡 |
   | `maxTurns` | `number \| undefined` | 不传(undefined) | F4 不设硬上限;⚠ `result.subtype:'error_max_turns'` 仅在显式设了 maxTurns 且用尽时出现,不传则不触发 |
   | `maxThinkingTokens` | `number \| undefined` | 不传 | 第三方 provider 对 thinking 支持不一,默认不传;按 provider 决定 |
   | `includePartialMessages` | `boolean` | `true` | 为 §7 实时流式输出开启;开启后额外收到 `type:'stream_event'` 的 partial 消息 |
   | `allowedTools` | `string[]` | 不传(用默认全集) | 内置工具默认在 `cwd` 可用;F3 下不限制工具集。工具名见第 6 条 |
   | `abortController` | `AbortController` | 传入新建的 controller | ⚠ **是 `abortController`**(传 controller 实例),**不是** `abortControllerSignal`;SIGINT → `controller.abort()`(§9) |
   | `stderr` | `(data: string) => void` | 日志回调 | 子进程 stderr 转入 §7 日志文件 |

   - **不传** `canUseTool`(F3 纯软约束)。
   - **不传** `resume` / `continue` / `forkSession`(§2.2 非目标,不做断点续跑)。

3. **流式消费**:for-await `SDKMessage` 序列,按 `type` 分派:
   - `type:'system'` + `subtype:'init'`(**首条**):含实际生效的 `model` / `apiKeySource` / `tools` / `permissionMode`——用于**启动校验**(确认 env 注入的 provider/model 生效,§7)。
   - `type:'assistant'`:`message: APIAssistantMessage`(Anthropic SDK 消息对象,`.content[]` 含 `text` / `tool_use` 块)——驱动 §7 终端输出。
   - `type:'user'`:`message: APIUserMessage`(`.content[]` 含 `tool_result` 块)——工具结果,打印摘要。
   - `type:'stream_event'`(仅 `includePartialMessages:true`):`event: RawMessageStreamEvent`——token 级增量,驱动 §7 实时输出。
   - `type:'system'` + `subtype:'compact_boundary'`:context 压缩边界(§4.6 依赖 SDK 自管理),记日志。

4. **中断**:`abortController.abort()` 触发;SDK 抛 **`AbortError`**(SDK 导出的自定义错误类)。实现须 try/catch `AbortError` 并兼容「正常返回 result」分支(§9)。

5. **终止信息**(`SDKResultMessage`,`type:'result'`),**字段名已校准**:
   - `subtype: 'success' | 'error_max_turns' | 'error_during_execution'`(§8 容错分类依据)。
   - `total_cost_usd: number`(§7 cost)。
   - `usage: { input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }`(§7 token)。
   - `num_turns: number`(§7 轮次)、`duration_ms: number` / `duration_api_ms: number`(§7 duration)。
   - `result: string`(仅 `success`)、`is_error: boolean`、`permission_denials: SDKPermissionDenial[]`(F3 bypassPermissions 下应为空)。

6. **内置工具**:SDK 在 `cwd` 下默认提供 `Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash` / `Task` / `NotebookEdit` / `WebFetch` / `WebSearch` / `TodoWrite` 等(工具名以类型参考「Tool Input Types」的 `Tool name:` 为准)。F3 下用默认全集(不传 `allowedTools`)即可满足自主执行。

实现任务交付前,把实际安装版 `.d.ts` 与本节字段名核对一次,差异回写本节(R-API)。

---

## 13. 改动点(文件级)

### 13.1 新增
| 路径 | 内容 |
|------|------|
| `src/infrastructure/sdk/claude-sdk-invocation-impl.ts`(命名示意) | `ClaudeSdkInvocation` 的真实实现类:调 SDK `query()`、流式回调(§7)、JSON 提取 + safeParse + 重试降级(§4.3)、容错分类(§8)、中断(§9)。返回 `SdkRunReport`。 |
| `src/infrastructure/sdk/claude-sdk-reviewer.ts`(命名示意) | SDK 版 `Reviewer` 实现(§5):独立会话审查,产 `ReviewOutcome`,JSON 重试降级。 |
| `src/infrastructure/sdk/sdk-client.ts`(命名示意,可选) | SDK 会话工厂:集中 `query()` 装配 + 流式日志 + abort + cost 采集,供 invocation 与 reviewer 复用,避免重复。 |
| `src/cli/` 配置读取 | 读 `caw init` 产物的 **provider profile**(§6:`provider` + `profiles[provider]`)+ CLI `--provider` / `--model` / `--executor`(`sdk`/`dry-run`)。组装 SDK `env`(§6 组装规则 + §12 `env` 项)注入 invocation。 |

### 13.2 修改(最小侵入)
| 文件 | 改动 |
|------|------|
| `package.json` | **扩权新增** `@anthropic-ai/claude-agent-sdk` 依赖(违反 TASK-001 红线,须走扩权流程,见 §16);锁版号。 |
| `src/cli/commands/task-run.ts` | `:161` 装配 executor(按配置注入 `ClaudeSdkExecutor(new ...InvocationImpl(...))` 或 DryRun);`TaskRunCommandOptions`(`:669`)+ `registerTaskRunCommand`(`:679`)增 `--model` / `--api-key` / `--executor` 等;`TaskRunOutcome`(`:86`)增 cost/usage/轮次/duration 字段(§7);`printOutcome` 打印摘要。 |
| `src/cli/commands/task-review.ts` | `:200` 装配 reviewer(SDK 版或 Local 兜底);命令选项增 `--model` / `--api-key` / `--reviewer`;`TaskReviewOutcome` 增 cost 字段。 |
| `src/cli/commands/init.ts` | `caw init` 产物新增 **provider profile** 配置(§6:预置 `anthropic` / `glm`,含 modelMapping + authTokenEnv + extraEnv)。 |
| `src/infrastructure/index.ts` | 导出新增的 invocation 实现 / SDK reviewer(若放 infrastructure)。 |

### 13.3 不改动
`executor-contract.ts`、`claude-sdk-adapter.ts`(`ClaudeSdkInvocation` 接口 / `ClaudeSdkExecutor` / `DryRunLocalExecutor`)、`core/**`、`application/**`、`task-schema` / `result-schema` / `review-schema`、合并链路(019/020/021)、`restoreNodeModules`、状态机。

---

## 14. 验收标准(可机器判定)

1. `npm i` 后 `@anthropic-ai/claude-agent-sdk` 装入 `node_modules`,`package.json` 锁定版号。
2. `npm run typecheck && npm test && npm run lint` 全绿。
3. `task:run` 在启用 profile 的 token 环境变量就位时默认走 SDK executor;`--executor dry-run` 显式回退 DryRun;token 缺失且未指定 dry-run 时报错不静默。
4. 真实 API 跑一个最小任务:产出的 `.result.md` 过 `ResultFrontmatterSchema`、`execution_status` ∈ 合法枚举、状态流转合法;终端有实时工具调用输出;日志文件存在且含逐消息记录;`TaskRunOutcome` 含非空 cost/usage。
5. `task:review` 走 SDK reviewer:`.review.md` 过 `ReviewFrontmatterSchema`、`review_result` ∈ 合法枚举。
6. fake invocation 单测覆盖:正常产出、JSON parse 失败重试 N 次、重试耗尽降级 failed+needs-human、鉴权错立即 failed、网络错指数退避耗尽降级、SIGINT 中断保留 worktree。
7. CI 真实 API 子集:断言契约(过 Schema + 合法枚举 + 状态流转)通过;无 key 时该子集 skip 且显式标注。
8. **多 provider**:切换 `--provider glm`(配合 `ZHIPU_API_KEY`)能跑通与 anthropic 同样的最小任务并过相同 Schema 断言;SDK `env` 注入后,`system init` 消息的 `model` 反映 GLM 档位映射值(§6/§12 启动校验)。

---

## 15. 风险与缓解

| 编号 | 风险 | 影响 | 缓解 |
|------|------|------|------|
| R-BOUND | F3 纯软约束 + 模型可能越界不自报 → 系统无手段发现,违背 AGENTS §2 强约束语义 | 高 | 经用户裁定接受;以 §7 完整工具调用日志作事后审计兜底;启动提示明确要求模型越界必自报 needs-human |
| R-JSON | F2 模型产 JSON 可能 parse 失败 / 漏报 / 谎报(尤其 verification 结果、modified_files) | 中高 | §4.3 重试 + 降级;CI 断言契约;谎报风险由用户接受(全自主权衡) |
| R-COST | F4 无上限 + CI 真实 API + 流式 → 成本不可控 | 中 | §7 每轮打印 token/cost 供人工介入;CI 用最小固定任务;预留 `maxTurns` 软观测(不硬限) |
| R-API | `@anthropic-ai/claude-agent-sdk` API 随版本变动,本规格字段名可能过时 | 中 | §12 只锁意图不锁字段名;实现任务对照 `.d.ts` 校准并回写附录 |
| R-NODE | memory 记录:本机 better-sqlite3 需 Node 22;worktree 装 SDK 依赖的 Node 环境一致性 | 低 | 复用主工作区 `node_modules`(restoreNodeModules 默认 junction);CI 固定 Node 版本 |
| R-DEP | 新增依赖违反 TASK-001 红线 | 低 | §16 显式扩权立项,不走临时新增 |
| R-FAILSAFE | 全自主无上限下,模型卡在工具循环反复试错 | 中 | §7 流式可见 + Ctrl+C;软观测轮次/token;不硬限(F4 取舍) |
| R-PROVIDER | 第三方 provider(GLM/DeepSeek)的 Anthropic 兼容端点行为与官方有差异(工具调用 / 流式 / thinking / cost 字段);档位映射漏档致内部调用失败 | 中 | §6 强制三档全映射;`system init` 消息启动校验(§7/§12);CI 每个 provider 跑最小任务断言契约;cost 字段缺失时降级显示 |

---

## 16. 分阶段(P0 必做 / P1 可选)

> 本规格对应的工作应另立 PLAN/任务(如 TASK-030+ 或实质化 TASK-022),按依赖拓扑拆分;此处给阶段建议。

### P0(全套闭环最小可用)
- 新增 SDK 依赖(扩权)+ `ClaudeSdkInvocation` 真实实现(自主执行 + JSON 重试降级 + 容错分类 + 中断)。
- **多 provider 接入**:Provider Profile 配置(§6)+ SDK `env` 注入(§12)+ `caw init` 预置 `anthropic` / `glm`。
- `task:run` 接线 + profile 鉴权 + 实时流式 + 日志 + cost 摘要。
- SDK 版 `Reviewer` + `task:review` 接线。
- fake invocation 单测 + CI 真实 API 契约断言(最小任务,至少跑通 anthropic 与 glm 各一)。

### P1(增强,不阻塞 P0)
- 更多 provider profile(deepseek 等)+ `caw init` 交互式添加。
- 真实 SDK mock/拦截降低 CI 成本。
- 配置文件 schema 化校验(Provider Profile 结构)。
- cost/usage 累计统计与告警(软观测,非硬限)。

---

## 附录 A:访谈决策追溯(本规格每条决策的来源)

| 决策 | 来源 |
|------|------|
| 自主执行 / 全 JSON 产 frontmatter / 纯软约束 / 无上限(§0 F1-F4) | 用户访谈第 1-2 轮 + 第 2 轮 Q2 明确立场 |
| JSON 重试 + 降级 failed(§4.3) | 第 2 轮 Q1 |
| 越界不挂软件硬约束、靠模型自报(§4.4) | 第 2 轮 Q2 |
| 全局单一模型可配 + 验证启动前装依赖(§6/§10) | 第 2 轮 Q3/Q4 |
| 实时流式 + 完整日志(§7) | 第 3 轮 Q1 |
| 技术故障分类处理(§8) | 第 3 轮 Q2 |
| Reviewer 也接 SDK(§5) | 第 3 轮 Q3 |
| CI 调真 API + 断言契约不断言文本(§11) | 第 3 轮 Q4 + 第 4 轮 Q1 |
| 并发本次不处理(§2.2) | 第 4 轮 Q2 |
| context 依赖 SDK 自管理(§4.6) | 第 4 轮 Q3 |
| 全套闭环范围(§2.1/§16) | 第 4 轮 Q4 |
| API key 环境变量 / model 配置 / 文件名 / SDK 版本(§6/§13) | 次要默认(访谈后声明,用户未异议) |
| 多 provider 接入(env 注入 + Provider Profile,§6/§12) | 用户验证过的 GLM 接入示例 + 官方 TypeScript 类型参考 |
| SDK 字段名校准(§12 全节) | 官方类型参考 docs.claude.com/en/api/agent-sdk/typescript |
| 传输超时 ≠ 执行上限(§4.5) | 用户示例 `API_TIMEOUT_MS` + F4 哲学区分 |
