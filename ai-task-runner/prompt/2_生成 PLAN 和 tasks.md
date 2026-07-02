请阅读 AGENTS.md、当前项目结构、已确认的 docs/SPEC_xxxx.md。

现在请基于 SPEC 制定开发计划，不要实施代码。

要求：

1. 生成 docs/PLAN_xxxx.md。
2. 将计划拆分为多个可独立实现、可独立验证的 task。
3. 每个 task 尽量控制在 1 到 4 个核心文件内，且应能在一次自动执行内闭环完成；预估需要多轮反复试验、或大范围改动才能收敛的工作，必须继续拆分。
4. 如果某个 task 太大，必须继续拆分。
5. 如果发现 SPEC 中有不适合执行、未确认或会导致跨层耦合的内容，请先指出，不要强行制定计划。
6. PLAN 必须包含整体阶段、任务顺序、依赖关系、分支策略、验证策略、风险控制和回滚/恢复方式。
7. 同时生成 docs/tasks/TASK_xxx.md 文件，供 AI Task Runner 自动执行。
8. 生成的 task 初始状态必须是 draft，不允许直接写 ready。
9. 不要实施代码。

文件名约定：docs/PLAN_xxxx.md 中的 xxxx 替换为本次需求的有意义标识（与 SPEC 保持一致），docs/tasks/TASK_xxx.md 中的 xxx 替换为零填充序号（如 TASK_001、TASK_002），不要保留字面 xxxx/xxx。

每个 task 正文必须包含：

- 目标
- 涉及模块
- 不涉及范围
- 依赖任务
- 实现步骤
- 验收标准
- 验证命令
- AI 允许修改代码路径

每个 task frontmatter 必须使用以下 schema：

```yaml
---
id: TASK_001
status: draft
branch: ai/task-001-example
spec: docs/SPEC_xxxx.md
plan: docs/PLAN_xxxx.md
commit: "feat(TASK_001): 简短说明"
depends_on: []
agent_allowed_paths:
  - src/features/example/model/
  - src/features/example/__tests__/
verify:
  - pnpm typecheck
  - pnpm test example
---
```

schema 约束：

- status 只能先写 draft；执行前审查和用户确认通过后，才能改为 ready。
- depends_on 必须显式声明；没有依赖时写 []。
- depends_on 必须形成有向无环图，不能出现循环依赖。
- agent_allowed_paths 必须是项目内相对路径，不能写 src、docs、scripts 这类过宽目录。
- agent_allowed_paths 不能包含 docs/tasks、docs/SPEC_*、docs/PLAN_*、.git、.ai-runner、Runner 脚本或 task 状态文件。
- verify 必须是会结束的检查命令，不能启动 dev/start/serve 服务，不能执行 git 变更、git 工作区清理或删除命令。
- 如果项目存在 .ai-runner/config.yml，verify 必须符合其中的 allow_prefixes 和 deny_patterns。
