import { runNextTask } from './task-lib.mjs';

/*
 * 批量入口采用“成功一个再跑下一个”的串行模式。
 * 只要某个任务失败、阻塞或验证不通过，脚本就会停止，
 * 避免后续任务建立在不可靠的代码状态上。
 */
let completedCount = 0;

try {
  while (await runNextTask()) {
    completedCount += 1;
  }

  console.log(`批量执行结束，本次完成 ${completedCount} 个任务。`);
} catch (error) {
  console.error(error.message);
  console.error(`批量执行中断，本次已完成 ${completedCount} 个任务。`);
  process.exitCode = 1;
}
