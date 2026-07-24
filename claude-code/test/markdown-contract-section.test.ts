/*
 * Markdown 固定章节提取测试锁定文档格式边界：只识别围栏外的精确标题行，
 * 缺失、重复、空章节和散文夹杂都在 YAML 解析与领域校验之前被拒绝。
 */
import { describe, expect, it } from "vitest";
import { extractContractYamlSection } from "../src/infrastructure/tasks/markdown-contract-section.js";

function extract(text: string, heading = "### 验收契约"): string {
  return extractContractYamlSection({ label: "测试文档", text, heading });
}

describe("extractContractYamlSection", () => {
  it("提取固定章节中的唯一 yaml 代码块", () => {
    const text = "\n## 任务描述\n\n任务正文。\n\n### 验收契约\n\n```yaml\ncriteria: []\n```\n";

    expect(extract(text)).toBe("criteria: []");
  });

  it("章节在同级或更高级标题处结束", () => {
    const text = "### 验收契约\n\n```yaml\na: 1\n```\n\n### 后续章节\n\n```yaml\nb: 2\n```\n";

    expect(extract(text)).toBe("a: 1");
    const atSpecLevel = "## 需求契约\n\n```yaml\nrequirements: []\n```\n\n## 其他章节\n\n正文。\n";
    expect(extract(atSpecLevel, "## 需求契约")).toBe("requirements: []");
  });

  it("代码围栏内的示例标题不会被误识别为固定章节", () => {
    const text = [
      "介绍。",
      "",
      "~~~markdown",
      "### 验收契约",
      "",
      "```yaml",
      "criteria: []",
      "```",
      "~~~",
      "",
      "### 验收契约",
      "",
      "```yaml",
      "criteria:",
      "  - id: AC-001",
      "```",
    ].join("\n");

    expect(extract(text)).toBe("criteria:\n  - id: AC-001");
  });

  it("拒绝缺失或重复的固定章节", () => {
    expect(() => extract("## 任务描述\n\n正文。\n")).toThrow("缺少固定章节");
    const duplicated = "### 验收契约\n\n```yaml\na: 1\n```\n\n正文。\n\n### 验收契约\n\n```yaml\nb: 2\n```\n";
    expect(() => extract(duplicated)).toThrow("重复固定章节");
  });

  it("拒绝散文、第二个代码块和非 yaml 围栏", () => {
    expect(() =>
      extract("### 验收契约\n\n请先阅读说明。\n\n```yaml\na: 1\n```\n")
    ).toThrow("必须只包含一个");
    expect(() =>
      extract("### 验收契约\n\n```yaml\na: 1\n```\n\n补充说明。\n")
    ).toThrow("必须只包含一个");
    expect(() =>
      extract("### 验收契约\n\n```yaml\na: 1\n```\n\n```yaml\nb: 2\n```\n")
    ).toThrow("必须只包含一个");
    expect(() =>
      extract("### 验收契约\n\n```json\n{}\n```\n")
    ).toThrow("必须只包含一个");
    expect(() => extract("### 验收契约\n\n\n")).toThrow("必须只包含一个");
  });

  it("更低级标题属于章节内容，同样因夹杂散文被拒绝", () => {
    const text = "### 验收契约\n\n```yaml\na: 1\n```\n\n#### 备注\n\n正文。\n";

    expect(() => extract(text)).toThrow("必须只包含一个");
  });

  it("yaml 代码块内部的类标题行不会截断章节", () => {
    const text = "### 验收契约\n\n```yaml\ndescription: |\n  ## 不是标题\n  多行文本。\n```\n";

    expect(extract(text)).toBe("description: |\n  ## 不是标题\n  多行文本。");
  });
});
