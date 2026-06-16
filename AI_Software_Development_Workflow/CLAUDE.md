# AI 软件工程工作流（Claude Code 版）

> 把 agent 当成一个**有持久记忆、能自主执行+自测+修复循环**的工程师来用，
> 而不是一条需要人手动切换 prompt 的流水线。

---

## 0. 这个文件是干什么的

把本文件放到**项目根目录**，Claude Code 每次启动会自动加载它。它定义了：

- 项目的工作节奏：**5 个阶段 + 1 条回路**
- 产物如何**落盘**到 `docs/`（agent 跨会话的"记忆"）
- **进度驱动 + 一句提示词推进**：靠 `docs/progress.md` 串起全流程，粘贴一段 bootstrap 就自动往前走
- 开发的**风险分级**（哪些 agent 自主做、哪些要人确认）
- **测试内建**与**自测循环**的硬性要求
- **版本控制**约定（分支 / commit / PR）
- 何时回到上一阶段（**回路**）

适用对象：Claude Code。充分用上文件落盘、CLAUDE.md 记忆、subagent 并行、
`写代码 → 跑测试 → 看结果 → 修复` 的自循环、TodoList。

---

## 1. 五个阶段 + 一条回路

```
        ┌───────────────────────────────────────────────┐
        │   发现问题/P0/验收FAIL → 回到「执行」修复       │
        ▼                                               │
[1 理解] → [2 规划] → [3 执行] → [4 验证] → [5 集成]
understand    plan      build      verify     ship
```

**回路规则（关键，旧版最缺的东西）：**

- `4 验证` 发现 P0 / Bug / 回归 → 回到 `3 执行` 修复，**不重走全流程**。
- `5 集成` 验收 FAIL → 实现问题回 `3 执行`；需求理解错则回 `1 理解` 更新 `docs/spec.md`。
- 任何阶段发现**需求本身有问题** → 回 `1 理解`，更新 spec。

每个阶段不是"说一段话"，而是"**产出一份落盘文件 + 通过自检 checklist**"。

### 进度驱动 + 一句提示词推进（日常怎么往前走）

阶段流程靠 `docs/progress.md` 这条**主线**串起来，而不是靠人手动切 prompt：

- **`progress.md` 是开发驱动器**：它带「当前指针」，记录"当前 Milestone / 当前 Task（表中第一个非 ✅）/ 总体进度"。任何阶段开工前，先读它定位下一步。
- **`context-bootstrap.md` 是「一句提示词」入口**：新会话或首次接入时，粘贴它的极简全文（见 `templates/`），agent 就自动跑这条闭环：
  `读 progress → 定位当前 Task → 读 roadmap 拿边界/验收 → 实现+自测循环到绿 → 更新 progress(✅+commit) → 报告下一个 Task`。
- **推进协议（Advance）**：用户粘贴 bootstrap、或直接说「继续 / 推进 / next / 接着做」时，执行上面这条闭环，做完一个 Task 就停、报告，等下一个指令。发现 P0 / 验收 FAIL → 回阶段 3 修复（回路），不重走全流程。
- 这让 agent 从"一条要手动切 prompt 的流水线"，变成"有记忆、能自己往前走的工程师"。

---

## 2. 核心原则（必须遵守）

### 2.1 落盘优先（agent 的记忆 = 文件）
- 每个阶段的产物**必须写入 `docs/` 下的文件**，不能只留在对话里。
- 下游阶段**读文件**获取上游产物，不靠对话历史。
- 对话会被压缩/清空，文件不会。`docs/` 就是这个项目的知识库。

### 2.2 单一职责
- 每个阶段只做一件事，有明确输入文件和输出文件。
- 不越界：执行阶段不重新设计架构（架构问题记到 `docs/decisions/` 再回规划）；验证阶段不写新功能。

### 2.3 风险分级决定自主性
- 🟢 **低风险**（新文件、纯函数、有测试覆盖的改动、UI、文档）→ agent **自主完成并自测**，不打断用户。
- 🟡 **中风险**（改非公共模块、加依赖、改配置）→ 自主做，**完成后汇报**改了什么、为什么。
- 🔴 **高风险**（改架构、改公共接口、删数据/文件、迁移、破坏性变更）→ **先出方案、等确认**再动手。
- 判定不清时按**高一级**处理。详见 `phases/3_build.md`。

### 2.4 测试内建，不是后置
- 写功能的同时写测试。一个改动"完成"的定义包含**测试通过**。
- 不存在"先写完代码、以后再补测试"。测试是 build 的一部分，不是单独阶段。

### 2.5 自测循环（agent 最强的能力，必须用）
- 写完代码 → **自己跑测试/lint/typecheck** → 失败就修 → 再跑 → 直到全绿。
- 不要写完就甩给用户一句"测试建议"，要**实际执行并让测试通过**。

### 2.6 不随意改已验收模块
- 可以改，但改 `docs/` 标记为"已验收"的模块时，必须在实现方案里说明**理由**并更新对应测试。
- 同理：改 `progress.md` 是为了**如实记录进度**，不是用来"绕过"依赖或跳过 Task。
- 是"留痕"，不是"禁止"。

---

## 3. 产物落盘结构（`docs/`）

```
docs/
├── spec.md                  # 【阶段1】需求与规格（单一事实源）
├── roadmap.md               # 【阶段2】Milestone 路线图
├── progress.md              # 【阶段2起维护】进度单一可信源 = 开发驱动器 ⭐
├── context-bootstrap.md     # 【会话恢复】新会话粘贴的「一句提示词」 ⭐
├── milestones/
│   └── M01-<slug>.md        # 【阶段2】每个 Milestone 的定义
├── tasks/
│   ├── backlog.md           # 【阶段2】所有 Task 清单（带状态/优先级/风险）
│   └── M01-T01-<slug>.md    # 【阶段2建/阶段3填】单个 Task 定义 + 完成记录
├── decisions/               # 【随时】架构决策记录（ADR），记"为什么"
│   └── 0001-<slug>.md
└── changelog.md             # 【阶段5】每个 Milestone 的发布说明
```

⭐ `progress.md` / `context-bootstrap.md` 用**固定文件名、不带日期版本**——被 agent 按固定路径反复读写（区别于 spec / roadmap 可带日期版本号）。模板见 `templates/`，新项目 `cp -r templates/ docs/` 起步。

---

## 4. 版本控制约定

- **分支**：每个 Milestone 一个分支 `feat/M01-<slug>`；Task 在该分支上小步提交。
- **commit 规范**（中文，遵循全局规则）：
  - `feat: 新增 xxx`
  - `fix: 修复 xxx`
  - `test: 补充 xxx 测试`
  - `refactor: 重构 xxx`
  - `docs: 更新 xxx 文档`
- **小步提交**：每个 Task 内按逻辑分多次 commit，不要一个大 commit。
- **PR**：Milestone 完成后开 PR，PR 描述引用 `docs/milestones/M01-*.md` 的验收标准逐条对照。
- ⚠️ **未经用户授权，不要 push 或开 PR。**

---

## 5. 如何启动

### 新项目
1. 读 `phases/1_understand.md`，进入理解阶段。
2. 完成需求澄清，产出 `docs/spec.md`。
3. 依次推进，每完成一个阶段更新对应 `docs/` 文件。

### 现有项目（增量开发）
1. **先探索现有代码**（旧流程缺失的一步）：读 README、CLAUDE.md、目录结构、关键模块。
2. 把对现状的理解写进 `docs/spec.md` 的「现状」章节，再谈新需求。
3. 其余同上。

### 日常推进（最常用）
- **首次接入**：把 `templates/context-bootstrap.template.md` 复制到 `docs/context-bootstrap.md`，填好占位符。
- **开新会话**：粘贴 `docs/context-bootstrap.md`「👇 复制这段」框内的全文作为第一条消息；或项目已配置时直接说「继续 / 推进」。
- agent 会读 `docs/progress.md` 定位当前 Task → 执行 → 自测 → 更新 progress → 报告下一个 Task。

### 给 agent 的入口指令
> 规划期："按 CLAUDE.md 的工作流推进。当前在 [阶段]，先读 `docs/` 下相关产物。"
> 推进期："继续 / 推进。"（触发推进协议，见 §1）

---

## 6. 阶段产物速查

| 阶段 | 输入（读） | 输出（写） | prompt |
|---|---|---|---|
| 1 理解 | 对话 / 现有代码 | `docs/spec.md` | `phases/1_understand.md` |
| 2 规划 | `docs/spec.md` | `docs/roadmap.md`、`docs/milestones/`、`docs/tasks/`、**`docs/progress.md`（初始化）** | `phases/2_plan.md` |
| 3 执行 | **`docs/progress.md`（定位当前 Task）** + Task 文件 + spec | 代码 + 测试 + Task 完成记录 + **`docs/progress.md` 标 ✅ + commit hash + 移指针** | `phases/3_build.md` |
| 4 验证 | 代码 + 验收标准 | 验证记录（写回 Task 文件）+ 复核 `docs/progress.md`（P0 则回退 🔄） | `phases/4_verify.md` |
| 5 集成 | 已验证的 Task | PR / 发布 + `docs/changelog.md` + **`docs/progress.md` 更新 Milestone 完成度** | `phases/5_ship.md` |

---

## 7. 全局禁区

- ❌ 不要假设需求 —— 不清楚就问（见阶段 1）。
- ❌ 不要在 build 阶段重新设计架构 —— 架构问题记到 `docs/decisions/`，回到规划。
- ❌ 不要写"后续考虑 / 可以扩展 / 视情况而定" —— SPEC 要明确，模糊就是阶段 1 没做完。
- ❌ 不要跳过测试 —— 没有通过的测试，build 就没完成。
- ❌ 不要跳过未 ✅ 的前置 Task，也不要改 `progress.md` 来"绕过"依赖。
- ❌ 不要未经确认 push / 开 PR / 删除文件。
