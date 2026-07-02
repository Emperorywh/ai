# AI Task Runner

这是一个本地 AI coding 任务执行器模板。

它的职责划分是：

- 用户负责定义需求、确认 SPEC、确认 PLAN、最终验收体验。
- AI 负责需求分析、架构理解、任务拆解和单 task 实现。
- Runner 负责调度、状态推进、路径校验、验证命令、日志记录、失败阻断和自动提交。
- 任务上下文来自文件，不依赖上一轮聊天上下文。

## 工作流

```text
需求
  -> prompt/1_生成 SPEC.md
  -> docs/SPEC_xxxx.md
  -> prompt/2_生成 PLAN 和 tasks.md
  -> docs/PLAN_xxxx.md + docs/tasks/TASK_xxx.md
  -> prompt/3_执行前审查.md
  -> 人工确认后把可执行 task 标记为 ready
  -> npm run ai:validate
  -> npm run ai:next / npm run ai:all
```

前三步（生成 SPEC / PLAN / 执行前审查）既可以用 `prompt/` 目录下的提示词手动执行，也可以用 Claude Code 的 slash 命令一键调用：`/spec <需求>`、`/plan [SPEC 标识]`、`/review`。

## 安装

```bash
npm install
```

## 命令

```bash
npm run ai:status
npm run ai:status -- --validate
npm run ai:validate
npm run ai:next
npm run ai:next -- --task TASK_001
npm run ai:next -- --dry-run
npm run ai:all
npm run ai:reset -- --task TASK_001 --status ready
npm run ai:reset -- --task TASK_001 --reset-branch
```

可选参数：

- `--project-root <path>`：指定真实项目根目录。
- `--runner-root <path>`：指定 Runner 工具根目录，默认自动使用当前脚本所在目录。
- `--config <path>`：指定项目内 Runner 配置文件，默认读取 `.ai-runner/config.yml`。
- `--task <id>`：只执行或恢复指定 task。
- `--dry-run`：只预览下一个可执行 task，不调用 Claude、不切分支、不改状态。
- `--status <status>`：配合 `ai:reset` 恢复任务状态。
- `--reset-branch`：配合 `ai:reset`，切到该 task 分支并丢弃上面残留的未提交改动，再把恢复后的状态落盘提交，让任务回到可直接重跑的干净状态。
- `--allow-empty`：允许 `ai:validate` 在没有 task 文件时通过，通常只用于模板或初始化检查。

## 跨项目配置

Runner 可以作为独立工具目录复用到多个项目。`--project-root` 指向真实业务项目，Runner 自带的执行 prompt 默认从工具目录读取，不要求业务项目复制 `scripts/ai-task-prompt.md`。

业务项目可以按需新增 `.ai-runner/config.yml`：

```yaml
task_dir: docs/tasks
log_dir: docs/ai-runner-logs
lock_file: .ai-task-runner.lock

branch_policy:
  mode: chained

forbidden_agent_paths:
  - docs/architecture/**

verify_policy:
  allow_prefixes:
    - pnpm typecheck
    - pnpm test
    - npm run lint
  deny_patterns:
    - "\\bnode\\s+scripts/delete-"
```

配置说明：

- `branch_policy.mode: chained`：默认行为，新 task 分支从当前分支继续创建，适合强依赖任务串行推进。
- `branch_policy.mode: base`：新 task 分支固定从 `branch_policy.base_branch` 创建，适合彼此独立的任务。
- `forbidden_agent_paths`：在默认保护 SPEC/PLAN/task/Runner 元数据的基础上，追加项目自定义受保护路径。
- `verify_policy.allow_prefixes`：如果声明，所有 verify 命令必须匹配其中一个前缀。
- `verify_policy.deny_patterns`：项目级 verify 正则黑名单。

## 任务状态流

```text
draft -> reviewed -> ready -> running -> done
                         |        |
                         v        v
                      blocked   failed
```

Runner 只执行 `ready` 状态的 task。`draft` 和 `reviewed` 用于计划生成、执行前审查和人工确认阶段。

## 任务文件格式

每个任务放在 `docs/tasks/*.md`，并在 frontmatter 中声明状态、分支、依赖、AI 可改路径和验证命令。

```markdown
---
id: TASK_001
status: draft
branch: ai/task-001-filter-model
spec: docs/SPEC_xxxx.md
plan: docs/PLAN_xxxx.md
commit: "feat(TASK_001): 抽离筛选状态模型"
depends_on: []
agent_allowed_paths:
  - src/features/orders/model/
  - src/features/orders/__tests__/
verify:
  - pnpm typecheck
  - pnpm test filterState
allowed_tools:
  - Bash(pnpm test:*)
---
```

字段要求：

- `id/status/branch/spec/plan/commit/agent_allowed_paths/verify` 都是必填。
- `spec` 和 `plan` 必须指向存在的文件。
- `depends_on` 必须显式声明；没有依赖时写 `[]`。
- `agent_allowed_paths` 只能写项目内相对路径，不能写 `src`、`docs`、`scripts` 等过宽目录。
- `agent_allowed_paths` 不能包含 `docs/tasks`、`docs/SPEC_*`、`docs/PLAN_*`、`.git`、`.ai-runner` 或 Runner 脚本。
- `verify` 必须是可结束的检查命令，不能启动 dev/start/serve 服务，不能执行 git 变更或删除命令。
- 可选字段 `allowed_tools` 声明实现阶段需要 Claude 自行执行的额外工具（如 `Bash(pnpm test:*)` 用于自测），按需精确放行，替代全开权限。
- 可选字段 `allow_empty_code_changes: true` 只用于纯验证类任务；普通开发任务不要使用。

## 安全闸门

- 工作区不干净会停止。
- 越界编辑在 Claude 工具调用层即被 PreToolUse 钩子事前阻断，不仅靠事后 `git diff` 检查。
- 队列 schema 不合法会停止。
- 队列为空时 `ai:validate` 会停止，除非显式传入 `--allow-empty`。
- task 不是 `ready` 会停止。
- depends_on 没有全部 done 会停止。
- depends_on 存在循环依赖会停止。
- 没有 `verify` 命令会停止。
- `spec` 或 `plan` 文件不存在会停止。
- Claude 修改 task 状态文件会停止。
- Claude 在 blocked 或失败前留下越界改动会停止。
- Claude 没有产生 `agent_allowed_paths` 内的代码改动会停止。
- 改动超出 `agent_allowed_paths` 会停止。
- Bash 中明显会创建、移动、删除、重定向写入或修改 git 工作区的命令会停止。
- 验证命令失败或超时会停止。
- verify 失败后允许有限次数 Claude 修复；修复后仍失败会停止。
- 提交前只读实现审查未明确通过会停止。
- Runner 只提交成功完成的 task。

## 日志、锁和超时

- Runner 执行时会创建 `.ai-task-runner.lock`，防止多个 Runner 同时修改状态；若上一次 Runner 崩溃留下残留锁，下次启动会校验锁中 PID 是否仍存活，确认已退出则自动回收，不会永久死锁。
- 执行日志写入 `docs/ai-runner-logs/`，默认被 git 忽略。
- 如果通过 `--project-root` 在业务项目中运行，请在业务项目 `.gitignore` 中加入 `docs/ai-runner-logs/` 和 `.ai-task-runner.lock`；Runner 内部也会在工作区检查和自动提交时忽略这些运行期产物。
- Claude 默认超时是 30 分钟，可用 `AI_RUNNER_CLAUDE_TIMEOUT_MS` 调整。
- verify 默认超时是 10 分钟，可用 `AI_RUNNER_VERIFY_TIMEOUT_MS` 调整。
- Claude 默认回合上限 50，可用 `AI_RUNNER_CLAUDE_MAX_TURNS` 调整。
- Claude 瞬态失败（超时或非零退出）默认重试 1 次，可用 `AI_RUNNER_CLAUDE_MAX_RETRIES` 调整。
- verify 失败后默认给 Claude 1 次修复机会，可用 `AI_RUNNER_VERIFY_REPAIR_ATTEMPTS` 调整。
- 提交前只读实现审查默认最多 12 回合，可用 `AI_RUNNER_REVIEW_MAX_TURNS` 调整。

## Claude 命令

Runner 用 headless 模式驱动 Claude，实际启动参数大致是：

```bash
claude --permission-mode default \
       --settings <本次生成的 settings.json> \
       --output-format stream-json \
       --max-turns 50 \
       --allowedTools Read \
       --allowedTools Glob \
       --allowedTools Grep \
       --allowedTools LS \
       --allowedTools Edit \
       --allowedTools Write \
       --allowedTools MultiEdit \
       --allowedTools NotebookEdit \
       [--allowedTools "<task 声明的工具>"]... \
       -p "<task prompt>"
```

要点：

- `--permission-mode default`：headless 下所有工具都通过 `--allowedTools` 显式放行，不再使用会自动接受编辑和部分文件系统 Bash 命令的 `acceptEdits`。
- `--settings`：每次执行按当前 task 生成一份 settings，内含一个 PreToolUse 钩子（`scripts/ai-enforce-paths.mjs`），在工具调用层事前强制 `agent_allowed_paths`，越界编辑即时被拒；Bash 中明显会创建、移动、删除、重定向写入或修改 git 工作区的命令也会被拒。Runner 同时保留事后 `git diff` 校验作为二道防线。
- `--output-format stream-json`：结果以结构化事件返回，Runner 从中解析最终结果文本并识别 `AI_TASK_BLOCKED` 信号，不再依赖脆弱的全文 grep。
- `--max-turns`：回合上限，防止 Claude 死循环；默认 50，可用 `AI_RUNNER_CLAUDE_MAX_TURNS` 覆盖。
- `--allowedTools`：Runner 默认只放行读写文件所需的基础工具；task 可在 frontmatter 用可选字段 `allowed_tools`（如 `Bash(pnpm test:*)`）声明实现阶段需要的额外工具，按需精确放行，不能声明通用 `Bash` 或 `Bash(*)`。

Claude 实现结束后，Runner 会执行 verify。若 verify 失败，会把失败命令、退出码和输出回灌给 Claude，按 `AI_RUNNER_VERIFY_REPAIR_ATTEMPTS` 做有限修复；修复仍受 `agent_allowed_paths` 和 PreToolUse 钩子约束。verify 通过后，Runner 会再启动一个只读 Claude 审查上下文，只允许 `Read/Glob/Grep/LS`，根据 task、diff 和相关文件输出 `AI_TASK_REVIEW_PASSED` 或 `AI_TASK_REVIEW_FAILED: 原因`，只有审查通过才会提交。

Runner 不再提供 `bypassPermissions` 全开模式：它会关闭所有权限检查，让实现期 bash 完全脱离 Runner 的路径闸门。需要让 Claude 跑 bash 自测时，请用 `allowed_tools` 声明最小工具规格。

瞬态失败（Claude 超时或非零退出）默认重试 1 次，可用 `AI_RUNNER_CLAUDE_MAX_RETRIES` 调整；路径越界、blocked、verify 失败属于确定性失败，不会重试。

如果你的 Claude Code 命令名不同，可以设置：

```bash
AI_RUNNER_CLAUDE_BIN=claude
```
