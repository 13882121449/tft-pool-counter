/**
 * 格子抽取（ADR-02 第 2 步）：把整帧按网格切成一个个归一化候选格。
 *
 * 产物 `SlotSample` 是识别链路的"原材料"，包含：
 * - 归一化图（后续费用分类 / 模板匹配 / 星标检测的统一输入）；
 * - pHash + dHash 指纹（同槽位判重与粗筛）；
 * - `blank` 空位判定（**卖回池**与"该槽已清空"的判据，是三个命门之一的上游）。
 *
 * 多格实例（远古巨龙占 2 格）的提示**不在此层产出** —— 抽取时还不知道弈子身份；
 * 它由裁决后的融合阶段依据 `teamSlots` + 几何相邻写入 `ObservationRecord.slotSpan`
 * （见 `@vision/match/multi-cell`）。
 *
 * 全部为 async（sharp 走异步），但内部对 sharp 缺失有纯 JS 降级路径。
 */

import { dhash } from '../../shared/math/hash';
import type { Zone } from '../../shared/types/domain';
import { cropAndNormalize } from '../preprocess/crop';
import { buildGrid, sampleRectOf, type GridGeometry, type SlotRect } from '../preprocess/geometry';
import {
  computeFrameStats,
  cropImage,
  fingerprint,
  type PixelRect,
  type RawImage,
} from '../preprocess/raw-image';

/** 空格判定：亮度方差低于此值视为空格。 */
export const BLANK_SLOT_VARIANCE = 130;

/** 空格判定：平均亮度低于此值视为空格（纯背景/暗格）。 */
export const BLANK_SLOT_LUMA = 12;

/** 单个槽位的抽取结果。 */
export interface SlotSample {
  zone: Zone;
  slotIndex: number;
  row: number;
  col: number;
  /** 格位矩形（物理像素）。 */
  rect: PixelRect;
  /** 实际用于识别的采样矩形（格位中心区域）。 */
  sampleRect: PixelRect;
  /** 归一化后的图像（默认 64×64 RGBA）。 */
  image: RawImage;
  /** pHash 指纹（16 位十六进制）。 */
  fingerprint: string;
  /** dHash 指纹（粗筛补充特征）。 */
  dHash: string;
  /** 是否判定为空位。 */
  blank: boolean;
  /** 平均亮度（0..255）。 */
  brightness: number;
  /** 亮度方差。 */
  variance: number;
}

/**
 * 抽取单个槽位。
 *
 * @param frame 整帧图像。
 * @param slot 槽位几何。
 * @param size 归一化尺寸。
 */
export async function extractSlotSample(
  frame: RawImage,
  slot: SlotRect,
  size: number,
): Promise<SlotSample> {
  const sampleRect = sampleRectOf(slot);
  const raw = cropImage(frame, sampleRect);
  const stats = computeFrameStats(raw, 2);
  const normalized = await cropAndNormalize(frame, sampleRect, size);
  const blank = stats.variance < BLANK_SLOT_VARIANCE || stats.meanLuma < BLANK_SLOT_LUMA;

  return {
    zone: slot.zone,
    slotIndex: slot.slotIndex,
    row: slot.row,
    col: slot.col,
    rect: { x: slot.x, y: slot.y, w: slot.w, h: slot.h },
    sampleRect,
    image: normalized,
    fingerprint: fingerprint(normalized),
    dHash: dhash(normalized.data, normalized.width, normalized.height, normalized.channels),
    blank,
    brightness: stats.meanLuma,
    variance: stats.variance,
  };
}

/**
 * 抽取全部槽位（棋盘 + 备战席 [+ 商店]）。
 *
 * @param frame 整帧图像。
 * @param geometry 网格几何。
 * @param options 是否包含商店、归一化尺寸。
 */
export async function extractSlotSamples(
  frame: RawImage,
  geometry: GridGeometry,
  options: { includeShop?: boolean; size?: number } = {},
): Promise<SlotSample[]> {
  const size = options.size ?? geometry.normalizeTo;
  const slots: SlotRect[] = options.includeShop
    ? [...geometry.board, ...geometry.bench, ...geometry.shop]
    : [...geometry.board, ...geometry.bench];

  const samples: SlotSample[] = [];
  for (const slot of slots) {
    samples.push(await extractSlotSample(frame, slot, size));
  }
  return samples;
}

/**
 * 只抽取某一行的槽位（棋盘逐行识别可降低单帧峰值耗时）。
 *
 * @param frame 整帧图像。
 * @param geometry 网格几何。
 * @param row 行号。
 * @param size 归一化尺寸。
 */
export async function extractBoardRow(
  frame: RawImage,
  geometry: GridGeometry,
  row: number,
  size?: number,
): Promise<SlotSample[]> {
  const cols = geometry.board.length / Math.max(1, countRows(geometry));
  const rect = geometry.boardRect;
  const rowHeight = Math.max(1, Math.round(rect.h / Math.max(1, countRows(geometry))));
  const rowRect: PixelRect = {
    x: rect.x,
    y: rect.y + rowHeight * row,
    w: rect.w,
    h: rowHeight,
  };
  const slots = buildGrid(
    rowRect,
    Math.max(1, Math.round(cols)),
    1,
    'board',
    geometry.board[0]?.sampleRatio ?? 0.72,
    geometry.screen,
  ).map((slot, index) => ({ ...slot, row, slotIndex: row * Math.round(cols) + index }));

  const samples: SlotSample[] = [];
  for (const slot of slots) {
    samples.push(await extractSlotSample(frame, slot, size ?? geometry.normalizeTo));
  }
  return samples;
}

/** 推断棋盘行数（从几何中槽位数量反推，避免重复传参）。 */
function countRows(geometry: GridGeometry): number {
  if (geometry.board.length === 0) {
    return 1;
  }
  let rows = 1;
  const firstRowIndex = geometry.board[0]?.row ?? 0;
  for (const slot of geometry.board) {
    if (slot.row !== firstRowIndex) {
      rows = Math.max(rows, slot.row + 1);
    }
  }
  return rows;
}

/**
 * 取出棋盘某一行的槽位列表（不重新计算几何，直接过滤）。
 *
 * @param samples 全部样本。
 * @param row 行号。
 */
export function pickBoardRow(samples: SlotSample[], row: number): SlotSample[] {
  return samples.filter((sample) => sample.zone === 'board' && sample.row === row);
}
