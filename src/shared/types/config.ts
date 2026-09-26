/**
 * 应用配置类型（架构 §4.3）。
 *
 * 所有默认值集中在 `src/shared/constants.ts` 的 `DEFAULT_APP_CONFIG`，
 * 禁止在各模块里散落字面量。
 */

import type { Cost } from './domain';

export interface WindowConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0.8 ~ 1.5 */
  scale: number;
  /** 0.4 ~ 1.0 */
  opacity: number;
  clickThrough: boolean;
  snapEdge: 'left' | 'right' | 'none';
  mode: 'full' | 'mini';
}

export interface ScanConfig {
  intervalPrepMs: number;
  /** 0 = 战斗阶段暂停扫描。 */
  intervalCombatMs: number;
  pauseOnCarousel: boolean;
  pauseOnBlur: boolean;
  probeIntervalMs: number;
  failStreakToAlarm: number;
}

export interface RecognitionConfig {
  templateSetId: string;
  /** 低于此分数标低置信。 */
  matchThreshold: number;
  coarseTopN: number;
  /** pHash 汉明距离阈值，≤ 此值判定为同一实例。 */
  fingerprintSameThreshold: number;
  enableShopDetect: boolean;
  enableOcrAssist: boolean;
  backend: 'auto' | 'node-screenshots' | 'desktopCapturer';
}

/** 估算参数（引擎输入，PRD Q7 参数化）。 */
export interface EstimateConfig {
  /** 每个未巡查家、每个费用档的保守估计持有张数。默认全档 1 张。 */
  perSeatByCost: Record<Cost, number>;
  /** 覆盖率低于此值打 LOW_COVERAGE 标记。 */
  lowCoverageThreshold: number;
  /**
   * 置信度低于此值打 LOW_CONFIDENCE 标记并可在 UI 显示「?」。
   * 对架构 §4.3 的最小扩展（默认值 0.6）。
   */
  lowConfidenceThreshold?: number;
  /**
   * 陈旧判定 TTL（ms）：某弈子最后一次被看到距今超过此值打 STALE 标记。
   * 对架构 §4.3 的最小扩展（默认 8000）。
   */
  staleTtlMs?: number;
}

export interface UiConfig {
  theme: 'dark' | 'light' | 'high-contrast';
  sortMode: 'cost-asc' | 'remaining-asc';
  /** 空数组 = 全部。 */
  costFilter: Cost[];
  traitFilter: string[];
  /** 我的追卡 championId 列表。 */
  watchlist: string[];
  /** 合规要求：永久显示"估算"字样，不可关闭。 */
  alwaysShowEstimateLabel: boolean;
}

export interface DataConfig {
  baselinePath: string;
  autoReloadBaseline: boolean;
  templateDir: string;
}

export interface HotkeyConfig {
  toggleVisible: string;
  togglePause: string;
}

export interface ComplianceConfig {
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface AdvancedConfig {
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  saveSession: boolean;
}

export interface AppConfig {
  /** schema 版本，用于 config-store 的 migrate。 */
  version: number;
  window: WindowConfig;
  scan: ScanConfig;
  recognition: RecognitionConfig;
  estimate: EstimateConfig;
  ui: UiConfig;
  data: DataConfig;
  hotkeys: HotkeyConfig;
  compliance: ComplianceConfig;
  advanced: AdvancedConfig;
}
