---
doc: TESTING
status: active
---

# TESTING — 验证策略

> 本文件定义项目级自动验证命令（见 `Readme.md` §6.8 / §16）。任务级 frontmatter `verification` 与本文件取**并集**；同一命令在两处声明时以任务级为准。每条命令可声明 `layers`（适用 layer 枚举，未声明表示对所有 layer 生效）与 `requires_permissions`（除 `run_commands` 外需要的额外能力）。

## 验证命令总表

### typecheck

```yaml
command: npm run typecheck
layers: [type, domain, data, page]
requires_permissions: []
notes: 全量 TypeScript 类型检查（tsc --noEmit），覆盖 src 与 test，所有 layer 必跑
```

### test

```yaml
command: npm test
layers: [type, domain, data, page]
requires_permissions: []
notes: Vitest 单元 / 集成测试；空套件依赖 passWithNoTests 通过
```

### lint

```yaml
command: npm run lint
layers: [type, domain, data, page]
requires_permissions: []
notes: ESLint 静态检查，覆盖 src 与 test
```

### build（非默认必跑，供 CLI 端到端验证使用）

```yaml
command: npm run build
layers: [page]
requires_permissions: []
notes: tsc 编译产物到 dist/，供 page 层命令级 e2e 使用
```

## 不自动执行的测试

- 浏览器测试（见 `Readme.md` §14 / §16）：默认人工执行，仅在任务 `permissions` 含 `open_browser` 且用户明确要求时由 agent 启动。
- 需要真实外部服务（MCP server、远端 API）的集成测试不在自动验证范围，按需人工或独立环境执行。

## 人工验收

见 `Readme.md` §14 人工验收清单；CLI 命令（`page` 层）需在临时项目目录中做命令级 e2e，断言产物文件与退出码。
