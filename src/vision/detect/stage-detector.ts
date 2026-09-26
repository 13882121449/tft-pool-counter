/**
 * 阶段识别（ADR-06 阶段降频策略的输入）。
 *
 * 为什么重要：不同阶段的扫描价值与频率完全不同 ——
 * 备战阶段棋子频繁买卖（需 1.5s 高频扫），战斗阶段棋盘瞬时变化但无买卖
 * （可降到 5s），走位选秀（carousel）阶段画面混乱应暂停扫描。
 *
 * 判据（不需要任何游戏内存信息，纯像素）：
 * - **帧间运动**：战斗阶段棋子移动 → 棋盘区域变化像素比例显著升高；
 * - **商店条是否出现**：备战阶段顶部有商店，战斗/选秀时没有；
 * - **棋盘结构强度**：选秀阶段棋盘区域被替换为环形选秀台，结构显著变化。
 *
 * 没有前一帧时退化为静态判据，并相应降低置信度（绝不假装很确定）。
 */

import type { Stage } from '../../shared/types/domain';
import type { GridGeometry } from '../preprocess/geometry';
import { computeFrameStats, cropImage, diffRatio, type RawImage } from '../preprocess/raw-image';

/** 判定"战斗中"的棋盘帧间变化比例阈值。 */
export const COMBAT_MOTION_RATIO = 0.06;

/** 判定商店条存在的亮度方差阈值。 */
export const SHOP_MIN_VARIANCE = 90;

/** 判定选秀阶段的棋盘方差上限（棋盘被替换为选秀台）。 */
export const CAROUSEL_BOARD_MAX_VARIANCE = 45;

/** 阶段识别结果。 */
export interface StageDetectResult {
  stage: Stage;
  confidence: number;
  /** 中文原因，便于日志排查。 */
  reason: string;
  /** 实测运动比例（无前帧时为 0）。 */
  motionRatio: number;
  /** 商店条方差。 */
  shopVariance: number;
  /** 棋盘方差。 */
  boardVariance: number;
}

/** ImageData 无关的最小帧引用（用于传入"前一帧"）。 */
export type PrevFrame = RawImage | null;

/**
 * 识别当前阶段。
 *
 * @param image 当前帧。
 * @param geometry 网格几何。
 * @param prev 前一帧（可选；有它才能判运动）。
 */
export function detectStage(
  image: RawImage,
  geometry: GridGeometry,
  prev: PrevFrame = null,
): StageDetectResult {
  const boardCrop = cropImage(image, geometry.boardRect);
  const boardStats = computeFrameStats(boardCrop, 4);
  const shopCrop = geometry.shopRect ? cropImage(image, geometry.shopRect) : null;
  const shopStats = shopCrop ? computeFrameStats(shopCrop, 4) : null;
  const shopVariance = shopStats?.variance ?? 0;

  let motionRatio = 0;
  if (prev !== null && prev.width === image.width && prev.height === image.height) {
    const prevBoard = cropImage(prev, geometry.boardRect);
    motionRatio = diffRatio(boardCrop, prevBoard);
  }

  const base = {
    motionRatio,
    shopVariance,
    boardVariance: boardStats.variance,
  };

  // 1) 棋盘结构极弱 → 选秀阶段（棋盘被选秀台替换）或非对局
  if (boardStats.variance < CAROUSEL_BOARD_MAX_VARIANCE) {
    const isCarousel = shopVariance > SHOP_MIN_VARIANCE;
    return {
      ...base,
      stage: isCarousel ? 'carousel' : 'unknown',
      confidence: isCarousel ? 0.6 : 0.4,
      reason: isCarousel ? '棋盘结构弱且商店条存在 → 疑似选秀' : '棋盘结构不足，无法判定阶段',
    };
  }

  // 2) 有前帧且运动明显 → 战斗阶段
  if (prev !== null && motionRatio >= COMBAT_MOTION_RATIO) {
    return {
      ...base,
      stage: 'combat',
      confidence: 0.85,
      reason: `棋盘帧间变化 ${(motionRatio * 100).toFixed(1)}% ≥ 阈值，判定为战斗中`,
    };
  }

  // 3) 商店条可见 → 备战阶段
  if (shopCrop !== null && shopVariance >= SHOP_MIN_VARIANCE) {
    return {
      ...base,
      stage: 'prep',
      confidence: prev === null ? 0.65 : 0.85,
      reason: '商店条可见，判定为备战阶段',
    };
  }

  // 4) 有前帧但运动小 → 战斗末尾/结算，归为 combat 低置信
  if (prev !== null) {
    return {
      ...base,
      stage: 'combat',
      confidence: 0.55,
      reason: '无商店条且棋盘有结构，判定为战斗中（低置信）',
    };
  }

  return {
    ...base,
    stage: 'unknown',
    confidence: 0.3,
    reason: '缺少前一帧且商店条不可用，阶段判定不确定',
  };
}

/**
 * 阶段 → 建议的扫描间隔（ms）；`intervalCombatMs = 0` 表示战斗阶段暂停。
 *
 * @param config 扫描配置。
 * @param stage 当前阶段。
 */
export function intervalForStage(
  config: { intervalPrepMs: number; intervalCombatMs: number; pauseOnCarousel: boolean },
  stage: Stage,
): number {
  switch (stage) {
    case 'prep':
      return config.intervalPrepMs;
    case 'combat':
      return config.intervalCombatMs;
    case 'carousel':
      return config.pauseOnCarousel ? 0 : config.intervalCombatMs;
    default:
      return Math.max(config.intervalCombatMs, config.intervalPrepMs);
  }
}
