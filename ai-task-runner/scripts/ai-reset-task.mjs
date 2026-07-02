import { parseRunnerCliArgs, resetTaskStatus } from './task-lib.mjs';

/*
 * 恢复入口只修改指定 task 的状态。
 * 失败或阻塞后，用户可以先人工清理工作区和修正任务文件，
 * 再用这个命令把任务重新放回 ready 队列。
 */
try {
  resetTaskStatus(parseRunnerCliArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
