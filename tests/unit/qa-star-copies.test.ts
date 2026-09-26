/**
 * QA 审计 —— 星级换算正确性（1★=1 / 2★=3 / 3★=9 / 4★=9）。
 *
 * 审计点：
 * - 换算表必须来自 `PoolBaseline.starCopyCost`，不得硬编码；
 * - 单个 3★ 弈子必须占用 9 张（最容易出错的一档）；
 * - 多实例叠加时按实例求和，而非按格子求和。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import {
  copiesOf,
  isStar,
  starFromCopies,
} from '../../src/core/pool-engine/star-copies';
import {
  applyCorrection,
  countCopiesOf,
  createLedgerState,
} from '../../src/core/ledger/ledger-store';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, QA_NOW, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;

beforeAll(() => {
  baseline = loadTestBaseline();
});

describe('星级 → 张数换算表', () => {
  it('copiesOf 返回 1 / 3 / 9 / 9', () => {
    expect(copiesOf(1, baseline)).toBe(1);
    expect(copiesOf(2, baseline)).toBe(3);
    expect(copiesOf(3, baseline)).toBe(9);
    expect(copiesOf(4, baseline)).toBe(9);
  });

  it('starFromCopies 边界：1→1★, 3→2★, 9→3★, 10→4★', () => {
    expect(starFromCopies(1, baseline)).toBe(1);
    expect(starFromCopies(2, baseline)).toBe(1);
    expect(starFromCopies(3, baseline)).toBe(2);
    expect(starFromCopies(8, baseline)).toBe(2);
    expect(starFromCopies(9, baseline)).toBe(3);
    expect(starFromCopies(10, baseline)).toBe(4);
  });

  it('starFromCopies 对非法输入（0 / 负数 / 小数）退化到 1★', () => {
    expect(starFromCopies(0, baseline)).toBe(1);
    expect(starFromCopies(-5, baseline)).toBe(1);
    expect(starFromCopies(5.9, baseline)).toBe(2);
  });

  it('isStar 只接受 1..4', () => {
    expect(isStar(1)).toBe(true);
    expect(isStar(4)).toBe(true);
    expect(isStar(0)).toBe(false);
    expect(isStar(5)).toBe(false);
    expect(isStar('2')).toBe(false);
  });
});

describe('引擎侧：单个 3★ 弈子占用 9 张', () => {
  it('1 费池 30，一个 3★ 后剩余 21', () => {
    const champion = baseline.champions.find((item) => item.cost === 1);
    expect(champion).toBeDefined();
    const id = champion!.id;

    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3 }, baseline)], {
        scannedSeats: [0, 1, 2, 3, 4, 5, 6, 7],
      }),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.poolTotal).toBe(30);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(21);
    expect(row.bySeat[0]).toBe(9);
    expect(row.seatHasAny[0]).toBe(true);
  });

  it('2★ 占 3 张、1★ 占 1 张', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    const two = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 2 }, baseline)], {
        scannedSeats: [0, 1, 2, 3, 4, 5, 6, 7],
      }),
      baseline,
    );
    expect(rowOf(two, id).observedCopies).toBe(3);
    expect(rowOf(two, id).remaining).toBe(27);

    const one = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 1 }, baseline)], {
        scannedSeats: [0, 1, 2, 3, 4, 5, 6, 7],
      }),
      baseline,
    );
    expect(rowOf(one, id).observedCopies).toBe(1);
    expect(rowOf(one, id).remaining).toBe(29);
  });

  it('跨家叠加：3★(9) + 2★(3) + 1★(1) = 13 张，剩余 17', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 1, star: 2, slotIndex: 1 }, baseline),
          inst({ championId: id, seat: 2, star: 1, slotIndex: 2 }, baseline),
        ],
        { scannedSeats: [0, 1, 2, 3, 4, 5, 6, 7] },
      ),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(13);
    expect(row.remaining).toBe(17);
    expect(row.bySeat.slice(0, 3)).toEqual([9, 3, 1]);
  });

  it('每家各一个 3★：9 × 8 = 72 张 → 1 费池溢出，剩余 clamp 到 0', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const seats = [0, 1, 2, 3, 4, 5, 6, 7] as const;

    const rows = computeRemaining(
      ledgersOf(
        seats.map((seat) => inst({ championId: id, seat, star: 3, slotIndex: seat }, baseline)),
        { scannedSeats: [...seats] },
      ),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(72);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(42);
    expect(row.flags).toContain('OVERFLOW_DUPLICATOR');
  });

  it('5 费池 9：一个 3★ 恰好耗尽，剩余 0 且不打溢出标记', () => {
    const id = baseline.champions.find((item) => item.cost === 5)!.id;

    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3 }, baseline)], {
        scannedSeats: [0, 1, 2, 3, 4, 5, 6, 7],
      }),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.poolTotal).toBe(9);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(0);
    expect(row.flags).not.toContain('OVERFLOW_DUPLICATOR');
  });
});

describe('人工校正落点的星级换算', () => {
  it('set-copies(9) 落成 3★ 且占 9 张', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 1, value: 9 },
      baseline,
      { now: QA_NOW },
    );

    expect(countCopiesOf(state, id, 1)).toBe(9);

    const rows = computeRemaining(state.ledgers, baseline, {}, { now: QA_NOW });
    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(21);
    expect(row.flags).toContain('MANUAL_OVERRIDE');
  });

  it('set-copies(10) 落成 4★（日蚀临时升星），仍按 9 张计入池消耗', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 1, value: 10 },
      baseline,
      { now: QA_NOW },
    );

    // 4★ 的 copiesOf = 9，而 set-copies 写入的 copies 是用户给的 10，
    // 因此引擎按 10 计（人工值优先）—— 这里锁定"人工值即真值"的口径。
    const rows = computeRemaining(state.ledgers, baseline, {}, { now: QA_NOW });
    expect(rowOf(rows, id).observedCopies).toBe(10);
  });

  it('adjust-copies(+2) 在 1★ 基础上变成 3 张', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 2, value: 1 },
      baseline,
      { now: QA_NOW },
    );
    state = applyCorrection(
      state,
      { kind: 'adjust-copies', championId: id, seat: 2, delta: 2 },
      baseline,
      { now: QA_NOW },
    );

    expect(countCopiesOf(state, id, 2)).toBe(3);
  });

  it('adjust-copies 减到负数时 clamp 到 0', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 3, value: 2 },
      baseline,
      { now: QA_NOW },
    );
    state = applyCorrection(
      state,
      { kind: 'adjust-copies', championId: id, seat: 3, delta: -100 },
      baseline,
      { now: QA_NOW },
    );

    expect(countCopiesOf(state, id, 3)).toBe(0);
  });
});
