# 规范编码与哈希边界

本文是 TASK-001 的架构契约：系统中所有进入证据链的摘要只有一个计算入口、一条编码管道和一套显式版本升级规则。实施规格见 `SupervisedExecutionLoopSpec.md` 第 5.2、7、8.5、14.4、17 与 20.1 节。

## 1. 唯一入口

`ports/canonical-hash.ts` 的 `CanonicalHashService` 是所有证书、manifest、结构化 evidence、契约投影和 trailer 引用的唯一哈希端口；`infrastructure/canonical/node-canonical-hash-service.ts` 的 `NodeCanonicalHashService` 是唯一生产实现，由组合根创建并注入项目仓储、进度协调器与提交阶段。

端口只暴露两个方法：

- `digestStructured(schema, value)`：结构化对象摘要。`schema` 必须是 `defineCanonicalSchema` 构造的品牌化 `CanonicalSchema`，不存在“不传 Schema 直接对任意对象签发摘要”的方法。
- `digestBytes(bytes)`：原始字节摘要，用于规范化后的源文本和附件字节，不做任何隐式文本或换行归一化。

领域与应用层只依赖规范 DTO 和该端口，不依赖文件系统、Git 或 SDK 类型；摘要算法没有第二套实现，也没有旧算法 fallback。

## 2. 结构化摘要管道

`digestStructured` 固定执行以下顺序，任一环节失败都以 `CanonicalViolationError` 拒绝，禁止清洗后继续：

1. **版本化 strict Schema 校验**：每个规范对象必须携带 `schemaVersion` 字面量；运行时品牌保证 Schema 只能由 `defineCanonicalSchema` 创建，未知字段、缺失字段、错误类型、Schema 外联合分支一律拒绝。
2. **值保留守卫**：双向、递归比对校验前后的自有键、数组形状和标量值；任何删字段、补默认值、trim、coerce 或 transform 都会拒绝，符号键同样拒绝。
3. **JCS 规范编码**（`domain/canonical-json.ts`，遵循 RFC 8785）：对象键按 UTF-16 码元序排列；数字按 ECMAScript `Number::toString` 序列化；字符串最小转义。拒绝非有限数字、孤立代理对、非纯对象、`toJSON` 自定义序列化、符号键、稀疏数组、循环引用和 `undefined`。对象键必须已经是 Unicode NFC，保证规范键唯一且不受平台文本归一化影响。数组保持领域规定顺序，绝不为追求稳定而排序具有业务顺序的数组。
4. **UTF-8 编码**：无 BOM，不附加平台换行。
5. **SHA-256**：外部表示固定为小写十六进制。

YAML 前置元数据与固定章节契约块的重复规范键都由 YAML 解析器 fail closed（`Map keys must be unique`），不会进入哈希。

## 3. SPEC/TASK 源文本与 source hash

`domain/canonical-text.ts` 的 `decodeCanonicalSourceText` 是源文本进入系统的唯一规范化边界：

- 必须是合法 UTF-8（strict 解码）；拒绝 BOM、NUL 与非法字节序列；
- 只允许 CRLF/CR → LF 的换行归一化，其他正文字符逐字节保留。

`sourceHash` 是规范化正文 UTF-8 字节的 `digestBytes` 结果。等价 LF/CRLF 源文件得到相同 source hash；除换行外的任何字节变化都会改变它。

## 4. 契约投影与 contract hash

`domain/project-contract.ts` 定义版本化投影，契约哈希只通过 `digestStructured` 计算：

- `SpecContractProjection`（`schemaVersion: 2`）：完整规范化 SPEC 正文、requirements、supportedPlatformMatrix 和 integrationCriteria。任何业务说明文字或结构化项目契约变化都会改变 contract hash。
- `TaskContractProjection`（`schemaVersion: 2`）：`id`、`title`、完整规范化 TASK 正文、解析后的验收契约和 `specContractHash`。任何业务说明文字变化（包括 YAML 验收块之外的正文）都会改变 contract hash；SPEC 变化经由 `specContractHash` 使全部 TASK 契约失效。规范 criterion key 由 TASK id 与 criterion id 推导，不作为投影字段重复参与哈希。
- `ProjectSourceProjection`（`schemaVersion: 1`）：唯一 SPEC 与按 TASK 数字线性顺序排列的全部源文件 `{path, sourceHash}`，支撑同一 Run 的精确恢复。
- `RequirementSetProjection`（`schemaVersion: 1`）：按 SPEC 声明顺序排列的 requirements，形成独立的 requirement 集合合同身份。
- `PlatformMatrixProjection`（`schemaVersion: 1`）：按 SPEC 声明顺序排列的支持平台矩阵，形成独立的平台合同身份。
- `TaskSetProjection`（`schemaVersion: 1`）：按 TASK 数字线性顺序排列的 `{id, contractHash}`，形成 task-set 合同身份。
- `HostExecutionPolicyProjection`（`schemaVersion: 2`，`domain/host-execution-policy.ts`）：宿主执行策略快照的唯一可哈希形态，绑定显式 `currentPlatformId`、Runner/Sandbox capability、env/dependency profile 与 executable 策略；无目标平台 command 同样必须进入受控 Runner。
- `PredecessorCompletionProjection`（`schemaVersion: 1`，`domain/task-completion.ts`）：`"root"` 或 `{taskId, commitSha}` 联合分支，绑定直接前驱完成提交。

投影中的结构化契约值来自 `domain/acceptance-contract.ts` 的 strict 领域 Schema（requirements、evidencePolicy、平台条目和四类 criterion）；只有协议明确声明可省略的字段才允许归一化默认值（当前仅 `allowNotApplicable: false`）。command 的参数数组和项目内 cwd 必须显式声明，缺失时 fail closed。

前置元数据的 YAML 引号风格等纯格式变化不属于契约：contract hash 不变，但 source hash 与 project hash 会改变。

## 5. 附件摘要契约

`domain/attachment-digest.ts` 的 `AttachmentDigest`（`schemaVersion: 1`）记录 `mediaType`、`byteLength` 和 `contentHash`。二进制和文本附件都按保存后的原始字节计算摘要，禁止隐式换行或文本归一化；媒体类型只接受小写 `type/subtype` 规范形式。附件摘要自身也是可经 `digestStructured` 签发摘要的规范对象。

## 6. Git 路径校验

`domain/canonical-paths.ts` 在项目加载时对全部文档路径 fail closed：

- 必须是仓库相对 POSIX 表示（拒绝绝对路径、盘符、反斜杠、空段、`.`、`..`、控制字符与 NUL）；
- 必须已经是 Unicode NFC；
- 路径集合不得存在规范化碰撞或大小写折叠碰撞；
- 目标平台必须可表示（Windows 拒绝保留设备名、结尾点/空格和非法字符）。

禁止在哈希时静默改写路径。候选 manifest 的路径规则在 TASK-005 复用同一校验。

## 7. 版本升级规则

- 每个可哈希对象的 Schema 内嵌 `schemaVersion` 字面量；协议或 Schema 变更必须显式提升版本号，旧版本对象会被 strict 校验拒绝。
- 不允许静默修改算法、不允许并存两套规范编码入口、不允许“去除未知字段后继续哈希”。
- `TaskContractProjection`/`SpecContractProjection` 已在 TASK-002 升级为 `schemaVersion: 2`，绑定解析后的结构化验收契约；验收 criterion、requirement 或平台 Schema 的后续变更必须再次显式升级。
- 候选内容身份（`CandidateManifest`/`CandidateIdentity`）由 TASK-005 在同一入口上重建；当前的 v6 候选工作树指纹、项目上下文导航指纹与 Git 身份键不属于本边界，分别由其所有任务处理。

## 8. 模块位置与依赖方向

| 模块 | 职责 |
| --- | --- |
| `domain/canonical-schema.ts` | 品牌化版本化 strict Schema、字段保留守卫 |
| `domain/canonical-json.ts` | JCS 编码与 UTF-8 编码 |
| `domain/canonical-text.ts` | 源文本 UTF-8/BOM/NUL 校验与 LF 归一化 |
| `domain/canonical-paths.ts` | Git 路径 NFC、碰撞与平台可表示性校验 |
| `domain/project-contract.ts` | SPEC/TASK/项目源集合契约投影与摘要 |
| `domain/acceptance-contract.ts` | requirements、平台矩阵与四类验收 criterion 的 strict 领域契约、规范键与跨引用校验 |
| `domain/requirement-coverage.ts` | requirement→criterion 覆盖判定与 mandatory integration 启动门禁（规则见 `docs/HostExecutionPolicy.md`） |
| `domain/host-execution-policy.ts` | 宿主执行策略快照的 strict 契约、内部完整性与规范哈希 |
| `domain/host-capability-validation.ts` | Run 创建前 valid / unsupported_contract / configuration_missing 三态校验 |
| `domain/task-completion.ts` | 前驱完成指纹投影 |
| `domain/attachment-digest.ts` | 附件原始字节摘要契约 |
| `ports/canonical-hash.ts` | 唯一哈希端口 |
| `infrastructure/canonical/node-canonical-hash-service.ts` | 唯一生产实现（node:crypto） |
| `infrastructure/tasks/markdown-contract-section.ts` | Markdown 固定章节提取边界 |
| `infrastructure/tasks/file-project-repository.ts` | 加载边界接线：归一化、路径校验、契约解析、投影与摘要 |
