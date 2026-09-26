/**
 * 多格实例识别阶段合并单测（QA M2：`slotSpanHint` → `ObservationRecord.slotSpan`）。
 *
 * 覆盖 `applyMultiCellHints`：
 * - 水平/垂直相邻的同款巨龙 → 并为一条、写 `slotSpan = 2`；
 * - 跨行边界不并（复用 M1 几何判定）；
 * - 非多格弈子不受影响；
 * - 不污染入参观测。
 */

import { describe, expect, it } from 'vitest';
import { applyMultiCellHints } from '../../../src/vision/match/multi-cell';
import { obs } from '../../helpers/goldens';

const BOARD_COLS = 7;
const COLS = { board: BOARD_COLS, bench: 8, shop: 5 };
const TEAM = new Map<string, number>([['elderdragon', 2]]);

/** 棋盘坐标 → 线性槽位索引。 */
function slotAt(row: number, col: number): number {
  return row * BOARD_COLS + col;
}

describe('applyMultiCellHints', () => {
  it('同一行水平相邻的巨龙 → 并为 1 条并写 slotSpan = 2', () => {
    const first = obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1 });
    const second = obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1 });
    const outcome = applyMultiCellHints([first, second], COLS, TEAM);

    expect(outcome.merged).toHaveLength(1);
    expect(outcome.merged[0]).toMatchObject({ keptSlotIndex: 10, droppedSlotIndex: 11 });
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.observations[0]?.slotIndex).toBe(10);
    expect(outcome.observations[0]?.slotSpan).toBe(2);
    expect(outcome.observations[0]?.mergedSlotIndices).toEqual([11]);
    // 入参不被修改
    expect(first.slotSpan).toBe(1);
  });

  it('同一列垂直相邻的巨龙 → 合并，mergedSlotIndices 为竖排格位', () => {
    const outcome = applyMultiCellHints(
      [
        obs({ zone: 'board', slotIndex: slotAt(0, 3), championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: slotAt(1, 3), championId: 'elderdragon', star: 1 }),
      ],
      COLS,
      TEAM,
    );
    expect(outcome.merged).toHaveLength(1);
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.observations[0]?.slotSpan).toBe(2);
    // 竖排：并入的是 slotAt(1,3)=10，而非 slotAt(0,4)=4
    expect(outcome.observations[0]?.mergedSlotIndices).toEqual([slotAt(1, 3)]);
  });

  it('跨行边界（row1col6 与 row2col0）**不**合并（M1 口径一致）', () => {
    const outcome = applyMultiCellHints(
      [
        obs({ zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: slotAt(2, 0), championId: 'elderdragon', star: 1 }),
      ],
      COLS,
      TEAM,
    );
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
    expect(outcome.observations[0]?.mergedSlotIndices).toBeUndefined();
  });

  it('不同星级不合并（升星中间态）', () => {
    const outcome = applyMultiCellHints(
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1 }),
        obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 2 }),
      ],
      COLS,
      TEAM,
    );
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
  });

  it('非多格弈子（teamSlots 不在表中）不受影响', () => {
    const outcome = applyMultiCellHints(
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'veigar', star: 1 }),
        obs({ zone: 'board', slotIndex: 11, championId: 'veigar', star: 1 }),
      ],
      COLS,
      TEAM,
    );
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
    expect(outcome.observations[0]?.slotSpan).toBe(1);
  });

  it('空 teamSlots 表 → 原样返回副本', () => {
    const input = [obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1 })];
    const outcome = applyMultiCellHints(input, COLS, new Map());
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(1);
  });

  it('空格观测（championId = null）被忽略', () => {
    const outcome = applyMultiCellHints(
      [
        obs({ zone: 'board', slotIndex: 10, championId: null }),
        obs({ zone: 'board', slotIndex: 11, championId: null }),
      ],
      COLS,
      TEAM,
    );
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
  });
});
