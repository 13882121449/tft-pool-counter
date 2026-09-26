/**
 * 置信度聚合。
 *
 * 公式（弱链优先 + 覆盖率加权）：
 *   instanceConfidence = min(各实例 confidence)      // 没有实例时视为 1
 *   coverageFactor     = 0.4 + 0.6 × (scanned / 8)
 *   confidence         = clamp01(instanceConfidence × coverageFactor)
 *
 * 为什么用 min 而不是平均：任意一个格子认错都会让整行数字失真，
 * 用最差格子代表整行能把风险暴露给用户（配合低置信高亮 + 一键校正）。
 */

import type { Coverage, UnitInstance } from '../../shared/types/domain';
import { clamp01 } from '../../shared/utils/assert';
import { uncoveredSeatCount } from './coverage';

/**
 * 计算单个弈子的置信度。
 *
 * @param instances 参与计数的实例。
 * @param coverage 覆盖率。
 */
export function confidenceOfChampion(
  instances: ReadonlyArray<UnitInstance>,
  coverage: Coverage,
): number {
  const instanceConfidence =
    instances.length === 0
      ? 1
      : instances.reduce((min, instance) => Math.min(min, instance.confidence), 1);

  const total = coverage.total > 0 ? coverage.total : 8;
  const scannedRatio = clamp01(coverage.scanned / total);
  const coverageFactor = 0.4 + 0.6 * scannedRatio;

  return clamp01(instanceConfidence * coverageFactor);
}

/**
 * 覆盖未知家带来的不确定性惩罚（0..1，越大越不确定）。
 *
 * @param coverage 覆盖率。
 */
export function uncertaintyFromCoverage(coverage: Coverage): number {
  return clamp01(uncoveredSeatCount(coverage) / Math.max(1, coverage.total));
}

/**
 * 计算整张快照的平均置信度。
 *
 * @param confidences 各行置信度。
 */
export function averageConfidence(confidences: ReadonlyArray<number>): number {
  if (confidences.length === 0) {
    return 0;
  }
  const sum = confidences.reduce((acc, value) => acc + value, 0);
  return clamp01(sum / confidences.length);
}
