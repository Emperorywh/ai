# AI 软件工程工作流（Claude Code 版）

一套为 **Claude Code** 设计的软件开发工作流。把 agent 当成有持久记忆、能自主执行+自测+修复循环的工程师，但**关键节点停下来等人**——不是全自动流水线。

**按功能自治 + 三段式提示词**：一个项目里每个功能（feature）各自走完整流程（访谈 → 规划 → 推进循环）。用三句可复用提示词驱动：① 访谈把需求问透 → ② 规划拆成可独立验证的 Milestone/Task → ③ 推进（**每次粘贴同一句**）做一个 Task 即停、等你人工验收后再粘同一句做下一个。

## 这是什么

5 个阶段 + 1 条回路 + 人工闸门，每个功能在自己的 `docs/features/<功能名>/` 下自治：

```
        ┌──── 发现 P0/验收FAIL/人工验收不通过 → 回「执行」修复 ────┐
        ▼                                                        │
[1 理解] → [2 规划] → [3 执行] → [4 验证] → [5 集成]
 访谈  🚪   规划  🚪  推进 🚪(每Task)  验证         发布  🚪
                  ↑ FEATURES.md(功能注册表) + 每功能 PROGRESS.md 驱动 ↑
```

| 提示词 | 触发 | 产出 | 闸门 |
|---|---|---|---|
| ① **访谈** | 新功能说需求 /「访谈」 | `docs/features/<功能名>/SPEC.md`（+注册 `FEATURES.md`） | 停，确认 SPEC |
| ② **规划** |「规划/拆分/出路线图」 | `ROADMAP.md` + `PROGRESS.md` | 停，确认规划 |
| ③ **推进** |「推进/继续/next」（每次同一句） | 代码+测试 + 更新 `PROGRESS.md` + commit | 停，**人工验收**后再粘同一句 |

## 目录结构（工作流仓库本身）

```
AI_Software_Development_Workflow/
├── CLAUDE.md          工作流主纲（复制到项目根目录，会被自动加载）
├── README.md          本文件
├── phases/            5 个阶段的指引
│   ├── 1_understand.md   理解（深度访谈 → SPEC）
│   ├── 2_plan.md         规划（→ ROADMAP + PROGRESS）
│   ├── 3_build.md        执行（推进提示词；风险分级 + 测试内建 + 自测循环；做完即停）
│   ├── 4_verify.md       验证（回路 + 复核 PROGRESS）
│   └── 5_ship.md         集成（版本控制 + 归档 + 更新 PROGRESS/FEATURES）
└── templates/         docs/ 落盘结构 + 产物模板 + 三段提示词
    ├── docs-structure.md                 per-feature 目录结构说明
    ├── features-registry.template.md     ⭐ FEATURES.md（功能注册表 + 当前活动功能指针）
    ├── entry-prompts.md                  ⭐ 三段可粘贴提示词（访谈/规划/推进）
    ├── spec.template.md                  SPEC（含决策日志/边界/权衡）
    ├── roadmap.template.md               ROADMAP（路线图 + Milestone 详细设计 + Task 表内联）
    └── progress.template.md              PROGRESS（进度驱动器）
```

## 套用后，项目里的 docs 长这样

```
project-root/
├── CLAUDE.md
├── docs/
│   ├── FEATURES.md                   功能注册表 + 「当前活动功能」指针 ⭐
│   └── features/
│       ├── user-auth/                一个功能 = 一套完整流程
│       │   ├── SPEC.md
│       │   ├── ROADMAP.md
│       │   └── PROGRESS.md
│       └── order-checkout/
│           ├── SPEC.md
│           ├── ROADMAP.md
│           └── PROGRESS.md
└── src/
```

## 怎么用

### 在项目里启用
1. 把 `CLAUDE.md` 复制到项目根目录（会被自动加载）。
2. 首次开功能时，agent 会自动建 `docs/FEATURES.md` 与 `docs/features/<功能名>/`（也可手动 `cp templates/features-registry.template.md docs/FEATURES.md` 起步）。

### 开发一个功能（最常用）
1. **访谈**：告诉 agent「我要做一个功能：……」或粘贴 `templates/entry-prompts.md` 的【访谈提示词】。agent 深度多轮访谈后落盘 `SPEC.md`，**停下等你确认**。
2. **规划**：确认 SPEC 后说「规划」。agent 拆出可独立验证的 Milestone/Task，落盘 `ROADMAP.md` + `PROGRESS.md`，**停下等你确认**。
3. **推进**（循环）：粘贴【推进提示词】（或说「推进」）。agent 读 `FEATURES.md`→当前功能→`PROGRESS.md` 定位当前 Task，实现+自测+更新 PROGRESS+commit，**做完一个即停等你人工验收**。验收 OK 后**再粘同一句**做下一个 Task。

### 切换功能
改 `FEATURES.md` 的「当前活动功能」指针，或说「切到 <功能名>」。

### 每个阶段怎么触发
直接说触发词（访谈 / 规划 / 推进），或粘贴 `templates/entry-prompts.md` 对应段落。**阶段之间靠 `docs/` 里的文件衔接 + 人工闸门，不靠对话记忆、不自动串接。**

## 六条设计原则
1. **落盘优先** —— 产物写文件，文件是 agent 的记忆。
2. **按功能自治** —— 每个功能一套 SPEC/ROADMAP/PROGRESS，`FEATURES.md` 统一调度。
3. **人工闸门** —— 段之间、Task 之间都停下等人；不是全自动。
4. **风险分级** —— 低风险自主做，高风险要确认。
5. **测试内建** —— 完成 = 测试通过。
6. **有回路** —— 发现问题回到执行，不重走全流程。

详见 `CLAUDE.md`。
