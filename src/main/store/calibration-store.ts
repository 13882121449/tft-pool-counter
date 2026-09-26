/**
 * 棋盘标定持久化（`<userData>/calibration.json`）。
 *
 * 为什么单独存一个文件而不塞进 `config.json`：
 * - 标定是**一次性测量结果**（归一化比例 + 基准屏幕尺寸），语义上属于"数据"而非"偏好"；
 * - 用户"恢复默认配置"时不应丢掉标定（否则每次都要重标）；
 * - 归一化比例（0..1）与分辨率无关，因此换显示器后依然可用。
 */

import type { Calibration } from '../../shared/types/scan';
import { readJsonFile, writeJsonFile } from './json-file';
import { calibrationFilePath } from './paths';

/** 标定存储。 */
export class CalibrationStore {
  private calibration: Calibration | null = null;

  private loaded = false;

  /**
   * 读取标定（幂等；不存在返回 null）。
   */
  async load(): Promise<Calibration | null> {
    if (this.loaded) {
      return this.calibration;
    }
    this.loaded = true;
    const result = await readJsonFile<Calibration | null>(calibrationFilePath(), () => null);
    this.calibration = isValidCalibration(result.value) ? result.value : null;
    return this.calibration;
  }

  /** 当前标定（可能为 null = 尚未标定）。 */
  get(): Calibration | null {
    return this.calibration;
  }

  /** 是否已完成标定。 */
  isReady(): boolean {
    return this.calibration !== null;
  }

  /**
   * 保存标定。
   *
   * @param calibration 标定信息。
   */
  async save(calibration: Calibration): Promise<void> {
    this.calibration = calibration;
    this.loaded = true;
    await writeJsonFile(calibrationFilePath(), calibration);
  }

  /** 清除标定（重新标定）。 */
  async clear(): Promise<void> {
    this.calibration = null;
    this.loaded = true;
    await writeJsonFile(calibrationFilePath(), null);
  }
}

/**
 * 判定标定结构是否可用（防止手改坏 JSON 导致后续除零 / NaN）。
 *
 * @param value 待判定值。
 */
export function isValidCalibration(value: unknown): value is Calibration {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const rect = (input: unknown): boolean => {
    if (input === null || typeof input !== 'object') {
      return false;
    }
    const r = input as Record<string, unknown>;
    return (
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.w) &&
      Number.isFinite(r.h) &&
      Number(r.w) > 0 &&
      Number(r.h) > 0
    );
  };
  return (
    rect(record.board) &&
    rect(record.bench) &&
    Number(record.boardCols) > 0 &&
    Number(record.boardRows) > 0 &&
    Number(record.benchSlots) >= 0 &&
    Number(record.screenW) > 0 &&
    Number(record.screenH) > 0 &&
    Number(record.scaleFactor) > 0
  );
}
