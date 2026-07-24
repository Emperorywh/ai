---
id: TASK-002
title: 编译结构化项目验收契约
---

## 任务描述

### 可验证结果

项目加载时能够把 SPEC 的 requirements、支持平台矩阵、集成条款和每个 TASK 的验收契约解析为冻结、strict、可规范哈希的运行输入；格式错误会在任何 Agent 启动前被拒绝。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 7.1、7.2、10.3.1、14.4、20.1 和 21 节。
- TASK-001 交付的 source hash、contract projection、规范编码和路径校验能力。
- 当前项目加载器只解析 TASK 的 `id`、`title`、自由正文和数字顺序。

### 输出

- requirements、evidence policy、supported platform matrix、integration criteria 和 TASK criteria 的 strict 领域契约。
- `command`、`static`、`human`、`external` 四类 criterion 及各自必需字段的解析能力。
- package script/argv 结构化执行描述，不接受 raw shell 或参数拼接语义。
- 带 TASK/integration scope 的规范 criterion key，以及 SPEC/TASK/requirement/platform/task-set 的稳定合同身份。
- 与新文档契约一致的初始化模板、说明文档和解析自动化测试。

### 实现约束

- TASK YAML 前置元数据仍只能包含 `id` 和 `title`；验收契约只从正文固定章节读取。
- human/external 必须包含 procedure、结构化 expected、非空 required evidence 和版本化 response schema。
- command 引用的 package manager、executable、env/dependency profile 和 platform 只保存稳定 ID，不携带实现、绝对路径或凭据。
- unknown kind、未知字段、重复规范键、空描述和非法 execution 必须 fail closed。
- 不从旧自由文本推测或自动补全验收条款，不保留宽松/legacy parser。
- Markdown/YAML 和文件 I/O 留在基础设施；领域层只接收已经解析的规范值。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：加载包含四类 criterion、requirements、平台矩阵和 integration criteria 的完整项目，验证规范键和各合同哈希稳定。
3. 正常路径：验证等价换行不会改变 contract hash，正文或结构化契约变化会改变相应身份。
4. 异常路径：验证缺失验收契约、未知 kind、重复/裸 criterion ID、raw shell、非法 argv、缺少 human/external 字段和悬空稳定 ID 的语法形状均被拒绝。
5. 安全路径：验证项目文档不能通过内嵌路径、命令或凭据扩大宿主执行能力。

### 完成标准

- 全部项目契约均能在 Agent 启动前严格解析并形成规范身份。
- 全部自动化验证通过，TASK-001 的规范哈希和当前数字线性排序行为保持有效。
- 模板与文档同步，不存在自由文本推测、自动补全、旧格式 fallback 或第二套 parser。
- 模块边界没有把 YAML/Markdown/文件系统泄漏到领域规则。
- 可创建独立 Git checkpoint，并安全进入 requirement coverage 判定。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除结构化验收契约解析和模板/文档更新；TASK-001 的规范哈希与当前 v6 项目加载路径保持完整。
