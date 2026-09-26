/**
 * 扫描与观测契约（架构 §4.2）。
 *
 * 一次扫描的产物 `ScanResult` 只包含**结构化观测**，绝不包含任何像素数据
 * —— 从架构上杜绝"截图被上传"的可能路径（合规 X8）。
 */

import type { AppError, Cost, Seat, SeatOrUnknown, Stage, Star, Zone } from './domain';

/** 归一化标定矩形（0..1，相对屏幕宽高），与分辨率/缩放无关。 */
export interface CalibrationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 完整标定信息。 */
export interface Calibration {
  board: CalibrationRect;
  boardCols: number;
  boardRows: number;
  bench: CalibrationRect;
  benchSlots: number;
  shop?: CalibrationRect;
  shopSlots: number;
  scoreboard?: CalibrationRect;
  /** 标定时的基准屏幕尺寸，用于把归一化比例换算回物理像素。 */
  screenW: number;
  screenH: number;
  scaleFactor: number;
}

/** 扫描请求。 */
export interface ScanRequest {
  scanId: string;
  trigger: 'scheduled' | 'manual' | 'probe';
  calibration: Calibration;
  options: {
    detectPlayer: boolean;
    detectStage: boolean;
    detectShop: boolean;
  };
}

/** 候选弈子（Top-N，供校正面板展示）。 */
export interface Candidate {
  championId: string;
  score: number;
}

/**
 * 单格观测记录。
 *
 * `championId === null` 表示该槽位被识别为**空**（卖出/淘汰回池的判据）。
 */
export interface ObservationRecord {
  zone: Zone;
  slotIndex: number;
  championId: string | null;
  star: Star;
  /** 0..1。 */
  confidence: number;
  /** pHash hex，用于同槽位指纹判重。 */
  fingerprint: string;
  /** 费用颜色先验的分类结果。 */
  costGuess: Cost | null;
  /** Top-N 候选，供手动校正面板使用。 */
  candidates: Candidate[];
  /** 命中非池单位黑名单（E5）。 */
  isBlacklisted: boolean;
  /**
   * 被同帧相邻槽位合并掉的观测所占用的额外格数（远古巨龙 = 2）。
   * 这是对架构 §4.2 的最小扩展，用于让引擎按「实例」而非「格子」计数。
   */
  slotSpan?: number;
  /**
   * 本观测（多格实例）**并入的其它槽位线性索引**（精确、可含竖排）。
   *
   * `slotSpan` 只表达"占几格"，无法区分横向/竖向；台账在覆盖写入时若要
   * 清理这些格上的旧实例（避免与合并实例重复计数），必须依赖本字段给出
   * 的确切格位，而不能用 `slotIndex + offset` 线性推算（QA N1）。
   */
  mergedSlotIndices?: number[];
}

/** 座位判定方法与置信度（ADR-05 三级判定链）。 */
export interface SeatGuess {
  seat: SeatOrUnknown;
  confidence: number;
  method: 'scoreboard' | 'board-fingerprint' | 'unknown' | 'manual';
}

/** 商店格观测（P1，不计入消耗）。 */
export interface ShopSlot {
  slotIndex: number;
  championId: string | null;
  confidence: number;
}

/** 分段耗时统计。 */
export interface ScanMetrics {
  captureMs: number;
  geometryMs: number;
  matchMs: number;
  starMs: number;
  playerMs: number;
  backend: 'node-screenshots' | 'desktopCapturer';
}

/** 一次扫描的完整产物。 */
export interface ScanResult {
  scanId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  stage: Stage;
  stageConfidence: number;
  seatGuess: SeatGuess;
  observations: ObservationRecord[];
  shop?: ShopSlot[];
  metrics: ScanMetrics;
  errors: AppError[];
}

/** 构造一个"空"的 ScanResult（未检测到棋盘 / 探测失败时使用）。 */
export function createEmptyScanResult(
  scanId: string,
  now: number,
  errors: AppError[] = [],
): ScanResult {
  return {
    scanId,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    stage: 'unknown',
    stageConfidence: 0,
    seatGuess: { seat: 8, confidence: 0, method: 'unknown' },
    observations: [],
    shop: undefined,
    metrics: {
      captureMs: 0,
      geometryMs: 0,
      matchMs: 0,
      starMs: 0,
      playerMs: 0,
      backend: 'desktopCapturer',
    },
    errors,
  };
}

/** 构造槽位键：`${seat}|${zone}|${slotIndex}`。 */
export function makeSlotKey(seat: SeatOrUnknown, zone: Zone, slotIndex: number): string {
  return `${seat}|${zone}|${slotIndex}`;
}

/** 解析槽位键，失败返回 null。 */
export function parseSlotKey(
  key: string,
): { seat: SeatOrUnknown; zone: Zone; slotIndex: number } | null {
  const parts = key.split('|');
  if (parts.length !== 3) {
    return null;
  }
  const seat = Number(parts[0]);
  const slotIndex = Number(parts[2]);
  const zone = parts[1];
  if (!Number.isInteger(seat) || !Number.isInteger(slotIndex)) {
    return null;
  }
  if (zone !== 'board' && zone !== 'bench' && zone !== 'shop') {
    return null;
  }
  return { seat: seat as SeatOrUnknown, zone, slotIndex };
}

/** 已巡查座位的集合（用于覆盖率展示）。 */
export type ScannedSeatSet = ReadonlyArray<Seat>;
