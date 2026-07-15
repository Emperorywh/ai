/*
 * 线性任务序列是 TASK 顺序的唯一领域解释器，只负责校验身份并按数字序号建立全序。
 * 文件仓储、队列和完成证据共享该结果，避免各层分别实现字符串排序或前驱推导。
 */
import { ConfigurationError } from "./errors.js";
import {
  TASK_ID_PATTERN,
  type TaskDefinition,
} from "./project.js";

export function createLinearTaskSequence(
  tasks: readonly TaskDefinition[],
): readonly TaskDefinition[] {
  const taskIds = new Set<string>();
  const taskByPosition = new Map<bigint, string>();

  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      throw new ConfigurationError(`任务 ID 重复：${task.id}`);
    }
    taskIds.add(task.id);

    const position = readTaskPosition(task.id);
    const existingTaskId = taskByPosition.get(position);
    if (existingTaskId !== undefined) {
      throw new ConfigurationError(
        `任务序号重复：${existingTaskId} 与 ${task.id}`,
      );
    }
    taskByPosition.set(position, task.id);
  }

  return [...tasks].sort((left, right) => {
    const leftPosition = readTaskPosition(left.id);
    const rightPosition = readTaskPosition(right.id);
    return leftPosition < rightPosition ? -1 : leftPosition > rightPosition ? 1 : 0;
  });
}

/*
 * 前驱只从已经建立的线性序列推导，不写回 TASK，也不复制成第二份静态元数据。
 * 找不到当前任务说明调用方破坏了 LoadedProject 不变量，必须立即报错而不是回退为根任务。
 */
export function findTaskPredecessor(
  orderedTasks: readonly TaskDefinition[],
  taskId: string,
): TaskDefinition | undefined {
  const index = orderedTasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    throw new ConfigurationError(`线性任务序列中不存在任务：${taskId}`);
  }
  return index === 0 ? undefined : orderedTasks[index - 1];
}

function readTaskPosition(taskId: string): bigint {
  const match = TASK_ID_PATTERN.exec(taskId);
  if (match?.[1] === undefined) {
    throw new ConfigurationError(`任务 ID 不符合 TASK-数字 格式：${taskId}`);
  }
  return BigInt(match[1]);
}
