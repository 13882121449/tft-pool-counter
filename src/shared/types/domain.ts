/**
 * 领域类型定义（架构 §4.1）。
 *
 * 本文件是 main / renderer / vision 三方共享的唯一契约来源。
 * 约束：禁止在此文件 import `electron` 或 `node:*`（由 ESLint 强制）。
 */

/** 弈子费用档位（1~5 费）。 */
export type Cost = 1 | 2 | 3 | 4 | 5;

/** 弈子星级。4★ = S18「日蚀」羁绊的战斗内临时升星，按 9 张计。 */
export type Star = 1 | 2 | 3 | 4;

/** 座位号，0 = 我。 */
export type Seat = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 座位号，含「未识别归属」暂存区。 */
export type SeatOrUnknown = Seat | typeof UNKNOWN_SEAT;

/** 未识别座位的哨兵值：观测先落到这里，绝不猜测归属（ADR-04 第 5 条）。 */
export const UNKNOWN_SEAT = 8 as const;

/** 局面阶段。 */
export type Stage = 'prep' | 'combat' | 'carousel' | 'unknown';

/** 观测区域。 */
export type Zone = 'board' | 'bench' | 'shop';

/** 台账槽位状态。 */
export type LedgerStatus = 'unscanned' | 'scanned' | 'eliminated';

/** 数据来源：自动识别 / 人工校正。 */
export type Source = 'auto' | 'manual';

/**
 * 弈子特殊机制（来自 `data/pool-baseline.json` 的 `special` 字段）。
 * 引擎必须通过这些字段工作，不得在代码里写死弈子 id。
 */
export interface ChampionSpecial {
  /** 占几个上阵人口/格位，默认 1；远古巨龙 = 2。 */
  teamSlots?: number;
  /** 实际消耗池中几张，默认等于 teamSlots；远古巨龙 = 1。 */
  poolCopiesConsumed?: number;
  /** 共享同一卡池的说明（如拉克丝全形态共享）。 */
  sharedPoolNote?: string;
  /** 额外羁绊贡献（远古巨龙 riftbeast_trait_contribution = 2）。 */
  riftbeastTraitContribution?: number;
  /** 备注。 */
  note?: string;
}

/** 单个弈子的静态定义（运行时形状，字段来自卡池基线数据文件）。 */
export interface Champion {
  /** 稳定 id，如 'ahri'。 */
  id: string;
  nameEn: string;
  nameCn: string;
  cost: Cost;
  traits: string[];
  /** 与 traits 一一对应；null = 国服译名待核实（Q9）。 */
  traitsCn: Array<string | null>;
  /** 卡池总数 —— 永远来自数据文件，禁止硬编码。 */
  poolTotal: number;
  special?: ChampionSpecial;
  /** 数据是否已经实测确认（当前基线 CONFIRMED: false）。 */
  confirmed: boolean;
}

/** 卡池基线元信息。 */
export interface BaselineMeta {
  schemaVersion: string;
  setNumber: number;
  setNameCn: string;
  setNameEn?: string;
  patch: string;
  confirmed: boolean;
  confidence: Record<string, string>;
  unverifiedNote?: string;
  generatedAt?: string;
}

/** 每个费用档的池大小。 */
export interface PoolSizeByCostEntry {
  copiesPerChampion: number;
  distinctChampions: number;
  tierTotal?: number;
  confirmed?: boolean;
}

/** 卡池基线：唯一的卡池数据源。 */
export interface PoolBaseline {
  meta: BaselineMeta;
  poolSizeByCost: Record<Cost, PoolSizeByCostEntry>;
  /** 星级 → 消耗张数：{1:1, 2:3, 3:9, 4:9}。 */
  starCopyCost: Record<Star, number>;
  champions: Champion[];
  /** 非池单位黑名单 id（E5 过滤）。 */
  nonPoolUnitIds: string[];
  shopOddsByLevel?: Record<number, number[]>;
}

/**
 * 一个具体的单位实例 —— 台账的最小计账单位。
 *
 * 注意：实例 ≠ 格子。远古巨龙占 2 格但只有 1 个实例（E8）。
 */
export interface UnitInstance {
  /** 唯一 id；槽位内容变化即生成新 id。 */
  instanceId: string;
  championId: string;
  star: Star;
  /** 由 star 经 `starCopyCost` 换算得到的消耗张数。 */
  copies: number;
  seat: SeatOrUnknown;
  zone: Zone;
  /** 格位线性索引（board: row * cols + col；bench: 0..M-1）。 */
  slotIndex: number;
  /** 占用格数，默认 1，远古巨龙 2。 */
  slotSpan: number;
  /** 0..1。 */
  confidence: number;
  /** pHash hex，用于同槽位判重。 */
  fingerprint: string;
  firstSeenAt: number;
  lastSeenAt: number;
  source: Source;
  /** 锁定后自动扫描完全不写入该槽位，只更新 autoSuggest。 */
  locked: boolean;
  /** 锁定期间系统建议的张数，仅供 UI 展示。 */
  autoSuggest?: number;
  /**
   * 防抖动标记：槽位被识别为空但未超过 TTL，保留旧记录并打此标记（ADR-04 第 2 条）。
   * 该字段是对架构文档 §4.1 的最小扩展，不影响跨进程结构化克隆。
   */
  unstable?: boolean;
}

/** 槽位键：`${seat}|${zone}|${slotIndex}`。 */
export type SlotKey = string;

/** 单个玩家的台账。 */
export interface PlayerLedger {
  seat: SeatOrUnknown;
  isSelf: boolean;
  status: LedgerStatus;
  /** 以槽位为键的幂等覆盖表（非事件日志，ADR-04）。 */
  slots: Record<SlotKey, UnitInstance>;
  /** 整块棋盘的 pHash，用于 L2 玩家识别（ADR-05）。 */
  boardFingerprint?: string;
  lastScanAt: number;
  scanCount: number;
  /** 最近一次写入的 scanId，用于保证 applyScan 幂等。 */
  lastScanId?: string;
}

/** 牌库标记，用于 UI 高亮与告警。 */
export type PoolFlag =
  | 'OVERFLOW_DUPLICATOR'
  | 'LOW_COVERAGE'
  | 'LOW_CONFIDENCE'
  | 'LOCKED'
  | 'MANUAL_OVERRIDE'
  | 'STALE'
  | 'SEAT_UNKNOWN';

/** 引擎输出：单个弈子的剩余数结果。 */
export interface RemainingResult {
  championId: string;
  cost: Cost;
  poolTotal: number;
  /** 已观测消耗，可能 > poolTotal（复制器）。 */
  observedCopies: number;
  /** max(0, poolTotal - observedCopies)。 */
  remaining: number;
  /** max(0, observedCopies - poolTotal) → UI 显示 "+N 复制器"。 */
  overflow: number;
  /** 乐观估计 = remaining。 */
  remainingOptimistic: number;
  /** 悲观估计 = max(0, remaining - Σ 未覆盖家 × 每家估计)。 */
  remainingPessimistic: number;
  /** length 8，各家持有张数。 */
  bySeat: number[];
  /** length 8，8 点点阵。 */
  seatHasAny: boolean[];
  coveredSeats: Seat[];
  confidence: number;
  flags: PoolFlag[];
  locked: boolean;
  updatedAt: number;
  /** 上一次快照的 remaining，供 UI 显示 ↑N / ↓N。 */
  prevRemaining?: number;
}

/** 巡查覆盖率。 */
export interface Coverage {
  scanned: number;
  total: number;
  seats: Seat[];
  missing: Seat[];
}

/** 快照元信息。 */
export interface SnapshotMeta {
  setNumber: number;
  patch: string;
  baselineConfirmed: boolean;
  avgConfidence: number;
  lastScanDurationMs: number;
}

/** 推送给渲染进程的完整快照。 */
export interface PoolSnapshot {
  scanId: string;
  generatedAt: number;
  stage: Stage;
  coverage: Coverage;
  /** 65 条，按 baseline.champions 顺序。 */
  rows: RemainingResult[];
  meta: SnapshotMeta;
  errors: AppError[];
}

/** 应用错误（跨进程传输必须是可结构化克隆的纯对象）。 */
export interface AppError {
  code: ErrorCode;
  message: string;
  detail?: unknown;
  at: number;
  fatal: boolean;
}

/** 错误码（架构 §4.4）。 */
export type ErrorCode =
  // 捕获 CAP
  | 'CAP_BACKEND_UNAVAILABLE'
  | 'CAP_BLACK_FRAME'
  | 'CAP_TIMEOUT'
  | 'CAP_OS_UNSUPPORTED'
  // 视觉 VIS
  | 'VIS_NO_BOARD'
  | 'VIS_CALIBRATION_MISSING'
  | 'VIS_TEMPLATE_EMPTY'
  | 'VIS_LOW_CONFIDENCE'
  | 'VIS_SEAT_UNKNOWN'
  // 基线 BASE
  | 'BASE_INVALID_JSON'
  | 'BASE_SCHEMA_FAIL'
  | 'BASE_SET_MISMATCH'
  | 'BASE_UNCONFIRMED'
  // 引擎 ENG
  | 'ENG_OVERFLOW'
  | 'ENG_UNKNOWN_CHAMPION'
  // IPC/存储 SYS
  | 'SYS_IPC_TIMEOUT'
  | 'SYS_WORKER_CRASH'
  | 'SYS_STORE_WRITE_FAIL';
