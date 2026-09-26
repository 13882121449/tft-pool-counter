/**
 * 标定几何：归一化矩形 → 网格 → **物理像素**坐标（架构 §3.5 / ADR-02 第 1–2 步）。
 *
 * 三条硬约束：
 * 1. 标定存的是 **0..1 归一化比例**，不存绝对像素 → 跨分辨率/缩放天然复用；
 * 2. 所有几何计算统一在**物理像素坐标系**（截图 Buffer 的像素尺寸 =
 *    逻辑像素 × scaleFactor），UI 显示层再除以 devicePixelRatio（ADR-01 已知坑 3）；
 * 3. 棋盘行列数、备战席槽位数、商店格数全部**可配置**（A1：S18 实测前先给默认值
 *    4 行 × 7 列 / 8 槽 / 5 格），绝不硬编码。
 *
 * 本文件是**纯函数**，零 node / electron 依赖，可直接在 Vitest 中单测。
 */

import type { Calibration, CalibrationRect } from '../../shared/types/scan';
import type { Zone } from '../../shared/types/domain';
import type { PixelRect } from './raw-image';

/** 单个槽位在物理像素坐标系下的矩形。 */
export interface SlotRect extends PixelRect {
  zone: Zone;
  /** 格位线性索引：board = row * cols + col；bench/shop = 0..n-1。 */
  slotIndex: number;
  /** 所在行（bench/shop 恒为 0）。 */
  row: number;
  /** 所在列。 */
  col: number;
  /** 取格子中心多大比例用于识别采样（避开相邻格与边框）。 */
  sampleRatio: number;
}

/** 一次标定解析出的完整网格几何。 */
export interface GridGeometry {
  /** 物理屏幕尺寸与缩放系数。 */
  screen: { width: number; height: number; scaleFactor: number };
  /** 棋盘标定矩形（物理像素）。 */
  boardRect: PixelRect;
  /** 备战席标定矩形。 */
  benchRect: PixelRect;
  /** 商店标定矩形（可选）。 */
  shopRect: PixelRect | null;
  /** 计分板标定矩形（可选，ADR-05 L1 用）。 */
  scoreboardRect: PixelRect | null;
  /** 棋盘槽位（rows × cols 个）。 */
  board: SlotRect[];
  /** 备战席槽位。 */
  bench: SlotRect[];
  /** 商店槽位。 */
  shop: SlotRect[];
  /** 归一化尺寸（识别图的统一输入尺寸，默认 64）。 */
  normalizeTo: number;
}

/** 构造 GridGeometry 所需的运行时屏幕信息。 */
export interface ScreenInfo {
  /** 物理像素宽度。 */
  width: number;
  /** 物理像素高度。 */
  height: number;
  /** DPI 缩放系数，默认 1。 */
  scaleFactor?: number;
}

/** 默认归一化尺寸（ADR-02：每格裁剪后归一化到 64×64）。 */
export const DEFAULT_NORMALIZE_TO = 64;

/** 默认格内采样比例（取中心 72%，避开边框）。 */
export const DEFAULT_CELL_SAMPLE_RATIO = 0.72;

/**
 * 归一化矩形 → 物理像素矩形。
 *
 * @param rect 归一化矩形（0..1）。
 * @param screen 屏幕物理尺寸。
 */
export function toPixelRect(rect: CalibrationRect, screen: ScreenInfo): PixelRect {
  const width = Math.max(0, screen.width);
  const height = Math.max(0, screen.height);
  const x = Math.round(rect.x * width);
  const y = Math.round(rect.y * height);
  return {
    x,
    y,
    w: Math.max(0, Math.round(rect.w * width)),
    h: Math.max(0, Math.round(rect.h * height)),
  };
}

/**
 * 计算格子矩形（不取整误差累积：用"累积边界"而非"固定步长"切分，
 * 保证最后一格右边缘恰好贴齐标定矩形右边缘）。
 *
 * @param rect 区域矩形。
 * @param colIndex 列索引。
 * @param colCount 总列数。
 */
function cellLeftRight(rect: PixelRect, colIndex: number, colCount: number): { left: number; right: number } {
  const left = rect.x + Math.round((rect.w * colIndex) / colCount);
  const right = rect.x + Math.round((rect.w * (colIndex + 1)) / colCount);
  return { left, right };
}

/**
 * 计算行边界（同上，用累积取整避免累积误差）。
 *
 * @param rect 区域矩形。
 * @param rowIndex 行索引。
 * @param rowCount 总行数。
 */
function cellTopBottom(rect: PixelRect, rowIndex: number, rowCount: number): { top: number; bottom: number } {
  const top = rect.y + Math.round((rect.h * rowIndex) / rowCount);
  const bottom = rect.y + Math.round((rect.h * (rowIndex + 1)) / rowCount);
  return { top, bottom };
}

/**
 * 把矩形切成 rows × cols 的网格。
 *
 * @param rect 区域矩形。
 * @param cols 列数。
 * @param rows 行数。
 * @param zone 区域类型。
 * @param sampleRatio 格内采样比例。
 * @param screen 屏幕尺寸（用于裁剪到边界内）。
 * @returns 槽位列表，长度 = rows * cols，按 row-major 排列。
 */
export function buildGrid(
  rect: PixelRect,
  cols: number,
  rows: number,
  zone: Zone,
  sampleRatio: number,
  screen: ScreenInfo,
): SlotRect[] {
  const slots: SlotRect[] = [];
  const colCount = Math.max(1, Math.floor(cols));
  const rowCount = Math.max(1, Math.floor(rows));

  for (let row = 0; row < rowCount; row += 1) {
    const { top, bottom } = cellTopBottom(rect, row, rowCount);
    for (let col = 0; col < colCount; col += 1) {
      const { left, right } = cellLeftRight(rect, col, colCount);
      slots.push({
        zone,
        slotIndex: row * colCount + col,
        row,
        col,
        x: Math.max(0, Math.min(screen.width, left)),
        y: Math.max(0, Math.min(screen.height, top)),
        w: Math.max(0, right - left),
        h: Math.max(0, bottom - top),
        sampleRatio,
      });
    }
  }
  return slots;
}

/**
 * 把矩形切成一行的 slots 个槽位（备战席 / 商店）。
 *
 * @param rect 区域矩形。
 * @param slots 槽位数。
 * @param zone 区域类型。
 * @param sampleRatio 格内采样比例。
 * @param screen 屏幕尺寸。
 */
export function buildRowSlots(
  rect: PixelRect,
  slots: number,
  zone: Zone,
  sampleRatio: number,
  screen: ScreenInfo,
): SlotRect[] {
  return buildGrid(rect, slots, 1, zone, sampleRatio, screen);
}

/**
 * 取槽位**中心** sampleRatio 比例的采样矩形（避开相邻格与边框）。
 *
 * @param slot 槽位。
 * @returns 采样矩形（物理像素）。
 */
export function sampleRectOf(slot: SlotRect): PixelRect {
  const ratio = Math.min(1, Math.max(0.1, slot.sampleRatio));
  const w = Math.round(slot.w * ratio);
  const h = Math.round(slot.h * ratio);
  return {
    x: slot.x + Math.round((slot.w - w) / 2),
    y: slot.y + Math.round((slot.h - h) / 2),
    w,
    h,
  };
}

/**
 * 由标定信息 + 当前屏幕信息构建完整网格几何。
 *
 * @param calibration 标定（归一化比例）。
 * @param screen 当前屏幕物理尺寸。
 * @param normalizeTo 识别图归一化尺寸。
 */
export function buildGeometry(
  calibration: Calibration,
  screen: ScreenInfo,
  normalizeTo: number = DEFAULT_NORMALIZE_TO,
): GridGeometry {
  const boardRect = toPixelRect(calibration.board, screen);
  const benchRect = toPixelRect(calibration.bench, screen);
  const shopRect = calibration.shop ? toPixelRect(calibration.shop, screen) : null;
  const scoreboardRect = calibration.scoreboard
    ? toPixelRect(calibration.scoreboard, screen)
    : null;

  return {
    screen: {
      width: screen.width,
      height: screen.height,
      scaleFactor: screen.scaleFactor ?? 1,
    },
    boardRect,
    benchRect,
    shopRect,
    scoreboardRect,
    board: buildGrid(
      boardRect,
      calibration.boardCols,
      calibration.boardRows,
      'board',
      DEFAULT_CELL_SAMPLE_RATIO,
      screen,
    ),
    bench: buildRowSlots(benchRect, calibration.benchSlots, 'bench', 0.78, screen),
    shop: shopRect
      ? buildRowSlots(shopRect, calibration.shopSlots, 'shop', 0.8, screen)
      : [],
    normalizeTo,
  };
}

/**
 * 从 `data/board-geometry.json` 的形状构造默认标定。
 *
 * 这是"首次启动的默认值"，真实值必须由用户通过标定向导覆盖（A3）。
 *
 * @param json 已解析的 board-geometry.json。
 * @param screen 当前屏幕信息。
 */
export function calibrationFromGeometryJson(
  json: BoardGeometryJson,
  screen: ScreenInfo,
): Calibration {
  return {
    board: { ...json.board.rect },
    boardCols: json.board.cols,
    boardRows: json.board.rows,
    bench: { ...json.bench.rect },
    benchSlots: json.bench.slots,
    shop: json.shop ? { ...json.shop.rect } : undefined,
    shopSlots: json.shop?.slots ?? 5,
    scoreboard: json.scoreboard ? { ...json.scoreboard.rect } : undefined,
    screenW: screen.width,
    screenH: screen.height,
    scaleFactor: screen.scaleFactor ?? json.baseResolution.scaleFactor ?? 1,
  };
}

/** `data/board-geometry.json` 的最小类型（只声明本文件用到的字段）。 */
export interface BoardGeometryJson {
  schemaVersion?: string;
  baseResolution: { width: number; height: number; scaleFactor?: number };
  board: {
    rows: number;
    cols: number;
    rect: CalibrationRect;
    cellSampleRatio?: number;
    normalizeTo?: number;
  };
  bench: { slots: number; rect: CalibrationRect; cellSampleRatio?: number };
  shop?: { slots: number; rect: CalibrationRect; cellSampleRatio?: number; wispSlotIndex?: number };
  scoreboard?: { rect: CalibrationRect };
}

/**
 * 判定标定是否"看起来合理"（防止用户误拖出 0 尺寸或超出屏幕的矩形）。
 *
 * @param calibration 待校验标定。
 * @param screen 当前屏幕。
 * @returns 校验结果与中文原因。
 */
export function validateCalibration(
  calibration: Calibration,
  screen: ScreenInfo,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const rects: Array<[string, CalibrationRect]> = [
    ['棋盘', calibration.board],
    ['备战席', calibration.bench],
  ];
  if (calibration.shop) {
    rects.push(['商店', calibration.shop]);
  }

  for (const [name, rect] of rects) {
    if (!(rect.w > 0.01) || !(rect.h > 0.01)) {
      reasons.push(`${name}标定区域过小`);
      continue;
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > 1.001 || rect.y + rect.h > 1.001) {
      reasons.push(`${name}标定区域超出屏幕范围`);
    }
  }

  if (calibration.boardCols < 1 || calibration.boardRows < 1) {
    reasons.push('棋盘行列数必须 >= 1');
  }
  if (calibration.benchSlots < 1) {
    reasons.push('备战席槽位数必须 >= 1');
  }
  if (!(screen.width > 0) || !(screen.height > 0)) {
    reasons.push('屏幕尺寸无效');
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * 统计几何中的槽位总数（棋盘 + 备战席），用于 UI 展示与自检。
 *
 * @param geometry 网格几何。
 */
export function totalSlotCount(geometry: GridGeometry): number {
  return geometry.board.length + geometry.bench.length;
}
