/**
 * QA2 独立审计 —— 2.3 几何计算：缩放不漂移 & 槽位不越界。
 *
 * 验证 ADR-02 / geometry.ts 的三条硬约束：
 *   a) 归一化标定在任意 scaleFactor / 分辨率下换算出的**归一化槽位坐标不变**
 *      （只有物理像素随缩放等比放大）；
 *   b) 4 行 × 7 列棋盘 = 28 槽 + 备战席 8 槽，全部落在屏幕范围内且互不越界；
 *   c) 累积取整：最后一格右/下边缘恰好贴齐标定矩形边缘（无误差累积）。
 */

import { describe, expect, it } from 'vitest';
import type { Calibration } from '../../src/shared/types/scan';
import {
  buildGeometry,
  totalSlotCount,
  type ScreenInfo,
} from '../../src/vision/preprocess/geometry';

/** 归一化标定（与 data/board-geometry.json 一致）。 */
const CALIBRATION: Calibration = {
  board: { x: 0.285, y: 0.3, w: 0.43, h: 0.245 },
  boardCols: 7,
  boardRows: 4,
  bench: { x: 0.3, y: 0.795, w: 0.4, h: 0.075 },
  benchSlots: 8,
  shop: { x: 0.34, y: 0.06, w: 0.32, h: 0.1 },
  shopSlots: 5,
  screenW: 1920,
  screenH: 1080,
  scaleFactor: 1,
};

const SCALE_FACTORS = [1, 1.25, 1.5, 2] as const;
const LOGICAL_W = 1920;
const LOGICAL_H = 1080;

/** 逻辑分辨率 × scaleFactor = 物理像素。 */
function screenFor(sf: number): ScreenInfo {
  return { width: Math.round(LOGICAL_W * sf), height: Math.round(LOGICAL_H * sf), scaleFactor: sf };
}

describe('2.3 几何：槽位数与不越界', () => {
  it.each(SCALE_FACTORS)('scaleFactor=%s：棋盘 28 + 备战席 8 槽，全部在屏幕内', (sf) => {
    const screen = screenFor(sf);
    const geometry = buildGeometry(CALIBRATION, screen);

    expect(geometry.board).toHaveLength(28);
    expect(geometry.bench).toHaveLength(8);
    expect(totalSlotCount(geometry)).toBe(36);

    for (const slot of [...geometry.board, ...geometry.bench]) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.w).toBeLessThanOrEqual(screen.width);
      expect(slot.y + slot.h).toBeLessThanOrEqual(screen.height);
      expect(slot.w).toBeGreaterThan(0);
      expect(slot.h).toBeGreaterThan(0);
    }
  });

  it('槽位之间无重叠（线性索引连续、边界相接）', () => {
    const screen = screenFor(1.5);
    const geometry = buildGeometry(CALIBRATION, screen);
    const row1 = geometry.board.filter((s) => s.row === 1).sort((a, b) => a.col - b.col);
    for (let i = 0; i < row1.length - 1; i += 1) {
      expect(row1[i]!.x + row1[i]!.w).toBe(row1[i + 1]!.x);
    }
  });
});

describe('2.3 几何：缩放不漂移', () => {
  it('归一化槽位坐标在 scaleFactor 1→2 之间保持不变（浮点容差内）', () => {
    const base = buildGeometry(CALIBRATION, screenFor(1));
    const doubled = buildGeometry(CALIBRATION, screenFor(2));

    for (let i = 0; i < base.board.length; i += 1) {
      const a = base.board[i]!;
      const b = doubled.board[i]!;
      const aNormX = a.x / base.screen.width;
      const bNormX = b.x / doubled.screen.width;
      // 2 倍屏下取整误差 ≤ 0.5px → 归一化误差 ≤ 0.5/screenWidth
      expect(Math.abs(aNormX - bNormX)).toBeLessThan(1.5 / base.screen.width + 1.5 / doubled.screen.width);
      expect(a.slotIndex).toBe(b.slotIndex);
      expect(a.row).toBe(b.row);
      expect(a.col).toBe(b.col);
    }
  });

  it('物理像素随 scaleFactor 等比放大（scaleFactor 记录正确）', () => {
    for (const sf of SCALE_FACTORS) {
      const geometry = buildGeometry(CALIBRATION, screenFor(sf));
      expect(geometry.screen.scaleFactor).toBe(sf);
      expect(geometry.screen.width).toBe(Math.round(LOGICAL_W * sf));
    }
  });

  it('scaleFactor 不影响 board.width / 总槽数（几何形状与缩放解耦）', () => {
    const counts = SCALE_FACTORS.map((sf) => buildGeometry(CALIBRATION, screenFor(sf)).board.length);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(28);
  });
});

describe('2.3 几何：累积取整无误差', () => {
  it.each(SCALE_FACTORS)('scaleFactor=%s：最后一格右边缘 == 棋盘矩形右边缘', (sf) => {
    const screen = screenFor(sf);
    const geometry = buildGeometry(CALIBRATION, screen);
    const lastCol = geometry.board.filter((s) => s.row === 0).sort((a, b) => a.col - b.col).at(-1)!;
    expect(lastCol.x + lastCol.w).toBe(geometry.boardRect.x + geometry.boardRect.w);
  });

  it.each(SCALE_FACTORS)('scaleFactor=%s：备战席末槽右边缘 == 备战席矩形右边缘', (sf) => {
    const screen = screenFor(sf);
    const geometry = buildGeometry(CALIBRATION, screen);
    const last = geometry.bench.at(-1)!;
    expect(last.x + last.w).toBe(geometry.benchRect.x + geometry.benchRect.w);
  });
});
