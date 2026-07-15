/*
 * 线性序列测试只验证数字顺序、身份唯一性与直接前驱推导，不接触文件系统或执行器。
 * 输入故意打乱，确保领域顺序不依赖目录枚举、字符串比较或调用方预排序。
 */
import { describe, expect, it } from "vitest";
import type { TaskDefinition } from "../src/domain/project.js";
import {
  createLinearTaskSequence,
  findTaskPredecessor,
} from "../src/domain/task-sequence.js";

/*
 * 测试任务只补齐仓储加载后的领域字段，避免在各用例复制无关 Markdown 解析细节。
 * 每次调用都创建新对象，序列排序不能通过修改输入数组产生隐式状态。
 */
function createTask(id: string): TaskDefinition {
  return {
    id,
    title: `任务 ${id}`,
    file: `orchestration/tasks/${id}.md`,
  };
}

describe("createLinearTaskSequence", () => {
  it("按 TASK 数字序号建立稳定全序且不修改输入", () => {
    const tasks = [
      createTask("TASK-010"),
      createTask("TASK-002"),
      createTask("TASK-001"),
    ];

    const ordered = createLinearTaskSequence(tasks);

    expect(ordered.map((task) => task.id)).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-010",
    ]);
    expect(tasks.map((task) => task.id)).toEqual([
      "TASK-010",
      "TASK-002",
      "TASK-001",
    ]);
  });

  it("推导根任务和任意任务的直接前驱", () => {
    const ordered = createLinearTaskSequence([
      createTask("TASK-003"),
      createTask("TASK-001"),
      createTask("TASK-002"),
    ]);

    expect(findTaskPredecessor(ordered, "TASK-001")).toBeUndefined();
    expect(findTaskPredecessor(ordered, "TASK-003")?.id).toBe("TASK-002");
  });

  it("拒绝重复任务 ID 和重复数字序号", () => {
    expect(() => createLinearTaskSequence([
      createTask("TASK-001"),
      createTask("TASK-001"),
    ])).toThrow("任务 ID 重复：TASK-001");

    expect(() => createLinearTaskSequence([
      createTask("TASK-001"),
      createTask("TASK-0001"),
    ])).toThrow("任务序号重复：TASK-001 与 TASK-0001");
  });

  it("找不到当前任务时拒绝隐式回退为根任务", () => {
    const ordered = createLinearTaskSequence([createTask("TASK-001")]);

    expect(() => findTaskPredecessor(ordered, "TASK-999")).toThrow(
      "线性任务序列中不存在任务：TASK-999",
    );
  });
});
