import { parseRunnerCliArgs, resetTaskStatus } from './task-lib.mjs';

/*
 * 恢复入口只修改指定 task 的状态。
 * 失败或阻塞后，用户可以先人工清理工作区和修正任务文件，
 * 再用这个命令把任务重新放回 ready 队列；
 * 传入 --reset-branch 时会额外丢弃该 task 分支上残留的未提交改动。
 */
try {
  await resetTaskStatus(parseRunnerCliArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
