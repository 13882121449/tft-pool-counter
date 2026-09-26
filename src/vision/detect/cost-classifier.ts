/**
 * 费用颜色先验分类器（ADR-02 第 3 步）—— **准确率与性能的关键一招**。
 *
 * 原理：TFT 每个弈子卡面**底部有一条费用色带**（1 灰白 / 2 绿 / 3 蓝 / 4 紫 / 5 金）。
 * 先判费用档，就把"65 类弈子识别"降级为"≤14 类（每个费用档的弈子数）识别"，
 * 粗筛集合缩小一个数量级，既提速又提准。
 *
 * 判定链（从强到弱）：
 * 1. HSV 区间命中 → 高置信；
 * 2. 命中多个区间 → 用与 `referenceRgb` 的欧氏距离决胜；
 * 3. 全不命中 → 返回 null（`unknown-cost-scan-all`，不做剪枝，绝不误判）。
 */

import {
  extractDominantColor,
  hueDistance,
  isInHsvRange,
  rgbDistance,
  rgbToHsv,
  type HsvRange,
  type Rgb,
} from '../../shared/math/color';
import type { Cost } from '../../shared/types/domain';
import { cropRelative } from '../preprocess/crop';
import type { RawImage } from '../preprocess/raw-image';
import type { CostClassSpec, CostColorSpec } from './specs';

/** 费用分类结果。 */
export interface CostClassifyResult {
  /** 命中的费用档；null = 无法归类（走 unknown-cost-scan-all）。 */
  cost: Cost | null;
  /** 0..1。 */
  confidence: number;
  /** 命中的区间数量（>1 表示需要决胜）。 */
  hitCount: number;
  /** 采样得到的主色。 */
  dominant: Rgb;
  /** 主色相对最近参考色的距离（越小越可信）。 */
  distanceToReference: number;
}

/** 单条 HSV 区间的匹配得分（0..1）。 */
function scoreRange(hsvRanges: HsvRange[], hsv: ReturnType<typeof rgbToHsv>): number {
  let best = 0;
  for (const range of hsvRanges) {
    if (isInHsvRange(hsv, range)) {
      return 1;
    }
    // 未命中时给一个"接近度"分数，用于多档并列时决胜
    const hMid = range.hMin <= range.hMax ? (range.hMin + range.hMax) / 2 : 0;
    const hDist = hueDistance(hsv.h, hMid) / 180;
    const sMid = (range.sMin + range.sMax) / 2;
    const vMid = (range.vMin + range.vMax) / 2;
    const sDist = Math.min(1, Math.abs(hsv.s - sMid));
    const vDist = Math.min(1, Math.abs(hsv.v - vMid));
    const closeness = 1 - Math.min(1, hDist * 0.5 + sDist * 0.3 + vDist * 0.2);
    best = Math.max(best, closeness);
  }
  return best;
}

/**
 * 对单个已归一化的格子图做费用分类。
 *
 * @param cell 归一化后的格子图（建议 64×64 RGBA）。
 * @param spec 费用颜色规格（来自 `data/cost-colors.json`）。
 * @returns 分类结果。
 */
export function classifyCost(cell: RawImage, spec: CostColorSpec): CostClassifyResult {
  if (cell.width === 0 || cell.height === 0 || spec.costs.length === 0) {
    return {
      cost: null,
      confidence: 0,
      hitCount: 0,
      dominant: { r: 0, g: 0, b: 0 },
      distanceToReference: Number.POSITIVE_INFINITY,
    };
  }

  // 采样底部色带（区域来自规格文件，避免硬编码）
  const region = {
    x: (1 - spec.sampleRegion.widthRatio) / 2,
    y: 1 - spec.sampleRegion.heightRatio,
    w: spec.sampleRegion.widthRatio,
    h: spec.sampleRegion.heightRatio,
  };
  const strip = cropRelative(cell, region);
  const dominantResult = extractDominantColor(strip.data, strip.channels, 1);
  const hsv = dominantResult.dominantHsv;

  let bestCost: Cost | null = null;
  let bestScore = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let hits = 0;

  for (const candidate of spec.costs) {
    const inRange = candidate.hsvRanges.some((range) => isInHsvRange(hsv, range));
    const score = inRange ? 1 : scoreRange(candidate.hsvRanges, hsv);
    const distance = rgbDistance(dominantResult.dominant, candidate.referenceRgb);
    if (inRange) {
      hits += 1;
    }

    const better =
      bestCost === null ||
      score > bestScore + 1e-6 ||
      (Math.abs(score - bestScore) <= 1e-6 && distance < bestDistance);
    if (better) {
      bestCost = candidate.cost;
      bestScore = score;
      bestDistance = distance;
    }
  }

  // 完全没有区间命中时，视为无法归类（宁可全量粗筛，也不误剪枝）
  if (hits === 0) {
    return {
      cost: null,
      confidence: 0,
      hitCount: 0,
      dominant: dominantResult.dominant,
      distanceToReference: Number.POSITIVE_INFINITY,
    };
  }

  // 置信度：命中数越少越可信（唯一命中最高）；再按与参考色的距离衰减
  const uniqueness = 1 / hits;
  const distanceFactor = 1 / (1 + bestDistance / 120);
  const confidence = Math.max(0, Math.min(1, uniqueness * 0.6 + distanceFactor * 0.4));

  return {
    cost: bestCost,
    confidence,
    hitCount: hits,
    dominant: dominantResult.dominant,
    distanceToReference: bestDistance,
  };
}

/**
 * 按费用档过滤候选规格（先验剪枝）。
 *
 * @param spec 全部费用规格。
 * @param cost 目标费用档；null = 不过滤（返回全部）。
 * @returns 允许参与匹配的费用档集合。
 */
export function allowedCostsFor(spec: CostColorSpec, cost: Cost | null): CostClassSpec[] {
  if (cost === null) {
    return spec.costs;
  }
  return spec.costs.filter((item) => item.cost === cost);
}

/**
 * 判断某个费用档是否在允许集合内。
 *
 * @param allowed 允许的费用档集合。
 * @param cost 待判费用档。
 */
export function isCostAllowed(allowed: CostClassSpec[], cost: Cost): boolean {
  return allowed.some((item) => item.cost === cost);
}
