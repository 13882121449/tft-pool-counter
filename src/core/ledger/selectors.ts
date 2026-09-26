/**
 * 台账选择器（渲染层与 IPC 层读取台账的唯一入口）。
 *
 * 只读，不修改状态；所有计算都委托给 `computeRemaining`，保证口径一致。
 */

import type {
  PoolBaseline,
  RemainingResult,
  SeatOrUnknown,
  UnitInstance,
} from '../../shared/types/domain';
import type { EstimateConfig } from '../../shared/types/config';
import { computeRemaining } from '../pool-engine/compute-remaining';
import { copiesOf } from '../pool-engine/star-copies';
import type { ZoneCols } from '../pool-engine/slot-geometry';
import type { LedgerState } from './ledger-store';

/** 选择器可选参数。 */
export interface SelectOptions {
  config?: Partial<EstimateConfig>;
  now?: number;
  prevRows?: ReadonlyArray<RemainingResult>;
  /** 各区域列数（透传到引擎做二维相邻判定）。 */
  geometry?: ZoneCols;
}

/**
 * 选出全部 65 行结果。
 *
 * @param state 台账状态。
 * @param baseline 卡池基线。
 * @param options 选项。
 */
export function selectRows(
  state: LedgerState,
  baseline: PoolBaseline,
  options: SelectOptions = {},
): RemainingResult[] {
  return computeRemaining(state.ledgers, baseline, options.config ?? {}, {
    now: options.now,
    prevRows: options.prevRows,
    geometry: options.geometry,
  });
}

/**
 * 选出关注区（我的追卡）。
 *
 * @param state 台账状态。
 * @param watchlist 关注的 championId 列表。
 * @param baseline 卡池基线。
 * @param options 选项。
 */
export function selectWatchlist(
  state: LedgerState,
  watchlist: ReadonlyArray<string>,
  baseline: PoolBaseline,
  options: SelectOptions = {},
): RemainingResult[] {
  if (watchlist.length === 0) {
    return [];
  }
  const wanted = new Set(watchlist);
  return selectRows(state, baseline, options).filter((row) => wanted.has(row.championId));
}

/**
 * 选出某家的全部实例（各家明细弹层 / 清空某家）。
 *
 * @param state 台账状态。
 * @param seat 座位。
 */
export function selectSeatDetail(state: LedgerState, seat: SeatOrUnknown): UnitInstance[] {
  const ledger = state.ledgers.find((item) => item.seat === seat);
  if (!ledger) {
    return [];
  }
  return Object.values(ledger.slots ?? {})
    .filter((instance): instance is UnitInstance => Boolean(instance))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

/**
 * 选出距离 3★ 还差几张（UI 的"差 N 张"文案）。
 *
 * 3★ 所需张数**必须**取自 `baseline.starCopyCost[3]`（QA M3），
 * 禁止硬编码 9；`baseline` 缺省时回退到 `star-copies` 的兜底换算表。
 *
 * ⚠️ **签名变更（breaking）**：第 2 参由旧版 `mySeat` 改为 `baseline`。
 * 旧调用 `copiesToThreeStar(row, 3)`（把 3 当座位号）会被当作"无基线"处理，
 * 静默回退兜底表 —— 如需指定座位，请显式写 `copiesToThreeStar(row, baseline, 3)`。
 * 当前 `src/` 下无按旧签名的生产调用点。
 *
 * @param row 单行结果。
 * @param baseline 卡池基线（决定 3★ 消耗张数）。
 * @param mySeat 我的座位，默认 0。
 */
export function copiesToThreeStar(
  row: RemainingResult,
  baseline?: PoolBaseline,
  mySeat = 0,
): number {
  const mine = row.bySeat[mySeat] ?? 0;
  return Math.max(0, copiesOf(3, baseline) - mine);
}

/**
 * 剩余数档位：用于 Tailwind 四档色（绿 / 黄 / 橙 / 红）。
 *
 * 阈值按比例：>50% 绿、>25% 黄、>0 橙、=0 红。
 *
 * @param row 单行结果。
 */
export function remainingTone(row: RemainingResult): 'plenty' | 'enough' | 'low' | 'out' {
  if (row.remaining <= 0) {
    return 'out';
  }
  const ratio = row.poolTotal > 0 ? row.remaining / row.poolTotal : 0;
  if (ratio > 0.5) {
    return 'plenty';
  }
  if (ratio > 0.25) {
    return 'enough';
  }
  return 'low';
}
