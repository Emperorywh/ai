import { parseRunnerCliArgs, runNextTask } from './task-lib.mjs';

/*
 * 批量入口采用“成功一个再跑下一个”的串行模式。
 * 只要某个任务失败、阻塞或验证不通过，脚本就会停止，
 * 避免后续任务建立在不可靠的代码状态上。
 */
const options = parseRunnerCliArgs(process.argv.slice(2));
let completedCount = 0;

try {
  /*
   * dry-run 不会改变状态，指定 taskId 也只代表一次明确执行。
   * 这两种模式都不能进入批量循环，否则会重复选中同一个任务。
   * 真实执行指定 task 成功时仍然计入完成数，让命令输出和实际提交保持一致。
   */
  if (options.dryRun || options.taskId) {
    const completed = await runNextTask(options);

    if (completed && !options.dryRun) {
      completedCount += 1;
    }
  } else {
    while (await runNextTask(options)) {
      completedCount += 1;
    }
  }

  console.log(`批量执行结束，本次完成 ${completedCount} 个任务。`);
} catch (error) {
  console.error(error.stack || error.message);
  console.error(`批量执行中断，本次已完成 ${completedCount} 个任务。`);
  process.exitCode = 1;
}
