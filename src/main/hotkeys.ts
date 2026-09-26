/**
 * 全局热键（架构 §3.6）。
 *
 * 默认：`Ctrl+Shift+T` 显隐 HUD、`Ctrl+Shift+P` 暂停/恢复扫描。
 * 注册失败（被其它软件占用）不视为致命错误，只记日志并在设置页提示。
 *
 * 合规：热键只切换本工具自身的窗口/调度状态，**不向游戏发送任何输入**。
 */

import { globalShortcut } from 'electron';
import type { AppServices } from './ipc/context';
import { logger } from './system/logger';

/**
 * 注册全局热键（会先注销旧热键，保证幂等）。
 *
 * @param services 服务集合。
 */
export function registerHotkeys(services: AppServices): void {
  unregisterHotkeys();
  const { toggleVisible, togglePause } = services.config.get().hotkeys;

  registerOne(toggleVisible, () => {
    services.windows.toggleVisible();
  }, '显隐 HUD');

  registerOne(
    togglePause,
    () => {
      if (services.scheduler.isPaused()) {
        services.scheduler.resume();
      } else {
        services.scheduler.pause();
      }
    },
    '暂停 / 恢复扫描',
  );
}

/** 注销全部热键。 */
export function unregisterHotkeys(): void {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // 应用退出过程中可能已释放
  }
}

/** 注册单个热键，失败只告警。 */
function registerOne(accelerator: string, handler: () => void, label: string): void {
  if (accelerator.length === 0) {
    return;
  }
  try {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) {
      logger.warn(`[hotkeys] 注册失败（可能已被占用）：${accelerator}（${label}）`);
    }
  } catch (error) {
    logger.warn('[hotkeys] 注册异常', {
      accelerator,
      label,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
