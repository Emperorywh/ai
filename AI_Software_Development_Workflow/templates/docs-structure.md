# docs/ 目录结构说明

这是项目知识库，也是 agent 跨会话的"记忆"。每个阶段把产物写进来。

```
docs/
├── spec.md                  # 【阶段1】需求与规格（单一事实源）
├── roadmap.md               # 【阶段2】Milestone 路线图
├── milestones/
│   └── M01-<slug>.md        # 【阶段2】Milestone 定义
├── tasks/
│   ├── backlog.md           # 【阶段2】Task 清单（带状态/优先级/风险）
│   └── M01-T01-<slug>.md    # 【阶段2建/阶段3填】Task 定义 + 完成记录
├── decisions/               # 【随时】架构决策记录（ADR），记"为什么"
│   └── 0001-<slug>.md
└── changelog.md             # 【阶段5】每个 Milestone 的发布说明
```

## 命名约定
- Milestone：`M01-<kebab-slug>`，如 `M01-user-auth`
- Task：`M01-T01-<kebab-slug>`，如 `M01-T01-login-form`
- ADR：`0001-<kebab-slug>`，序号递增

## 启用方式
新项目：把 `templates/` 下的模板复制到项目的 `docs/`，再改名：
```
cp templates/spec.template.md      docs/spec.md
cp templates/milestone.template.md docs/milestones/M01-xxx.md
cp templates/task.template.md      docs/tasks/M01-T01-xxx.md
```
（`docs-structure.md` 本身是说明，不需要复制到项目。）
