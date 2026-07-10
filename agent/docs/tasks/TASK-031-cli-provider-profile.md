---
id: TASK-031
title: Provider Profile 配置读取 + SDK env 组装
status: draft
layer: page
depends_on:
  - TASK-023
allowed_paths:
  - src/cli/config/provider-profile.ts
  - src/cli/commands/init.ts
  - test/cli/config/provider-profile.test.ts
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
  - src/cli/commands/task-run.ts
  - src/cli/commands/task-review.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/config/provider-profile
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - docs/SPEC_claude-sdk-integration.md#6-鉴权与配置provider-profile多模型接入p0
  source_files:
    - src/cli/commands/init.ts
workflow_outputs:
  result_file: docs/tasks/TASK-031-cli-provider-profile.result.md
---

# TASK-031 Provider Profile 配置读取 + SDK env 组装

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0。SPEC §6 把多 provider 接入（`options.env` 接 GLM/DeepSeek）列为 P0，以 Provider Profile 组织配置。本任务建配置读取 + env 组装，是 TASK-032/033/034/035 的共同依赖。

## 2. 当前目标

- **`provider-profile.ts`**：
  - 定义 `ProfileConfig`（`provider` + `profiles[anthropic/glm]`，每 profile 含 `baseUrl`/`authTokenEnv`/`modelMapping{haiku,sonnet,opus}`/`extraEnv`）。
  - 读 `.caw/config.json`（或既有 `caw init` 产物——实现时确认 `init.ts` 现状后选定路径）。
  - 组装 SDK env：`{ ...process.env, [tokenKey]: <token>, ...(baseUrl? {ANTHROPIC_BASE_URL}:{}), ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ...extraEnv }`。**官方注入 `ANTHROPIC_API_KEY`、第三方注入 `ANTHROPIC_AUTH_TOKEN`**。
  - **三档强制全映射校验**（缺档报错，R-PROVIDER）。
- **`init.ts`**：`caw init` 预置 `anthropic` + `glm` 两个 profile（含 modelMapping + authTokenEnv + extraEnv 模板，glm 含 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`/`API_TIMEOUT_MS`）。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§6/§12 `env` 项）、docs/tasks/TASK-031-cli-provider-profile.md
- `src/cli/commands/init.ts`（现状）

## 5. 修改范围

- `src/cli/config/provider-profile.ts`（新）、`src/cli/commands/init.ts`、`test/cli/config/provider-profile.test.ts`（新）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`、`src/cli/commands/task-run.ts`、`src/cli/commands/task-review.ts`

## 7. 不做什么

- 不调 SDK（env 组装是纯逻辑，**不 import sdk-client**）。
- 不实现 invocation/reviewer。
- 不做 CLI 命令的 `--provider` 解析接线（那是 task-run/task-review 在 TASK-034/035 调用本模块）。
- 不做 deepseek profile（P1）。
- token 只从环境变量读（`authTokenEnv` 指定），**不落配置文件明文**。

## 8. 架构约束

- `provider-profile.ts` 是 cli 层配置读取，被 `task-run`/`task-review`（034/035）调用组装 env 后传给 invocation/reviewer（composition root 装配）。
- 配置文件路径与 `caw init` 产物一致。
- 经 `ResultFrontmatterSchema` 风格的 zod 做最小 schema 校验（P1 再正式 schema 化）。

## 9. 数据流和状态流要求

`.caw/config.json` → 读 enabled profile → 读 `authTokenEnv` 指定的环境变量 → 组装 env 对象（含三档映射 + extraEnv）→ 返回给调用方（034/035），不直接触达模型。

## 10. 预期新增或修改文件

- `src/cli/config/provider-profile.ts`、`test/cli/config/provider-profile.test.ts`、`src/cli/commands/init.ts`

## 11. 验收标准

- anthropic profile：env 注入 `ANTHROPIC_API_KEY`、无 `ANTHROPIC_BASE_URL`。
- glm profile：env 注入 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` + 三档 `ANTHROPIC_DEFAULT_*_MODEL` + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`/`API_TIMEOUT_MS`。
- 三档缺映射时报错。
- env 含 `...process.env` 展开。
- `caw init` 产物含两个 profile 模板。
- `typecheck` 0 错误。

## 12. 风险提示

- R-PROVIDER：token 注入键随 provider（`ANTHROPIC_API_KEY` vs `ANTHROPIC_AUTH_TOKEN`）——单测两 profile 断言注入键。
- 配置文件 schema 未定型——本任务定义最小 schema，P1 再 schema 化校验。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-031-cli-provider-profile.result.md
- `DECISIONS.md` 更新建议：Provider Profile schema + env 组装规则
