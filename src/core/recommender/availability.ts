/**
 * 可得性计算：把引擎输出的 `RemainingResult` 翻译成推荐模块需要的「这张牌我还买得到几张」。
 *
 * 关键取舍：**一律使用悲观口径**（`remainingPessimistic`）来评估可得性。
 * 理由是推荐结论会直接驱动玩家的经济决策 —— 追星失败比错过一套阵容贵得多，
 * 因此宁可低估可用牌量。乐观口径仍原样透出，供 UI 展示参考区间。
 */

import type { Cost, RemainingResult } from '../../shared/types/domain';

/** 单个弈子的可得性。 */
export interface ChampionAvailability {
  championId: string;
  cost: Cost;
  /** 池总数（来自基线，非硬编码）。 */
  poolTotal: number;
  /** 乐观剩余。 */
  remaining: number;
  /** 悲观剩余 —— 推荐决策只用这个值。 */
  pessimistic: number;
  /** 我持有的张数。 */
  owned: number;
  /** 悲观剩余占池总数的比例，0..1。 */
  ratio: number;
  /** 除我之外还有几家持有（竞争度，0..7）。 */
  rivalSeats: number;
}

/** 空可得性（baseline 里有、快照里缺失时的兜底）。 */
function emptyAvailability(championId: string, cost: Cost, poolTotal: number): ChampionAvailability {
  return {
    championId,
    cost,
    poolTotal,
    remaining: poolTotal,
    pessimistic: poolTotal,
    owned: 0,
    ratio: poolTotal > 0 ? 1 : 0,
    rivalSeats: 0,
  };
}

/**
 * 计算全部弈子的可得性。
 *
 * @param rows 引擎输出的 65 条剩余数结果。
 * @param mySeat 我的座位，默认 0。
 */
export function computeAvailability(
  rows: readonly RemainingResult[],
  mySeat = 0,
): Map<string, ChampionAvailability> {
  const result = new Map<string, ChampionAvailability>();

  for (const row of rows) {
    const owned = Math.max(0, row.bySeat[mySeat] ?? 0);
    const pessimistic = Math.max(0, row.remainingPessimistic);
    const ratio = row.poolTotal > 0 ? clamp01(pessimistic / row.poolTotal) : 0;

    let rivalSeats = 0;
    for (let seat = 0; seat < row.bySeat.length; seat += 1) {
      if (seat !== mySeat && (row.bySeat[seat] ?? 0) > 0) {
        rivalSeats += 1;
      }
    }

    result.set(row.championId, {
      championId: row.championId,
      cost: row.cost,
      poolTotal: row.poolTotal,
      remaining: Math.max(0, row.remaining),
      pessimistic,
      owned,
      ratio,
      rivalSeats,
    });
  }

  return result;
}

/**
 * 取可得性，缺失时按「池满」兜底。
 *
 * 之所以兜底成「池满」而不是「池空」：快照缺某张牌只说明**没观测到消耗**，
 * 不代表它被消耗完了；按池满处理会让推荐偏乐观一格，但由悲观口径兜住整体偏保守，
 * 两者叠加比「按池空」导致的整条推荐被误杀更安全。
 *
 * @param availability 可得性表。
 * @param championId 弈子 id。
 * @param cost 费用。
 * @param poolTotal 池总数。
 */
export function availabilityOf(
  availability: ReadonlyMap<string, ChampionAvailability>,
  championId: string,
  cost: Cost,
  poolTotal: number,
): ChampionAvailability {
  return availability.get(championId) ?? emptyAvailability(championId, cost, poolTotal);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value >= 1 ? 1 : value;
}
