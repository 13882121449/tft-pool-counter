/**
 * 配置域 IPC（架构 §8.3）。
 *
 * 配置一旦变更，需要把影响**同步**到各处（否则会出现"设置页改了但没生效"）：
 * - `window` → 窗口不透明度/缩放/穿透/模式（**不重新落盘**，避免写放大）；
 * - `recognition` → 下发给 vision worker；
 * - `advanced.logLevel` → 日志级别；
 * - `advanced.saveSession` → 会话落盘开关。
 */

import { ipcMain } from 'electron';
import type { AppConfig } from '../../shared/types/config';
import { CH_CONFIG_GET, CH_CONFIG_RESET, CH_CONFIG_SET } from '../../shared/ipc/channels';
import { setLogLevel } from '../system/logger';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 配置变更后的副作用分发。
 *
 * @param services 服务集合。
 * @param patch 本次变更的片段。
 * @param config 变更后的完整配置。
 */
function applySideEffects(services: AppServices, patch: Partial<AppConfig>, config: AppConfig): void {
  if (patch.window !== undefined) {
    services.windows.applyWindowConfig(config.window);
  }
  if (patch.recognition !== undefined) {
    services.vision.configure({
      recognition: {
        matchThreshold: config.recognition.matchThreshold,
        coarseTopN: config.recognition.coarseTopN,
        enableShopDetect: config.recognition.enableShopDetect,
      },
    });
  }
  if (patch.advanced !== undefined) {
    setLogLevel(config.advanced.logLevel);
    services.session.setEnabled(config.advanced.saveSession);
  }
}

/**
 * 注册配置域 handler。
 *
 * @param services 服务集合。
 */
export function registerConfigHandlers(services: AppServices): void {
  ipcMain.handle(CH_CONFIG_GET, () => wrap<AppConfig>(() => services.config.get()));

  ipcMain.handle(CH_CONFIG_SET, (_event, patch: Partial<AppConfig>) =>
    wrap<AppConfig>(() => {
      const config = services.config.set(patch);
      applySideEffects(services, patch, config);
      return config;
    }),
  );

  ipcMain.handle(CH_CONFIG_RESET, () =>
    wrap<AppConfig>(() => {
      const config = services.config.reset();
      setLogLevel(config.advanced.logLevel);
      services.session.setEnabled(config.advanced.saveSession);
      services.windows.applyWindowConfig(config.window);
      return config;
    }),
  );
}
