---
task_id: TASK-031
execution_status: completed
modified_files:
  - src/cli/commands/init.ts
created_files:
  - src/cli/config/provider-profile.ts
  - test/cli/config/provider-profile.test.ts
  - docs/tasks/TASK-031-cli-provider-profile.result.md
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "0 错误（tsc --noEmit 覆盖 src + test，strict + noUncheckedIndexedAccess）"
  - command: npm test -- cli/config/provider-profile
    result: passed
    notes: "32 项全过（DEFAULT 合法性 3 / parseProfileConfig schema 校验含三档缺映射报错 8 / resolveProfile 4 / anthropic env 2 / glm env 3 / env 展开覆盖 3 / token 缺失 2 / composeProviderEnv 3 / readProfileConfig I/O 2 / init 产物含两 profile 2）"
  - command: npm run lint
    result: passed
    notes: "eslint 0 错误"
  - command: npm test -- cli/init
    result: passed
    notes: "9/9 全过——DOC_FILES 追加 .caw/config.json 后 init 测试无回归（EXPECTED_PATHS 动态派生自 DOC_FILES 自动跟上；DOC_DOC_PATHS.length===8 仍成立，因 .caw/config.json 不在 docs/ 下）"
  - command: npm test
    result: passed
    notes: "全量 724 项无回归（原 692 + provider-profile 32）。Node v22.23.1（ABI 127，满足 ISS-005）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "- TASK-031（Provider Profile 配置读取 + SDK env 组装）已完成：`src/cli/config/provider-profile.ts`（cli 配置层）提供多 provider 接入的配置读取 + SDK env 组装——`ProfileConfigSchema`/`ProviderProfileSchema`/`ModelMappingSchema`（zod 单一来源 + z.infer 派生类型，三档 haiku/sonnet/opus 强制全映射 .strict()，缺档/空串报错 R-PROVIDER）+ `parseProfileConfig(raw)`（JSON.parse + zod 校验，非法 JSON / schema 失败抛 ProviderConfigError）+ `readProfileConfig(configPath)`（文件 I/O 薄包装）+ `resolveProfile(config, providerOverride?)`（启用 profile 选用：override 优先否则 config.provider，不存在抛 ProviderConfigError；只做选用纯逻辑不做 commander 解析）+ `buildProviderEnv(profile, {env?})`（§6 公式组装 SDK env：`{ ...stringEnv(env), [tokenKey]: token, ...(baseUrl?{ANTHROPIC_BASE_URL}:{}), ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ...extraEnv }`——token 注入键按 baseUrl 推断：null→官方 ANTHROPIC_API_KEY / 非空→第三方 ANTHROPIC_AUTH_TOKEN（R-PROVIDER）；token 从 profile.authTokenEnv 指定的环境变量读、缺失/空串抛 ProviderTokenMissingError；stringEnv 剔除 undefined 规范化为 Record<string,string>；extraEnv 最后展开可覆盖前键）+ `composeProviderEnv(config, {providerOverride?, env?})`（resolve+build 便利入口，供 034/035）。`DEFAULT_PROFILE_CONFIG`（预置 anthropic + glm，modelMapping/authTokenEnv/extraEnv 模板，glm 含 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC/API_TIMEOUT_MS）+ `DEFAULT_CONFIG_PATH='.caw/config.json'`。错误体系 ProviderProfileError(base)/ProviderConfigError/ProviderTokenMissingError。纯 cli 配置层：不 import sdk-client（§7 env 组装是纯逻辑）/core/application/infrastructure（forbidden 守住）、不调 SDK、不做 CLI --provider 接线（归 034/035）。32 项单测。`init.ts` 往 DOC_FILES 追加 `.caw/config.json`（内容取 DEFAULT_PROFILE_CONFIG JSON.stringify 单一来源），caw init 产物现含两个 profile 模板（SPEC §6/§13.2）。"
    - section: "当前系统可用能力"
      mode: append
      content: "- Provider Profile 配置读取 + SDK env 组装：`provider-profile.ts`（`src/cli/config/provider-profile.ts`）是多 provider 接入的配置层，被 task-run/task-review（034/035）调用组装 env 后传给 invocation/reviewer（composition root 装配），是 032/033/034/035 共同依赖（SPEC §6 P0）。`parseProfileConfig(raw): ProfileConfig` 把 .caw/config.json 文本解析 + zod 校验（ProfileConfigSchema = provider + profiles 字典；ProviderProfileSchema = baseUrl(string|null)/authTokenEnv/modelMapping(三档)/extraEnv，全 .strict() 拒多余键；ModelMappingSchema 三档 haiku/sonnet/opus 各 min(1)，缺档报错）；`readProfileConfig(configPath)` 读文件 + parse；`resolveProfile(config, providerOverride?)` 选启用 profile（override→--provider，否则 config.provider，不存在抛错）；`buildProviderEnv(profile, {env=process.env})` 按 §6 公式产 SDK env——token 注入键 baseUrl 推断（null→ANTHROPIC_API_KEY 官方 / 非空→ANTHROPIC_AUTH_TOKEN 第三方）、token 从 authTokenEnv 环境变量读缺失抛 ProviderTokenMissingError、展开 ...process.env（stringEnv 剔 undefined）、三档写 ANTHROPIC_DEFAULT_*_MODEL、extraEnv 最后展开；`composeProviderEnv` 一步串联。`DEFAULT_PROFILE_CONFIG` 预置 anthropic(baseUrl null, ANTHROPIC_API_KEY, claude-haiku-4-5/sonnet-5/opus-4-8) + glm(baseUrl 智谱端点, ZHIPU_API_KEY, glm-4.7/5.2/5.2, extraEnv 含长超时 API_TIMEOUT_MS=3000000 + 禁非必要流量 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1)，作为 caw init 产物与默认值单一来源。token 只从 authTokenEnv 环境变量读、不落配置明文（§7）。zod 最小 schema 校验（任务 §8），P1 再考虑提升 core 正式 schema 化。"
    - section: "当前架构状态"
      mode: append
      content: "- `src/cli/config/provider-profile.ts` 建立：仅依赖 `zod`（cli 层已用，plan/task-create 同模式）+ `node:fs`（readFileSync），零反向依赖（不 import core/application/infrastructure/sdk-client——forbidden 守住；§7 env 组装是纯逻辑不触达 SDK）。沿用「Zod schema 单一来源 + z.infer 派生类型 + 纯函数 + Result 错误」模式：三 Schema（ModelMapping/ProviderProfile/ProfileConfig）.strict() 拒多余键 + 三档 min(1) 强制全映射；parseProfileConfig（JSON.parse + safeParse，非法抛 ProviderConfigError 不静默）/ resolveProfile（选用纯逻辑）/ buildProviderEnv（§6 公式组装，tokenEnvKey 按 baseUrl 推断注入键、stringEnv 剔 undefined 规范化 ProcessEnv→Record<string,string>、token 缺失抛 ProviderTokenMissingError）/ composeProviderEnv（resolve+build 便利）。错误体系 ProviderProfileError(base extends Error)+ProviderConfigError+ProviderTokenMissingError（复用项目既有 Error 子类范式）。DEFAULT_PROFILE_CONFIG（预置两 profile）+ DEFAULT_CONFIG_PATH 作单一来源导出。`noUncheckedIndexedAccess` 下 env[authTokenEnv]（string|undefined）/ profiles[name]（undefined）显式判空守卫。`src/cli/commands/init.ts` 修改：import 同层 DEFAULT_PROFILE_CONFIG（cli 内部互调，不违反 init「不依赖 core/application/infrastructure 领域逻辑」——provider-profile 是 cli 层纯数据常量）+ DOC_FILES 追加 `{path:'.caw/config.json', content: JSON.stringify(DEFAULT_PROFILE_CONFIG,null,2)+'\\n'}`（CONFIG_JSON_TEMPLATE 单一来源，模板内 token 仅环境变量名无明文）+ 顶部职责注释补「生成 .caw/config.json（TASK-031/SPEC §6）」。init 产物现 10 个文件（原 9 + .caw/config.json），.caw/ 目录随写由 mkdirSync recursive 建立。init.test.ts 不在 allowed 未改：其断言全从 DOC_FILES 动态派生（EXPECTED_PATHS），追加后自动跟上仍全绿；仅测试标题「不创建 docs/ 以外」注释语义与新行为有张力（断言不失败，见 ISS-021）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "- Provider Profile 复用要点（TASK-031）：`composeProviderEnv(config, {providerOverride?, env?})`（`src/cli/config/provider-profile.ts`）是 TASK-034（task:run 接线）/ TASK-035（task:review 接线）组装 SDK env 的入口——读 .caw/config.json（readProfileConfig，默认路径 DEFAULT_CONFIG_PATH='.caw/config.json'，可接 --config 覆盖）→ composeProviderEnv（或分两步 resolveProfile + buildProviderEnv）→ 把返回的 Record<string,string> 传给 sdk-client 的 SdkSessionInput.env（TASK-030）。`providerOverride` 接 --provider，`env` 默认 process.env（生产）但**单测须注入 fake env**（隔离真实环境，断言注入键/缺失/展开）。token 注入键随 provider（R-PROVIDER）：buildProviderEnv 据 profile.baseUrl 推断——null→ANTHROPIC_API_KEY（官方）/ 非空→ANTHROPIC_AUTH_TOKEN（第三方兼容端点 bearer），SPEC §6 ⚠ 明文两键不同。token 从 profile.authTokenEnv 指定的环境变量读（anthropic→ANTHROPIC_API_KEY / glm→ZHIPU_API_KEY），缺失/空串抛 ProviderTokenMissingError——034/035 须 catch 此错并据 --executor dry-run 决定兜底或报错（SPEC §6「key 缺失：缺失则显式 --executor dry-run 才兜底，否则报错不静默」）。env 组装公式（§6）：`{ ...process.env, [tokenKey]:token, ...(baseUrl?{ANTHROPIC_BASE_URL}:{}), ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ...extraEnv }`——必须展开 ...process.env（SDK env 整体替换子进程环境，§12），extraEnv 最后可覆盖前键。三档强制全映射（schema min(1)，缺档 parseProfileConfig 报错）——Claude Code 内部按任务复杂度自动选档，漏档致内部调用失败。TASK-032/033 经 sdk-client runSdkSession 跑自主/审查会话时，env 由 034/035 经本模块组装后注入 SdkSessionInput.env（sdk-client buildSdkOptions 透传 env 到 options.env）。DEFAULT_PROFILE_CONFIG 是 caw init 产物与默认值单一来源，新增 provider（deepseek P1）在此扩展 + init 自动跟上。配置 schema 未提升 core（P1），当前就近 cli/config 用 zod 最小校验够用。详见 DEC-032 + ISS-021。"
    - section: "当前未解决问题摘要"
      mode: append
      content: "- ISS-021（low，open）新增自 TASK-031：init.test.ts（不在本任务 allowed_paths，未改）的测试标题与注释因本任务扩展 init 产物（DOC_FILES 追加 `.caw/config.json`）而语义过时——第 69 行测试名「仅写文档骨架，不创建 docs/ 以外的无关文件」与第 75 行注释「docs/ 下文件数恰为清单声明数」现名不副实（.caw/config.json 是 docs/ 以外的 SPEC §6 要求文件）。**断言本身全绿不阻塞验收**：EXPECTED_PATHS 动态派生自 DOC_FILES（自动含 .caw/config.json，created.toContain 白名单通过）、DOC_DOC_PATHS.length===8 只数 docs/ 下（.caw/config.json 不计入，仍 8）。仅测试标题/注释文档张力。建议后续任务（更新 init 测试时）把标题改为「仅写清单内文件」等准确表述。详见 ISS-021。\n- 既有 open issue（ISS-004/005/006/007/008/009/010/011/012/014/015/016/017/019/020）与本任务无触发：provider-profile 纯 cli 配置层（不依赖 SQLite、不改状态机、不触发级联/合并、不调 SDK），Node v22（ISS-005 约束满足）下全绿。ISS-012（SDK 就位）进展：本任务补齐多 provider env 组装（SDK 调用的前置配置层），真实 invocation/reviewer 仍留 TASK-032/033。"
    - section: "建议下一个任务"
      mode: replace
      content: "- **TASK-032（ClaudeSdkInvocation 真实实现）** —— `PLAN_claude-sdk-integration` 第三个任务（layer: data，depends_on TASK-022✅/030✅/031✅ 全 done）。在 `src/infrastructure/sdk/claude-sdk-invocation-impl.ts` 实现 `ClaudeSdkInvocation` 真实类：经 sdk-client（030）`runSdkSession` 跑自主 query + 据 SdkRunReport + 模型 JSON 产出（§4.2 fenced 块提取）组装 SdkRunReport + JSON 重试降级（§4.3）+ 容错分类（§8）+ 中断（§9）。**TASK-032 与 TASK-033（SDK 版 Reviewer，depends_on 027✅/030✅/031✅）互不依赖，031 完成后两者全部解锁且可并行**（032 是执行侧 invocation 实现，033 是审查侧 reviewer 实现，各自独立文件，不互依赖；都复用 sdk-client runSdkSession + provider-profile env 组装结果经 034/035 注入）。拓扑序后续：TASK-034（task:run 接线，depends_on 026✅/032）/ TASK-035（task:review 接线 + CI 真实 API，depends_on 027✅/033）——待 032/033 完成后解锁。provider-profile（031）已就位供 034/035 调 `composeProviderEnv` 组装 env 注入。推进 ISS-012（SDK 真实调用——032/033）/ ISS-016（真实 Reviewer——033）。v0.1.0 终态快照保留于上方各 section。tag/发版（当前 0.1.0/private:true）由人工决定。"
  decisions:
    - id: ""
      title: "Provider Profile schema + SDK env 组装规则——token 注入键按 baseUrl 推断 + 三档强制全映射 + DEFAULT_PROFILE_CONFIG 单一来源供 init"
      status: proposed
      scope: src/cli/config（provider-profile.ts）+ src/cli/commands/init.ts
      created_from_task: TASK-031
      decision: "provider-profile.ts 按 SPEC §6 落地多 provider 配置读取 + SDK env 组装。四项关键设计：(1) token 注入键判定——SPEC §6 表格 + ⚠ 注释明文「官方 anthropic 注入 ANTHROPIC_API_KEY；第三方注入 ANTHROPIC_AUTH_TOKEN」但未给判定字段，本任务据 §6 示例（anthropic.baseUrl=null 官方默认端点 / glm.baseUrl=智谱端点）+ env 公式（baseUrl 三元决定 ANTHROPIC_BASE_URL）推断：**baseUrl==null→ANTHROPIC_API_KEY（官方）/ 非空→ANTHROPIC_AUTH_TOKEN（第三方 bearer）**。官方端点用默认 baseUrl（null），第三方必然指向兼容端点（非空），故 baseUrl 是否存在与官方/第三方天然对应，无需额外声明字段（schema 保持 baseUrl/authTokenEnv/modelMapping/extraEnv 四字段），也未硬编码 profile name（更灵活）。(2) env 组装严格按 §6 公式 `{ ...process.env, [tokenKey]:token, ...(baseUrl?{ANTHROPIC_BASE_URL}:{}), ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ...extraEnv }`——必须展开 ...process.env（SDK env 整体替换子进程环境 §12）、extraEnv 最后展开（后写者覆盖，SPEC 公式顺序）、token 从 authTokenEnv 指定的环境变量读不落配置明文（§7）；stringEnv 辅助把 NodeJS.ProcessEnv 剔除 undefined 规范化为 Record<string,string>（运行时 process.env 自有属性值皆 string，类型标注的 undefined 仅在访问不存在 key 时，展开前剔除保证类型与运行时一致，SDK Dict<string> 兼容）。(3) 三档强制全映射——ModelMappingSchema haiku/sonnet/opus 各 z.string().min(1) + .strict() 拒多余键，缺档/空串 parseProfileConfig 抛 ProviderConfigError（R-PROVIDER：Claude Code 内部按复杂度自动选档，漏档致内部调用失败）。(4) DEFAULT_PROFILE_CONFIG 作为 caw init 产物与默认值单一来源（DRY，AGENTS §3）——init.ts import 同层 DEFAULT_PROFILE_CONFIG + JSON.stringify 生成 .caw/config.json 模板，避免模板与配置模块两处定义漂移；预置 anthropic（baseUrl null/ANTHROPIC_API_KEY/claude-haiku-4-5·sonnet-5·opus-4-8）+ glm（智谱端点/ZHIPU_API_KEY/glm-4.7·5.2·5.2/extraEnv 含 API_TIMEOUT_MS=3000000 传输层长超时 + CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1），deepseek 留 P1。错误体系三态（ProviderProfileError base / ProviderConfigError 配置非法含缺档 / ProviderTokenMissingError token 缺失），显式不静默（AGENTS §3）。"
      rationale: "token 注入键 baseUrl 推断：SPEC §6 未给显式判定字段，但示例 + 公式把 baseUrl null/非空与官方/第三方强绑定（官方用默认端点=baseUrl null，第三方必须指兼容端点=非空），baseUrl 是天然且充分的判据，无需新增 schema 字段或硬编码 profile name（硬编码 name 会限制用户自定义无 baseUrl 的非 anthropic profile）。env 公式逐字段对照 §6 表格 + §12 env 项落地，未自行增减。三档 min(1)+strict：R-PROVIDER 明文「三档必须全部映射」，schema 层强制比运行期检测更早失败（parse 即报错）。DEFAULT_PROFILE_CONFIG 单一来源供 init：SPEC §6「caw init 预置 anthropic+glm」+ §13.2「init 产物新增 provider profile 配置」，模板数据与配置模块同源避免漂移；init import 同层 cli 模块的纯数据常量不违反「init 不依赖 core/application/infrastructure 领域逻辑」（provider-profile 是 cli 层，且只 import 数据常量非逻辑）。zod 最小校验就近 cli/config（任务 §8）：P1 再考虑提升 core 正式 schema 化（如 TaskFrontmatterSchema 同级），当前 P0 够用。token 缺失抛错不静默承接 SPEC §6「key 缺失报错」+ AGENTS §3。"
      consequences: "provider-profile 为 032/033/034/035 共同依赖：034/035 调 composeProviderEnv 组装 env 注入 sdk-client SdkSessionInput.env；032/033 经 sdk-client runSdkSession 消费。新增 provider（deepseek P1）只扩 DEFAULT_PROFILE_CONFIG + init 自动跟上（单一来源）。token 注入键判定绑定 baseUrl：若未来出现「无 baseUrl 的第三方端点」或「有 baseUrl 的官方端点」profile，须重新评估判定字段（可能需加显式 authMode 字段）——当前 P0 两预置 profile 不触发此情况。配置 schema 未提升 core：第三方/外部复用 ProfileConfigSchema 需从 cli/config import（P1 若提升 core 则迁移）。init 产物扩展使 init.test.ts 标题/注释语义过时（ISS-021，断言全绿不阻塞）。关联 DEC-030/031（SDK 依赖 + sdk-client）/ ISS-012（SDK 就位）/ ISS-019（zod peer 冲突，本任务复用已装 zod 3.25.76 不触发）/ ISS-021（init 测试注释）。"
  issues:
    - id: ""
      title: "init.test.ts 测试标题/注释语义过时——TASK-031 扩展 init 产物加 .caw/config.json 后「不创建 docs/ 以外」名不副实（断言全绿，仅文档张力）"
      status: open
      severity: low
      scope: test/cli/init.test.ts（不在 TASK-031 allowed_paths，未改）
      created_from_task: TASK-031
      owner: ""
      recommended_action: "TASK-031 往 init.ts 的 DOC_FILES 追加 `.caw/config.json`（SPEC §6/§13.2 要求 caw init 预置 provider profile），init 产物现含 docs/ 以外的配置文件。test/cli/init.test.ts（不在本任务 allowed，未改）的「仅写文档骨架，不创建 docs/ 以外的无关文件」测试（第 69 行）标题 + 第 75 行注释「docs/ 下文件数恰为清单声明数（SPEC/ARCHITECTURE/...+ tasks/.gitkeep）」现语义过时——.caw/config.json 是 docs/ 以外的「有关」文件。**断言本身全绿不阻塞验收**：(1) 第 9 行 EXPECTED_PATHS 动态派生自 DOC_FILES（自动含 .caw/config.json）；(2) 第 33/59 行 created/skipped 比对 EXPECTED_PATHS（动态跟上）；(3) 第 72-74 行 created.every(p => EXPECTED_PATHS.contains(p)) 白名单通过；(4) 第 76 行 DOC_DOC_PATHS.length===8 只过滤 docs/ 前缀（.caw/config.json 不计入，仍 8）。仅测试标题/注释文档张力。建议后续任务（更新 init 测试时）把标题改为「仅写 DOC_FILES 清单内文件」等准确表述，注释补「.caw/config.json 是 SPEC §6 要求的 provider profile 配置」。关联 DEC-032。"
next_action: review
---

# TASK-031 执行结果

## 1. 执行结论

任务完成。`PLAN_claude-sdk-integration` 第三个任务（Provider Profile 配置读取 + SDK env 组装）落地：

- **provider-profile.ts**（新）：cli 配置层，提供多 provider 接入的配置读取（zod schema 校验）+ SDK env 组装（§6 公式）。是 TASK-032/033/034/035 共同依赖。
- **init.ts**（改）：`caw init` 产物追加 `.caw/config.json`（预置 anthropic + glm 两个 profile，单一来源 DEFAULT_PROFILE_CONFIG）。
- **token 注入键按 baseUrl 推断**（R-PROVIDER）：null→ANTHROPIC_API_KEY（官方）/ 非空→ANTHROPIC_AUTH_TOKEN（第三方），单测两 profile 分别断言注入键。

32 项单测全绿，typecheck / lint 0 错误，全量 724 项无回归。

## 2. 完成内容

- 新建 `src/cli/config/provider-profile.ts`：
  - Schema（zod 单一来源 + z.infer 派生）：`ModelMappingSchema`（三档 min(1) + strict）、`ProviderProfileSchema`（baseUrl/authTokenEnv/modelMapping/extraEnv，strict）、`ProfileConfigSchema`（provider + profiles 字典，strict）。
  - 常量：`DEFAULT_PROFILE_CONFIG`（预置 anthropic + glm，含 modelMapping/authTokenEnv/extraEnv 模板）、`DEFAULT_CONFIG_PATH='.caw/config.json'`。
  - 错误体系：`ProviderProfileError`（base）/ `ProviderConfigError`（配置非法/缺档/profile 不存在）/ `ProviderTokenMissingError`（token 缺失）。
  - 函数：`parseProfileConfig(raw)`（JSON + zod 校验）/ `readProfileConfig(configPath)`（I/O 包装）/ `resolveProfile(config, providerOverride?)`（选用启用 profile）/ `buildProviderEnv(profile, {env?})`（§6 公式组装）/ `composeProviderEnv(config, {providerOverride?, env?})`（resolve+build 便利）。
- 改 `src/cli/commands/init.ts`：import 同层 `DEFAULT_PROFILE_CONFIG` + DOC_FILES 追加 `.caw/config.json`（CONFIG_JSON_TEMPLATE = JSON.stringify 单一来源）+ 顶部职责注释补充。
- 新建 `test/cli/config/provider-profile.test.ts`（32 项：DEFAULT 合法性 3 / parseProfileConfig 8 / resolveProfile 4 / anthropic env 2 / glm env 3 / env 展开覆盖 3 / token 缺失 2 / composeProviderEnv 3 / readProfileConfig I/O 2 / init 产物含两 profile 2）。

## 3. 修改文件

- `src/cli/commands/init.ts`（import DEFAULT_PROFILE_CONFIG + DOC_FILES 追加 .caw/config.json + 注释）

## 4. 新增文件

- `src/cli/config/provider-profile.ts`
- `test/cli/config/provider-profile.test.ts`
- `docs/tasks/TASK-031-cli-provider-profile.result.md`

## 5. 删除文件

无。

## 6. 架构决策

新增 DEC-032（proposed）：Provider Profile schema + SDK env 组装规则（token 注入键 baseUrl 推断 + 三档强制全映射 + DEFAULT_PROFILE_CONFIG 单一来源供 init + stringEnv 规范化 + 错误体系三态）。

## 7. 偏离计划

无规格偏离。SPEC §6（Provider Profile）+ §12（env 项）全部按字面落地，字段名与公式逐项一致（env 组装公式 / token 注入键 / 三档映射 / init 预置），无需回写 SPEC。

一处实现具体化（非偏离）：SPEC §6 表格明文「官方注入 ANTHROPIC_API_KEY；第三方注入 ANTHROPIC_AUTH_TOKEN」但未指定判定字段，本任务据 §6 示例（baseUrl null=官方 / 非空=第三方）+ env 公式（baseUrl 三元决定 ANTHROPIC_BASE_URL）推断为 baseUrl 是否为 null 判定 token 注入键——已记入 DEC-032 rationale。此具体化与 SPEC 完全自洽（官方端点用默认 baseUrl、第三方必然有兼容端点 baseUrl）。

provider-profile 不调 SDK（§7 env 组装是纯逻辑，不 import sdk-client）、不做 CLI --provider 接线（归 034/035）、不做 deepseek profile（P1）、token 不落配置明文（§7）——严格遵守 §7。

## 8. 后续任务注意事项

- **034/035 接线**（task:run/task:review）：调 `composeProviderEnv(config, {providerOverride, env})`（或 readProfileConfig + 分步）组装 env → 注入 sdk-client SdkSessionInput.env。`providerOverride` 接 `--provider`，`env` 默认 process.env。
- **token 缺失处理**（034/035）：buildProviderEnv 的 ProviderTokenMissingError 须 catch，按 SPEC §6「key 缺失：缺失则显式 --executor dry-run 才兜底，否则报错不静默」处置。
- **token 注入键**（R-PROVIDER）：baseUrl null→ANTHROPIC_API_KEY / 非空→ANTHROPIC_AUTH_TOKEN。032/033 经 sdk-client 跑会话时，system init 消息的 model 应反映档位映射值（§6/§12 启动校验，归 032/033 + CI 035）。
- **单测 env 注入**：buildProviderEnv/composeProviderEnv 的 `env` 参数测试时**必须注入 fake env**（隔离真实 process.env，断言注入键/缺失/展开），生产路径才用默认 process.env。
- **新增 provider**（P1 deepseek）：扩 DEFAULT_PROFILE_CONFIG + init 自动跟上（单一来源）；若出现「无 baseUrl 第三方端点」或「有 baseUrl 官方端点」profile，须重评 token 注入键判定字段（可能加显式 authMode）。
- **配置 schema 提升**（P1）：当前 zod 最小校验就近 cli/config，P1 可考虑提升 core 正式 schema 化。

## 9. 未解决问题

- ISS-021（low，open）：init.test.ts 测试标题/注释语义过时（.caw/config.json 加入 init 产物后「不创建 docs/ 以外」名不副实），**断言全绿不阻塞**（EXPECTED_PATHS 动态派生 + DOC_DOC_PATHS 只数 docs/），仅文档张力。详见 frontmatter issues / DEC-032。
- ISS-012（medium，open）进展：本任务补齐多 provider env 组装（SDK 调用的前置配置层），真实 invocation/reviewer 仍留 TASK-032/033。
- 既有 open issue（ISS-004/005/006/007/008/009/010/011/014/015/016/017/019/020）与本任务无触发：provider-profile 纯 cli 配置层（不依赖 SQLite、不改状态机、不触发级联/合并、不调 SDK），Node v22（ISS-005 约束满足）下全绿。

## 10. 验证结果

- `npm run typecheck`：✓ 0 错误。
- `npm test -- cli/config/provider-profile`：✓ 32/32 全过。
- `npm run lint`：✓ 0 错误。
- `npm test -- cli/init`：✓ 9/9 全过（DOC_FILES 改动无回归）。
- `npm test`（全量）：✓ 724/724 全过（原 692 + provider-profile 32，无回归）。

本任务不依赖 SQLite 原生模块（provider-profile 纯 TypeScript + zod + node:fs），Node v22.23.1（ABI 127，满足 ISS-005）下全绿。

## 11. 人工验收建议

- 重点核 token 注入键随 provider（R-PROVIDER）：anthropic profile（baseUrl null）env 注入 `ANTHROPIC_API_KEY`、无 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`；glm profile（baseUrl 非空）env 注入 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`、无 `ANTHROPIC_API_KEY`（验收 1/2，单测 anthropic env + glm env 覆盖）。
- 核三档强制全映射：parseProfileConfig 对缺 sonnet/haiku/空串值的配置抛 ProviderConfigError（验收 3，单测覆盖）。
- 核 env 含 ...process.env 展开：buildProviderEnv 展开传入 env 源 + stringEnv 剔除 undefined（验收 4，单测覆盖）。
- 核 caw init 产物含两个 profile 模板：scaffoldProject 后 .caw/config.json 解析含 anthropic + glm，token 仅环境变量名无明文（验收 5，单测覆盖）。
- 核 token 缺失抛 ProviderTokenMissingError 不静默（§6 key 缺失，单测覆盖）。
- 核 DEC-032 token 注入键 baseUrl 推断是否符合预期（SPEC §6 未指定判定字段，本任务据示例+公式推断）。
- 核 ISS-021 init.test.ts 注释张力是否认可（断言全绿，仅建议后续更新标题/注释）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress 六条 section（完成进度 / 可用能力 / 架构状态 / 后续注意 / 未解决问题摘要 / 替换建议下一个任务为 TASK-032）、DEC-032（proposed）、ISS-021（low，open）。SPEC §6/§12 无需回写（实现逐项对照一致，无 R-API 级差异）。
