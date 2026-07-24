/*
 * Markdown 固定章节提取是文档格式边界：只识别代码围栏之外的精确标题行，
 * 章节内容必须恰好是一个 ```yaml 代码块，不允许散文、第二个代码块或空章节。
 * 缺失、重复或形状非法的章节都在 YAML 解析之前 fail closed。
 */
import { ConfigurationError } from "../../domain/errors.js";

const ATX_HEADING_PATTERN = /^(#{1,6}) /u;
const FENCE_MARKER_PATTERN = /^(```|~~~)/u;
const YAML_BLOCK_PATTERN = /^```yaml\n([\s\S]*)\n```$/u;

export function extractContractYamlSection(input: {
  readonly label: string;
  readonly text: string;
  readonly heading: string;
}): string {
  const headingLevel = headingLevelOf(input.heading);
  if (headingLevel === undefined) {
    throw new ConfigurationError(`固定章节标题非法：${input.heading}`);
  }
  const lines = input.text.split("\n");
  const headingIndices = collectHeadingIndices(lines, input.heading);
  if (headingIndices.length === 0) {
    throw new ConfigurationError(
      `${input.label} 缺少固定章节：${input.heading}`,
    );
  }
  if (headingIndices.length > 1) {
    throw new ConfigurationError(
      `${input.label} 存在重复固定章节：${input.heading}`,
    );
  }
  const start = headingIndices[0];
  if (start === undefined) {
    throw new ConfigurationError(
      `${input.label} 缺少固定章节：${input.heading}`,
    );
  }

  let end = lines.length;
  let fenceMarker: string | undefined;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    fenceMarker = advanceFence(fenceMarker, line);
    if (fenceMarker !== undefined) {
      continue;
    }
    const level = headingLevelOf(line);
    if (level !== undefined && level <= headingLevel) {
      end = index;
      break;
    }
  }

  const content = lines.slice(start + 1, end).join("\n").trim();
  const match = YAML_BLOCK_PATTERN.exec(content);
  /*
   * 契约 YAML 内部不允许再出现任何围栏行，否则第二个代码块会被宽松吞进同一段 YAML。
   */
  if (
    match?.[1] === undefined ||
    match[1].split("\n").some((line) => FENCE_MARKER_PATTERN.test(line))
  ) {
    throw new ConfigurationError(
      `${input.label} 的固定章节 ${input.heading} 必须只包含一个 \`\`\`yaml 代码块`,
    );
  }
  return match[1];
}

/*
 * 代码围栏内的示例标题不是章节标题；围栏只被同类标记关闭，~~~ 内的 ``` 行只是内容。
 */
function collectHeadingIndices(
  lines: readonly string[],
  heading: string,
): number[] {
  const indices: number[] = [];
  let fenceMarker: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const previousMarker = fenceMarker;
    fenceMarker = advanceFence(fenceMarker, line);
    if (previousMarker === undefined && fenceMarker === undefined && line === heading) {
      indices.push(index);
    }
  }
  return indices;
}

function advanceFence(
  fenceMarker: string | undefined,
  line: string,
): string | undefined {
  const marker = FENCE_MARKER_PATTERN.exec(line)?.[1];
  if (fenceMarker === undefined) {
    return marker;
  }
  return marker === fenceMarker ? undefined : fenceMarker;
}

function headingLevelOf(line: string): number | undefined {
  return ATX_HEADING_PATTERN.exec(line)?.[1]?.length;
}
