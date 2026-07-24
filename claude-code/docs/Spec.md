请根据我提供的原始需求，并结合当前代码库，生成或重写 `orchestration/SPEC.md`。

本次只编写系统规格，不拆分 TASK，不实现业务功能，不修改业务代码。

## 核心原则

SPEC 应冻结：

- 系统最终要实现的可验证结果；
- 业务规则和领域概念；
- 关键状态及其合法转换；
- 数据流和状态流；
- 模块职责、边界和依赖方向；
- 外部接口、数据格式及集成契约；
- 安全、一致性、性能等可验证要求；
- 明确的非目标和禁止行为。

SPEC 不应预先冻结：

- 需要修改或创建的具体文件；
- 类名、函数名、组件名和目录结构；
- 逐步编码方案；
- 内部设计模式；
- 测试文件的位置和组织方式；
- 尚未经过架构分析的库或框架选择。

只有外部协议、部署环境、安全合规要求、现有项目不可替换的基础技术，以及已经明确确认的全局架构决策，才可以作为技术约束写入 SPEC。

Coding Agent 应当在执行 TASK 时检查实际代码，再自主决定实现位置、模块结构和技术细节。

## 分析要求

编写前必须：

1. 完整理解原始需求。
2. 检查当前代码库的架构和既有能力。
3. 梳理领域边界、模块职责和依赖方向。
4. 梳理核心数据流、状态流和异常路径。
5. 识别需求与现有架构之间的冲突。
6. 区分业务事实、架构不变量和实现细节。

如果现有架构不合理，应在 SPEC 中描述目标边界和必须保持的不变量，但不要直接指定具体重构文件或实现步骤。

## SPEC 文档结构

请使用以下结构：

# 系统规格

## 1. 系统目标

描述系统要解决的问题，以及完成后用户能够获得的核心能力。

## 2. 非目标

明确本系统当前不处理的范围，防止 Coding Agent 自行扩展需求。

## 3. 用户角色与使用场景

描述主要角色、触发条件、操作流程和预期结果。

## 4. 领域模型与业务规则

定义核心领域概念、关系、约束、唯一性规则和业务不变量。

## 5. 功能需求

按可观察行为描述系统能力。

每项需求必须包含：

- 触发条件；
- 输入；
- 系统行为；
- 输出；
- 正常结果；
- 关键异常结果。

不要描述具体文件或编码步骤。

## 6. 数据流与状态流

描述数据从输入到持久化、处理和输出的完整流向。

对于有生命周期的实体，明确：

- 状态集合；
- 合法状态转换；
- 转换条件；
- 非法转换的处理方式；
- 失败和恢复语义。

## 7. 模块边界

描述模块职责和依赖方向，包括：

- 每个模块负责什么；
- 不负责什么；
- 模块之间通过什么语义协作；
- 哪些跨层调用和隐式状态被禁止。

只描述逻辑边界，不预设具体文件和类。

## 8. 外部契约

描述需要稳定的 API、事件、数据格式、错误语义或第三方集成约束。

只有真正需要跨边界稳定的内容才应冻结。

## 9. 非功能要求

使用可验证标准描述：

- 安全性；
- 数据一致性；
- 性能；
- 可恢复性；
- 可观测性；
- 可维护性；
- 可测试性。

避免使用“性能良好”“结构清晰”等无法判断的表述。

## 10. 验收标准

列出系统完成后必须能够独立验证的结果。

每项验收标准都应具有明确输入、操作和预期输出。

浏览器或视觉结果可以列为人工验收项，但 Coding Agent 不得自动启动浏览器。

## 11. 待确认问题

只列出无法从需求和代码推导、且会实质影响业务边界或架构方向的问题。

如果没有待确认问题，明确写“无”。

## 12. 需求契约

本章节为固定章节，内容必须是恰好一个 ```yaml 代码块，声明非空 `requirements` 数组。每条 requirement 声明稳定 ID（`REQ-大写片段-数字`）、是否 mandatory 和最低证据强度：

```yaml
requirements:
  - id: REQ-BUILD-001
    mandatory: true
    evidencePolicy:
      allowedCriterionKinds: [command]
      requiredPlatformIds: []
      requiredResponseSchemas: []
      requiredEvidence: []
      finalCandidateRequired: false
```

`evidencePolicy` 规则：

- `allowedCriterionKinds` 非空，只允许 `command` / `static` / `human` / `external`；
- `requiredPlatformIds` 只能引用支持平台矩阵中的稳定 platformId；
- `requiredResponseSchemas` 使用版本化 ID（以 `_vN` 结尾）；
- `requiredEvidence` 使用小写 snake_case evidence 种类；
- `finalCandidateRequired` 声明该 requirement 是否必须在最终候选上重新证明。

覆盖判定的最低强度规则（详见 `docs/HostExecutionPolicy.md`）：criterion 引用 requirement 不等于覆盖——只有 kind 命中 `allowedCriterionKinds`、平台命中 `requiredPlatformIds`（command 必须声明落在其中的 platformId，static 不能绑定平台）、`responseSchema` 命中 `requiredResponseSchemas` 且 `requiredEvidence` 完整覆盖的 criterion 才计入覆盖；错误 kind、弱证据或其他平台不能冒充覆盖。TASK criterion 只证明里程碑候选，每条 mandatory requirement 必须至少有一条满足强度的 integration criterion，否则项目在 Agent 启动前被拒绝。

## 13. 支持平台矩阵

本章节为固定章节，内容必须是恰好一个 ```yaml 代码块。每个目标平台声明稳定 platformId、OS、架构、runtime/toolchain、包管理器和换行策略：

```yaml
supportedPlatformMatrix:
  - platformId: windows-4k-target-gpu
    os: windows
    arch: x64
    runtime: node-22
    toolchain: pnpm-11
    packageManager: pnpm
    lineEndingPolicy: crlf
```

没有目标平台的项目使用 `supportedPlatformMatrix: []`，但任何 platformId 引用（command criterion、requirement evidence policy）都必须指向矩阵中的真实条目。`os` 只允许 `windows` / `linux` / `darwin`，`arch` 只允许 `x64` / `arm64`，`lineEndingPolicy` 只允许 `lf` / `crlf`。

## 14. 集成验收契约

本章节为固定章节，内容必须是恰好一个 ```yaml 代码块，声明与 TASK 验收契约同构的 `criteria` 数组（规范键为 `integration/<criterion-id>`）。集成条款至少覆盖：项目可用的完整 lint、typecheck、test、build 门禁；跨模块架构和数据流验收；干净 checkout 或等价可移植性验证；项目要求的性能、视觉、数据来源和人工验收。

criterion 的 kind、字段、执行描述和稳定 ID 规则与 TASK 验收契约完全一致（见 `docs/Task.md` 的验收契约章节）。每条 integration criterion 必须通过 `requirementRefs` 引用本 SPEC 中存在的 requirement，每条 mandatory requirement 至少要有一条满足其 evidencePolicy 最低强度的 integration criterion；command 引用的 package manager、executable、env/dependency profile 和 platform 必须来自宿主 HostExecutionPolicySnapshot 中已有的稳定 ID，缺失时 Run 创建前校验会以“宿主 capability 缺失”失败，而不是把合同判为非法。

## 输出要求

- `orchestration/SPEC.md` 必须自包含，后续 Coding Agent 不需要依赖聊天记录理解需求。
- 必须包含 `## 需求契约`、`## 支持平台矩阵`、`## 集成验收契约` 三个固定章节，且每个章节只携带一个 ```yaml 代码块；缺失、重复或形状非法的章节会让项目在 Agent 启动前被拒绝。
- 使用确定、可验证的语言。
- 不写 TASK 顺序。
- 不写文件修改清单。
- 不写逐步实现方案。
- 不为旧代码、旧数据或旧契约保留兼容、fallback 或 deprecated 设计。
- 不确定的重要决策不得自行发明，应写入“待确认问题”。