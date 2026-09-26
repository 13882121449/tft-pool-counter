/**
 * 标定域 IPC（架构 §4.2 Calibration）。
 *
 * 标定是"归一化比例（0..1）"，与分辨率/DPI 无关，因此换显示器后仍可用；
 * 保存后立即下发给 vision worker，无需重启。
 */

import { ipcMain } from 'electron';
import type { Calibration } from '../../shared/types/scan';
import { CH_CALIBRATION_GET, CH_CALIBRATION_SET } from '../../shared/ipc/channels';
import { isValidCalibration } from '../store/calibration-store';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 注册标定域 handler。
 *
 * @param services 服务集合。
 */
export function registerCalibrationHandlers(services: AppServices): void {
  ipcMain.handle(CH_CALIBRATION_GET, () =>
    wrap<Calibration | null>(() => services.calibration.get()),
  );

  ipcMain.handle(CH_CALIBRATION_SET, (_event, calibration: Calibration) =>
    wrap<Calibration>(async () => {
      if (!isValidCalibration(calibration)) {
        throw new Error('标定结构非法：请确认已框选棋盘与备战席区域');
      }
      await services.calibration.save(calibration);
      services.vision.setCalibration(calibration);
      return calibration;
    }),
  );
}
