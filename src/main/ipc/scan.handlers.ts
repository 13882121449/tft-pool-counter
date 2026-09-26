/**
 * 扫描域 IPC（架构 §8.3）。
 *
 * 通道：`scan:once` / `scan:pause` / `scan:resume` / `scan:status`
 */

import { ipcMain } from 'electron';
import type { ScanStatusPush } from '../../shared/types/ipc';
import {
  CH_SCAN_ONCE,
  CH_SCAN_PAUSE,
  CH_SCAN_RESUME,
  CH_SCAN_STATUS,
} from '../../shared/ipc/channels';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 注册扫描域 handler。
 *
 * @param services 服务集合。
 */
export function registerScanHandlers(services: AppServices): void {
  ipcMain.handle(CH_SCAN_ONCE, () =>
    wrap<ScanStatusPush>(() => services.scheduler.triggerManual()),
  );

  ipcMain.handle(CH_SCAN_PAUSE, () =>
    wrap<ScanStatusPush>(() => {
      services.scheduler.pause();
      return services.scheduler.getStatus();
    }),
  );

  ipcMain.handle(CH_SCAN_RESUME, () =>
    wrap<ScanStatusPush>(() => {
      services.scheduler.resume();
      return services.scheduler.getStatus();
    }),
  );

  ipcMain.handle(CH_SCAN_STATUS, () =>
    wrap<ScanStatusPush>(() => services.scheduler.getStatus()),
  );
}
