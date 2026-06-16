# 阶段 5：集成 / 发布（Ship）

> 角色：发布工程师 + 产品验收。
> 目标：把已验证的 Milestone / 功能合并、发布、归档。

## 输入

- 阶段 4 验证通过的代码（在分支上）
- 该功能 `SPEC.md` + `ROADMAP.md`（Milestone 验收标准）

## 版本控制动作

1. **确认在正确的分支**：每个功能一个分支 `feat/<功能名>-M01-<slug>`（不在则建）；Task 在该分支上小步提交。
2. **小步提交**：Task 内按逻辑分多个 commit。commit message 用中文：
   - `feat: 新增 xxx` / `fix: 修复 xxx` / `test: 补充 xxx 测试`
   - `refactor: 重构 xxx` / `docs: 更新 xxx 文档`
3. **push 与 PR**：Milestone / 功能完成后开 PR。
   - PR 描述引用 `ROADMAP.md` 的验收标准，逐条对照。
   - ⚠️ **未经用户授权，不要 push 或开 PR。** 先问。

## 产品验收（Milestone / 功能级）

对照 SPEC + ROADMAP 验收标准 + 实际实现 + 测试结果 + **用户人工验收结论**，判断：
```
# 验收结论
## 已满足项
## 未满足项
## 风险项
## 技术债（记入 PROGRESS / 新 Task）
## 结论：PASS / FAIL
```

- **PASS** → 继续发布、归档。
- **FAIL** → **回路**：
  - 实现问题 → 回阶段 3 修复。
  - 需求理解问题 → 回阶段 1，更新 `SPEC.md`。
  - 不要含糊带过，列清必须修复的问题。

## 归档（PASS 后）

1. 在 `PROGRESS.md`「近期注意事项」追加本 Milestone 发布说明（做了什么、破坏性变更、已知问题）；项目需要独立 changelog 时另建。
2. 必要时更新 `SPEC.md`（需求有调整时，递增版本与日期）。
3. 更新 `PROGRESS.md`：「Milestone 完成度」表把该 MS 标 ✅；当前指针指向下一个 Milestone 的第一个 Task。
4. 更新 `docs/FEATURES.md`：刷新该功能的「Milestone 进度」与状态；功能全部完成则标 ✅已发布。

## 完成自检

- [ ] 分支 / commit 规范遵守
- [ ] （如授权）PR 已开，描述对照验收标准
- [ ] 验收结论已出（PASS / FAIL）
- [ ] （PASS）`PROGRESS.md` 与 `FEATURES.md` 已更新
- [ ] （PASS）发布说明已记录

## 完成后

- 一个 Milestone ship 完 → 若该功能还有后续 Milestone，回到阶段 2 规划下一个；或粘贴【推进提示词】继续下一 Task。
- 整个功能发布完 → 在 `FEATURES.md` 标 ✅已发布；可开新功能（回到阶段 1）。
