/**
 * 全局常量（架构 §3.3）。
 *
 * 时间单位统一为 **epoch ms**；置信度统一为 **0..1** 浮点。
 */

import type { AppConfig, EstimateConfig } from './types/config';
import type { Cost, Star } from './types/domain';
import { UNKNOWN_SEAT } from './types/domain';

/** 一局比赛的座位数（含我在内 8 家）。 */
export const SEAT_COUNT = 8;

/** 台账中要维护的"座位"总数：8 个真实座位 + 1 个 UNKNOWN 暂存区。 */
export const LEDGER_SLOT_COUNT = SEAT_COUNT + 1;

export { UNKNOWN_SEAT };

/** 搜索「未识别归属」暂存区时使用的索引。 */
export const UNKNOWN_SEAT_INDEX = UNKNOWN_SEAT;

/** 默认 stale 判定 TTL（ms）：槽位被识别为空且超过此时间才移除（防抖动）。 */
export const STALE_TTL_MS = 8_000;

/** pHash 汉明距离阈值：≤ 此值判定为同一实例（ADR-04）。 */
export const SAME_FINGERPRINT_THRESHOLD = 6;

/** 默认模板匹配阈值：低于此值标低置信。 */
export const MATCH_THRESHOLD = 0.72;

/** pHash 粗筛 Top-N。 */
export const COARSE_TOP_N = 5;

/** 置信度低于此值打 LOW_CONFIDENCE 标记。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** 覆盖率低于此值打 LOW_COVERAGE 标记。 */
export const LOW_COVERAGE_THRESHOLD = 5;

/** 快照推送节流间隔（ms）。 */
export const SNAPSHOT_THROTTLE_MS = 100;

/** 扫描耗时预算（ms），超过则触发降采样。 */
export const SCAN_BUDGET_MS = 1_500;

/** 单次视觉流水线超时保护（ms）。 */
export const SCAN_TIMEOUT_MS = 1_200;

/** 人工校正实例占用的保留 slotIndex 起始值（避开 board 0..27 / bench 0..7）。 */
export const MANUAL_SLOT_BASE = 1_000;

/**
 * 星级 → 消耗池中张数的**默认换算表**（唯一来源）。
 *
 * 运行时以 `PoolBaseline.starCopyCost` 为准；基线缺失时回退到本表。
 * 业务逻辑（core / renderer）一律引用本常量或基线，**禁止硬编码 1/3/9**
 * （QA M3：`copiesToThreeStar` 与渲染层 `distanceToThreeStar` 曾各自写死 9）。
 *
 * 4★ = S18「日蚀」羁绊的战斗内临时升星，张数与 3★ 相同。
 */
export const STAR_COPY_COST: Record<Star, number> = { 1: 1, 2: 3, 3: 9, 4: 9 };

/** 台账历史环形缓冲容量。 */
export const LEDGER_HISTORY_CAPACITY = 200;

/** 撤销栈容量。 */
export const UNDO_STACK_CAPACITY = 50;

/** 当前支持的赛季号（与 `data/pool-baseline.json` 对齐）。 */
export const SUPPORTED_SET_NUMBER = 18;

/** 配置 schema 版本，用于 `config-store.migrate()`。 */
export const CONFIG_VERSION = 1;

/** 悲观估计默认参数：每个未巡查家、每个费用档保守估计 1 张（PRD Q7）。 */
export const DEFAULT_PER_SEAT_BY_COST: Record<Cost, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
};

/** 默认估算配置。 */
export const DEFAULT_ESTIMATE_CONFIG: EstimateConfig = {
  perSeatByCost: { ...DEFAULT_PER_SEAT_BY_COST },
  lowCoverageThreshold: LOW_COVERAGE_THRESHOLD,
  lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
  staleTtlMs: STALE_TTL_MS,
};

/** 完整默认配置（唯一来源，禁止在模块内散落字面量）。 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: CONFIG_VERSION,
  window: {
    x: -1,
    y: -1,
    width: 340,
    height: 640,
    scale: 1,
    opacity: 0.92,
    clickThrough: false,
    snapEdge: 'right',
    mode: 'full',
  },
  scan: {
    intervalPrepMs: 1_500,
    intervalCombatMs: 5_000,
    pauseOnCarousel: true,
    pauseOnBlur: true,
    probeIntervalMs: 5_000,
    failStreakToAlarm: 3,
  },
  recognition: {
    templateSetId: 'builtin-s18',
    matchThreshold: MATCH_THRESHOLD,
    coarseTopN: COARSE_TOP_N,
    fingerprintSameThreshold: SAME_FINGERPRINT_THRESHOLD,
    enableShopDetect: false,
    enableOcrAssist: false,
    backend: 'auto',
  },
  estimate: { ...DEFAULT_ESTIMATE_CONFIG },
  ui: {
    theme: 'dark',
    sortMode: 'cost-asc',
    costFilter: [],
    traitFilter: [],
    watchlist: [],
    // 合规要求：永久显示"估算"，不可关闭
    alwaysShowEstimateLabel: true,
  },
  data: {
    baselinePath: 'data/pool-baseline.json',
    autoReloadBaseline: true,
    templateDir: 'userData/assets/templates',
  },
  hotkeys: {
    toggleVisible: 'Ctrl+Shift+T',
    togglePause: 'Ctrl+Shift+P',
  },
  compliance: {
    acknowledged: false,
  },
  advanced: {
    logLevel: 'info',
    saveSession: false,
  },
};
