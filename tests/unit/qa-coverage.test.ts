/**
 * QA 审计 —— 8 家边界与乐观/悲观区间（PRD 6.4 / Q7）。
 *
 * 审计点：
 * - 全扫 8 家：乐观 == 悲观 == 点估计（无未巡查家，区间应收敛）；
 * - 只扫 1 家：7 家未覆盖，悲观 = max(0, 剩余 − 7 × 每家估计)；
 * - 覆盖率 < 5/8 打 LOW_COVERAGE；
 * - 被淘汰的家算作已覆盖（其持有量已知为 0）；
 * - 悲观 ≤ 点估计 ≤ 乐观 恒成立。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import {
  computeCoverage,
  isSeatCovered,
  pessimisticRemaining,
  uncoveredSeatCount,
} from '../../src/core/pool-engine/coverage';
import { resolveEstimateConfig } from '../../src/core/pool-engine/compute-remaining';
import { DEFAULT_ESTIMATE_CONFIG, LOW_COVERAGE_THRESHOLD } from '../../src/shared/constants';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
});

describe('覆盖率计算', () => {
  it('全扫 8 家：coverage = 8/8，missing 为空', () => {
    const coverage = computeCoverage(ledgersOf([], { scannedSeats: ALL }));
    expect(coverage.scanned).toBe(8);
    expect(coverage.total).toBe(8);
    expect(coverage.seats).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(coverage.missing).toEqual([]);
    expect(uncoveredSeatCount(coverage)).toBe(0);
  });

  it('只扫 1 家：coverage = 1/8，missing 为其余 7 家', () => {
    const coverage = computeCoverage(ledgersOf([], { scannedSeats: [3] }));
    expect(coverage.scanned).toBe(1);
    expect(coverage.seats).toEqual([3]);
    expect(coverage.missing).toEqual([0, 1, 2, 4, 5, 6, 7]);
    expect(uncoveredSeatCount(coverage)).toBe(7);
  });

  it('一家未扫：coverage = 0/8', () => {
    const coverage = computeCoverage(ledgersOf([], { scannedSeats: [] }));
    expect(coverage.scanned).toBe(0);
    expect(uncoveredSeatCount(coverage)).toBe(8);
  });

  it('被淘汰的家算作已覆盖；UNKNOWN 暂存区不计入 8 家', () => {
    const coverage = computeCoverage(
      ledgersOf([], { scannedSeats: [0, 1], eliminatedSeats: [2, 3] }),
    );
    expect(coverage.scanned).toBe(4);
    expect(coverage.seats).toEqual([0, 1, 2, 3]);
    expect(isSeatCovered({ seat: 2, status: 'eliminated' } as never)).toBe(true);
    expect(isSeatCovered({ seat: 4, status: 'unscanned', scanCount: 0 } as never)).toBe(false);
    expect(isSeatCovered(undefined)).toBe(false);
  });

  it('UNKNOWN 暂存区（seat 8）永远不计入 8 家覆盖率', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const coverage = computeCoverage(
      ledgersOf([inst({ championId: id, seat: 8, star: 1 }, baseline)], { scannedSeats: [] }),
    );
    expect(coverage.total).toBe(8);
    expect(coverage.scanned).toBe(0);
    expect(coverage.seats).not.toContain(8);
  });
});

describe('乐观 / 悲观区间', () => {
  it('全扫 8 家：乐观 == 悲观 == 点估计', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 0, star: 2, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 1, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    const row = rowOf(rows, id);
    expect(row.observedCopies).toBe(4);
    expect(row.remaining).toBe(26);
    expect(row.remainingOptimistic).toBe(26);
    expect(row.remainingPessimistic).toBe(26);
  });

  it('只扫 1 家：悲观 = 剩余 − 7 × 每家 1 张（PRD 算例 B 口径）', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 2 }, baseline)], {
        scannedSeats: [0],
      }),
      baseline,
    );
    const row = rowOf(rows, id);
    expect(row.remaining).toBe(27);
    // 7 家未覆盖 × 1 张 = 7
    expect(row.remainingPessimistic).toBe(20);
    expect(row.remainingOptimistic).toBe(27);
  });

  it('悲观参数可按费用档配置（perSeatByCost）', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const ledgers = ledgersOf([inst({ championId: id, seat: 0, star: 2 }, baseline)], {
      scannedSeats: [0],
    });

    const rows = computeRemaining(ledgers, baseline, {
      perSeatByCost: { 1: 3, 2: 2, 3: 2, 4: 1, 5: 1 },
    });
    const row = rowOf(rows, id);
    // 剩余 27 − 7 家 × 3 张 = 6
    expect(row.remainingPessimistic).toBe(6);
  });

  it('悲观估计被 clamp 到 0，不为负（剩余 1、7 家未覆盖）', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf(
        [0, 1, 2].map((seat) => inst({ championId: id, seat, star: 3, slotIndex: seat }, baseline)),
        { scannedSeats: [0, 1, 2] },
      ),
      baseline,
      { perSeatByCost: { 1: 10, 2: 1, 3: 1, 4: 1, 5: 1 } },
    );
    const row = rowOf(rows, id);
    expect(row.remaining).toBe(3);
    // 3 − 5×10 = −47 → clamp 到 0
    expect(row.remainingPessimistic).toBe(0);
  });

  it('任意覆盖率下：悲观 ≤ 点估计 ≤ 乐观，且均非负', () => {
    const id = baseline.champions.find((item) => item.cost === 3)!.id;
    for (let scanned = 0; scanned <= 8; scanned += 1) {
      const rows = computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star: 2 }, baseline)], {
          scannedSeats: ALL.slice(0, scanned),
        }),
        baseline,
      );
      const row = rowOf(rows, id);
      expect(row.remainingPessimistic).toBeLessThanOrEqual(row.remaining);
      expect(row.remaining).toBeLessThanOrEqual(row.remainingOptimistic);
      expect(row.remainingPessimistic).toBeGreaterThanOrEqual(0);
      expect(row.coveredSeats).toHaveLength(scanned);
    }
  });
});

describe('LOW_COVERAGE / LOW_CONFIDENCE 标记', () => {
  it('覆盖率 < 5/8 打 LOW_COVERAGE，≥ 5/8 不打', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    expect(LOW_COVERAGE_THRESHOLD).toBe(5);

    const low = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star: 1 }, baseline)], {
          scannedSeats: [0, 1, 2, 3],
        }),
        baseline,
      ),
      id,
    );
    expect(low.flags).toContain('LOW_COVERAGE');

    const high = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star: 1 }, baseline)], {
          scannedSeats: [0, 1, 2, 3, 4],
        }),
        baseline,
      ),
      id,
    );
    expect(high.flags).not.toContain('LOW_COVERAGE');
  });

  it('覆盖率越低置信度越低：1/8 时置信度 = 0.95 × (0.4 + 0.6×1/8)', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    const one = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star: 1, confidence: 0.95 }, baseline)], {
          scannedSeats: [0],
        }),
        baseline,
      ),
      id,
    );
    expect(one.confidence).toBeCloseTo(0.95 * (0.4 + 0.6 * (1 / 8)), 10);
    expect(one.flags).toContain('LOW_CONFIDENCE');

    const all = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 0, star: 1, confidence: 0.95 }, baseline)], {
          scannedSeats: ALL,
        }),
        baseline,
      ),
      id,
    );
    expect(all.confidence).toBeCloseTo(0.95, 10);
    expect(all.flags).not.toContain('LOW_CONFIDENCE');
  });

  it('未观测到的弈子置信度 = 覆盖率因子（1/8 时 0.475）', () => {
    const rows = computeRemaining(ledgersOf([], { scannedSeats: [0] }), baseline);
    for (const row of rows) {
      expect(row.confidence).toBeCloseTo(0.4 + 0.6 * (1 / 8), 10);
    }
  });
});

describe('pessimisticRemaining 纯函数边界', () => {
  it('无未覆盖家时直接返回 max(0, remaining)', () => {
    const config = resolveEstimateConfig();
    const coverage = computeCoverage(ledgersOf([], { scannedSeats: ALL }));
    expect(pessimisticRemaining(5, coverage, config, 1)).toBe(5);
    expect(pessimisticRemaining(0, coverage, config, 1)).toBe(0);
  });

  it('默认每家估计为 1 张', () => {
    expect(DEFAULT_ESTIMATE_CONFIG.perSeatByCost).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
  });

  it('费用档缺失时回退到每家 1 张', () => {
    const config = resolveEstimateConfig({ perSeatByCost: { 1: 5 } as never });
    const coverage = computeCoverage(ledgersOf([], { scannedSeats: [0] }));
    // 3 费档未配置 → 回退 1 张
    expect(pessimisticRemaining(20, coverage, config, 3)).toBe(13);
    // 1 费档配置为每家 5 张：20 − 7×5 = −15 → 必须 clamp 到 0（不得为负）
    expect(pessimisticRemaining(20, coverage, config, 1)).toBe(0);
    expect(pessimisticRemaining(40, coverage, config, 1)).toBe(5);
  });
});
