请完整阅读 `orchestration/SPEC.md`，并结合当前代码库的架构、模块边界、数据流和状态流，将 SPEC 拆分为适合 Coding Agent 严格线性执行的 TASK。

本次只生成 TASK 文档，不实现业务功能，不修改业务代码。

## 核心原则

TASK 应冻结：

- 当前任务必须交付的可验证结果；
- 明确输入和输出；
- 相关业务规则和状态不变量；
- 必须遵守的模块边界和依赖方向；
- 验证方式和完成标准；
- `### 验收契约` 章节中的结构化验收 criteria（四类 kind、结构化执行描述、requirement 引用）；
- Git checkpoint 和回退边界。

TASK 不应冻结：

- 需要修改或创建的具体文件；
- 类名、函数名和组件名；
- 逐步编码过程；
- 内部实现模式；
- 不必要的库或框架选择；
- 测试代码的具体组织方式。

Coding Agent 必须先检查任务执行时的实际代码，再自主决定实现位置、模块结构和技术细节。

如果存在外部契约、安全要求、部署约束或已经确认的全局架构决策，TASK 必须遵守，但不要重复设计另一套技术方案。

## 拆分规则

1. 必须按“可验证结果”拆分，不得按时间、前端、后端、数据库、测试或开发阶段机械拆分。
2. 每个 TASK 只交付一个高内聚结果。
3. 每个 TASK 都要有明确输入、输出、验证方式、完成标准和回退边界。
4. 每个 TASK 完成后，代码库必须处于一致、可运行、可验证的状态，并可以生成独立 Git checkpoint。
5. 测试、必要重构和相关文档必须包含在产生对应结果的 TASK 中，不要单独拆分。
6. 如果现有架构无法正确支持结果，应把必要重构纳入最早需要它的 TASK。
7. 禁止通过临时 patch、重复逻辑、跨层耦合或兼容旧实现完成任务。
8. 先定义可验证结果，再使用大约 20～60 分钟作为粒度检查标准，禁止按时间本身拆任务。
9. 如果任务明显过大，应按照独立用户行为、状态转换、数据闭环、接口契约或异常场景继续拆分。
10. 拆分后的每个结果必须能够独立验证，不能依赖后续 TASK 才能证明完成。

## 线性执行规则

- 使用 `TASK-001`、`TASK-002`、`TASK-003` 格式编号。
- TASK 按 ID 数字顺序严格线性执行。
- 只有前一个 TASK 完成后，才能执行下一个 TASK。
- 每个 TASK 必须建立在此前所有 TASK 已完成的代码状态上。
- 后续 TASK 不得成为当前 TASK 的完成条件。
- 任一 TASK 失败或阻塞时，后续 TASK 保持未执行状态。

## 线性一致性与阻塞前置检查

- 严格线性队列不支持“本 TASK 阻塞但部分后续 TASK 仍可并行推进”或“只阻塞若干未来 TASK”的语义。若存在可独立交付的结果，必须把它们排在潜在阻塞 TASK 之前；不得在 TASK 正文中声明绕过线性顺序。
- 每个 TASK 的输入只能依赖 SPEC、现有代码和此前已经完成的 TASK，不得同时把当前未完成结果列为后继 TASK 的可选输入。
- 如果某项核心交付物依赖项目内没有的外部数据、凭据、真实人工核对记录或不可逆产品决策，必须停止生成受影响 TASK，并在最终结果中列出待确认问题；不得生成一个注定只能返回 `blocked` 的执行单元。
- 人工浏览器、视觉或发布验收可以作为已完成代码候选的后置验收清单，但不得成为 Worker 创建 Git checkpoint 前必须伪造或自行完成的事实。
- 拆分完成后必须反向检查每个 TASK：假设它因实现约束返回 `blocked`，所有数字编号更大的 TASK 都必须确实不能启动；否则说明顺序或任务边界无效，必须重新拆分。

## TASK 文档格式

每个 TASK 必须严格采用以下格式，YAML 前置元数据只能包含 `id` 和 `title`：

---
id: TASK-001
title: 简洁描述本任务交付的结果
---

## 任务描述

### 可验证结果

描述完成后新增了什么可以直接观察和验证的能力。

### 输入

列出相关 SPEC 条款、现有系统能力，以及此前 TASK 已交付的结果。

### 输出

列出需要交付的业务行为、领域能力、接口、状态变化、测试和必要文档。

输出应描述能力和契约，不要写具体文件修改清单。

### 实现约束

列出必须遵守的业务规则、状态不变量、模块边界和依赖方向。

具体实现位置和技术细节由 Coding Agent 检查当前代码后决定。

### 验证方式

给出可以实际执行的验证步骤，包括：

- 验证命令；
- 正常路径；
- 关键异常路径；
- 明确预期结果。

不得自动启动浏览器。界面和视觉要求只能记录为人工验收事项。

### 完成标准

明确列出可以创建 Git checkpoint 的条件，至少保证：

- 可验证结果已经实现；
- 相关自动化验证通过；
- 此前 TASK 的行为没有被破坏；
- 没有遗留临时逻辑、重复实现或跨层耦合；
- 代码库可以安全进入下一个 TASK。

### 回退边界

说明回退本 TASK 的 Git checkpoint 时，只会移除本 TASK 新增的结果，不会破坏此前完成的能力。

### 验收契约

本 TASK 完成判定的唯一机器门禁，必须是恰好一个 ```yaml 代码块：

```yaml
criteria:
  - id: AC-001
    requirementRefs: [REQ-BUILD-001]
    kind: command
    scope: full
    execution:
      kind: package_script
      packageManager: pnpm
      script: test
      args: []
      cwdRelative: .
      timeoutMs: 900000
      envProfile: project_test
      dependencyProfile: pnpm_frozen
    success: exit_code_zero
    allowNotApplicable: false
    description: 全量测试通过
```

验收契约规则：

1. 每个 TASK 必须有且仅有一个 `### 验收契约` 章节，章节内只允许一个 ```yaml 代码块，不允许散文或第二个代码块；`criteria` 必须是非空数组。
2. criterion 只允许四类 kind：
   - `command`：由宿主 VerificationRunner 真实执行，必须声明 `scope`（`targeted` / `full` / `clean_platform`）、结构化 `execution` 和 `success`（当前只支持 `exit_code_zero`）；`scope: clean_platform` 时必须额外声明存在于支持平台矩阵中的 `platformId`。
   - `static`：由独立 Reviewer 逐条给出 disposition，只有基础字段。
   - `human`：由操作者按规定 `procedure` 验收，必须包含非空 `procedure`、结构化 `expected`（`metric` / `operator` / `value`）、非空 `requiredEvidence` 和版本化 `responseSchema`（以 `_vN` 结尾）。
   - `external`：依赖项目外事实或凭据就绪声明，字段要求与 `human` 相同。
3. `command` 不接受 raw shell 字符串；`execution` 只允许 `package_script`（packageManager、script、args、cwdRelative、timeoutMs、envProfile、dependencyProfile）或 `argv`（executable、args、cwdRelative、timeoutMs、envProfile）。参数逐项传递且不得包含 shell 拼接语义（`;`、`&&`、`|`、`>`、反引号、`$(`、`${` 等）；`cwdRelative` 只能是 `.` 或项目内相对 POSIX 路径。
4. package manager、executable、env/dependency profile 和 platform 只引用宿主 HostExecutionPolicySnapshot 中已有的稳定 ID，TASK/SPEC 不得定义实现、绝对路径或凭据。
5. 每条 criterion 必须通过 `requirementRefs` 引用 SPEC 中存在的 requirement；`id` 使用 `AC-数字`（至少三位）且在同一文档内唯一；`description` 不能为空；`allowNotApplicable` 默认 `false`，只有显式设为 `true` 才允许 Reviewer 给出带理由的 `not_applicable`。
6. 未知 kind、未知字段、重复规范键、空描述、非法执行描述、缺失必填字段或悬空稳定 ID 都会在 Agent 启动前拒绝整个项目；不要写自由文本验收描述，系统不会从旧正文推测或自动补全验收条款。

## 工作流程

1. 阅读完整 SPEC。
2. 检查相关现有代码。
3. 梳理领域边界、数据流和状态流。
4. 提取 SPEC 中全部可验证结果。
5. 将结果组织成严格线性序列。
6. 检查每个 TASK 的独立验证能力和 Git checkpoint 边界。
7. 检查所有外部数据、人工核对和不可逆决策是否已具备；缺失时停止生成受影响 TASK。
8. 检查不存在“局部阻塞仍继续后继”或其他并行语义。
9. 检查每项 SPEC 要求是否被完整覆盖。
10. 在 `orchestration/tasks` 中生成 TASK Markdown 文件。
11. 不保留与本次拆分结果无关的旧 TASK 文档。
12. 最终列出 TASK 顺序，并简述每个 TASK 的可验证结果。

如果 SPEC 存在无法从文档和代码推导、且会实质影响任务边界的关键问题，不要自行发明需求。停止生成受影响的 TASK，并列出需要确认的问题。
