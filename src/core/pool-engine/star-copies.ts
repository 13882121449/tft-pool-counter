/**
 * 星级 → 消耗张数换算。
 *
 * 换算表**必须**来自 `PoolBaseline.starCopyCost`（默认 {1:1, 2:3, 3:9, 4:9}），
 * 禁止在业务逻辑里硬编码数字。基线缺失时回退到 `shared/constants` 的
 * `STAR_COPY_COST`（唯一来源，渲染层亦引用它，保证全链路口径一致）。
 */

import type { PoolBaseline, Star } from '../../shared/types/domain';
import { STAR_COPY_COST } from '../../shared/constants';

/**
 * 某星级消耗池中多少张。
 *
 * @param star 星级。
 * @param baseline 卡池基线（缺失时回退 `STAR_COPY_COST`）。
 */
export function copiesOf(star: Star, baseline: PoolBaseline | undefined): number {
  const table = baseline?.starCopyCost;
  const value = table?.[star];
  return typeof value === 'number' && value > 0 ? value : STAR_COPY_COST[star];
}

/**
 * 由消耗张数反推最接近的星级（人工校正时把"设为 N 张"落成具体星级）。
 *
 * 规则：取不超过 copies 的最大星级；copies < 1 时按 1★ 处理。
 *
 * @param copies 张数。
 * @param baseline 卡池基线（缺失时回退兜底换算表）。
 */
export function starFromCopies(copies: number, baseline: PoolBaseline | undefined): Star {
  const safeCopies = Math.max(1, Math.floor(copies));
  let best: Star = 1;
  for (const star of [1, 2, 3] as Star[]) {
    if (copiesOf(star, baseline) <= safeCopies) {
      best = star;
    }
  }
  // 4★ 是 S18「日蚀」羁绊的**战斗内临时升星**，张数与 3★ 相同（9 张）。
  // 台账里 9 张应归为 3★；只有明显超过 3★ 的张数才按 4★ 处理。
  if (safeCopies > copiesOf(3, baseline) && copiesOf(4, baseline) <= safeCopies) {
    best = 4;
  }
  return best;
}

/**
 * 校验星级是否合法。
 *
 * @param value 待校验值。
 */
export function isStar(value: unknown): value is Star {
  return value === 1 || value === 2 || value === 3 || value === 4;
}
