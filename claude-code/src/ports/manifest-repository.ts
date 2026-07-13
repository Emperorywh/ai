/*
 * Manifest 仓储负责把磁盘上的 YAML 与 Markdown 解析为完整、已校验的任务上下文。
 * 应用层只消费 LoadedTaskManifest，不需要知道编码、路径解析或哈希计算方式。
 */
import type { LoadedTaskManifest } from "../domain/manifest.js";

export interface ManifestRepository {
  load(manifestPath: string): Promise<LoadedTaskManifest>;
}
