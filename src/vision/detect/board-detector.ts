/**
 * 棋盘存在性检测（ADR-02 第 1 步的前置门禁）。
 *
 * 为什么需要它：在游戏大厅 / 结算界面 / 加载界面调用识别既浪费算力，
 * 也会把无关画面误判为棋子。这里用"标定区域是否有足够结构信息"作为低成本门禁，
 * 不通过就返回 `VIS_NO_BOARD`，让调度器进入休眠探测模式（省电、少误报）。
 *
 * 判据（全部基于标定矩形内的亮度统计，O(采样像素)）：
 * 1. 平均亮度不能过低（排除黑帧/淡出画面）；
 * 2. 亮度方差必须够大（排除纯色背景/加载图）；
 * 3. 备战席区域通常与棋盘同时出现 → 作为加权证据。
 */

import type { Calibration } from '../../shared/types/scan';
import type { GridGeometry } from '../preprocess/geometry';
import { computeFrameStats, cropImage, type RawImage } from '../preprocess/raw-image';

/** 棋盘检测阈值（保守偏严，宁可漏检交给探测循环，也不误判）。 */
export const BOARD_MIN_VARIANCE = 60;

/** 棋盘区域最小平均亮度。 */
export const BOARD_MIN_LUMA = 14;

/** 备战席区域最小方差（加权证据）。 */
export const BENCH_MIN_VARIANCE = 40;

/** 棋盘检测结果。 */
export interface BoardDetectionResult {
  present: boolean;
  /** 0..1。 */
  confidence: number;
  /** 中文原因，可直接显示在 HUD 的"等待扫描"提示里。 */
  reason: string;
  boardVariance: number;
  benchVariance: number;
  boardLuma: number;
}

/**
 * 判定当前帧是否包含棋盘。
 *
 * @param image 整帧图像。
 * @param geometry 已解析的网格几何。
 * @returns 判定结果。
 */
export function detectBoard(image: RawImage, geometry: GridGeometry): BoardDetectionResult {
  if (image.width === 0 || image.height === 0) {
    return {
      present: false,
      confidence: 1,
      reason: '捕获帧为空',
      boardVariance: 0,
      benchVariance: 0,
      boardLuma: 0,
    };
  }

  const boardCrop = cropImage(image, geometry.boardRect);
  const benchCrop = cropImage(image, geometry.benchRect);
  const boardStats = computeFrameStats(boardCrop, 4);
  const benchStats = computeFrameStats(benchCrop, 4);

  const boardOk = boardStats.variance >= BOARD_MIN_VARIANCE && boardStats.meanLuma >= BOARD_MIN_LUMA;
  const benchOk = benchStats.variance >= BENCH_MIN_VARIANCE;

  if (boardOk && benchOk) {
    return {
      present: true,
      confidence: 0.95,
      reason: '已定位棋盘与备战席',
      boardVariance: boardStats.variance,
      benchVariance: benchStats.variance,
      boardLuma: boardStats.meanLuma,
    };
  }

  if (boardOk) {
    return {
      present: true,
      confidence: 0.7,
      reason: '已定位棋盘（备战席区域结构不足，可能被遮挡）',
      boardVariance: boardStats.variance,
      benchVariance: benchStats.variance,
      boardLuma: boardStats.meanLuma,
    };
  }

  const reason =
    boardStats.meanLuma < BOARD_MIN_LUMA
      ? '标定区域过暗，未检测到棋盘（若为独占全屏请改为无边框全屏）'
      : '标定区域结构不足，未检测到棋盘（可能不在对局中或标定已失效）';

  return {
    present: false,
    confidence: boardStats.variance > 0 ? 0.8 : 1,
    reason,
    boardVariance: boardStats.variance,
    benchVariance: benchStats.variance,
    boardLuma: boardStats.meanLuma,
  };
}

/**
 * 校验标定是否仍然适配当前帧（用于"标定失效"提示）。
 *
 * 判据：棋盘矩形的实际内容不以纯色为主。
 *
 * @param image 整帧图像。
 * @param calibration 当前标定。
 */
export function isCalibrationPlausible(image: RawImage, calibration: Calibration): boolean {
  const rect = {
    x: Math.round(calibration.board.x * image.width),
    y: Math.round(calibration.board.y * image.height),
    w: Math.round(calibration.board.w * image.width),
    h: Math.round(calibration.board.h * image.height),
  };
  const crop = cropImage(image, rect);
  if (crop.width === 0 || crop.height === 0) {
    return false;
  }
  const stats = computeFrameStats(crop, 4);
  return stats.variance >= BOARD_MIN_VARIANCE * 0.5;
}
