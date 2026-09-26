/**
 * QA 审计 —— 远古巨龙双槽位（E8）与"槽位相邻"判定口径。
 *
 * 架构 §ADR-04 第 3 条明确：把 **水平/垂直相邻** 且 championId+star 相同的槽位
 * 合并为一个实例（只计 1 张）。
 *
 * 本文件：
 * - 验证常见情形（同一只巨龙占 2 格、不相邻的两只巨龙）行为正确；
 * - 记录行边界跨行误合并的**修复回归**：M1 修复后改为按二维几何判定，
 *   `row1col6` 与 `row2col0` 不再被误合并（原 `it.fails` 已转为常规断言）。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
/** TFT 棋盘为 7 列 × 4 行，slotIndex = row * 7 + col。 */
const BOARD_COLS = 7;

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 棋盘坐标 → 线性槽位索引。 */
function slotAt(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

describe('远古巨龙：元数据与基础约定', () => {
  it('elderdragon 是唯一 teamSlots > 1 的弈子，且 poolCopiesConsumed = 1', () => {
    const multi = baseline.champions.filter((champion) => (champion.special?.teamSlots ?? 1) > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0]!.id).toBe('elderdragon');
    expect(multi[0]!.special?.poolCopiesConsumed).toBe(1);
    expect(multi[0]!.poolTotal).toBe(9);
  });

  it('普通弈子（teamSlots = 1）不受双槽位规则影响', () => {
    const normal = baseline.champions.find(
      (champion) => champion.cost === 1 && (champion.special?.teamSlots ?? 1) === 1,
    )!;
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: normal.id, seat: 0, star: 1, slotIndex: 0 }, baseline),
          inst({ championId: normal.id, seat: 0, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    // 两个相邻的 1★ 普通弈子 = 2 张（绝不合并）
    expect(rowOf(rows, normal.id).observedCopies).toBe(2);
  });
});

describe('远古巨龙：正确的合并行为', () => {
  it('同一只巨龙占相邻 2 格（row1 col5/col6）→ 只计 1 张', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 5) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 6) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(1);
    expect(rowOf(rows, 'elderdragon').remaining).toBe(8);
  });

  it('不相邻的两只巨龙 → 各计 1 张，共 2 张', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(0, 0) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(2, 3) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(2);
  });

  it('两只相邻摆放的巨龙（12/13 + 14/15）→ 仍计 2 张', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 5) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 6) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(2, 0) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(2, 1) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(2);
  });

  it('不同星级的巨龙不会互相合并', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 5) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 2, slotIndex: slotAt(1, 6) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    // 1★(1 张) + 2★(3 张) = 4 张
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(4);
  });

  it('不同玩家的巨龙不会跨家合并', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 5) }, baseline),
          inst({ championId: 'elderdragon', seat: 1, star: 1, slotIndex: slotAt(1, 6) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(2);
  });
});

describe('修复回归：跨行边界不再被误合并（二维几何相邻判定）', () => {
  /**
   * 架构 §ADR-04 第 3 条要求按"水平/垂直相邻"合并。
   *
   * 修复前实现只比较 `slotIndex === prev + slotSpan`（线性相邻），在 7 列棋盘上
   * row1col6(13) 与 row2col0(14) 线性相邻但**空间不相邻**，会被误合并（M1）。
   * 修复后按二维几何判定：二者不相邻 → 各计 1 张。
   */
  it('跨行边界的两只巨龙（row1col6 与 row2col0）应各计 1 张 = 2 张', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 6) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(2, 0) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    const row = rowOf(rows, 'elderdragon');
    expect(row.observedCopies).toBe(2);
    // 池 9 − 已观测 2 = 剩余 7（修复前会被误并为 1，remaining 偏高为 8）
    expect(row.remaining).toBe(7);
  });

  it('同一行水平相邻的两只巨龙仍正确合并为 1 张（row1 col5/col6）', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 5) }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: slotAt(1, 6) }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(1);
  });
});
