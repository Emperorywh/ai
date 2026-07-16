/*
 * 项目上下文端口隔离文件系统发现策略与提示词组装。
 * 应用阶段只消费不可变清单，不能自行遍历目录或解释包管理器文件。
 */
import type { ProjectContextManifest } from "../domain/project-context.js";

export interface ProjectContextProvider {
  compile(projectRoot: string): Promise<ProjectContextManifest>;
}
