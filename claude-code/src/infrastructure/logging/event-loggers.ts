/*
 * 终端日志提供人类可读进度，JSONL 日志提供机器可检索的完整应用事件。
 * 两种输出通过组合器并列执行，任何一个记录失败都会显式暴露，避免静默丢失审计信息。
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EventLogger, RunEvent } from "../../ports/event-logger.js";

export class ConsoleEventLogger implements EventLogger {
  public log(event: RunEvent): Promise<void> {
    const task = event.taskId === undefined ? "" : ` [${event.taskId}]`;
    process.stdout.write(
      `${event.timestamp} [${event.runId}]${task} ${event.message}\n`,
    );
    return Promise.resolve();
  }
}

export class JsonlEventLogger implements EventLogger {
  public constructor(private readonly baseDirectory: string) {}

  public async log(event: RunEvent): Promise<void> {
    const directory = join(this.baseDirectory, "runs", event.runId);
    await mkdir(directory, { recursive: true });
    await appendFile(
      join(directory, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }
}

export class CompositeEventLogger implements EventLogger {
  public constructor(private readonly loggers: readonly EventLogger[]) {}

  public async log(event: RunEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.loggers.map((logger) => logger.log(event)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        const message = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        process.stderr.write(`事件日志写入失败：${message}\n`);
      }
    }
  }
}
