/*
 * TimeFormatter 只负责把规范时间事实投影为面向操作者的文本，不参与计时、超时或状态转换。
 * 应用层通过该端口声明展示策略，避免直接依赖系统时区、locale 或具体时区实现。
 */
export interface TimeFormatter {
  formatTimestamp(value: string | Date): string;
  formatRunIdTimestamp(value: Date): string;
}
