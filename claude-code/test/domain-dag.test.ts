/*
 * DAG 测试只验证领域层的依赖契约与确定性顺序，不接触文件系统或执行器。
 * 固定输入顺序作为并列可运行任务的裁决依据，保证恢复后仍能选择同一任务。
 */
import { describe, expect, it } from "vitest";
import { createStableTaskOrder } from "../src/domain/dag.js";
import type { TaskDefinition } from "../src/domain/manifest.js";

/**
 * 测试任务补齐 TASK 目录解析后的字段，让用例只突出依赖关系。
 * 每次调用都创建独立数组，避免测试之间通过可变集合共享隐式状态。
 */
function createTask(
  id: string,
  dependsOn: readonly string[] = [],
): TaskDefinition {
  return {
    id,
    title: `任务 ${id}`,
    file: `tasks/${id}.md`,
    dependsOn: [...dependsOn],
    scope: {
      allow: ["src/**"],
      deny: [],
    },
    gates: [
      {
        name: "类型检查",
        command: "pnpm",
        args: ["run", "typecheck"],
        timeoutMinutes: 15,
      },
    ],
    manualAcceptance: [],
  };
}

describe("createStableTaskOrder", () => {
  it("以任务目录原始顺序稳定裁决同时满足依赖的任务", () => {
    const tasks = [
      createTask("TASK-003", ["TASK-001"]),
      createTask("TASK-002"),
      createTask("TASK-001"),
      createTask("TASK-004", ["TASK-002", "TASK-003"]),
      createTask("TASK-005"),
    ];

    const firstOrder = createStableTaskOrder(tasks).map((task) => task.id);
    const secondOrder = createStableTaskOrder(tasks).map((task) => task.id);

    expect(firstOrder).toEqual([
      "TASK-002",
      "TASK-001",
      "TASK-003",
      "TASK-004",
      "TASK-005",
    ]);
    expect(secondOrder).toEqual(firstOrder);
    expect(tasks.map((task) => task.id)).toEqual([
      "TASK-003",
      "TASK-002",
      "TASK-001",
      "TASK-004",
      "TASK-005",
    ]);
  });

  it("拒绝重复任务 ID", () => {
    const tasks = [createTask("TASK-001"), createTask("TASK-001")];

    expect(() => createStableTaskOrder(tasks)).toThrow(
      "任务 ID 重复：TASK-001",
    );
  });

  it("拒绝指向不存在任务的依赖", () => {
    const tasks = [createTask("TASK-001", ["TASK-404"])];

    expect(() => createStableTaskOrder(tasks)).toThrow(
      "任务 TASK-001 依赖不存在的任务 TASK-404",
    );
  });

  it("拒绝无法完成拓扑排序的环依赖", () => {
    const tasks = [
      createTask("TASK-001", ["TASK-003"]),
      createTask("TASK-002", ["TASK-001"]),
      createTask("TASK-003", ["TASK-002"]),
    ];

    expect(() => createStableTaskOrder(tasks)).toThrow(
      "任务依赖存在环：TASK-001, TASK-002, TASK-003",
    );
  });
});
