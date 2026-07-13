/*
 * 初始化器只生成最小、可执行的契约骨架，不猜测业务需求，也不会覆盖任何已有文件。
 * 示例将规格、计划和任务描述保持分离，便于后续由访谈与规划流程独立维护这些文档。
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ConfigurationError } from "../domain/errors.js";

const SAMPLE_FILES: Readonly<Record<string, string>> = {
  "orchestrator.yaml": `version: 1
project:
  root: .
  spec: SPEC.md
  plan: PLAN.md
  contextFiles:
    - AGENTS.md

defaults:
  maxAttempts: 3
  taskTimeoutMinutes: 45
  maxTurns: 80
  model: sonnet
  effort: high

review:
  enabled: true
  maxAttempts: 2
  model: sonnet
  effort: high
  maxTurns: 30

git:
  commitMessagePrefix: task

tasks:
  - id: TASK-001
    title: 实现第一个独立任务
    file: tasks/TASK-001.md
    dependsOn: []
    scope:
      allow:
        - src/**
        - test/**
        - package.json
        - pnpm-lock.yaml
      deny:
        - .env*
    gates:
      - name: typecheck
        command: pnpm
        args:
          - typecheck
        timeoutMinutes: 10
      - name: test
        command: pnpm
        args:
          - test
        timeoutMinutes: 15
    manualAcceptance:
      - 在本地浏览器中完成功能与视觉验收
`,
  "SPEC.md": `# 规格说明

请将已经审核通过的完整规格说明放在这里。
`,
  "PLAN.md": `# 开发计划

请记录任务依赖、模块边界、数据流和状态流。
`,
  "AGENTS.md": `# 项目约束

请记录所有 Worker 都必须遵守的架构、编码和测试约束。
`,
  "tasks/TASK-001.md": `# TASK-001 实现第一个独立任务

## 目标

请写清本任务唯一、可验证的交付目标。

## 输入与边界

- 明确允许修改的模块。
- 明确不可修改的契约。
- 明确依赖的前置任务输出。

## 完成条件

- 自动门禁全部通过。
- 不存在范围外文件变更。
- 独立 Reviewer 审核通过。
`,
};

export async function writeSampleProject(directory: string): Promise<readonly string[]> {
  const root = resolve(directory);
  const written: string[] = [];

  try {
    for (const [relativePath, content] of Object.entries(SAMPLE_FILES)) {
      const absolutePath = resolve(root, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
      written.push(absolutePath);
    }
  } catch (error) {
    await Promise.all(written.map((path) => unlink(path).catch(() => undefined)));
    if (isAlreadyExists(error)) {
      throw new ConfigurationError("初始化已回滚：目标目录中存在同名文件");
    }
    throw error;
  }

  return written;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
