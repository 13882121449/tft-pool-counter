/**
 * 系统 / 日志 / 自检域 IPC（架构 §8.3）。
 */

import { app, ipcMain } from 'electron';
import { CH_LOG_EXPORT, CH_LOG_TAIL, CH_SYSTEM_INFO, CH_SYSTEM_QUIT } from '../../shared/ipc/channels';
import type { SystemInfoPayload } from '../../shared/types/ipc';
import { exportLog, tailLog } from '../system/logger';
import { runPoolSelfTest } from '../self-check/pool-self-test';
import { runResolutionCheck } from '../self-check/resolution-check';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 注册系统域 handler。
 *
 * @param services 服务集合。
 */
export function registerSystemHandlers(services: AppServices): void {
  ipcMain.handle(CH_LOG_TAIL, (_event, payload?: { lines?: number }) =>
    wrap<string[]>(() => tailLog(payload?.lines ?? 200)),
  );

  ipcMain.handle(CH_LOG_EXPORT, (_event, payload: { outPath: string }) =>
    wrap<string>(() => exportLog(payload.outPath)),
  );

  ipcMain.handle(CH_SYSTEM_INFO, () =>
    wrap<SystemInfoPayload>(() => {
      const baseline = services.runtime.getBaseline();
      return {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        resolution: runResolutionCheck(services.calibration.get()),
        capabilities: services.vision.capabilities(),
        poolSelfTest: baseline !== null ? runPoolSelfTest(baseline) : null,
      };
    }),
  );

  ipcMain.handle(CH_SYSTEM_QUIT, () =>
    wrap<boolean>(() => {
      app.quit();
      return true;
    }),
  );
}
