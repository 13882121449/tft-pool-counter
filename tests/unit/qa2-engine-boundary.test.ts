/**
 * QA2 独立审计 —— 2.4 引擎边界。
 *
 * 覆盖：星级换算（1/3/9 含 3★、4★）／复制器溢出 clamp／卡池基数可配置
 * （证明无硬编码）／淘汰回池／撤销栈 LIFO 与容量。
 *
 * 直接构造 PlayerLedger（走 qa-builders），精确命中引擎边界。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { copiesOf, starFromCopies } from '../../src/core/pool-engine/star-copies';
import {
  applyCorrection,
  canUndo,
  createLedgerState,
  undoCorrection,
} from '../../src/core/ledger/ledger-store';
import { UNDO_STACK_CAPACITY } from '../../src/shared/constants';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 深拷贝基线（用于"可配置"证明）。 */
function cloneBaseline(): PoolBaseline {
  return JSON.parse(JSON.stringify(baseline)) as PoolBaseline;
}

describe('2.4 星级换算', () => {
  it('1★=1 / 2★=3 / 3★=9 / 4★=9（换算表来自基线）', () => {
    expect(copiesOf(1, baseline)).toBe(1);
    expect(copiesOf(2, baseline)).toBe(3);
    expect(copiesOf(3, baseline)).toBe(9);
    expect(copiesOf(4, baseline)).toBe(9);
  });

  it('引擎按实例张数计：1★/2★/3★ 分别 +1/+3/+9', () => {
    const id = baseline.champions.find((c) => c.cost === 1)!.id;
    for (const [star, expected] of [
      [1, 1],
      [2, 3],
      [3, 9],
    ] as const) {
      const rows = computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star, slotIndex: 0 }, baseline)], {
          scannedSeats: ALL,
        }),
        baseline,
      );
      expect(rowOf(rows, id).observedCopies).toBe(expected);
    }
  });

  it('starFromCopies 反推：9 张归 3★、明显超过才归 4★', () => {
    expect(starFromCopies(1, baseline)).toBe(1);
    expect(starFromCopies(3, baseline)).toBe(2);
    expect(starFromCopies(9, baseline)).toBe(3);
    expect(starFromCopies(18, baseline)).toBe(4);
  });

  it('3★ 恰好耗尽 5 费池（9 张）→ remaining=0 且不误报溢出', () => {
    const id = baseline.champions.find((c) => c.cost === 5)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3, slotIndex: 0 }, baseline)], {
        scannedSeats: ALL,
      }),
      baseline,
    );
    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(0);
    expect(row.flags).not.toContain('OVERFLOW_DUPLICATOR');
  });
});

describe('2.4 复制器溢出', () => {
  it('observed > pool → remaining clamp 0、overflow 正确、打 OVERFLOW_DUPLICATOR', () => {
    const id = baseline.champions.find((c) => c.cost === 5)!.id; // pool 9
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 1, star: 3, slotIndex: 0 }, baseline), // 9+9=18
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(18);
    expect(row.remaining).toBe(0);
    expect(row.overflow).toBe(9);
    expect(row.flags).toContain('OVERFLOW_DUPLICATOR');
    // 守恒：remaining − overflow = pool − observed
    expect(row.remaining - row.overflow).toBe(row.poolTotal - row.observedCopies);
  });

  it('65 行全溢出场景下无任何负剩余数', () => {
    const instances = baseline.champions.map((c, i) =>
      inst({ championId: c.id, seat: i % 8, star: 3, slotIndex: i }, baseline),
    );
    const rows = computeRemaining(ledgersOf(instances, { scannedSeats: ALL }), baseline);
    expect(rows.every((r) => r.remaining >= 0)).toBe(true);
    expect(rows.every((r) => r.overflow >= 0)).toBe(true);
  });
});

describe('2.4 卡池基数可配置（证明无硬编码）', () => {
  it('改写 poolTotal=100 后 remaining 随之为 100（读数据而非常量）', () => {
    const custom = cloneBaseline();
    const target = custom.champions.find((c) => c.cost === 1)!;
    target.poolTotal = 100;
    const rows = computeRemaining(ledgersOf([], { scannedSeats: ALL }), custom);
    expect(rowOf(rows, target.id).poolTotal).toBe(100);
    expect(rowOf(rows, target.id).remaining).toBe(100);
  });

  it('切换基数 22/20/17/10/9 后结果正确变化（1 费 28→22）', () => {
    const custom = cloneBaseline();
    const byCost: Record<number, number> = { 1: 22, 2: 20, 3: 17, 4: 10, 5: 9 };
    for (const c of custom.champions) {
      c.poolTotal = byCost[c.cost]!;
    }
    const id1 = custom.champions.find((c) => c.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id1, seat: 0, star: 1, slotIndex: 0 }, custom)], {
        scannedSeats: ALL,
      }),
      custom,
    );
    const row = rowOf(rows, id1);
    expect(row.poolTotal).toBe(22);
    expect(row.observedCopies).toBe(1);
    expect(row.remaining).toBe(21);
  });

  it('星级换算表可配置：starCopyCost[3]=4 后 3★ 只计 4 张', () => {
    const custom = cloneBaseline();
    custom.starCopyCost = { 1: 1, 2: 2, 3: 4, 4: 4 };
    const id = custom.champions.find((c) => c.cost === 5)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3, slotIndex: 0 }, custom)], {
        scannedSeats: ALL,
      }),
      custom,
    );
    expect(rowOf(rows, id).observedCopies).toBe(4);
  });
});

describe('2.4 淘汰语义（PRD RQ-14）', () => {
  it('淘汰后该家单位回池：淘汰家不计入 observedCopies', () => {
    const id = baseline.champions.find((c) => c.cost === 2)!.id;
    const instances = [
      inst({ championId: id, seat: 0, star: 1, slotIndex: 0 }, baseline),
      inst({ championId: id, seat: 1, star: 1, slotIndex: 0 }, baseline),
    ];
    const alive = computeRemaining(ledgersOf(instances, { scannedSeats: ALL }), baseline);
    expect(rowOf(alive, id).observedCopies).toBe(2);

    const eliminated = computeRemaining(
      ledgersOf(instances, { scannedSeats: ALL, eliminatedSeats: [1] }),
      baseline,
    );
    expect(rowOf(eliminated, id).observedCopies).toBe(1);
    expect(rowOf(eliminated, id).remaining).toBe(rowOf(eliminated, id).poolTotal - 1);
    // 淘汰家仍算"已覆盖"
    expect(rowOf(eliminated, id).coveredSeats).toContain(1);
  });
});

describe('2.4 撤销栈', () => {
  it('LIFO：set-copies 后 undo 精确回滚（槽位/状态一致）', () => {
    const id = baseline.champions.find((c) => c.cost === 1)!.id;
    const s0 = createLedgerState(0);
    const s1 = applyCorrection(s0, { kind: 'set-copies', championId: id, seat: 0, value: 3 }, baseline, {
      now: 100,
    });
    expect(canUndo(s1)).toBe(true);
    const back = undoCorrection(s1);
    expect(JSON.stringify(back.ledgers)).toBe(JSON.stringify(s0.ledgers));
    expect(canUndo(back)).toBe(false);
  });

  it('容量上限 50：超出后按 FIFO 丢弃最旧快照', () => {
    const id = baseline.champions.find((c) => c.cost === 1)!.id;
    let state = createLedgerState(0);
    for (let i = 0; i < UNDO_STACK_CAPACITY + 10; i += 1) {
      state = applyCorrection(
        state,
        { kind: 'set-copies', championId: id, seat: 0, value: i + 1 },
        baseline,
        { now: i + 1 },
      );
    }
    expect(state.undo).toHaveLength(UNDO_STACK_CAPACITY);
  });

  it('adjust-copies 累加后再 undo 回到累加前', () => {
    const id = baseline.champions.find((c) => c.cost === 3)!.id;
    let state = createLedgerState(0);
    state = applyCorrection(state, { kind: 'set-copies', championId: id, seat: 2, value: 2 }, baseline);
    const before = JSON.stringify(state.ledgers);
    state = applyCorrection(state, { kind: 'adjust-copies', championId: id, seat: 2, delta: 5 }, baseline);
    state = undoCorrection(state);
    expect(JSON.stringify(state.ledgers)).toBe(before);
  });
});
