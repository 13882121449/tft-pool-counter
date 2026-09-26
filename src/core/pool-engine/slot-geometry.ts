/**
 * 槽位几何工具（ADR-04 双槽位「相邻」判定的**单一事实来源**）。
 *
 * TFT 棋盘是固定网格（7 列 × 4 行），备战席是单行 8 格，因此线性槽位索引与
 * 二维坐标满足 `slotIndex = row * cols + col`。
 *
 * 架构 §ADR-04 第 3 条要求：对 `teamSlots > 1` 的弈子，把**水平/垂直相邻**
 * 且 `championId + star` 相同的槽位合并为一个实例。若按**线性索引**判相邻，
 * 7 列棋盘上 `row1col6(13)` 与 `row2col0(14)` 会被误判为相邻（QA M1），
 * 导致两只分处行末/次行行首的远古巨龙被当成一只（少算最多 9 张）。
 *
 * 本模块为纯函数、零依赖，供 `dedup` / `rules/double-slot.rule` /
 * 视觉融合阶段（`@vision/match/multi-cell`）共用，保证三处口径完全一致。
 */

import type { Zone } from '../../shared/types/domain';

/** 默认棋盘列数（TFT 棋盘 7 列 × 4 行）。 */
export const DEFAULT_BOARD_COLS = 7;

/** 默认备战席格数（单行 8 格）。 */
export const DEFAULT_BENCH_COLS = 8;

/** 默认商店格数（单行 5 格）。 */
export const DEFAULT_SHOP_COLS = 5;

/** 各区域的列数（用于把线性 `slotIndex` 还原为二维坐标）。 */
export interface ZoneCols {
  /** 棋盘列数，默认 7。 */
  board?: number;
  /** 备战席格数，默认 8。 */
  bench?: number;
  /** 商店格数，默认 5。 */
  shop?: number;
}

/**
 * 取某区域的列数：优先用调用方提供的值，否则回退游戏常量。
 *
 * @param zone 区域。
 * @param cols 各区域列数（可缺省）。
 * @returns 大于 0 的整数列数。
 */
export function colsForZone(zone: Zone, cols: ZoneCols = {}): number {
  const value = zone === 'board' ? cols.board : zone === 'bench' ? cols.bench : cols.shop;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (zone === 'board') {
    return DEFAULT_BOARD_COLS;
  }
  if (zone === 'bench') {
    return DEFAULT_BENCH_COLS;
  }
  return DEFAULT_SHOP_COLS;
}

/**
 * 由线性槽位索引还原二维坐标。
 *
 * @param slotIndex 线性槽位索引（`row * cols + col`）。
 * @param cols 列数。
 * @returns `{ row, col }`。
 */
export function toRowCol(slotIndex: number, cols: number): { row: number; col: number } {
  const safeCols = cols > 0 ? cols : 1;
  const row = Math.floor(slotIndex / safeCols);
  const col = slotIndex - row * safeCols;
  return { row, col };
}

/**
 * 判断两个槽位是否**水平或垂直相邻**（二维曼哈顿距离恰为 1）。
 *
 * 注意：这只描述"空间相邻"，**不**包含索引差为 1 的跨行边界
 * （如 13 与 14 在 7 列棋盘上不相邻）。
 *
 * @param a 槽位 A 的线性索引（通常是已合并实例的**末端覆盖格**）。
 * @param b 槽位 B 的线性索引。
 * @param cols 该区域的列数。
 * @returns 是否相邻。
 */
export function isOrthogonallyAdjacent(a: number, b: number, cols: number): boolean {
  if (a === b) {
    return false;
  }
  const ca = toRowCol(a, cols);
  const cb = toRowCol(b, cols);
  const horizontal = ca.row === cb.row && Math.abs(ca.col - cb.col) === 1;
  const vertical = ca.col === cb.col && Math.abs(ca.row - cb.row) === 1;
  return horizontal || vertical;
}
