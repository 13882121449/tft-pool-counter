/**
 * 3★ 张数换算「单一事实来源」回归（QA M3b）。
 *
 * 验证 `STAR_COPY_COST` 是 core 与 renderer 共同引用的唯一来源：
 * - core `copiesOf(star, undefined)` 回退到它；
 * - core `copiesToThreeStar(row)`（无基线）与 renderer `distanceToThreeStar(row)` 同值；
 * - 不再有任何一处硬编码 9。
 */

import { describe, expect, it } from 'vitest';
import type { RemainingResult } from '../../../src/shared/types/domain';
import { STAR_COPY_COST } from '../../../src/shared/constants';
import { copiesOf } from '../../../src/core/pool-engine/star-copies';
import { copiesToThreeStar } from '../../../src/core/ledger/selectors';
import { distanceToThreeStar } from '../../../src/renderer/utils/format';

/** bySeat[0] = 2 的极简行。 */
const row = {
  championId: 'veigar',
  cost: 1 as const,
  poolTotal: 30,
  observedCopies: 2,
  remaining: 28,
  overflow: 0,
  remainingOptimistic: 28,
  remainingPessimistic: 28,
  bySeat: [2, 0, 0, 0, 0, 0, 0, 0],
  seatHasAny: [true, false, false, false, false, false, false, false],
  coveredSeats: [0, 1, 2, 3, 4, 5, 6, 7] as RemainingResult['coveredSeats'],
  confidence: 1,
  flags: [] as RemainingResult['flags'],
  locked: false,
  updatedAt: 0,
} satisfies RemainingResult;

describe('STAR_COPY_COST 单一事实来源', () => {
  it('默认换算表为 {1:1, 2:3, 3:9, 4:9}', () => {
    expect(STAR_COPY_COST).toEqual({ 1: 1, 2: 3, 3: 9, 4: 9 });
  });

  it('core copiesOf 在无基线时回退到该常量', () => {
    expect(copiesOf(3, undefined)).toBe(STAR_COPY_COST[3]);
    expect(copiesOf(1, undefined)).toBe(STAR_COPY_COST[1]);
  });

  it('core 与 renderer 的"差 N 张 3★"同源同值（无基线时）', () => {
    expect(copiesToThreeStar(row)).toBe(STAR_COPY_COST[3] - 2);
    expect(distanceToThreeStar(row)).toBe(STAR_COPY_COST[3] - 2);
    expect(copiesToThreeStar(row)).toBe(distanceToThreeStar(row));
  });

  it('持有量 ≥ 需求时两者都 clamp 到 0', () => {
    const heavy = { ...row, bySeat: [20, 0, 0, 0, 0, 0, 0, 0] };
    expect(copiesToThreeStar(heavy)).toBe(0);
    expect(distanceToThreeStar(heavy)).toBe(0);
  });
});
