# 阶段 5：集成（Ship）

> 角色：发布工程师 + 产品验收。
> 目标：把已验证的 Task / Milestone 合并、发布、归档。

## 输入
- 阶段 4 验证通过的代码（在分支上）
- Milestone 验收标准（`docs/milestones/M01-*.md`）

## 版本控制动作
1. **确认在正确的分支**：`feat/M01-<slug>`（不在则建）。
2. **小步提交**：Task 内按逻辑分多个 commit。commit message 用中文：
   - `feat: 新增 xxx` / `fix: 修复 xxx` / `test: 补充 xxx 测试`
   - `refactor: 重构 xxx` / `docs: 更新 xxx 文档`
3. **push 与 PR**：Milestone 完成后开 PR。
   - PR 描述引用 `docs/milestones/M01-*.md` 的验收标准，逐条对照。
   - ⚠️ **未经用户授权，不要 push 或开 PR。** 先问。

## 产品验收（Milestone 级）
对照 SPEC + Milestone 验收标准 + 实际实现 + 测试结果，判断：
```
# 验收结论
## 已满足项
## 未满足项
## 风险项
## 技术债（记到 backlog）
## 结论：PASS / FAIL
```

- **PASS** → 继续发布、归档。
- **FAIL** → **回路**：
  - 实现问题 → 回阶段 3 修复。
  - 需求理解问题 → 回阶段 1，更新 `docs/spec.md`。
  - 不要含糊带过，列清必须修复的问题。

## 归档（PASS 后）
1. 更新 `docs/changelog.md`：本 Milestone 做了什么、破坏性变更、已知问题。
2. 必要时更新 `docs/spec.md`（需求有调整时）。
3. 在 `docs/milestones/M01-*.md` 标记「已完成」。

## 完成自检
- [ ] 分支 / commit 规范遵守
- [ ] （如授权）PR 已开，描述对照验收标准
- [ ] 验收结论已出（PASS / FAIL）
- [ ] （PASS）changelog 已更新
- [ ] （PASS）Milestone 文件标记完成

## 完成后
- 一个 Milestone ship 完 → 回到阶段 2，规划下一个 Milestone。
