/**
 * 渲染层格式化工具（架构 §3.7）。
 *
 * 所有"数字/颜色/文案"的换算集中在这里，保证 HUD 与设置页口径一致。
 * 注意：这里**重复**了 core 的档位阈值（而不是 import core），
 * 因为渲染层需要的是"Tailwind class 名"而非领域枚举；两边阈值保持同步。
 */

import type { Cost, PoolSnapshot, RemainingResult, Seat, SeatOrUnknown, Stage } from '@shared/types/domain';
import { UNKNOWN_SEAT } from '@shared/types/domain';
import { STAR_COPY_COST } from '@shared/constants';

/** 剩余数色阶档位。 */
export type RemainingTone = 'plenty' | 'enough' | 'low' | 'out' | 'unknown';

/**
 * 计算剩余数色阶（>50% 绿 / >25% 黄 / >0 橙 / =0 红）。
 *
 * @param row 单行结果。
 */
export function remainingTone(row: RemainingResult): RemainingTone {
  if (row.poolTotal <= 0) {
    return 'unknown';
  }
  if (row.remaining <= 0) {
    return 'out';
  }
  const ratio = row.remaining / row.poolTotal;
  if (ratio > 0.5) {
    return 'plenty';
  }
  if (ratio > 0.25) {
    return 'enough';
  }
  return 'low';
}

/** 档位 → 文字色 Tailwind class。 */
export function toneTextClass(tone: RemainingTone): string {
  switch (tone) {
    case 'plenty':
      return 'text-pool-plenty';
    case 'enough':
      return 'text-pool-enough';
    case 'low':
      return 'text-pool-low';
    case 'out':
      return 'text-pool-out';
    default:
      return 'text-pool-unknown';
  }
}

/** 档位 → 进度条 Tailwind class。 */
export function toneBarClass(tone: RemainingTone): string {
  switch (tone) {
    case 'plenty':
      return 'bg-pool-plenty';
    case 'enough':
      return 'bg-pool-enough';
    case 'low':
      return 'bg-pool-low';
    case 'out':
      return 'bg-pool-out';
    default:
      return 'bg-pool-unknown';
  }
}

/** 费用档 → 边框色（1 费灰 / 2 费绿 / 3 费蓝 / 4 费紫 / 5 费金）。 */
export function costBorderClass(cost: Cost): string {
  switch (cost) {
    case 1:
      return 'border-slate-500/60';
    case 2:
      return 'border-emerald-500/70';
    case 3:
      return 'border-sky-500/70';
    case 4:
      return 'border-fuchsia-500/70';
    case 5:
      return 'border-amber-400/80';
    default:
      return 'border-slate-500/60';
  }
}

/** 剩余数文案（低置信加「?」，为 0 显示「已抽完」）。 */
export function formatRemaining(row: RemainingResult, lowConfidence = false): string {
  const label = String(row.remaining);
  return lowConfidence ? `${label}?` : label;
}

/** 悲观区间文案（覆盖率不足时显示）。 */
export function formatPessimistic(row: RemainingResult): string {
  if (row.remainingPessimistic >= row.remaining) {
    return '';
  }
  return `悲观 ${row.remainingPessimistic}`;
}

/**
 * 距离 3★ 还差几张（我 = seat 0）。
 *
 * 3★ 所需张数取自**唯一来源** `STAR_COPY_COST[3]`（与 core 的
 * `copiesOf(3, baseline)` 同源），不再硬编码 9（QA M3b）。
 *
 * @param row 单行结果。
 * @param mySeat 我的座位，默认 0。
 */
export function distanceToThreeStar(row: RemainingResult, mySeat = 0): number {
  const mine = row.bySeat[mySeat] ?? 0;
  return Math.max(0, STAR_COPY_COST[3] - mine);
}

/** 座位中文标签。 */
export function seatLabel(seat: SeatOrUnknown): string {
  if (seat === UNKNOWN_SEAT) {
    return '未识别';
  }
  return seat === 0 ? '我' : `第 ${seat + 1} 家`;
}

/** 阶段中文标签。 */
export function stageLabel(stage: Stage): string {
  switch (stage) {
    case 'prep':
      return '备战';
    case 'combat':
      return '战斗';
    case 'carousel':
      return '选秀';
    default:
      return '未知';
  }
}

/** 耗时文案。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

/** 相对时间（"3 秒前"）。 */
export function formatRelativeTime(at: number, now = Date.now()): string {
  if (!at || at <= 0) {
    return '尚未扫描';
  }
  const delta = Math.max(0, now - at);
  if (delta < 1500) {
    return '刚刚';
  }
  if (delta < 60_000) {
    return `${Math.round(delta / 1000)} 秒前`;
  }
  return `${Math.round(delta / 60_000)} 分钟前`;
}

/** 覆盖率文案。 */
export function coverageLabel(snapshot: PoolSnapshot | null): string {
  if (snapshot === null) {
    return '巡查 —/8';
  }
  return `巡查 ${snapshot.coverage.scanned}/8`;
}

/** 8 点点阵：哪些家已有观测。 */
export function seatHasAnyList(snapshot: PoolSnapshot | null): boolean[] {
  const result = new Array<boolean>(8).fill(false);
  if (snapshot === null) {
    return result;
  }
  for (const row of snapshot.rows) {
    for (let seat = 0; seat < 8; seat += 1) {
      if (row.seatHasAny[seat]) {
        result[seat] = true;
      }
    }
  }
  return result;
}

/** 错误文案（AppError → 中文）。 */
export function errorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message;
    }
    if (typeof record.code === 'string') {
      return record.code;
    }
  }
  return '未知错误';
}

/** 座位列表（0..7）。 */
export const SEAT_INDICES: Seat[] = [0, 1, 2, 3, 4, 5, 6, 7];
