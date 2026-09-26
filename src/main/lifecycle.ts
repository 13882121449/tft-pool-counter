/**
 * 应用生命周期挂钩（架构 §3.6 / §5.4）。
 *
 * 处理"系统挂起 / 唤醒 / 锁屏 / 解锁"：
 * - 挂起与锁屏时暂停扫描（此时屏幕内容无意义，扫了也是浪费）；
 * - 唤醒与解锁后恢复（用户回到游戏，需要立刻恢复刷新）。
 *
 * 合规：只响应系统电源/会话事件，不涉及任何进程交互。
 */

import { powerMonitor } from 'electron';
import type { ScanScheduler } from './scheduler/scan-scheduler';
import { logger } from './system/logger';

/** 生命周期依赖。 */
export interface LifecycleDeps {
  scheduler: ScanScheduler;
}

/**
 * 安装生命周期挂钩。
 *
 * @param deps 依赖。
 * @returns 卸载函数（退出前调用）。
 */
export function installLifecycle(deps: LifecycleDeps): () => void {
  const wasPausedBySystem = { value: false };

  const onSuspend = (): void => {
    if (!deps.scheduler.isPaused()) {
      wasPausedBySystem.value = true;
    }
    logger.info('[lifecycle] 系统挂起 → 暂停扫描');
    deps.scheduler.pause();
  };

  const onResume = (): void => {
    logger.info('[lifecycle] 系统唤醒 → 恢复扫描');
    if (wasPausedBySystem.value) {
      wasPausedBySystem.value = false;
      deps.scheduler.resume();
    }
  };

  const onLock = (): void => {
    if (!deps.scheduler.isPaused()) {
      wasPausedBySystem.value = true;
    }
    deps.scheduler.pause();
  };

  const onUnlock = (): void => {
    if (wasPausedBySystem.value) {
      wasPausedBySystem.value = false;
      deps.scheduler.resume();
    }
  };

  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('unlock-screen', onUnlock);

  return () => {
    powerMonitor.off('suspend', onSuspend);
    powerMonitor.off('resume', onResume);
    powerMonitor.off('lock-screen', onLock);
    powerMonitor.off('unlock-screen', onUnlock);
  };
}
