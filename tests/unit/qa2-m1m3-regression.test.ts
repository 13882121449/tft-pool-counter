/**
 * QA2 独立验收 —— M1（二维相邻）/M3（基线驱动）修复后的回归。
 *
 * 与工程师新增的 `slot-geometry.test.ts` / `multi-cell.test.ts` 互补：
 * 本文件走**引擎端到端**路径（`computeRemaining`）独立复现 M1 的修复效果，
 * 并为 M3 补上工程师缺失的「改 `starCopyCost[3]` → 结果随之变化」用例
 * （证明 `copiesToThreeStar` 是**读基线**，而非换个地方继续硬编码）。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline, RemainingResult } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { copiesToThreeStar } from '../../src/core/ledger/selectors';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const BOARD_COLS = 7;

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 棋盘坐标 → 线性槽位索引。 */
function at(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

/** 深拷贝基线。 */
function cloneBaseline(): PoolBaseline {
  return JSON.parse(JSON.stringify(baseline)) as PoolBaseline;
}

/** 放置若干同款巨龙，返回其行结果。 */
function dragonRow(slots: Array<{ slot: number; zone?: 'board' | 'bench' }>): RemainingResult {
  const rows = computeRemaining(
    ledgersOf(
      slots.map((s) =>
        inst(
          { championId: 'elderdragon', seat: 0, star: 1, slotIndex: s.slot, zone: s.zone ?? 'board' },
          baseline,
        ),
      ),
      { scannedSeats: ALL },
    ),
    baseline,
  );
  return rowOf(rows, 'elderdragon');
}

describe('M1 回归（引擎端到端）：二维几何相邻', () => {
  it('跨行边界 idx 13↔14 **不**合并（修复前会误并为 1）', () => {
    const row = dragonRow([{ slot: at(1, 6) }, { slot: at(2, 0) }]);
    expect(at(1, 6)).toBe(13);
    expect(at(2, 0)).toBe(14);
    expect(row.observedCopies).toBe(2);
    expect(row.remaining).toBe(7); // 池 9 − 2
  });

  it('跨行边界 idx 6↔7 同样不合并', () => {
    // slot6 = row0col6，slot7 = row1col0 → 空间不相邻
    expect(at(0, 6)).toBe(6);
    const row = dragonRow([{ slot: 6 }, { slot: 7 }]);
    expect(row.observedCopies).toBe(2);
  });

  it('同行左右相邻（10↔11）可合并为 1', () => {
    const row = dragonRow([{ slot: 10 }, { slot: 11 }]);
    expect(row.observedCopies).toBe(1);
  });

  it('同列上下相邻（3↔10，col3 跨行）可合并为 1', () => {
    const row = dragonRow([{ slot: at(0, 3) }, { slot: at(1, 3) }]);
    expect(row.observedCopies).toBe(1);
  });

  it('备战席（8 槽单行）线性相邻（0↔1）可合并为 1', () => {
    const row = dragonRow([{ slot: 0, zone: 'bench' }, { slot: 1, zone: 'bench' }]);
    expect(row.observedCopies).toBe(1);
  });

  it('备战席末格与棋盘首格不跨区合并', () => {
    const row = dragonRow([{ slot: 7, zone: 'bench' }, { slot: 0, zone: 'board' }]);
    expect(row.observedCopies).toBe(2);
  });
});

describe('M3 回归：copiesToThreeStar 读 starCopyCost[3]（非硬编码）', () => {
  /** 一个 bySeat[0]=2 的极简行。 */
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

  it('默认基线：starCopyCost[3]=9 → 差 7 张', () => {
    expect(baseline.starCopyCost[3]).toBe(9);
    expect(copiesToThreeStar(row, baseline)).toBe(7);
  });

  it('把 starCopyCost[3] 改为 12 → 结果变为 10（证明读基线，非硬编码）', () => {
    const custom = cloneBaseline();
    custom.starCopyCost = { ...custom.starCopyCost, 3: 12 };
    expect(copiesToThreeStar(row, custom)).toBe(10);
  });

  it('把 starCopyCost[3] 改为 5 → 结果变为 3（方向正确）', () => {
    const custom = cloneBaseline();
    custom.starCopyCost = { ...custom.starCopyCost, 3: 5 };
    expect(copiesToThreeStar(row, custom)).toBe(3);
  });

  it('缺省 baseline 时回退兜底表（=9），不抛异常', () => {
    expect(copiesToThreeStar(row)).toBe(7);
    expect(copiesToThreeStar(row, undefined, 0)).toBe(7);
  });

  it('持有量 ≥ 需求时 clamp 到 0', () => {
    const heavy = { ...row, bySeat: [20, 0, 0, 0, 0, 0, 0, 0] };
    expect(copiesToThreeStar(heavy, baseline)).toBe(0);
  });
});
