---
id: TASK-003
title: 判定需求覆盖与宿主能力引用
---

## 任务描述

### 可验证结果

系统能够证明每条 mandatory requirement 被足够强的 TASK/integration criteria 覆盖，并能在 Run 创建前区分“项目契约无效”和“宿主尚无相应 capability”，避免弱证据、错误平台或项目自定义权限冒充覆盖。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 7.2、10.3.1、15.1、20.1 和 21 节。
- TASK-001 的规范哈希边界。
- TASK-002 已解析的 requirements、criteria、平台矩阵和稳定宿主策略引用。
- 当前仓库没有 requirement coverage 或 host capability validation 的现状。

### 输出

- requirement→criterion 覆盖判定，校验 kind、platform、response schema、required evidence 和 final-candidate policy 的最低强度。
- 每条 mandatory requirement 至少有一个 integration criterion 的启动门禁。
- 产品级只读 HostExecutionPolicySnapshot 契约及规范哈希，项目只能引用其已有 ID。
- Run 创建前的 host capability 校验结果模型，明确 valid、configuration missing 和 unsupported contract 的差异。
- 覆盖弱证据、缺能力和权限越界的自动化测试及必要文档。

### 实现约束

- TASK criterion 只能证明里程碑候选，不能替代 final-candidate integration evidence。
- human/external 只有在 requirement evidence policy 明确允许时才可覆盖对应 requirement，且永远不能满足另一个 command criterion。
- platform、runner、sandbox、env、dependency 和 executable ID 必须来自宿主只读快照；项目 settings、skill、MCP 或 CLI 不能扩大它。
- 缺 mandatory command/platform capability 时，新项目校验或已创建 Run 的状态语义必须按 SPEC 区分，不能生成人工替代请求。
- 本 TASK 不决定产品实际支持哪些 OS/架构，也不发布任何未经 conformance 的 capability。
- 覆盖判定是确定性领域规则，不接受 Worker/Reviewer 自报矩阵。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：对四类 criterion 验证 requirement coverage、规范键和 evidence policy hash 可重算。
3. 正常路径：验证完整 host snapshot 中的 Runner/Sandbox/env/dependency/executable 引用可满足启动前 capability 检查。
4. 异常路径：验证悬空 requirementRef、mandatory requirement 无 integration criterion、弱 kind、错误 platform/schema/evidence、缺 final-candidate policy 和项目越权 ID 均不能形成覆盖。
5. 配置路径：验证“合同非法”与“合同有效但宿主 capability 缺失”产生不同且可恢复的诊断，不降级为人工日志。

### 完成标准

- requirement coverage 与 host capability 引用能由冻结输入确定性判定。
- 全部自动化验证通过，TASK-001/002 的规范合同身份保持一致。
- 没有 Agent 自报覆盖、弱证据降级、空平台矩阵规避或项目扩大产品权限的路径。
- 契约规则、宿主策略来源与运行状态表达职责分离。
- 可创建独立 Git checkpoint，并为 artifact 和后续证据链提供可信合同根。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除覆盖判定、宿主策略引用校验和对应测试/文档；结构化合同解析及规范哈希仍然存在。
