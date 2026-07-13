/*
 * 系统时钟是 Clock 端口的唯一生产实现。
 * 应用层依赖接口，因此测试无需修改全局 Date 或使用隐式假时间。
 */
import type { Clock } from "../ports/clock.js";

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
