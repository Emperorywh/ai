import { runNextTask } from './task-lib.mjs';

/*
 * 单任务入口只负责启动下一个 pending task。
 * 复杂的状态流、git 校验、Claude 调用都封装在 task-lib 中，
 * 这样命令入口保持很薄，后续也更容易被 CI 或其它脚本复用。
 */
try {
  await runNextTask();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
