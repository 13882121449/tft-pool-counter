/**
 * 覆盖率计算与乐观/悲观区间。
 *
 * 产品承诺（PRD 6.4）：工具给出的是「基于可见信息的估算」。
 * 覆盖率不足时必须给出悲观区间，绝不把点估计包装成权威数字。
 */

import type { Coverage, Cost, PlayerLedger } from '../../shared/types/domain';
import type { EstimateConfig } from '../../shared/types/config';
import { SEAT_COUNT } from '../../shared/constants';

/**
 * 判断某家是否已被巡查过。
 *
 * 判定口径：`scanCount > 0` 或状态为 scanned/eliminated。
 * 被淘汰的玩家其持有量已知为 0，同样算作已覆盖。
 *
 * @param ledger 玩家台账。
 */
export function isSeatCovered(ledger: PlayerLedger | undefined): boolean {
  if (!ledger) {
    return false;
  }
  if (ledger.status === 'scanned' || ledger.status === 'eliminated') {
    return true;
  }
  return ledger.scanCount > 0;
}

/**
 * 计算全场覆盖率。
 *
 * @param ledgers 全部台账（含 UNKNOWN 暂存区，它不计入 8 家）。
 */
export function computeCoverage(ledgers: ReadonlyArray<PlayerLedger>): Coverage {
  const seats: number[] = [];
  const missing: number[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat += 1) {
    const ledger = ledgers.find((item) => item.seat === seat);
    if (isSeatCovered(ledger)) {
      seats.push(seat);
    } else {
      missing.push(seat);
    }
  }
  return {
    scanned: seats.length,
    total: SEAT_COUNT,
    seats: seats as Coverage['seats'],
    missing: missing as Coverage['missing'],
  };
}

/**
 * 未被巡查的家数。
 *
 * @param coverage 覆盖率。
 */
export function uncoveredSeatCount(coverage: Coverage): number {
  return Math.max(0, coverage.total - coverage.scanned);
}

/**
 * 悲观估计：假设每个未巡查家都持有 `perSeatByCost[cost]` 张。
 *
 * 算例 B：remaining = 1，未巡查 2 家，每家 1 张 → max(0, 1 - 2) = 0。
 *
 * @param remaining 点估计剩余数。
 * @param coverage 覆盖率。
 * @param config 估算配置。
 * @param cost 费用档。
 */
export function pessimisticRemaining(
  remaining: number,
  coverage: Coverage,
  config: EstimateConfig,
  cost: Cost,
): number {
  const uncovered = uncoveredSeatCount(coverage);
  if (uncovered === 0) {
    return Math.max(0, remaining);
  }
  const perSeat = config.perSeatByCost?.[cost] ?? 1;
  return Math.max(0, remaining - uncovered * perSeat);
}
