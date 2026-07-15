/*
 * 项目仓储负责按固定目录契约加载上下文与全部 TASK，并生成稳定运行指纹。
 * 调用方只提供项目根目录，端口不接受任何会改变系统行为的配置对象。
 */
import type { LoadedProject } from "../domain/project.js";

export interface ProjectRepository {
  load(projectRoot: string): Promise<LoadedProject>;
}
