/**
 * 阵容评分：把候选草案变成可展示的推荐结论。
 *
 * 评分是**同快照内相对排序**用的，不是绝对强度 —— 因为本模块拿不到
 * 「羁绊强度 / 装备契合度」这类数据，硬编一个"强度分"只会骗人。
 * 四个维度里两个直接来自牌库数据（可得性、已有进度），两个是结构分（主线深度、费用质量）。
 */

import type { Champion, Cost, Star } from '../../shared/types/domain';
import type {
  Feasibility,
  LineupMember,
  LineupRecommendation,
  LineupTrait,
  MemberStatus,
} from '../../shared/types/recommend';
import type { ChampionAvailability } from './availability';
import type { LineupDraft } from './compose';
import type { TraitEntry } from './trait-index';

/** 评分权重（合计 1）。 */
const WEIGHTS = {
  /** 可得性：牌库还买不买得到。 */
  availability: 0.4,
  /** 已有进度：我已经投了多少。 */
  owned: 0.3,
  /** 主线深度：核心羁绊凑了几人。 */
  traitDepth: 0.2,
  /** 费用质量：高费牌更值。 */
  costQuality: 0.1,
} as const;

/** 判定阈值。 */
const THRESHOLDS = {
  /** 加权可得性 ≥ 此值判 easy。 */
  easy: 0.45,
  /** 加权可得性 ≥ 此值判 normal，否则 hard。 */
  normal: 0.22,
  /** 低费牌已持有多少张时继续追 3★。 */
  lowCostChase: 5,
} as const;

/** 评分上下文。 */
export interface ScoreContext {
  championsById: ReadonlyMap<string, Champion>;
  availability: ReadonlyMap<string, ChampionAvailability>;
  traitIndex: ReadonlyMap<string, TraitEntry>;
  starCopyCost: Record<Star, number>;
  population: number;
}

/**
 * 决定该成员的目标星级。
 *
 * 默认追 2★（3★ 需要 9 张，对 4/5 费来说在 10/9 张的池子里几乎不可行，
 * 硬推荐 3★ 会把玩家带进沟里）。两种情况例外：已达 3★ 保持，低费高投入继续追。
 *
 * @param cost 费用。
 * @param owned 已持有张数。
 * @param starCopyCost 星级 → 张数。
 */
export function pickTargetStar(
  cost: Cost,
  owned: number,
  starCopyCost: Record<Star, number>,
): Star {
  const threeStar = starCopyCost[3] ?? 9;
  if (owned >= threeStar) {
    return 3;
  }
  if (cost <= 2 && owned >= THRESHOLDS.lowCostChase) {
    return 3;
  }
  return 2;
}

function memberStatus(needed: number, pessimistic: number): MemberStatus {
  if (needed <= 0) {
    return 'ready';
  }
  if (pessimistic <= 0) {
    return 'blocked';
  }
  return pessimistic < needed ? 'contested' : 'ready';
}

function feasibilityText(feasibility: Feasibility): string {
  switch (feasibility) {
    case 'easy':
      return '充足';
    case 'normal':
      return '够用';
    case 'hard':
      return '紧张';
    default:
      return '已空';
  }
}

/**
 * 给一条草案打分。
 *
 * @param draft 候选阵容。
 * @param ctx 评分上下文。
 */
export function scoreLineup(draft: LineupDraft, ctx: ScoreContext): LineupRecommendation | null {
  const memberIds = draft.memberIds;
  if (memberIds.length === 0) {
    return null;
  }

  const members: LineupMember[] = [];
  const traitCount = new Map<string, number>();
  let missingCopies = 0;
  let ownedScoreSum = 0;
  let ratioWeightedSum = 0;
  let ratioWeight = 0;
  let ratioPlainSum = 0;
  let costSum = 0;
  let blockedCount = 0;

  for (const championId of memberIds) {
    const champion = ctx.championsById.get(championId);
    const av = ctx.availability.get(championId);
    if (champion === undefined || av === undefined) {
      continue;
    }

    const targetStar = pickTargetStar(champion.cost, av.owned, ctx.starCopyCost);
    const targetCopies = ctx.starCopyCost[targetStar] ?? 0;
    const needed = Math.max(0, targetCopies - av.owned);
    const status = memberStatus(needed, av.pessimistic);

    members.push({
      championId,
      nameCn: champion.nameCn,
      cost: champion.cost,
      owned: av.owned,
      targetStar,
      needed,
      poolRemaining: av.remaining,
      poolPessimistic: av.pessimistic,
      status,
      core: draft.seedTrait !== null ? champion.traits.includes(draft.seedTrait) : av.owned > 0,
    });

    for (const trait of champion.traits) {
      traitCount.set(trait, (traitCount.get(trait) ?? 0) + 1);
    }

    missingCopies += needed;
    ownedScoreSum += targetCopies > 0 ? Math.min(av.owned / targetCopies, 1) : 0;
    costSum += champion.cost;

    if (needed > 0) {
      ratioWeightedSum += av.ratio * needed;
      ratioWeight += needed;
      if (status === 'blocked') {
        blockedCount += 1;
      }
    }
    ratioPlainSum += av.ratio;
  }

  const memberCount = members.length;
  if (memberCount === 0) {
    return null;
  }

  const traits: LineupTrait[] = [...traitCount.entries()]
    .map(([trait, count]) => ({
      trait,
      nameCn: ctx.traitIndex.get(trait)?.nameCn ?? trait,
      count,
      poolCount: ctx.traitIndex.get(trait)?.members.length ?? count,
    }))
    .sort((a, b) => b.count - a.count || b.poolCount - a.poolCount || a.trait.localeCompare(b.trait));

  // 可得性：用「按缺口张数加权」的悲观比例 —— 差 3 张的牌比差 1 张的牌更该主导判断
  const availabilityScore =
    ratioWeight > 0 ? ratioWeightedSum / ratioWeight : ratioPlainSum / memberCount;
  const ownedScore = ownedScoreSum / memberCount;
  const maxTraitCount = traits[0]?.count ?? 0;
  const traitDepthScore = ctx.population > 0 ? Math.min(maxTraitCount / ctx.population, 1) : 0;
  const costQualityScore = Math.min(costSum / memberCount / 5, 1);

  const score =
    100 *
    (WEIGHTS.availability * availabilityScore +
      WEIGHTS.owned * ownedScore +
      WEIGHTS.traitDepth * traitDepthScore +
      WEIGHTS.costQuality * costQualityScore);

  let feasibility: Feasibility;
  if (blockedCount >= 2) {
    feasibility = 'blocked';
  } else if (blockedCount === 1) {
    feasibility = 'hard';
  } else if (availabilityScore >= THRESHOLDS.easy) {
    feasibility = 'easy';
  } else if (availabilityScore >= THRESHOLDS.normal) {
    feasibility = 'normal';
  } else {
    feasibility = 'hard';
  }

  const headline = traits[0];
  const headlineLabel = headline?.nameCn ?? '散搭';

  return {
    id: draft.id,
    traits: traits.slice(0, 4),
    members,
    score: Math.round(score * 10) / 10,
    feasibility,
    missingCopies,
    summary: `${headlineLabel}：还差 ${missingCopies} 张｜牌库${feasibilityText(feasibility)}`,
  };
}
