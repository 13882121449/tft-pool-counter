/**
 * QA 审计 —— 剩余数非负 + 复制器超额（PRD 算例 C / E3）。
 *
 * 审计点：
 * - PRD: "当某弈子观测消耗 > 池总数时，UI 显示'超额（复制器）'而非负数"；
 * - 剩余数必须 clamp 到 0，绝不为负；
 * - `observed == poolTotal` 是**不**打溢出标记的边界（恰好耗尽属于正常）；
 * - 超额时必须产出 ENG_OVERFLOW 告警供 UI 提示。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { AppError, PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL_SCANNED = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 取一个 5 费弈子（池 9，最容易触发溢出）。 */
function fiveCost(): string {
  return baseline.champions.find((item) => item.cost === 5)!.id;
}

describe('剩余数永不为负', () => {
  it('观测 36 张 / 池 9 → 剩余 0、溢出 27、打 OVERFLOW_DUPLICATOR', () => {
    const id = fiveCost();
    const errors: AppError[] = [];

    const rows = computeRemaining(
      ledgersOf(
        [0, 1, 2, 3].map((seat) =>
          inst({ championId: id, seat, star: 3, slotIndex: seat }, baseline),
        ),
        { scannedSeats: ALL_SCANNED },
      ),
      baseline,
      {},
      { errors },
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(36);
    expect(row.remaining).toBe(0);
    expect(row.remaining).toBeGreaterThanOrEqual(0);
    expect(row.overflow).toBe(27);
    expect(row.flags).toContain('OVERFLOW_DUPLICATOR');
    expect(errors.some((error) => error.code === 'ENG_OVERFLOW')).toBe(true);
  });

  it('恰好耗尽（observed == poolTotal）：剩余 0、溢出 0、不打 OVERFLOW_DUPLICATOR', () => {
    const id = fiveCost();
    const errors: AppError[] = [];

    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3 }, baseline)], {
        scannedSeats: ALL_SCANNED,
      }),
      baseline,
      {},
      { errors },
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(0);
    expect(row.flags).not.toContain('OVERFLOW_DUPLICATOR');
    expect(errors.some((error) => error.code === 'ENG_OVERFLOW')).toBe(false);
  });

  it('差 1 张耗尽：剩余 1，溢出 0', () => {
    const id = fiveCost();

    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 2, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 1, star: 2, slotIndex: 1 }, baseline),
          inst({ championId: id, seat: 2, star: 1, slotIndex: 2 }, baseline),
          inst({ championId: id, seat: 3, star: 1, slotIndex: 3 }, baseline),
        ],
        { scannedSeats: ALL_SCANNED },
      ),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(8);
    expect(row.remaining).toBe(1);
    expect(row.overflow).toBe(0);
  });

  it('超额 1 张：剩余 0、溢出 1（PRD 算例 C 精确复现）', () => {
    const id = fiveCost();

    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 1, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: ALL_SCANNED },
      ),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(10);
    expect(row.poolTotal).toBe(9);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(1);
    expect(row.flags).toContain('OVERFLOW_DUPLICATOR');
  });

  it('全场极端溢出（每家 3★ × 8）：全部 65 行剩余均 ≥ 0', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6, 7] as const;
    const instances = baseline.champions.flatMap((champion, championIndex) =>
      seats.map((seat) =>
        inst(
          {
            championId: champion.id,
            seat,
            star: 3,
            slotIndex: championIndex * 10 + seat,
          },
          baseline,
        ),
      ),
    );

    const rows = computeRemaining(ledgersOf(instances, { scannedSeats: ALL_SCANNED }), baseline);

    expect(rows).toHaveLength(65);
    for (const row of rows) {
      expect(row.remaining).toBeGreaterThanOrEqual(0);
      expect(row.remainingOptimistic).toBeGreaterThanOrEqual(0);
      expect(row.remainingPessimistic).toBeGreaterThanOrEqual(0);
      // 恒等式：remaining - overflow === poolTotal - observedCopies
      expect(row.remaining - row.overflow).toBe(row.poolTotal - row.observedCopies);
    }
  });

  it('悲观估计在溢出场景下同样不为负', () => {
    const id = fiveCost();

    const rows = computeRemaining(
      ledgersOf(
        [0, 1].map((seat) => inst({ championId: id, seat, star: 3, slotIndex: seat }, baseline)),
        // 只扫 2 家 → 6 家未覆盖，悲观会再往下压
        { scannedSeats: [0, 1] },
      ),
      baseline,
      { perSeatByCost: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 } },
    );

    const row = rowOf(rows, id);
    expect(row.remainingPessimistic).toBe(0);
    expect(row.remainingPessimistic).toBeGreaterThanOrEqual(0);
  });
});
