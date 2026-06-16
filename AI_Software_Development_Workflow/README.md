# AI 软件工程工作流（Claude Code 版）

一套为 **Claude Code** 设计的软件开发工作流。把 agent 当成有持久记忆、能自主执行+自测+修复循环的工程师，而不是一条需要手动切换 prompt 的流水线。

## 这是什么

5 个阶段 + 1 条回路，覆盖从需求到发布的全流程：

```
        ┌──────────── 发现问题/P0/验收FAIL → 回执行修复 ────────────┐
        ▼                                                          │
[1 理解] → [2 规划] → [3 执行] → [4 验证] → [5 集成]
understand    plan      build      verify     ship
```

## 与旧版（8 阶段）的核心区别

| 维度 | 旧版 8 阶段 | 新版 5 阶段 |
|---|---|---|
| 上下文 | 靠对话历史，换会话就丢 | **落盘到 `docs/`**，跨会话读取 |
| 测试 | 开发之后的独立阶段 | **内建于开发**，完成即测试通过 |
| 自主性 | 每个 Task 都停下来确认 | **风险分级**，低风险自主完成 |
| 流程 | 单向直线 | 有**回路**，FAIL/P0 回到执行 |
| 版本控制 | 无 | 有分支/commit/PR 约定 |
| 现有项目 | 直接问需求 | **先探索理解现有代码** |
| 运行方式 | 人工切换 8 个 prompt | CLAUDE.md 自动加载 + 5 个阶段 prompt |

## 目录结构

```
AI_Software_Development_Workflow/
├── CLAUDE.md          工作流主纲（复制到项目根目录，会被自动加载）
├── README.md          本文件
├── phases/            5 个阶段的 prompt
│   ├── 1_understand.md   理解
│   ├── 2_plan.md         规划
│   ├── 3_build.md        执行（风险分级 + 测试内建 + 自测循环）
│   ├── 4_verify.md       验证（含回路）
│   └── 5_ship.md         集成（版本控制 + 归档）
└── templates/         docs/ 落盘结构 + 产物模板
    ├── docs-structure.md
    ├── spec.template.md
    ├── milestone.template.md
    └── task.template.md
```

## 怎么用

### 在新项目里启用
1. 把 `CLAUDE.md` 复制到项目根目录。
2. 把 `templates/` 里的结构建到项目的 `docs/`（`cp -r templates/ docs/`，再按需改名）。
3. 在 Claude Code 里说："按 CLAUDE.md 的工作流，从阶段 1 开始。"

### 在现有项目里启用
1. 复制 `CLAUDE.md` 到项目根目录。
2. 告诉 agent："先探索现有代码，把现状写进 `docs/spec.md`，再按工作流推进新需求。"

### 每个阶段怎么触发
直接把对应 `phases/N_*.md` 的内容发给 agent，或引用它。
**阶段之间靠 `docs/` 里的文件衔接，不靠对话记忆。**

## 四条设计原则
1. **落盘优先** —— 产物写文件，文件是 agent 的记忆。
2. **风险分级** —— 低风险自主做，高风险要确认。
3. **测试内建** —— 完成 = 测试通过。
4. **有回路** —— 发现问题回到执行，不重走全流程。

详见 `CLAUDE.md`。
