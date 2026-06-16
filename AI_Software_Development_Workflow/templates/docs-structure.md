# docs/ 目录结构说明

这是项目知识库，也是 agent 跨会话的"记忆"。每个阶段把产物写进来。

```
docs/
├── spec.md                  # 【阶段1】需求与规格（单一事实源）
├── roadmap.md               # 【阶段2】Milestone 路线图
├── progress.md              # 【阶段2起维护】进度单一可信源 = 开发驱动器 ⭐
├── context-bootstrap.md     # 【会话恢复】新会话粘贴的「一句提示词」 ⭐
├── milestones/
│   └── M01-<slug>.md        # 【阶段2】Milestone 定义
├── tasks/
│   ├── backlog.md           # 【阶段2】Task 清单（带状态/优先级/风险）
│   └── M01-T01-<slug>.md    # 【阶段2建/阶段3填】Task 定义 + 完成记录
├── decisions/               # 【随时】架构决策记录（ADR），记"为什么"
│   └── 0001-<slug>.md
└── changelog.md             # 【阶段5】每个 Milestone 的发布说明
```

⭐ `progress.md` 是开发节奏的驱动器：它带「当前指针」，agent 任何时候读它就知道下一步做什么。
⭐ `context-bootstrap.md` 是「一句提示词推进」的入口：新会话粘进去就恢复全部认知并自动推进。

## 命名约定
- Milestone：`M01-<kebab-slug>`，如 `M01-user-auth`
- Task：`M01-T01-<kebab-slug>`，如 `M01-T01-login-form`
- ADR：`0001-<kebab-slug>`，序号递增
- **运行时文件**：`progress.md` / `context-bootstrap.md` 用**固定文件名、不带日期/版本**——它们被 agent 按固定路径反复读写。
  - 区别于 `spec.md` / `roadmap.md`：这两个可按需带日期版本号（如 `spec_2026-06-16.md`），是阶段性冻结的产物。

## 启用方式
新项目：把 `templates/` 下的模板复制到项目的 `docs/`，再改名：
```
cp templates/spec.template.md              docs/spec.md
cp templates/progress.template.md          docs/progress.md           # 阶段2 规划完成后初始化
cp templates/context-bootstrap.template.md docs/context-bootstrap.md  # 填好占位符后即可用
cp templates/milestone.template.md         docs/milestones/M01-xxx.md
cp templates/task.template.md              docs/tasks/M01-T01-xxx.md
```
（`docs-structure.md` 本身是说明，不需要复制到项目。）
