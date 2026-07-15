/*
 * 初始化器在现有项目中增量生成最小契约骨架：同名普通文件保持原样，只补齐缺失文件。
 * 路径类型冲突或写入异常会回滚本次新建内容，用户已有文件始终不进入回滚集合。
 */
import { lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ConfigurationError } from "../domain/errors.js";
import { PROJECT_STRUCTURE } from "../domain/project.js";

/*
 * 初始化器只生成固定项目结构所需的上下文和任务模板，不创建任何配置文件。
 * 新任务只新增一个 Markdown 文档，运行时会自动扫描目录，从结构上消除登记遗漏。
 */
const SAMPLE_FILES: Readonly<Record<string, string>> = {
  [PROJECT_STRUCTURE.specification]: `# 规格说明

请将已经审核通过的完整规格说明放在这里。
`,
  [PROJECT_STRUCTURE.plan]: `# 开发计划

请记录任务依赖、模块边界、数据流和状态流。
`,
  [PROJECT_STRUCTURE.agentInstructions]: `# 项目约束

请记录所有 Worker 都必须遵守的架构、编码和测试约束。
`,
  [`${PROJECT_STRUCTURE.taskDirectory}/TASK-001.md`]: `---
id: TASK-001
title: 实现第一个独立任务
dependsOn: []
manualAcceptance:
  - 在本地浏览器中完成功能与视觉验收
---

# TASK-001 — 实现第一个独立任务

## 任务描述

请直接描述希望 AI 完成的任务、期望效果和必要背景。
AI 将自行阅读项目、分析架构、设计方案并完成实现。
`,
};

export interface SampleProjectWriteResult {
  readonly createdFiles: readonly string[];
  readonly skippedFiles: readonly string[];
}

/*
 * 文件创建采用独占写入而不是“先检查再写入”，避免并发初始化时覆盖用户文件。
 * 已存在的普通文件只记录为 skipped，后续重复执行能够稳定收敛到同一目录结构。
 */
export async function writeSampleProject(
  directory: string,
): Promise<SampleProjectWriteResult> {
  const root = resolve(directory);
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  try {
    for (const [relativePath, content] of Object.entries(SAMPLE_FILES)) {
      const absolutePath = resolve(root, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      const result = await createSampleFile(absolutePath, content);
      if (result === "created") {
        createdFiles.push(absolutePath);
      } else {
        skippedFiles.push(absolutePath);
      }
    }
  } catch (error) {
    await Promise.all(
      createdFiles.map((path) => unlink(path).catch(() => undefined)),
    );
    if (error instanceof ConfigurationError) {
      throw new ConfigurationError(`初始化已回滚：${error.message}`);
    }
    throw error;
  }

  return { createdFiles, skippedFiles };
}

/*
 * EEXIST 只对现有普通文件表示“可以跳过”。目录、符号链接和其他特殊文件都属于
 * 明确的路径类型冲突，不能被静默当成已完成初始化，否则后续读取会产生隐式行为。
 */
async function createSampleFile(
  absolutePath: string,
  content: string,
): Promise<"created" | "skipped"> {
  try {
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }

    const metadata = await lstat(absolutePath);
    if (metadata.isFile()) {
      return "skipped";
    }
    throw new ConfigurationError(
      `目标路径已存在且不是普通文件：${absolutePath}`,
    );
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
