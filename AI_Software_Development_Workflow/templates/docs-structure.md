# docs/ 目录结构说明（按功能自治）

这是项目知识库，也是 agent 跨会话的「记忆」。**每个功能（feature）在自己的目录下有一套完整的 SPEC/ROADMAP/PROGRESS**，互不干扰。

```
project-root/
├── CLAUDE.md                         # 工作流主纲（项目根，自动加载）+ 三段式协议
├── docs/
│   ├── FEATURES.md                   # 【项目级】功能注册表 + 「当前活动功能」指针 ⭐
│   └── features/
│       └── <功能名>/                  # 一个功能 = 一套完整流程
│           ├── SPEC.md               # 【阶段1】需求 + 决策日志 + 边界 + 权衡（单一事实源）
│           ├── ROADMAP.md            # 【阶段2】路线图 + 每 Milestone 详细设计 + Task 表（内联）
│           └── PROGRESS.md           # 【阶段2起】进度驱动器：当前指针 + Task 状态表 + 踩坑 ⭐
└── src/                              # 代码
```

⭐ `FEATURES.md`（项目级）+ 每个功能的 `PROGRESS.md` 是**运行时驱动器**：三段式提示词（访谈/规划/推进）都靠它们定位「现在做哪个功能、做到哪一步」。

## 命名约定

- 功能目录：`docs/features/<kebab-slug>`，如 `docs/features/user-auth/`
- 文件**固定名、不带日期/版本**：`SPEC.md` / `ROADMAP.md` / `PROGRESS.md` 被 agent 按固定路径反复读写。
- 版本/日期放在**文件头部表格**里（如 `文档版本 v1.1 | 日期 2026-06-16`），随访谈/规划演进递增。

## 三份文档的分工

- **SPEC** = 做什么 / 长什么样 / 为什么这么定（决策日志）
- **ROADMAP** = 用什么顺序做 / 每步边界与验收（Milestone 详细设计 + Task 表）
- **PROGRESS** = 做到哪了 / 踩了哪些坑（当前指针 + 状态表 + Lessons Learned）

## 启用方式

新功能（阶段 1 访谈落盘时由 agent 自动建，也可手动）：
```bash
# 1. 建功能目录
mkdir -p docs/features/<功能名>

# 2. 项目级注册表（首次需建一次）
cp templates/features-registry.template.md  docs/FEATURES.md

# 3. 各阶段产出（agent 按阶段写入，模板供参考）
cp templates/spec.template.md     docs/features/<功能名>/SPEC.md       # 阶段1
cp templates/roadmap.template.md  docs/features/<功能名>/ROADMAP.md    # 阶段2
cp templates/progress.template.md docs/features/<功能名>/PROGRESS.md   # 阶段2 初始化
```

> `docs-structure.md` / `entry-prompts.md` 本身是说明与提示词，**不复制到项目 docs/**（放在工作流仓库的 `templates/`，供查阅；`entry-prompts.md` 的内容按需粘贴使用）。
