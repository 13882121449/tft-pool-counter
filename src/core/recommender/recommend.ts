/**
 * 阵容推荐主入口。
 *
 * 数据来源严格限定为「我已有的 + 全场牌库剩余的」：
 * - 我已有的 → `RemainingResult.bySeat[mySeat]`
 * - 牌库剩的 → `RemainingResult.remaining` / `remainingPessimistic`
 * - 羁绊关系 → `Champion.traits`（来自基线，不硬编码）
 *
 * 除此之外不引入任何外部强度数据，也不联网 —— 与主程序的合规红线一致。
 */

import type { Champion, RemainingResult, Star } from '../../shared/types/domain';
import type { ChaseAdvice, ChaseVerdict, RecommendationResult } from '../../shared/types/recommend';
import { computeAvailability } from './availability';
import { composeLineups } from './compose';
import { scoreLineup } from './score';
import { buildTraitIndex } from './trait-index';

/** 推荐计算输入。 */
export interface RecommendInput {
  /** 引擎输出的 65 条剩余数。 */
  rows: readonly RemainingResult[];
  /** 基线弈子列表。 */
  champions: readonly Champion[];
  /** 星级 → 张数（来自基线）。 */
  starCopyCost: Record<Star, number>;
  /** 我的座位，默认 0。 */
  mySeat?: number;
  /** 上阵人口，默认 8。 */
  population?: number;
  /** 返回阵容条数，默认 3。 */
  topN?: number;
  /** 需要排除的非池单位 id。 */
  nonPoolUnitIds?: readonly string[];
  /** 巡查覆盖率，用于生成误差声明。 */
  coverage?: { scanned: number; total: number };
  /** 基线是否已实测确认。 */
  baselineConfirmed?: boolean;
}

/** 默认上阵人口：TFT 常规对局 8 人口成型。 */
const DEFAULT_POPULATION = 8;

/** 默认推荐条数。 */
const DEFAULT_TOP_N = 3;

/**
 * 由持有张数推断当前星级。
 *
 * @param owned 持有张数。
 * @param starCopyCost 星级 → 张数。
 */
function starOf(owned: number, starCopyCost: Record<Star, number>): Star {
  if (owned >= (starCopyCost[3] ?? 9)) {
    return 3;
  }
  if (owned >= (starCopyCost[2] ?? 3)) {
    return 2;
  }
  return 1;
}

/**
 * 生成追星建议：手上已经投了钱的牌，该继续还是止损。
 *
 * @param rows 剩余数结果。
 * @param mySeat 我的座位。
 * @param championsById id → 弈子。
 * @param starCopyCost 星级 → 张数。
 */
function buildChaseAdvice(
  rows: readonly RemainingResult[],
  mySeat: number,
  championsById: ReadonlyMap<string, Champion>,
  starCopyCost: Record<Star, number>,
): ChaseAdvice[] {
  const advice: ChaseAdvice[] = [];

  for (const row of rows) {
    const owned = Math.max(0, row.bySeat[mySeat] ?? 0);
    if (owned <= 0) {
      continue;
    }
    const champion = championsById.get(row.championId);
    if (champion === undefined) {
      continue;
    }

    const star = starOf(owned, starCopyCost);
    const pessimistic = Math.max(0, row.remainingPessimistic);
    const remaining = Math.max(0, row.remaining);

    let verdict: ChaseVerdict;
    let neededToNextStar = 0;
    let reason: string;

    if (star >= 3) {
      verdict = 'hold';
      reason = '已 3★ 满级，无需继续投入';
    } else {
      const nextStar = (star + 1) as Star;
      neededToNextStar = Math.max(0, (starCopyCost[nextStar] ?? 0) - owned);
      if (pessimistic <= 0) {
        verdict = 'stop';
        reason = `牌库已被抢空，还差 ${neededToNextStar} 张，追不动了`;
      } else if (pessimistic < neededToNextStar) {
        verdict = 'hold';
        reason = `牌库仅剩约 ${pessimistic} 张，还差 ${neededToNextStar} 张，大概率追不满`;
      } else {
        verdict = 'keep-chasing';
        reason = `牌库还剩约 ${pessimistic} 张，够上 ${nextStar}★（需 ${neededToNextStar} 张）`;
      }
    }

    advice.push({
      championId: row.championId,
      nameCn: champion.nameCn,
      cost: champion.cost,
      owned,
      star,
      verdict,
      neededToNextStar,
      poolRemaining: remaining,
      poolPessimistic: pessimistic,
      reason,
    });
  }

  // 高费优先（投入更大、决策更贵），同级按持有张数降序
  advice.sort((a, b) => b.cost - a.cost || b.owned - a.owned || a.championId.localeCompare(b.championId));
  return advice;
}

/**
 * 生成阵容推荐。
 *
 * @param input 见 {@link RecommendInput}。
 */
export function recommendLineups(input: RecommendInput): RecommendationResult {
  const mySeat = input.mySeat ?? 0;
  const population = input.population ?? DEFAULT_POPULATION;
  const topN = input.topN ?? DEFAULT_TOP_N;

  const excluded = new Set(input.nonPoolUnitIds ?? []);
  const champions = input.champions.filter((champion) => !excluded.has(champion.id));
  const championsById = new Map(champions.map((champion) => [champion.id, champion] as const));

  const availability = computeAvailability(input.rows, mySeat);
  const traitIndex = buildTraitIndex(champions, excluded);

  const drafts = composeLineups({ champions, traitIndex, availability, population });

  const scored = drafts
    .map((draft) =>
      scoreLineup(draft, {
        championsById,
        availability,
        traitIndex,
        starCopyCost: input.starCopyCost,
        population,
      }),
    )
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.missingCopies - b.missingCopies ||
        a.id.localeCompare(b.id),
    );

  const coverageScanned = input.coverage?.scanned ?? 0;
  const coverageTotal = input.coverage?.total ?? 8;
  const coverageNote =
    coverageScanned < coverageTotal
      ? `已侦察 ${coverageScanned}/${coverageTotal} 家，未侦察部分的持有量未知，推荐偏乐观`
      : `已侦察 ${coverageScanned}/${coverageTotal} 家`;
  const baselineNote =
    input.baselineConfirmed === false ? '；卡池基线尚未实测确认，池总数可能有偏差' : '';

  return {
    lineups: scored.slice(0, topN),
    chase: buildChaseAdvice(input.rows, mySeat, championsById, input.starCopyCost),
    generatedAt: Date.now(),
    params: { population, mySeat, topN },
    disclaimer: `基于可见信息的估算：${coverageNote}${baselineNote}`,
  };
}
