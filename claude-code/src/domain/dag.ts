/*
 * DAG 模块只负责依赖合法性与稳定拓扑顺序，不读取文件，也不判断任务是否执行成功。
 * 相同 Manifest 在任何机器上都会得到相同顺序，便于恢复、审计和测试推导。
 */
import type { TaskDefinition } from "./manifest.js";
import { ConfigurationError } from "./errors.js";

export function createStableTaskOrder(
  tasks: readonly TaskDefinition[],
): readonly TaskDefinition[] {
  const taskById = new Map<string, TaskDefinition>();
  const sourceIndex = new Map<string, number>();

  tasks.forEach((task, index) => {
    if (taskById.has(task.id)) {
      throw new ConfigurationError(`任务 ID 重复：${task.id}`);
    }

    taskById.set(task.id, task);
    sourceIndex.set(task.id, index);
  });

  const incomingCount = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    const uniqueDependencies = new Set(task.dependsOn);
    if (uniqueDependencies.size !== task.dependsOn.length) {
      throw new ConfigurationError(`任务 ${task.id} 存在重复依赖`);
    }

    incomingCount.set(task.id, uniqueDependencies.size);
    for (const dependencyId of uniqueDependencies) {
      if (dependencyId === task.id) {
        throw new ConfigurationError(`任务 ${task.id} 不能依赖自身`);
      }
      if (!taskById.has(dependencyId)) {
        throw new ConfigurationError(
          `任务 ${task.id} 依赖不存在的任务 ${dependencyId}`,
        );
      }

      const items = dependents.get(dependencyId) ?? [];
      items.push(task.id);
      dependents.set(dependencyId, items);
    }
  }

  const ready = tasks
    .filter((task) => incomingCount.get(task.id) === 0)
    .map((task) => task.id);
  const ordered: TaskDefinition[] = [];

  while (ready.length > 0) {
    ready.sort((left, right) =>
      (sourceIndex.get(left) ?? 0) - (sourceIndex.get(right) ?? 0));
    const nextId = ready.shift();
    if (nextId === undefined) {
      break;
    }

    const task = taskById.get(nextId);
    if (task === undefined) {
      throw new ConfigurationError(`内部错误：任务 ${nextId} 丢失`);
    }
    ordered.push(task);

    for (const dependentId of dependents.get(nextId) ?? []) {
      const nextCount = (incomingCount.get(dependentId) ?? 0) - 1;
      incomingCount.set(dependentId, nextCount);
      if (nextCount === 0) {
        ready.push(dependentId);
      }
    }
  }

  if (ordered.length !== tasks.length) {
    const cyclicIds = tasks
      .filter((task) => !ordered.some((item) => item.id === task.id))
      .map((task) => task.id);
    throw new ConfigurationError(`任务依赖存在环：${cyclicIds.join(", ")}`);
  }

  return ordered;
}
