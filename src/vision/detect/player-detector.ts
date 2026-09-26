/**
 * 「当前是第几家」识别 —— ADR-05 三级判定链。
 *
 * 背景（合规红线导致的必然设计）：本工具**不能**模拟输入去切换巡查视角，
 * 只能由用户手动切。因此工具必须自己判断"现在看到的这块棋盘属于第几家"。
 *
 * 三级链（逐级降级，都不可靠就返回 UNKNOWN，**绝不猜测**）：
 * - **L1 计分板高亮**：左侧计分板中"自己那一行"有更高亮度/描边 → 置信度最高；
 * - **L2 棋盘指纹**：整块棋盘的 pHash 与历史记录比对（同一家的棋局结构稳定）；
 * - **L3 UNKNOWN**：观测先落到 `UNKNOWN_SEAT` 暂存区，由用户手动归属或
 *   下一轮扫描再确认（ADR-04 第 5 条：宁可暂存，不可错归属）。
 */

import { hammingDistance } from '../../shared/math/hash';
import { SEAT_COUNT } from '../../shared/constants';
import { SEAT_CONFIDENCE_FLOOR } from '../../core/ledger/player-identity';
import type { Seat, SeatOrUnknown } from '../../shared/types/domain';
import { UNKNOWN_SEAT } from '../../shared/types/domain';
import type { SeatGuess } from '../../shared/types/scan';
import { computeFrameStats, cropImage, type RawImage } from '../preprocess/raw-image';

/** 一条已知的"棋盘指纹 → 座位"记录。 */
export interface KnownBoardFingerprint {
  seat: Seat;
  fingerprint: string;
  /** 最近一次看到的时间（越新越可信）。 */
  lastSeenAt?: number;
}

/** L1 判定结果。 */
export interface ScoreboardHighlightResult {
  seat: Seat;
  confidence: number;
  /** 冠军行与亚军行的亮度差（越大越确定）。 */
  margin: number;
}

/** L2 判定结果。 */
export interface FingerprintMatchResult {
  seat: Seat;
  confidence: number;
  distance: number;
}

/**
 * L1：计分板高亮行识别。
 *
 * 把计分板矩形纵向等分成 8 段（每个玩家一段），取"亮度 + 饱和度"综合分最高的
 * 一段；若与第二名差距过小则认为分辨不出（返回 null）。
 *
 * @param scoreboard 计分板区域图像。
 * @param seatCount 玩家数（默认 8）。
 */
export function detectByScoreboardHighlight(
  scoreboard: RawImage,
  seatCount: number = SEAT_COUNT,
): ScoreboardHighlightResult | null {
  if (scoreboard.width === 0 || scoreboard.height === 0 || seatCount <= 0) {
    return null;
  }

  const bandHeight = scoreboard.height / seatCount;
  const scores: number[] = [];

  for (let seat = 0; seat < seatCount; seat += 1) {
    const band = cropImage(scoreboard, {
      x: 0,
      y: Math.round(bandHeight * seat),
      w: scoreboard.width,
      h: Math.max(1, Math.round(bandHeight)),
    });
    const stats = computeFrameStats(band, 2);
    scores.push(stats.meanLuma + stats.variance * 0.05);
  }

  let bestSeat = 0;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  scores.forEach((score, seat) => {
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestSeat = seat;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });

  if (!Number.isFinite(bestScore) || !Number.isFinite(secondScore)) {
    return null;
  }

  const margin = bestScore - secondScore;
  // 差距过小 = 没有明显高亮行，L1 弃权
  if (margin < 4) {
    return null;
  }

  const normalizedMargin = Math.min(1, margin / 40);
  return {
    seat: clampSeat(bestSeat, seatCount),
    confidence: 0.6 + normalizedMargin * 0.35,
    margin,
  };
}

/** 把任意索引夹到合法座位范围。 */
function clampSeat(index: number, seatCount: number): Seat {
  const bounded = Math.max(0, Math.min(seatCount - 1, Math.floor(index)));
  return bounded as Seat;
}

/**
 * L2：用整块棋盘指纹在已知记录里找回座位。
 *
 * @param boardFingerprint 当前棋盘 pHash。
 * @param known 已知记录。
 * @param threshold 汉明距离阈值（缺省 = 12，比"同一实例"的 6 宽，因为视角变化更大）。
 */
export function detectByBoardFingerprint(
  boardFingerprint: string,
  known: readonly KnownBoardFingerprint[],
  threshold = 12,
): FingerprintMatchResult | null {
  if (!boardFingerprint || boardFingerprint === '0'.repeat(16) || known.length === 0) {
    return null;
  }

  let best: FingerprintMatchResult | null = null;
  for (const record of known) {
    if (!record.fingerprint || record.fingerprint === '0'.repeat(16)) {
      continue;
    }
    const distance = hammingDistance(boardFingerprint, record.fingerprint);
    if (distance > threshold) {
      continue;
    }
    if (best === null || distance < best.distance) {
      best = { seat: record.seat, confidence: 0, distance };
    }
  }

  if (best === null) {
    return null;
  }

  // 距离越小越可信；上限 0.9（L2 本身不可能比 L1 更确定）
  const confidence = Math.max(0.4, Math.min(0.9, 0.9 - best.distance / 32));
  return { ...best, confidence };
}

/** 玩家识别的输入。 */
export interface PlayerDetectInput {
  /** 计分板区域图像（标定了才有）。 */
  scoreboard?: RawImage | null;
  /** 本帧整块棋盘的 pHash。 */
  boardFingerprint: string;
  /** 已知的座位↔指纹记录。 */
  known?: readonly KnownBoardFingerprint[];
  /** 用户手动指定的座位（最高优先级）。 */
  hint?: SeatOrUnknown | null;
  /** L2 的汉明距离阈值。 */
  fingerprintThreshold?: number;
}

/**
 * 三级链入口。
 *
 * @param input 识别输入。
 * @returns 座位猜测（含方法与置信度）。
 */
export function detectPlayer(input: PlayerDetectInput): SeatGuess {
  // 用户手动指定 > 一切
  if (input.hint !== undefined && input.hint !== null && input.hint !== UNKNOWN_SEAT) {
    return { seat: input.hint, confidence: 1, method: 'manual' };
  }

  // L1：计分板高亮
  if (input.scoreboard) {
    const l1 = detectByScoreboardHighlight(input.scoreboard);
    if (l1 !== null && l1.confidence >= SEAT_CONFIDENCE_FLOOR) {
      return { seat: l1.seat, confidence: l1.confidence, method: 'scoreboard' };
    }
  }

  // L2：棋盘指纹
  const l2 = detectByBoardFingerprint(
    input.boardFingerprint,
    input.known ?? [],
    input.fingerprintThreshold ?? 12,
  );
  if (l2 !== null && l2.confidence >= SEAT_CONFIDENCE_FLOOR) {
    return { seat: l2.seat, confidence: l2.confidence, method: 'board-fingerprint' };
  }

  // L3：不猜，落到 UNKNOWN 暂存区
  return { seat: UNKNOWN_SEAT, confidence: 0, method: 'unknown' };
}

/**
 * 把本帧结果并入"已知指纹"记录（供下一轮 L2 使用）。
 *
 * @param known 现有记录。
 * @param seat 座位。
 * @param fingerprint 棋盘指纹。
 * @param now 时间戳。
 * @param capacity 记录上限（默认 64，避免无限增长）。
 */
export function rememberBoardFingerprint(
  known: KnownBoardFingerprint[],
  seat: Seat,
  fingerprint: string,
  now: number,
  capacity = 64,
): KnownBoardFingerprint[] {
  if (!fingerprint || fingerprint === '0'.repeat(16)) {
    return known;
  }
  const next = [
    ...known.filter((record) => !(record.seat === seat && record.fingerprint === fingerprint)),
    { seat, fingerprint, lastSeenAt: now },
  ];
  next.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
  return next.slice(0, Math.max(1, capacity));
}
