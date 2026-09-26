/**
 * 阶段 → 扫描间隔策略（架构 §3.6 / §5.4）。
 *
 * 设计意图：
 * - **备战阶段**：棋盘变化频繁，1.5s 一刷；
 * - **战斗阶段**：棋盘基本不变，降频到 5s，省 CPU；
 * - **选秀阶段**：几乎必然误判棋盘，直接暂停（避免把选秀界面当成棋子）；
 * - **未知阶段**：走探测频率（5s），只在疑似有棋盘时才逐步提速。
 */

import type { Stage } from '../../shared/types/domain';
import type { ScanConfig } from '../../shared/types/config';

/** 策略结果。 */
export interface StagePolicyResult {
  /** 下一次扫描间隔（ms）。 */
  intervalMs: number;
  /** 是否暂停实际扫描（只做状态回报）。 */
  paused: boolean;
  /** 暂停/降频原因（中文，供调试面板）。 */
  reason?: string;
}

/**
 * 计算某阶段的目标扫描间隔。
 *
 * @param stage 当前阶段（unknown 时走探测频率）。
 * @param scan 扫描配置。
 */
export function intervalForStage(stage: Stage, scan: ScanConfig): StagePolicyResult {
  switch (stage) {
    case 'prep':
      return { intervalMs: scan.intervalPrepMs, paused: false };
    case 'combat':
      if (scan.intervalCombatMs <= 0) {
        return {
          intervalMs: scan.probeIntervalMs,
          paused: true,
          reason: '战斗阶段暂停扫描（intervalCombatMs = 0）',
        };
      }
      return { intervalMs: scan.intervalCombatMs, paused: false };
    case 'carousel':
      if (scan.pauseOnCarousel) {
        return {
          intervalMs: scan.probeIntervalMs,
          paused: true,
          reason: '选秀阶段暂停扫描',
        };
      }
      return { intervalMs: scan.intervalPrepMs, paused: false };
    case 'unknown':
    default:
      return { intervalMs: scan.probeIntervalMs, paused: false, reason: '阶段未知，走探测频率' };
  }
}

/**
 * 是否属于"降频"（非暂停但间隔显著变长），供状态条展示。
 *
 * @param result 策略结果。
 * @param scan 扫描配置。
 */
export function isDowngraded(result: StagePolicyResult, scan: ScanConfig): boolean {
  return !result.paused && result.intervalMs > scan.intervalPrepMs;
}
