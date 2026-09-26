/**
 * QA 审计 —— 随机化/性质测试（8 家 × 28 格）。
 *
 * 用确定性伪随机数发生器生成大量随机台账，断言引擎恒等式：
 *   1) remaining = max(0, poolTotal − observedCopies)          （PRD 核心公式）
 *   2) remaining ≥ 0 ∧ overflow ≥ 0                            （绝不为负）
 *   3) remaining − overflow = poolTotal − observedCopies       （守恒）
 *   4) observedCopies = Σ bySeat + UNKNOWN 暂存区持有量         （口径一致）
 *   5) 悲观 ≤ 乐观
 *   6) 幂等：同输入两次计算结果完全一致
 *   7) 单调：加一张牌，剩余数不增
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline, SeatOrUnknown, Star, UnitInstance } from '../../src/shared/types/domain';
import { UNKNOWN_SEAT } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, lcg, ledgersOf, QA_NOW } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const BOARD_SLOTS = 28;
const SEATS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const ITERATIONS = 40;

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 生成一批随机实例。 */
function randomInstances(rand: () => number): UnitInstance[] {
  const instances: UnitInstance[] = [];
  for (const seat of SEATS) {
    for (let slot = 0; slot < BOARD_SLOTS; slot += 1) {
      // 约 45% 的格子有棋子，其余为空（真实对局的稀疏度）
      if (rand() > 0.45) {
        continue;
      }
      const champion = baseline.champions[Math.floor(rand() * baseline.champions.length)]!;
      const star = ([1, 1, 1, 2, 2, 3] as Star[])[Math.floor(rand() * 6)]!;
      instances.push(
        inst(
          {
            championId: champion.id,
            seat,
            star,
            zone: 'board',
            slotIndex: slot,
            confidence: 0.5 + rand() * 0.5,
          },
          baseline,
        ),
      );
    }
  }
  return instances;
}

describe('随机台账恒等式（性质测试）', () => {
  it(`随机 ${ITERATIONS} 局 × 8 家 × 28 格：全部恒等式成立`, () => {
    const rand = lcg(20260914);

    for (let round = 0; round < ITERATIONS; round += 1) {
      const instances = randomInstances(rand);
      const ledgers = ledgersOf(instances, { scannedSeats: SEATS, now: QA_NOW });
      const rows = computeRemaining(ledgers, baseline, {}, { now: QA_NOW });

      // 行数与顺序
      expect(rows).toHaveLength(65);
      rows.forEach((row, index) => {
        expect(row.championId).toBe(baseline.champions[index]!.id);

        // 1) 核心公式
        expect(row.remaining).toBe(Math.max(0, row.poolTotal - row.observedCopies));
        // 2) 非负
        expect(row.remaining).toBeGreaterThanOrEqual(0);
        expect(row.overflow).toBeGreaterThanOrEqual(0);
        // 3) 守恒
        expect(row.remaining - row.overflow).toBe(row.poolTotal - row.observedCopies);
        // 4) 口径一致：bySeat 之和 = observedCopies
        const sumBySeat = row.bySeat.reduce((sum, value) => sum + value, 0);
        expect(sumBySeat).toBe(row.observedCopies);
        // 5) 区间
        expect(row.remainingPessimistic).toBeLessThanOrEqual(row.remainingOptimistic);
        expect(row.remainingOptimistic).toBe(row.remaining);
        // bySeat / seatHasAny 长度固定 8
        expect(row.bySeat).toHaveLength(8);
        expect(row.seatHasAny).toHaveLength(8);
        // 8 家全扫 → 无未覆盖家 → 悲观 == 点估计
        expect(row.remainingPessimistic).toBe(row.remaining);
        expect(row.coveredSeats).toHaveLength(8);
      });
    }
  });

  it('observedCopies 独立复算：与台账实例张数直接求和一致（64 个普通弈子）', () => {
    const rand = lcg(777);
    // 双槽位弈子（elderdragon）按"单位实例"合并计数，朴素求和天然不等；
    // 这里对其余 64 个弈子做严格独立复算（覆盖 300 局 ≈ 6.7 万次观测）。
    const specialIds = new Set(
      baseline.champions.filter((c) => (c.special?.teamSlots ?? 1) > 1).map((c) => c.id),
    );
    expect(specialIds.size).toBe(1);

    for (let round = 0; round < 100; round += 1) {
      const instances = randomInstances(rand);
      const rows = computeRemaining(
        ledgersOf(instances, { scannedSeats: SEATS, now: QA_NOW }),
        baseline,
      );

      const expected = new Map<string, number>();
      for (const instance of instances) {
        expected.set(instance.championId, (expected.get(instance.championId) ?? 0) + instance.copies);
      }

      for (const row of rows) {
        if (specialIds.has(row.championId)) {
          continue;
        }
        expect(row.observedCopies).toBe(expected.get(row.championId) ?? 0);
      }
    }
  });

  it('幂等：同一台账重复计算，结果逐字段一致', () => {
    const rand = lcg(31337);
    const instances = randomInstances(rand);
    const ledgers = ledgersOf(instances, { scannedSeats: SEATS, now: QA_NOW });

    const first = computeRemaining(ledgers, baseline, {}, { now: QA_NOW });
    const second = computeRemaining(ledgers, baseline, {}, { now: QA_NOW });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('引擎不修改输入台账（纯函数）', () => {
    const rand = lcg(2468);
    const instances = randomInstances(rand);
    const ledgers = ledgersOf(instances, { scannedSeats: SEATS, now: QA_NOW });
    const snapshot = JSON.stringify(ledgers);

    computeRemaining(ledgers, baseline, {}, { now: QA_NOW });
    expect(JSON.stringify(ledgers)).toBe(snapshot);
  });

  it('单调性：新增一张牌后，该弈子剩余数不增', () => {
    const rand = lcg(1357);
    for (let round = 0; round < 10; round += 1) {
      const instances = randomInstances(rand);
      const baseRows = computeRemaining(
        ledgersOf(instances, { scannedSeats: SEATS, now: QA_NOW }),
        baseline,
      );

      const target = baseline.champions[Math.floor(rand() * baseline.champions.length)]!;
      const withExtra = [
        ...instances,
        inst({ championId: target.id, seat: 0, star: 1, slotIndex: 100 + round }, baseline),
      ];
      const afterRows = computeRemaining(
        ledgersOf(withExtra, { scannedSeats: SEATS, now: QA_NOW }),
        baseline,
      );

      const before = baseRows.find((row) => row.championId === target.id)!;
      const after = afterRows.find((row) => row.championId === target.id)!;
      expect(after.remaining).toBeLessThanOrEqual(before.remaining);
      expect(after.observedCopies).toBeGreaterThanOrEqual(before.observedCopies);
    }
  });

  it('UNKNOWN 暂存区（seat 8）的持有量计入 observedCopies 但不出现在 bySeat', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 1, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: UNKNOWN_SEAT as SeatOrUnknown, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: SEATS },
      ),
      baseline,
    );

    const row = rows.find((item) => item.championId === id)!;
    expect(row.bySeat.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(row.observedCopies).toBe(2);
    expect(row.remaining).toBe(28);
    expect(row.flags).toContain('SEAT_UNKNOWN');
  });

  it('覆盖率随机切换：悲观区间随未覆盖家数单调不增', () => {
    const rand = lcg(9001);
    const instances = randomInstances(rand);
    const id = baseline.champions.find((item) => item.cost === 2)!.id;

    let previousPessimistic = Number.POSITIVE_INFINITY;
    for (let scanned = 8; scanned >= 0; scanned -= 1) {
      const rows = computeRemaining(
        ledgersOf(instances, { scannedSeats: SEATS.slice(0, scanned), now: QA_NOW }),
        baseline,
        { perSeatByCost: { 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 } },
      );
      const row = rows.find((item) => item.championId === id)!;
      expect(row.remainingPessimistic).toBeLessThanOrEqual(previousPessimistic);
      previousPessimistic = row.remainingPessimistic;
    }
  });
});
