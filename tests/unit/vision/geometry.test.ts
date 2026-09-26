/**
 * T03 几何层单测：归一化标定 → 物理像素网格（架构 §3.5 / ADR-02 第 1–2 步）。
 *
 * 这是视觉层最该被钉死的部分：一旦网格错位，后面所有识别都会系统性偏移。
 * 因此这里既断言**精确像素值**，也断言**不变式**（不重叠、越界、采样区包含关系）。
 */

import { describe, expect, it } from 'vitest';
import type { Calibration } from '../../../src/shared/types/scan';
import {
  buildGeometry,
  buildGrid,
  buildRowSlots,
  calibrationFromGeometryJson,
  sampleRectOf,
  toPixelRect,
  totalSlotCount,
  validateCalibration,
} from '../../../src/vision/preprocess/geometry';
import geometryJson from '../../../data/board-geometry.json';

/** 1920×1080 基准屏幕。 */
const SCREEN = { width: 1920, height: 1080, scaleFactor: 1 };

/** 默认标定（与 data/board-geometry.json 对齐）。 */
const CALIBRATION: Calibration = {
  board: { x: 0.285, y: 0.3, w: 0.43, h: 0.245 },
  boardCols: 7,
  boardRows: 4,
  bench: { x: 0.3, y: 0.795, w: 0.4, h: 0.075 },
  benchSlots: 8,
  shop: { x: 0.34, y: 0.06, w: 0.32, h: 0.1 },
  shopSlots: 5,
  scoreboard: { x: 0.005, y: 0.18, w: 0.11, h: 0.4 },
  screenW: 1920,
  screenH: 1080,
  scaleFactor: 1,
};

describe('toPixelRect', () => {
  it('把归一化比例换算成物理像素（四舍五入）', () => {
    expect(toPixelRect(CALIBRATION.board, SCREEN)).toEqual({ x: 547, y: 324, w: 826, h: 265 });
    expect(toPixelRect(CALIBRATION.bench, SCREEN)).toEqual({ x: 576, y: 859, w: 768, h: 81 });
  });

  it('屏幕尺寸变化时按比例缩放（高 DPI / 2K / 4K 天然适配）', () => {
    const rect = toPixelRect(CALIBRATION.board, { width: 2560, height: 1440 });
    expect(rect.x).toBe(Math.round(0.285 * 2560));
    expect(rect.y).toBe(Math.round(0.3 * 1440));
    expect(rect.w).toBe(Math.round(0.43 * 2560));
  });
});

describe('buildGrid / buildRowSlots', () => {
  it('棋盘切成 4 行 × 7 列 = 28 格，按 row-major 编号', () => {
    const rect = toPixelRect(CALIBRATION.board, SCREEN);
    const slots = buildGrid(rect, 7, 4, 'board', 0.72, SCREEN);
    expect(slots).toHaveLength(28);
    expect(slots[0]).toMatchObject({ zone: 'board', row: 0, col: 0, slotIndex: 0 });
    expect(slots[6]).toMatchObject({ row: 0, col: 6, slotIndex: 6 });
    expect(slots[7]).toMatchObject({ row: 1, col: 0, slotIndex: 7 });
    expect(slots[27]).toMatchObject({ row: 3, col: 6, slotIndex: 27 });
  });

  it('用「累积边界取整」切分，最后一格右/下边缘精确贴合标定矩形', () => {
    const rect = toPixelRect(CALIBRATION.board, SCREEN);
    const slots = buildGrid(rect, 7, 4, 'board', 0.72, SCREEN);
    const last = slots[27]!;
    expect(last.x + last.w).toBe(rect.x + rect.w);
    expect(last.y + last.h).toBe(rect.y + rect.h);
    const first = slots[0]!;
    expect(first.x).toBe(rect.x);
    expect(first.y).toBe(rect.y);
  });

  it('同一行内相邻格首尾相接、互不重叠', () => {
    const rect = toPixelRect(CALIBRATION.board, SCREEN);
    const slots = buildGrid(rect, 7, 4, 'board', 0.72, SCREEN);
    const row0 = slots.filter((slot) => slot.row === 0);
    for (let i = 1; i < row0.length; i += 1) {
      expect(row0[i]!.x).toBe(row0[i - 1]!.x + row0[i - 1]!.w);
    }
    for (let i = 1; i < 4; i += 1) {
      const prev = slots.filter((slot) => slot.row === i - 1)[0]!;
      const next = slots.filter((slot) => slot.row === i)[0]!;
      expect(next.y).toBe(prev.y + prev.h);
    }
  });

  it('备战席切成一行的 8 槽', () => {
    const rect = toPixelRect(CALIBRATION.bench, SCREEN);
    const slots = buildRowSlots(rect, 8, 'bench', 0.78, SCREEN);
    expect(slots).toHaveLength(8);
    expect(slots.every((slot) => slot.zone === 'bench' && slot.row === 0)).toBe(true);
    expect(slots[0]!.x).toBe(rect.x);
    expect(slots[7]!.x + slots[7]!.w).toBe(rect.x + rect.w);
  });

  it('矩形越界时把坐标夹到屏幕内（不产生负坐标）', () => {
    const slots = buildGrid({ x: -50, y: -30, w: 200, h: 100 }, 2, 2, 'board', 0.72, SCREEN);
    expect(slots.every((slot) => slot.x >= 0 && slot.y >= 0)).toBe(true);
  });
});

describe('buildGeometry', () => {
  it('产出 28 + 8 = 36 个真实槽位，并带商店与计分板矩形', () => {
    const geometry = buildGeometry(CALIBRATION, SCREEN);
    expect(geometry.board).toHaveLength(28);
    expect(geometry.bench).toHaveLength(8);
    expect(geometry.shop).toHaveLength(5);
    expect(totalSlotCount(geometry)).toBe(36);
    expect(geometry.scoreboardRect).not.toBeNull();
    expect(geometry.normalizeTo).toBe(64);
  });

  it('所有槽位完全落在屏幕内（防标定漂移到屏幕外）', () => {
    const geometry = buildGeometry(CALIBRATION, SCREEN);
    for (const slot of [...geometry.board, ...geometry.bench, ...geometry.shop]) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.w).toBeLessThanOrEqual(SCREEN.width);
      expect(slot.y + slot.h).toBeLessThanOrEqual(SCREEN.height);
      expect(slot.w).toBeGreaterThan(0);
      expect(slot.h).toBeGreaterThan(0);
    }
  });

  it('未标定商店时不产出商店槽位（该功能默认关闭）', () => {
    const withoutShop: Calibration = { ...CALIBRATION };
    delete withoutShop.shop;
    const geometry = buildGeometry(withoutShop, SCREEN);
    expect(geometry.shop).toHaveLength(0);
    expect(geometry.shopRect).toBeNull();
  });

  it('高 DPI 下按物理像素换算（scaleFactor 不参与 rect，只做记录）', () => {
    const geometry = buildGeometry(CALIBRATION, { width: 3840, height: 2160, scaleFactor: 2 });
    expect(geometry.screen).toEqual({ width: 3840, height: 2160, scaleFactor: 2 });
    expect(geometry.boardRect.x).toBe(Math.round(0.285 * 3840));
    expect(geometry.board[0]!.w).toBeGreaterThan(200);
  });
});

describe('sampleRectOf', () => {
  it('取格位中心 72% 区域，且完全包含在格位内', () => {
    const geometry = buildGeometry(CALIBRATION, SCREEN);
    for (const slot of geometry.board) {
      const sample = sampleRectOf(slot);
      expect(sample.w).toBeLessThan(slot.w);
      expect(sample.h).toBeLessThan(slot.h);
      expect(sample.x).toBeGreaterThanOrEqual(slot.x);
      expect(sample.y).toBeGreaterThanOrEqual(slot.y);
      expect(sample.x + sample.w).toBeLessThanOrEqual(slot.x + slot.w);
      expect(sample.y + sample.h).toBeLessThanOrEqual(slot.y + slot.h);
    }
  });

  it('比例被夹到 0.1..1，避免配置错误导致零尺寸采样', () => {
    const geometry = buildGeometry(CALIBRATION, SCREEN);
    const slot = { ...geometry.board[0]!, sampleRatio: 0 };
    const sample = sampleRectOf(slot);
    expect(sample.w).toBeGreaterThan(0);
    expect(sample.h).toBeGreaterThan(0);
  });
});

describe('calibrationFromGeometryJson', () => {
  it('直接采用 data/board-geometry.json 的行列数（4 行 × 7 列、8 槽、5 商店格）', () => {
    const calibration = calibrationFromGeometryJson(geometryJson, SCREEN);
    expect(calibration.boardRows).toBe(4);
    expect(calibration.boardCols).toBe(7);
    expect(calibration.benchSlots).toBe(8);
    expect(calibration.shopSlots).toBe(5);
    expect(calibration.screenW).toBe(1920);
  });
});

describe('validateCalibration', () => {
  it('默认标定通过校验', () => {
    expect(validateCalibration(CALIBRATION, SCREEN)).toEqual({ ok: true, reasons: [] });
  });

  it('零尺寸矩形被判为无效并给出中文原因', () => {
    const broken: Calibration = { ...CALIBRATION, board: { x: 0.2, y: 0.2, w: 0, h: 0 } };
    const result = validateCalibration(broken, SCREEN);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('棋盘'))).toBe(true);
  });

  it('超出屏幕范围的矩形被判为无效', () => {
    const broken: Calibration = { ...CALIBRATION, bench: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } };
    const result = validateCalibration(broken, SCREEN);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('备战席'))).toBe(true);
  });

  it('屏幕尺寸非法时判为无效', () => {
    const result = validateCalibration(CALIBRATION, { width: 0, height: 0 });
    expect(result.ok).toBe(false);
  });
});
