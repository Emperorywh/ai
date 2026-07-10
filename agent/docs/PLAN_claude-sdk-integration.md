---
plan_id: PLAN_claude-sdk-integration
title: 接入 Claude Agent SDK 真实执行引擎 — 开发计划
source_spec: docs/SPEC_claude-sdk-integration.md
status: draft
created: 2026-07-10
owner: Orchestrator
---

# PLAN — 接入 Claude Agent SDK 真实执行引擎

> 本计划基于 `docs/SPEC_claude-sdk-integration.md` 制定。该 SPEC 把既有 TASK-022 产出的
> `ClaudeSdkInvocation` **接口骨架**（`DryRunLocalExecutor` 兜底 + `ClaudeSdkExecutor` 注入式
> 编排，**无真实 SDK 调用**）落地为真实调用 `@anthropic-ai/claude-agent-sdk` 的执行引擎，
> 并对称地为 `task:review` 提供 SDK 版 Reviewer。本计划只做拆分与排期，不实施代码。
>
> 与既有 `PLAN_coding-agent-workflow.md`（系统总规划，TASK-001~029 已收尾）的关系：本 PLAN
> 是其上 TASK-022 骨架的深化，**独立成 PLAN**；不改动既有 PLAN 的阶段表与已 done 任务。

## 0. 关键前置决策

1. **基于 TASK-022 骨架增量，不推翻契约。** 既有 `ClaudeSdkInvocation` 接口 / `SdkRunInput` /
   `SdkRunReport` / `ClaudeSdkExecutor` / `Reviewer` 契约**不改**（SPEC §3），本计划只新增真实
   实现类 + CLI 接线 + 配置 + 可观测性。core/application 零改动。

2. **扩权独立成 TASK-030。** 新增 `@anthropic-ai/claude-agent-sdk` 违反 TASK-001 依赖红线
   （`PLAN_coding-agent-workflow` §0-8）。按红线规则，扩权须显式立项、不在其他任务里越权改
   `package.json`。TASK-030 承担扩权 + sdk-client 会话工厂，是后续一切的前提。

3. **多 provider 接入是 P0 核心。** SPEC §6 已把 Provider Profile（`env` 注入接 GLM/DeepSeek）
   提升为 P0，非"自建网关"边角。TASK-031 专门承载配置读取 + env 组装，是 032/033/034/035 的
   共同依赖。

4. **SDK 字段名已校准。** SPEC §12 已对照官方类型参考（docs.claude.com/en/api/agent-sdk/typescript）
   校准至字段级（`abortController`/`systemPrompt`/`env`/`settingSources`/`maxThinkingTokens`/
   result 的 `subtype`/`total_cost_usd`/`usage`/`num_turns`/`duration_ms`）。实现任务据此编码，
   不再"待 SDK 确认"，但仍以安装版 `.d.ts` 为最终准绳（R-API）。

5. **provider 配置经构造注入，不改 `SdkRunInput`。** 真实 invocation/reviewer 需要 env/model，
   但 SPEC §3 锁定 `SdkRunInput` 不改 → provider 配置（来自 TASK-031）经**实现类构造函数**注入，
   CLI（TASK-034/035）在 composition root 装配。`SdkRunInput` 仍只承载 per-task 输入。

6. **F1–F5 哲学贯穿。** 自主执行 / 全 JSON 产 frontmatter / 纯软约束（不挂 canUseTool）/ 无硬
   上限 / 软件只做可见性+校验+容错。实现者若遇「要不要加约束/检测/上限」，默认不加，回看
   SPEC §0。

## 1. 任务清单与依赖拓扑

| ID | 标题 | layer | depends_on |
|----|------|-------|-----------|
| TASK-030 | 扩权新增 SDK 依赖 + sdk-client 会话工厂 | data | 022 |
| TASK-031 | Provider Profile 配置读取 + SDK env 组装 | page | 023 |
| TASK-032 | ClaudeSdkInvocation 真实实现 | data | 022,030,031 |
| TASK-033 | SDK 版 Reviewer 实现 | data | 027,030,031 |
| TASK-034 | task:run CLI 接线 + 可观测性 | page | 026,031,032 |
| TASK-035 | task:review CLI 接线 + CI 真实 API 契约 | page | 027,031,033 |

```
TASK-022(骨架,done) ─┐
                     ├─→ TASK-030(sdk-client) ─┬─→ TASK-032(invocation) ─→ TASK-034(task:run)
TASK-023(init,done) ─┴─→ TASK-031(profile) ───┴─→ TASK-033(reviewer) ───→ TASK-035(task:review+CI)
```

- **TASK-030 / 031 可并行**（无相互依赖）：030 是 infra 层装包+工厂，031 是 cli 层配置。
- **TASK-032 / 033 依赖 030 + 031**：实现层需要 sdk-client + env 组装。
- **TASK-034 依赖 032**：task:run 接线注入真实 invocation。
- **TASK-035 依赖 033**：task:review 接线注入真实 reviewer + CI 覆盖全套。

## 2. 各任务定位

| 任务 | 一句话定位 | SPEC 对应 |
|------|-----------|----------|
| TASK-030 | 装 SDK 包 + 建可复用 query 会话工厂（流式/abort/cost 采集，字段按 §12） | §12 / §13.1 |
| TASK-031 | 读 `.caw/config.json` provider profile + 组装 SDK env（§6 规则）+ init 预置 anthropic/glm | §6 / §13.1-2 |
| TASK-032 | `ClaudeSdkInvocation` 真实实现：自主 query + JSON 提取/重试降级 + 容错分类 + 中断 | §4 / §8 / §9 |
| TASK-033 | SDK 版 `Reviewer`：独立会话审查，产 ReviewOutcome，JSON 重试降级 | §5 |
| TASK-034 | `task-run.ts` 装配 executor + `--provider/--model/--executor` + 流式 + 日志 + cost 摘要 | §7 / §13.2 |
| TASK-035 | `task-review.ts` 装配 reviewer + CI 跑 anthropic/glm 最小任务断言契约 | §11 / §14-8 |

## 3. 文件边界与 allowed_paths 约定

- **核心原则**：跨任务 `allowed_paths` 不重叠是并行前提；本计划默认**串行**执行（遵循既有 PLAN §4）。
- **`src/infrastructure/index.ts` 例外**：作为聚合导出，TASK-030 / 032 / 033 各自**追加**导出
  （串行执行下重叠可接受）；各任务在 §5「修改范围」注明"index.ts 追加导出"。
- **`package.json` 仅 TASK-030 可改**（扩权）。
- **既有 `claude-sdk-adapter.ts`（`ClaudeSdkInvocation`/`ClaudeSdkExecutor`）与 `task-review.ts`
  的 `Reviewer` 接口不改**（SPEC §3）；TASK-033 新增实现类，TASK-035 改 `task-review.ts` 的
  **装配处**（`:200`）不改接口。

## 4. P0 / P1 映射（对应 SPEC §16）

- **P0（本 PLAN 全覆盖）**：SDK 依赖 + invocation 实现 + 多 provider 接入 + task:run 接线 +
  reviewer + task:review 接线 + fake 单测 + CI 真实 API 契约。
- **P1（不在本 PLAN，后续扩展）**：更多 provider（deepseek）+ init 交互式添加；SDK mock/拦截
  降 CI 成本；config schema 化校验；cost/usage 累计告警。

## 5. 验证策略（对应 SPEC §11）

| 任务 | 验证手段 |
|------|---------|
| TASK-030 | typecheck；sdk-client 单测（fake query 流，断言 cost/usage 采集 + abort）；`npm i` 后包就位 |
| TASK-031 | typecheck；profile 读取/env 组装单测（anthropic/glm 两 profile，断言 env 注入键与档位映射） |
| TASK-032 | typecheck；**fake invocation 单测**：正常产出 / JSON parse 失败重试 N 次 / 重试耗尽降级 failed+needs-human / 鉴权错立即 failed / 网络错指数退避耗尽降级 / SIGINT 中断保留 worktree（SPEC §14-6） |
| TASK-033 | typecheck；fake reviewer 单测（同上降级模式） |
| TASK-034 | typecheck；task:run e2e（`--executor dry-run` 回退 + SDK 注入路径用 fake invocation 验装配与 outcome 字段） |
| TASK-035 | typecheck；CI 真实 API：anthropic + glm 各跑最小任务，断言过 Schema + 合法枚举 + 状态流转（§14-8）；无 key 时 skip 且显式标注 |

统一命令（既有）：`npm run typecheck` / `npm test` / `npm run lint`。

## 6. 风险（对应 SPEC §15）

| 编号 | 风险 | 本 PLAN 控制 |
|------|------|-------------|
| R-DEP | 新增依赖违反 TASK-001 红线 | TASK-030 显式扩权，独立立项 |
| R-API | SDK 字段名随版本变 | SPEC §12 已校准；实现仍核对安装版 .d.ts，差异回写 §12 |
| R-PROVIDER | 第三方端点行为差异 / 档位漏映射 | TASK-031 强制三档全映射；TASK-035 CI 每 provider 跑最小任务；system init 启动校验 |
| R-JSON | 模型产 JSON 失败/谎报 | TASK-032/033 重试+降级 + fake 单测覆盖 |
| R-COST | 无上限 + CI 真实 API | TASK-035 最小固定任务；TASK-034 每轮打印 token/cost |
| R-NODE | Node 环境一致性（better-sqlite3 需 Node 22） | 复用主工作区 node_modules（restoreNodeModules junction）；TASK-030 确认 SDK 无 native 依赖 |

## 7. 收尾标准（对应 SPEC §14）

- `npm i` 后 `@anthropic-ai/claude-agent-sdk` 就位，`package.json` 锁版。
- `npm run typecheck && npm test && npm run lint` 全绿。
- `task:run` 在 profile token 就位时默认走 SDK；`--executor dry-run` 回退；token 缺失报错不静默。
- 真实 API（anthropic + glm）跑最小任务：`.result.md` / `.review.md` 过 Schema、状态流转合法、
  终端有实时工具调用输出、日志文件含逐消息记录、TaskRunOutcome 含非空 cost。
- fake invocation 单测覆盖 SPEC §14-6 全部路径。
- 由 Orchestrator/人工决定是否更新 `Readme.md` §5.2/§5.3 的执行引擎描述与既有 PLAN 阶段表。
