# 宿主执行策略与启动能力校验

本文是 TASK-003 的架构契约：requirement 覆盖判定、产品级 `HostExecutionPolicySnapshot` 与 Run 创建前宿主能力校验的规则边界。实施规格见 `SupervisedExecutionLoopSpec.md` 第 7.2、10.3.1、15.1、20.1 与 21 节。

## 1. 职责分离

| 职责 | 位置 | 说明 |
| --- | --- | --- |
| 契约规则（覆盖判定） | `domain/requirement-coverage.ts` | 确定性纯函数，只消费冻结的 requirements 与 criteria，不接受 Worker/Reviewer 自报矩阵 |
| 宿主策略来源 | `domain/host-execution-policy.ts` | 只读快照契约、解析与规范哈希；宿主配置的编译属于组合根（后续 TASK） |
| 启动校验结果模型 | `domain/host-capability-validation.ts` | 把“合同非法”与“宿主缺能力”分成可恢复的不同诊断 |
| 运行状态表达 | 后续 TASK | 已创建 Run 缺能力时按 SPEC 进入 `paused/configuration`，不生成人工替代请求 |

## 2. RequirementCoverageValidator

覆盖判定逐条比较 criterion 与 requirement 的 `evidencePolicy` 最低强度，任一维度不满足即驳回并记录稳定机器码：

- `kind_not_allowed`：criterion kind 不在 `allowedCriterionKinds` 中。`human`/`external` 只有 evidence policy 显式允许时才能覆盖对应 requirement。
- `command_missing_platform` / `platform_not_required`：policy 声明 `requiredPlatformIds` 时，command criterion 必须声明落在其中的 `platformId`；未声明 platformId 的 command 运行在宿主平台，宿主结果不能替代其他目标平台。
- `static_cannot_bind_platform`：static criterion 不能提供平台绑定证据。
- `response_schema_not_allowed`：policy 声明 `requiredResponseSchemas` 时，只有 human/external criterion 且 `responseSchema` 命中才算数。
- `required_evidence_missing`：policy 声明 `requiredEvidence` 时，只有 human/external criterion 且 `requiredEvidence` 完整覆盖才算数。

平台受限 requirement 要求每个必需平台都有可绑定证据：command criterion 只证明其声明的 platformId；human/external criterion 由操作者在目标平台执行 procedure，契约期只证明其覆盖资格，真实平台匹配在验收时经 required evidence（如 `environment_manifest`）核对。

scope 语义：

- TASK criterion 只证明里程碑候选，永远不能替代 final-candidate integration evidence。
- 每条 mandatory requirement 必须至少有一条满足强度的 integration criterion（启动门禁）；缺失时项目在 Agent 启动前被 `FileProjectRepository` 拒绝。
- `finalCandidateRequired: true` 的 requirement 只有 integration 覆盖计入最终证明。

判定结果随 `LoadedProject.requirementCoverage` 冻结，是后续 evidence 矩阵的可信合同根；报告只保存规范 criterion key（`task:<TASK-ID>/<criterion-id>` 或 `integration/<criterion-id>`），相同冻结输入永远得到相同报告。

## 3. HostExecutionPolicySnapshot

`HostExecutionPolicySnapshot`（`schemaVersion: 1`）是产品级只读输入，由组合根从宿主配置编译，在 Run 创建时经唯一规范哈希入口计算 `hostExecutionPolicyHash` 并冻结进 Run 契约。字段：

- `platformCapabilities`：每个 platformId 至多一条 RunnerCapability（`runnerId`、`local`/`remote`、`sandboxCapabilityId`、`trustIdentity`），保证按 platformId 路由唯一确定。
- `sandboxCapabilities`：只有通过平台一致性 conformance 的 OS 隔离能力才允许发布；未通过 conformance 的宿主不得把对应条目编译进快照。
- `envProfiles`：环境变量白名单与 secret 绑定 ID；不携带凭据值。
- `dependencyProfiles`：支持的 package manager、网络策略（离线 / 受限 provisioning 后断网）与 lifecycle script 策略。
- `executablePolicies`：argv executable 的实现、固定参数前缀与允许平台集合。

项目文档（TASK、SPEC、项目 settings、skill、MCP、CLI 参数）只能引用快照中已有的稳定 ID，不能定义或覆盖其实现。解析边界与项目契约同样 fail closed：未知字段、旧 `schemaVersion`、重复 ID、重复 platformId、悬空 `sandboxCapabilityId` 引用和非法 ID 形状都会被拒绝。

## 4. Run 创建前的三态校验

`validateRunStartupCapabilities` 按固定顺序产生恰好一种结果：

1. `unsupported_contract`：覆盖门禁失败，合同自身无效。诊断携带失败 requirement 及每个驳回候选的机器码，必须修改项目契约，不能靠配置宿主解决。
2. `configuration_missing`：合同有效，但快照缺少 command criterion 引用的能力。诊断逐条绑定规范 criterion key 与缺失的宿主稳定 ID：`missing_env_profile`、`missing_dependency_profile`、`unsupported_package_manager`、`missing_executable_policy`、`executable_platform_not_allowed`、`missing_runner_capability`、`missing_sandbox_capability`。操作者配置宿主能力后重试即可恢复；新 Run validate 失败，已创建 Run 按 SPEC 进入 `paused/configuration`。
3. `valid`：全部引用可解析，返回 `hostExecutionPolicyHash` 供 Run 契约冻结。

两类失败都是结构化事实，永远不降级为人工日志，也不生成可批准的人工替代请求；human/external 回答永远不能冒充 command criterion 的 `system_verification`。新 Run 即使复用全部 TASK 完成提交，也必须重新执行本校验。

宿主配置的编译（从真实宿主配置生成快照、conformance 发布流程）与 `paused/configuration` 的状态表达属于后续 TASK；本 TASK 不决定产品实际支持哪些 OS/架构，也不发布任何未经 conformance 的 capability。
