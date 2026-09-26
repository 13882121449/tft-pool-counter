/**
 * 占位模板使用的费用参考色板。
 *
 * 数据来源：`data/cost-colors.json` 的 `referenceRgb`（经 `specs.ts` 解析）。
 * 这里只做"费用档 → 参考色"的查表，**不引入新的硬编码颜色**
 * —— 兜底值直接派生自 `FALLBACK_COST_COLOR_SPEC`，保证只有一处真值来源。
 */

import type { Cost } from '../../shared/types/domain';
import type { Rgb } from '../../shared/math/color';
import { FALLBACK_COST_COLOR_SPEC, type CostColorSpec } from '../detect/specs';

/** 未知费用档时的中性灰。 */
const NEUTRAL_GRAY: Rgb = { r: 128, g: 128, b: 128 };

/**
 * 由费用规格构造色板。
 *
 * @param spec 费用颜色规格。
 * @returns 费用档 → 参考色。
 */
export function buildCostPalette(spec: CostColorSpec): Record<Cost, Rgb> {
  const palette: Record<Cost, Rgb> = {
    1: NEUTRAL_GRAY,
    2: NEUTRAL_GRAY,
    3: NEUTRAL_GRAY,
    4: NEUTRAL_GRAY,
    5: NEUTRAL_GRAY,
  };
  for (const item of spec.costs) {
    palette[item.cost] = item.referenceRgb;
  }
  return palette;
}

/** 默认色板（派生自内置兜底规格，避免在代码里再写一遍色值）。 */
export const DEBUG_COST_REFERENCE_RGB: Record<Cost, Rgb> = buildCostPalette(
  FALLBACK_COST_COLOR_SPEC,
);
