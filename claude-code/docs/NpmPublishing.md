# npm 包发布手册

npm version patch --no-git-tag-version
npm publish --access public

本文档用于维护者将 `apex-coding-agent` 发布到 npm 官方 Registry，覆盖首次发布、后续版本发布、Security Key 认证、发布后验证和常见错误处理。

最后核对日期：2026-07-16。

## 1. 发布契约

当前项目的 npm 发布边界由 `package.json` 统一定义：

- 包名：`apex-coding-agent`；
- 包类型：无 scope 的公开包；
- Node.js 版本：`>=20`；
- 包管理器：`pnpm@11.10.0`；
- CLI 命令：`apex-coding-agent`；
- CLI 入口：`dist/cli/index.js`；
- 库入口：`dist/index.js`；
- 类型入口：`dist/index.d.ts`；
- 发布内容：`dist`、`README.md` 以及 npm 自动包含的 `package.json`；
- 发布前质量门禁：`pnpm typecheck && pnpm lint && pnpm test`；
- 打包前构建：清理 `dist` 后使用 TypeScript 重新编译。

发布数据流如下：

```text
src
  → 类型检查、Lint、测试
  → 清理并重新生成 dist
  → 审查 npm 包内容
  → 使用 Security Key 完成发布认证
  → npm 官方 Registry
  → 查询版本并全局安装验证
```

发布过程不得绕过 `prepublishOnly` 或 `prepack`。Registry 中已经存在的同名同版本不可覆盖，任何修复都必须发布新版本。

## 2. 前置条件

发布前必须满足：

1. npm 账号已经完成邮箱验证。
2. npm 账号已经绑定 Security Key 形式的 2FA。
3. 当前终端登录的是有权发布该包的 npm 用户。
4. Registry 为 `https://registry.npmjs.org/`。
5. Git 工作区不存在未确认的变更。
6. `package.json` 中的版本尚未发布。
7. 发布内容不包含密钥、Token、个人信息或内部资料。

检查基础环境：

```powershell
node --version
pnpm --version
npm --version
git status --short --branch
npm config get registry
```

如需将当前 npm 默认源切换到官方 Registry：

```powershell
npm config set registry https://registry.npmjs.org/
```

关键发布命令仍应显式携带 `--registry=https://registry.npmjs.org/`，避免用户级或项目级配置把包发布到其他 Registry。

## 3. 配置 Security Key 2FA

npm 已停止通过 CLI 为账号新增 TOTP 2FA。不要使用下面的命令初始化 2FA：

```powershell
npm profile enable-2fa auth-and-writes
```

该命令会尝试新增 TOTP，并返回类似错误：

```text
E404 Not Found - Adding a new TOTP 2FA is no longer supported.
```

正确流程：

1. 登录 [npmjs.com](https://www.npmjs.com/)。
2. 打开 `https://www.npmjs.com/settings/<npm-username>/tfa`。
3. 启用 2FA，并添加 Security Key。
4. Windows 开发机可以使用 Windows Hello PIN、指纹或人脸识别，也可以使用外接硬件安全密钥。
5. 将恢复码保存到密码管理器等独立安全位置。

绑定后检查 2FA 状态：

```powershell
npm profile get tfa --json --registry=https://registry.npmjs.org/
```

输出不得再包含以下状态：

```json
{
  "tfa": false
}
```

## 4. 登录 npm

使用 npm 的网页认证流程登录：

```powershell
npm login --auth-type=web --registry=https://registry.npmjs.org/
```

确认当前用户：

```powershell
npm whoami --registry=https://registry.npmjs.org/
```

如果刚刚启用了 2FA，但发布仍然报告旧的认证状态，重新登录：

```powershell
npm logout --registry=https://registry.npmjs.org/
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

不得把 npm Token 写入仓库、`.env`、TASK、脚本或文档。

## 5. 确认包名与版本

首次发布前查询包名：

```powershell
npm view apex-coding-agent name version --registry=https://registry.npmjs.org/
```

首次发布时，查询返回 `E404` 表示 Registry 中尚不存在这个包，不代表本地项目异常。正式发布前仍应再次查询，因为未发布的包名可能被其他用户注册。

后续发布必须先按照语义化版本规则修改 `package.json` 中的 `version`：

- `patch`：兼容性缺陷修复，例如 `0.1.0 → 0.1.1`；
- `minor`：兼容性新增能力，例如 `0.1.0 → 0.2.0`；
- `major`：破坏性变更，例如 `0.1.0 → 1.0.0`。

发布前确认目标版本不存在：

```powershell
$version = node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version"
npm view "apex-coding-agent@$version" version --registry=https://registry.npmjs.org/
```

查询返回 `E404` 表示该版本可以继续准备；如果返回具体版本号，则必须先提高版本，不能覆盖发布。

## 6. 执行发布前验证

安装与锁文件完全一致的依赖：

```powershell
pnpm install --frozen-lockfile
```

执行完整质量门禁：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

验证 CLI 构建产物：

```powershell
node dist/cli/index.js --version
node dist/cli/index.js --help
```

预演发布并审查最终文件列表：

```powershell
npm publish --dry-run --access public --registry=https://registry.npmjs.org/
```

预演期间 npm 会执行项目配置的生命周期脚本。必须确认：

- 所有质量门禁通过；
- `dist/cli/index.js` 和 `dist/index.js` 存在；
- 发布列表只包含预期文件；
- 没有凭据、运行状态、测试数据或其他敏感内容；
- 包名和版本正确。

## 7. 正式发布

在项目根目录执行：

```powershell
npm publish --access public --registry=https://registry.npmjs.org/
```

因为当前包没有 scope，所以它只能作为公开包发布。`--access public` 保留为显式发布意图。

发布时 npm 可能输出一个验证链接。打开该链接，并使用已经绑定的 Windows Hello 或硬件安全密钥完成 WebAuthn 验证。Security Key 流程不需要手工追加 `--otp`。

只有终端明确输出发布成功后，才能认为版本已经进入 Registry。

## 8. 发布后验证

查询 Registry 中的版本和标签：

```powershell
npm view apex-coding-agent version dist-tags --registry=https://registry.npmjs.org/
```

安装刚发布的明确版本，避免本地缓存或标签漂移：

```powershell
$version = node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version"
npm install --global "apex-coding-agent@$version" --registry=https://registry.npmjs.org/
apex-coding-agent --version
apex-coding-agent --help
```

包页面：<https://www.npmjs.com/package/apex-coding-agent>

验证完成后，应提交版本变更，并按仓库发布约定创建对应 Git 标签。npm Registry 版本、Git 提交和 Git 标签必须能够相互追溯。

## 9. 常见错误

### 9.1 发布返回 `E403`，要求 2FA

典型信息：

```text
Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

原因：账号未启用 2FA，或者当前凭据没有满足发布安全策略。

处理：

1. 使用 `npm profile get tfa --json` 检查状态。
2. 在 npm 网站绑定 Security Key。
3. 必要时执行 `npm logout` 后重新通过网页登录。
4. 重新执行发布命令，并完成 Security Key 验证。

### 9.2 启用 2FA 返回 `E404 POST /-/npm/v1/user`

如果错误同时包含：

```text
Adding a new TOTP 2FA is no longer supported.
```

则 Registry 和账号都没有异常。原因是 CLI 仍在尝试新增已经停止支持的 TOTP 方式。改为在 npm 网站的 2FA 设置页添加 Security Key。

### 9.3 `npm view` 返回 `E404`

- 查询尚未发布的包名或版本时，这是预期结果。
- 查询已经发布的包时，检查包名、版本和 Registry 是否正确。
- 不要把查询接口的 `E404` 与配置 2FA 接口的 `E404` 混为一类。

### 9.4 发布返回包名或权限相关的 `E403`

检查当前用户和包所有者：

```powershell
npm whoami --registry=https://registry.npmjs.org/
npm owner ls apex-coding-agent --registry=https://registry.npmjs.org/
```

如果包已经属于其他用户，必须更换包名或由现有所有者授予维护权限，不能绕过 Registry 的所有权校验。

### 9.5 版本已经存在

npm 不允许覆盖已发布版本。提高 `package.json` 中的版本，重新执行全部验证后再发布。不要通过删除本地缓存、强制参数或重建相同版本尝试覆盖 Registry。

### 9.6 已发布版本存在缺陷

优先发布修复版本。必要时可以弃用有问题的版本并给出迁移信息：

```powershell
npm deprecate "apex-coding-agent@<bad-version>" "该版本存在问题，请升级到 <fixed-version>" --registry=https://registry.npmjs.org/
```

除非满足 npm 的删除政策并确认没有消费者，否则不要使用 `npm unpublish`。发布版本应视为不可变事实。

## 10. 发布检查清单

每次发布前逐项确认：

- [ ] Git 工作区中的变更已经审查。
- [ ] npm Registry 是 `https://registry.npmjs.org/`。
- [ ] npm 登录用户正确。
- [ ] Security Key 2FA 已启用。
- [ ] 包名归属正确。
- [ ] 版本符合语义化版本规则且尚未发布。
- [ ] 锁文件与依赖声明一致。
- [ ] 类型检查通过。
- [ ] Lint 通过。
- [ ] 测试通过。
- [ ] 构建通过。
- [ ] CLI 的版本与帮助命令可运行。
- [ ] `npm publish --dry-run` 输出已经人工审查。
- [ ] 发布内容不包含敏感信息。
- [ ] 正式发布时已完成 Security Key 验证。
- [ ] Registry 查询和明确版本的全局安装验证通过。
- [ ] npm 版本、Git 提交和 Git 标签能够相互追溯。

## 11. 自动发布的演进方向

当前流程面向维护者本地交互式发布。未来接入 CI/CD 时，应优先采用 npm Trusted Publishing（OIDC）或 Staged Publishing，不应把长期 npm Token 固化在仓库或 CI 配置中。

npm 正在收紧 Granular Access Token 的 `bypass 2FA` 能力，并计划限制这类 Token 直接发布。新增自动发布能力前必须重新核对 npm 最新安全策略，不能把本手册中的本地交互流程直接复制为 CI 脚本。

## 12. 官方参考

- [创建和发布无 scope 公共包](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [配置双因素认证](https://docs.npmjs.com/configuring-two-factor-authentication/)
- [使用双因素认证访问 npm](https://docs.npmjs.com/accessing-npm-using-2fa/)
- [包发布的 2FA 要求](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
- [npm GAT bypass 2FA 弃用计划](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)
