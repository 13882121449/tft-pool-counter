/**
 * IPC 契约类型（架构 §4 / §8.3）。
 *
 * 约定：
 * - 请求/响应：`ipcRenderer.invoke(channel, req) → Promise<Result<T>>`
 * - 主 → 渲推送：`webContents.send(channel, payload)`
 * - 所有 payload 必须可结构化克隆（禁止函数、class 实例、Map/Set）。
 */

import type {
  AppError,
  Coverage,
  PoolBaseline,
  PoolSnapshot,
  RemainingResult,
  SeatOrUnknown,
  Star,
  UnitInstance,
} from './domain';
import type { Calibration, ScanResult } from './scan';
import type { AppConfig } from './config';
import type { VisionCapabilities, WizardDraftPayload } from './vision';
import type { Result } from '../utils/result';

/** 校正指令（人工校正是一等公民，PRD 5.2）。 */
export type CorrectionCmd =
  /** 直接把某家某弈子的持有张数设为 value。 */
  | {
      kind: 'set-copies';
      championId: string;
      seat: SeatOrUnknown;
      value: number;
      star?: Star;
      lock?: boolean;
    }
  /** 在现有基础上增减张数。 */
  | { kind: 'adjust-copies'; championId: string; seat: SeatOrUnknown; delta: number }
  /** 把 UNKNOWN 暂存区的实例搬移到指定座位。 */
  | { kind: 'move-instance'; instanceId: string; toSeat: SeatOrUnknown }
  /** 锁定/解锁某家某弈子。 */
  | { kind: 'set-lock'; championId: string; seat: SeatOrUnknown; locked: boolean }
  /** 清空某家台账（重扫）。 */
  | { kind: 'clear-seat'; seat: SeatOrUnknown }
  /** 标记某家被淘汰（棋盘+备战席回池）。 */
  | { kind: 'mark-eliminated'; seat: SeatOrUnknown };

/** 校正面板需要的载荷。 */
export interface CorrectionPayload {
  championId: string;
  bySeat: number[];
  observedCopies: number;
  remaining: number;
  poolTotal: number;
  locked: boolean;
  candidates: Array<{ championId: string; score: number }>;
}

/** scan 域请求/响应。 */
export interface ScanOnceRequest {
  trigger: 'manual' | 'scheduled' | 'probe';
}

export interface ScanStatusPush {
  scanning: boolean;
  lastScanAt: number;
  durationMs: number;
  stage: string;
  failStreak: number;
  backend: string;
}

/** baseline 域。 */
export interface BaselineInfo {
  setNumber: number;
  setNameCn: string;
  patch: string;
  confirmed: boolean;
  championCount: number;
  path: string;
  loadedAt: number;
}

export interface BaselineValidateResult {
  ok: boolean;
  errors: AppError[];
  warnings: AppError[];
  info?: BaselineInfo;
}

/** window 域。 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowActionRequest {
  action:
    | 'minimize'
    | 'close'
    | 'toggle-visible'
    | 'set-click-through'
    | 'set-mode'
    /** 打开（或聚焦）设置窗口；HUD 标题栏 / 迷你模式的「设置」按钮使用。 */
    | 'open-settings';
  value?: boolean | 'full' | 'mini';
}

/** 所有 IPC 调用的响应统一包一层 Result。 */
export type IpcResponse<T> = Result<T, AppError>;

/** 便捷别名，供 handler 签名使用。 */
export type ScanResultPayload = ScanResult;
export type PoolSnapshotPayload = PoolSnapshot;
export type RemainingRowsPayload = RemainingResult[];
export type CoveragePayload = Coverage;
export type CalibrationPayload = Calibration;
export type ConfigPayload = AppConfig;
export type BaselinePayload = PoolBaseline;
export type UnitInstancePayload = UnitInstance;

/** ---- 模板素材域载荷（T04 新增）---- */

/** 单个模板目录的统计。 */
export interface TemplateDirInfo {
  dir: string;
  count: number;
}

/** 模板库总览（设置页 / 采集向导）。 */
export interface TemplateListPayload {
  /** 随包分发的占位/内置模板。 */
  bundled: TemplateDirInfo;
  /** 用户自建模板（可写）。 */
  user: TemplateDirInfo;
  /** 卡池基线中的弈子数量（用于覆盖度对比）。 */
  championCount: number;
}

/** 采集向导落盘请求。 */
export interface TemplateAppendRequest {
  /** 格子 → 弈子 id。 */
  assignments: Record<number, string>;
  /** worker 切出的草稿（原始 RGBA）。 */
  drafts: WizardDraftPayload[];
}

/** 采集向导落盘结果。 */
export interface TemplateAppendResult {
  added: number;
  files: string[];
  errors: string[];
}

/** zip 导出请求。 */
export interface TemplateExportRequest {
  outPath: string;
}

/** zip 导出结果。 */
export interface TemplateExportResult {
  path: string;
  count: number;
  bytes: number;
}

/** zip 导入请求。 */
export interface TemplateImportRequest {
  zipPath: string;
}

/** zip 清单信息。 */
export interface TemplateManifestInfo {
  schemaVersion: string;
  setNumber: number;
  patch: string;
  exportedAt: string;
  count: number;
  source: string;
}

/** zip 导入结果。 */
export interface TemplateImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  dir: string;
  manifest?: TemplateManifestInfo;
}

/** 触发采集当前画面（模板素材向导）。 */
export interface TemplateCaptureRequest {
  /** 是否同时采集商店格（默认 false）。 */
  includeShop?: boolean;
}

/** 采集结果（草稿为原始 RGBA，渲染层可用 canvas 直接展示缩略图）。 */
export interface TemplateCaptureResult {
  drafts: WizardDraftPayload[];
  size: number;
  errors: string[];
}

/** ---- 自检 / 系统信息（T04 新增）---- */

/** 分辨率 / DPI 自检结果（RQ-17 / ADR 风险 A5）。 */
export interface ResolutionCheckPayload {
  ok: boolean;
  /** 是否疑似独占全屏（任务栏被隐藏）。 */
  exclusiveFullscreenLikely: boolean;
  displayWidth: number;
  displayHeight: number;
  scaleFactor: number;
  workArea: { x: number; y: number; width: number; height: number };
  /** null = 尚未标定，无法比较。 */
  matchesCalibration: boolean | null;
  advice: string;
}

/** 单费用档自检。 */
export interface TierSelfTestPayload {
  cost: number;
  copiesPerChampion: number;
  distinctChampions: number;
  summedPoolTotal: number;
  tierTotal: number;
  ok: boolean;
}

/** 卡池自检结果（Q1：一局验证 30/25/18/10/9 之类）。 */
export interface PoolSelfTestPayload {
  ok: boolean;
  tiers: TierSelfTestPayload[];
  notes: string[];
}

/** 系统信息（设置页「关于 / 自检」）。 */
export interface SystemInfoPayload {
  version: string;
  platform: string;
  arch: string;
  resolution: ResolutionCheckPayload;
  capabilities: VisionCapabilities | null;
  poolSelfTest: PoolSelfTestPayload | null;
}
