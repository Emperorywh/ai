/*
 * ProjectContextManifest 是面向 Agent 的轻量项目导航事实，不承载源码正文。
 * 文件树、包管理器和脚本均经过稳定排序，同一工作区状态必然生成相同清单与指纹。
 */
export interface ProjectScript {
  readonly name: string;
  readonly command: string;
}

export interface ProjectContextManifest {
  readonly fingerprint: string;
  readonly packageManager?: "bun" | "npm" | "pnpm" | "yarn" | undefined;
  readonly scripts: readonly ProjectScript[];
  readonly scriptsTruncated: boolean;
  readonly entries: readonly string[];
  readonly truncated: boolean;
  readonly diagnostics: readonly string[];
}
