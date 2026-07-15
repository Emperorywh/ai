/*
 * 北京时间测试覆盖跨日换算、文件安全运行 ID、终端事件以及完整状态展示投影。
 * 所有断言使用固定 UTC 输入，不依赖测试机器的本地时区或 locale。
 */
import { describe, expect, it } from "vitest";
import { presentRunState } from "../src/application/run-state-presentation.js";
import type { RunState } from "../src/domain/run-state.js";
import { BeijingTimeFormatter } from "../src/infrastructure/time/beijing-time-formatter.js";
import { ConsoleEventLogger } from "../src/infrastructure/logging/event-loggers.js";

const formatter = new BeijingTimeFormatter();

describe("BeijingTimeFormatter", () => {
  it("把 UTC 时间稳定换算为带 +08:00 偏移的北京时间", () => {
    expect(formatter.formatTimestamp("2026-07-14T19:28:40.710Z")).toBe(
      "2026-07-15T03:28:40.710+08:00",
    );
  });

  it("生成 Windows 文件名安全且明确标识北京时间的运行 ID 时间段", () => {
    expect(
      formatter.formatRunIdTimestamp(new Date("2026-07-14T11:51:02.277Z")),
    ).toBe("2026-07-14T19-51-02-277+08-00");
  });

  it("拒绝非法时间而不是静默打印错误时间", () => {
    expect(() => formatter.formatTimestamp("not-a-time")).toThrow(
      "无法格式化非法时间",
    );
  });
});

describe("北京时间人类可读输出", () => {
  it("终端事件转换时间前缀但不改写原事件", async () => {
    let output = "";
    const event = {
      timestamp: "2026-07-14T19:28:40.710Z",
      runId: "run-1",
      taskId: "TASK-012",
      type: "task_progress",
      message: "Agent execution 错误",
    };
    const logger = new ConsoleEventLogger(
      formatter,
      (content) => {
        output += content;
      },
    );

    await logger.log(event);

    expect(output).toBe(
      "2026-07-15T03:28:40.710+08:00 [run-1] [TASK-012] Agent execution 错误\n",
    );
    expect(event.timestamp).toBe("2026-07-14T19:28:40.710Z");
  });

  it("status 投影显式转换运行、任务、attempt 和归档时间", () => {
    const display = presentRunState(createRunState(), formatter);
    const task = display.tasks["TASK-012"];

    expect(display.createdAt).toBe("2026-07-15T03:28:40.710+08:00");
    expect(display.updatedAt).toBe("2026-07-15T03:28:45.710+08:00");
    expect(task?.updatedAt).toBe("2026-07-15T03:28:45.710+08:00");
    expect(task?.attempts[0]?.startedAt).toBe(
      "2026-07-15T03:28:41.710+08:00",
    );
    expect(task?.attempts[0]?.finishedAt).toBe(
      "2026-07-15T03:28:42.710+08:00",
    );
    expect(task?.candidateArchive?.archivedAt).toBe(
      "2026-07-15T03:28:45.710+08:00",
    );
  });
});

function createRunState(): RunState {
  return {
    version: 4,
    runId: "run-1",
    status: "failed",
    projectHash: "hash",
    projectRoot: "/project",
    workspace: {
      repositoryRoot: "/project",
      branch: "main",
      expectedHead: "head",
    },
    createdAt: "2026-07-14T19:28:40.710Z",
    updatedAt: "2026-07-14T19:28:45.710Z",
    tasks: {
      "TASK-012": {
        taskId: "TASK-012",
        status: "failed",
        attempts: [{
          number: 1,
          kind: "repair",
          sessionId: "11111111-1111-4111-8111-111111111111",
          sessionInitialized: true,
          startedAt: "2026-07-14T19:28:41.710Z",
          finishedAt: "2026-07-14T19:28:42.710Z",
          outcome: "failed",
        }],
        reviewAttempts: 0,
        candidateArchive: {
          reference: "refs/quarantine/1",
          changedFiles: ["src/file.ts"],
          archivedAt: "2026-07-14T19:28:45.710Z",
        },
        updatedAt: "2026-07-14T19:28:45.710Z",
      },
    },
  };
}
