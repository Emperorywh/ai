import { loadTasks, parseRunnerCliArgs, printTaskStatus, validateTaskQueue } from './task-lib.mjs';

/*
 * 状态命令默认只读任务文件，不触碰 git，也不修改任何状态。
 * 传入 --validate 时会额外执行 task schema 校验，
 * 方便在进入 Runner 前先发现 SPEC/PLAN/task 契约问题。
 */
try {
  const options = parseRunnerCliArgs(process.argv.slice(2));

  if (options.validate) {
    validateTaskQueue(options);
  }

  printTaskStatus(loadTasks(options));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
