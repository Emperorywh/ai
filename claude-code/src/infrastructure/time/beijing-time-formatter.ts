/*
 * 北京时间格式化器是 TimeFormatter 的唯一生产实现，固定使用 UTC+08:00 且不读取宿主机时区。
 * 状态层仍保存 UTC；这里创建偏移后的临时 Date 只为复用稳定的 ISO 字段宽度与毫秒精度。
 */
import type { TimeFormatter } from "../../ports/time-formatter.js";

const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;
const BEIJING_ISO_OFFSET = "+08:00";

export class BeijingTimeFormatter implements TimeFormatter {
  public formatTimestamp(value: string | Date): string {
    const instant = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(instant.getTime())) {
      throw new RangeError(`无法格式化非法时间：${String(value)}`);
    }

    const beijingFields = new Date(instant.getTime() + BEIJING_UTC_OFFSET_MS);
    return beijingFields.toISOString().replace("Z", BEIJING_ISO_OFFSET);
  }

  public formatRunIdTimestamp(value: Date): string {
    /*
     * Windows 文件名不能包含冒号，运行 ID 又必须保留明确的 +08:00 语义。
     * 只替换分隔符而不删减字段，使目录排序、日志识别和人工换算保持确定性。
     */
    return this.formatTimestamp(value).replaceAll(/[:.]/gu, "-");
  }
}
