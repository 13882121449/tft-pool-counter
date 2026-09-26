/**
 * 槽位几何单测（QA M1：双槽位"相邻"必须是二维水平/垂直相邻）。
 *
 * 覆盖：
 * - `toRowCol` / `isOrthogonallyAdjacent` 的纯几何正确性（含跨行边界的反例）；
 * - `colsForZone` 的缺省与非法值回退；
 * - `mergeAdjacentSlots` 在新判定下的行为（跨行不并、同行/同列并）。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../../src/shared/types/domain';
import {
  DEFAULT_BENCH_COLS,
  DEFAULT_BOARD_COLS,
  DEFAULT_SHOP_COLS,
  colsForZone,
  isOrthogonallyAdjacent,
  toRowCol,
} from '../../../src/core/pool-engine/slot-geometry';
import { mergeAdjacentSlots, type DedupDeps } from '../../../src/core/pool-engine/dedup';
import { copiesOf } from '../../../src/core/pool-engine/star-copies';
import { loadTestBaseline, obs } from '../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();
const BOARD_COLS = 7;

/** 棋盘坐标 → 线性槽位索引。 */
function slotAt(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

/** 去重依赖。 */
function deps(overrides: Partial<DedupDeps> = {}): DedupDeps {
  return {
    championIndex: new Map(baseline.champions.map((champion) => [champion.id, champion])),
    nonPoolUnitIds: new Set(baseline.nonPoolUnitIds),
    copiesOfStar: (star) => copiesOf(star, baseline),
    ...overrides,
  };
}

describe('toRowCol · colsForZone', () => {
  it('由线性索引还原二维坐标', () => {
    expect(toRowCol(13, BOARD_COLS)).toEqual({ row: 1, col: 6 });
    expect(toRowCol(14, BOARD_COLS)).toEqual({ row: 2, col: 0 });
    expect(toRowCol(0, BOARD_COLS)).toEqual({ row: 0, col: 0 });
  });

  it('列数缺省回退游戏常量', () => {
    expect(colsForZone('board')).toBe(DEFAULT_BOARD_COLS);
    expect(colsForZone('bench')).toBe(DEFAULT_BENCH_COLS);
    expect(colsForZone('shop')).toBe(DEFAULT_SHOP_COLS);
  });

  it('显式列数生效，非法值回退', () => {
    expect(colsForZone('board', { board: 5 })).toBe(5);
    expect(colsForZone('board', { board: 0 })).toBe(DEFAULT_BOARD_COLS);
    expect(colsForZone('board', { board: Number.NaN })).toBe(DEFAULT_BOARD_COLS);
    expect(colsForZone('bench', { bench: 6.5 })).toBe(DEFAULT_BENCH_COLS);
  });
});

describe('isOrthogonallyAdjacent', () => {
  it('水平相邻（同行、列号 +1）为真', () => {
    expect(isOrthogonallyAdjacent(slotAt(1, 3), slotAt(1, 4), BOARD_COLS)).toBe(true);
    expect(isOrthogonallyAdjacent(10, 11, BOARD_COLS)).toBe(true);
  });

  it('垂直相邻（同列、行号 +1）为真', () => {
    expect(isOrthogonallyAdjacent(slotAt(0, 3), slotAt(1, 3), BOARD_COLS)).toBe(true);
    expect(isOrthogonallyAdjacent(3, 10, BOARD_COLS)).toBe(true);
  });

  it('跨行边界（row1col6 与 row2col0）**不**相邻（M1 反例）', () => {
    expect(isOrthogonallyAdjacent(slotAt(1, 6), slotAt(2, 0), BOARD_COLS)).toBe(false);
    expect(isOrthogonallyAdjacent(13, 14, BOARD_COLS)).toBe(false);
    // 行末 → 次行行首在任意列数下都是跨行边界
    expect(isOrthogonallyAdjacent(6, 7, BOARD_COLS)).toBe(false);
  });

  it('自身 / 非相邻为假', () => {
    expect(isOrthogonallyAdjacent(5, 5, BOARD_COLS)).toBe(false);
    expect(isOrthogonallyAdjacent(slotAt(0, 0), slotAt(2, 3), BOARD_COLS)).toBe(false);
  });
});

describe('mergeAdjacentSlots · 二维相邻', () => {
  it('同一行水平相邻的巨龙合并为 1 条', () => {
    const result = mergeAdjacentSlots(
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1 }),
      ],
      deps(),
    );
    expect(result.merged).toHaveLength(1);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.slotIndex).toBe(10);
    expect(result.kept[0]?.slotSpan).toBe(2);
  });

  it('同一列垂直相邻的巨龙合并为 1 条', () => {
    const result = mergeAdjacentSlots(
      [
        obs({ zone: 'board', slotIndex: slotAt(0, 3), championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: slotAt(1, 3), championId: 'elderdragon', star: 1 }),
      ],
      deps(),
    );
    expect(result.merged).toHaveLength(1);
    expect(result.kept).toHaveLength(1);
  });

  it('跨行边界的巨龙**不**合并（M1 回归）', () => {
    const result = mergeAdjacentSlots(
      [
        obs({ zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: slotAt(2, 0), championId: 'elderdragon', star: 1 }),
      ],
      deps(),
    );
    expect(result.merged).toHaveLength(0);
    expect(result.kept).toHaveLength(2);
  });

  it('普通弈子（teamSlots = 1）不合并', () => {
    const result = mergeAdjacentSlots(
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'veigar', star: 1 }),
        obs({ zone: 'board', slotIndex: 11, championId: 'veigar', star: 1 }),
      ],
      deps(),
    );
    expect(result.merged).toHaveLength(0);
    expect(result.kept).toHaveLength(2);
  });
});
