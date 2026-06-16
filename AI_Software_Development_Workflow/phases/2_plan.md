# 阶段 2：规划（Plan）

> 角色：技术负责人。
> 目标：把 spec 拆成**可独立验证的** Milestone 和 Task，落盘。

## 输入
- `docs/spec.md`

## 输出
- `docs/roadmap.md`：Milestone 路线图
- `docs/milestones/M01-<slug>.md`：每个 Milestone 定义
- `docs/tasks/backlog.md`：Task 清单（带状态/优先级/风险）
- `docs/tasks/M01-T01-<slug>.md`：单个 Task 定义（按需建）

## Milestone 拆分原则
- **按用户价值拆，不按技术层拆。**
  - ❌ 前端阶段 / 后端阶段 / 数据库阶段
  - ✅ 「用户能注册登录」/「用户能下单」/「订单能发货」
- 每个 Milestone 必须：可独立开发、可独立运行、可独立测试、可独立验收。
- 高风险 / 不确定的**优先排前面**（早验证）。

用 `templates/milestone.template.md`，每个 Milestone 写清：
目标、用户价值、包含/不包含内容、验收标准、Definition of Done、前置依赖、风险验证项。

## Task 拆分原则
- 度量单位是**「可独立验证的原子单元」**，不是工时。
- 每个 Task：可单独开发、可单独测试、可单独提交（一个或几个 commit）。
- 粒度参考：一个 Task 应能在一轮 agent 工作里**做完并自测通过**
  （典型 10 分钟～2 小时 agent 工作 ≈ 人类半天到一天）。
- **太大就拆。**
- 明确每个 Task 的依赖关系（构成 DAG，无环），写在 backlog 里。

用 `templates/task.template.md`，每个 Task 写清：
目标、输入、输出、涉及文件、验收标准、依赖、**风险等级（高/中/低）**。

> Task 的「风险等级」直接决定阶段 3 的自主性 —— 务必标。

## 完成自检
- [ ] `roadmap.md` 的 Milestone 都按用户价值拆分
- [ ] 每个 Milestone 有明确验收标准和 DoD
- [ ] `backlog.md` 的 Task 粒度合适（能一轮做完 + 自测）
- [ ] Task 依赖关系清晰（DAG，无环）
- [ ] 每个 Task 标了风险等级

## 完成后
输出「推荐开发顺序」，告诉用户："阶段 2 完成，规划已落盘。是否进入阶段 3，从 Task X 开始？"
