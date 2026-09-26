/**
 * IPC handler 统一注册（架构 §3.6）。
 *
 * 只在 `bootstrap` 调用一次；重复调用被内部标志挡住，
 * 避免热重载 / 二次初始化时 `ipcMain.handle` 抛 "second handler" 错误。
 */

import type { AppServices } from './context';
import { registerBaselineHandlers } from './baseline.handlers';
import { registerCalibrationHandlers } from './calibration.handlers';
import { registerConfigHandlers } from './config.handlers';
import { registerCorrectionHandlers } from './correction.handlers';
import { registerPoolHandlers } from './pool.handlers';
import { registerScanHandlers } from './scan.handlers';
import { registerSystemHandlers } from './system.handlers';
import { registerTemplateHandlers } from './template.handlers';
import { registerWindowHandlers } from './window.handlers';

/** 是否已注册（幂等保护）。 */
let registered = false;

/**
 * 注册全部 IPC handler。
 *
 * @param services 服务集合。
 */
export function registerHandlers(services: AppServices): void {
  if (registered) {
    return;
  }
  registered = true;

  registerScanHandlers(services);
  registerPoolHandlers(services);
  registerCorrectionHandlers(services);
  registerConfigHandlers(services);
  registerBaselineHandlers(services);
  registerWindowHandlers(services);
  registerCalibrationHandlers(services);
  registerTemplateHandlers(services);
  registerSystemHandlers(services);
}
