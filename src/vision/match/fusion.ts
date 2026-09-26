/**
 * 多证据融合与最终裁决（ADR-02 第 6 步）。
 *
 * 三路证据：
 * 1. **pHash 粗筛相似度**（全局结构，抗压缩噪声）；
 * 2. **精排相似度**（OpenCV/NCC，局部纹理，判"是不是同一个弈子"）；
 * 3. **费用颜色先验一致性**（判"费用档对不对"，把误配到异费弈子的情况压下去）。
 *
 * 融合后：
 * - 第一名分数 ≥ `matchThreshold` → 直接采信；
 * - 否则取最高分并打 `lowConfidence`（UI 高亮 + 引导一键校正，绝不静默猜）。
 */

import type { Cost } from '../../shared/types/domain';
import type { Candidate } from '../../shared/types/scan';
import { MATCH_THRESHOLD } from '../../shared/constants';
import type { CoarseHit } from './phash-matcher';
import type { RefinedHit } from './opencv-matcher';

/** 融合权重。 */
export interface FusionWeights {
  coarse: number;
  refined: number;
  cost: number;
}

/** 默认权重（精排最重，费用先验次之，粗筛做基线）。 */
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  coarse: 0.35,
  refined: 0.45,
  cost: 0.2,
};

/** 费用先验为"未知"时给的中性一致性分数。 */
export const NEUTRAL_COST_AGREEMENT = 0.5;

/** 融合后的候选。 */
export interface FusedCandidate {
  championId: string;
  cost: Cost;
  /** 0..1 综合分。 */
  score: number;
  coarseScore: number;
  refinedScore: number;
  /** 0..1：费用先验一致度。 */
  costAgreement: number;
}

/**
 * 单条融合打分。
 *
 * @param coarseScore 粗筛相似度 0..1。
 * @param refinedScore 精排相似度 0..1。
 * @param costAgreement 费用一致性 0..1。
 * @param weights 权重。
 */
export function fuseScore(
  coarseScore: number,
  refinedScore: number,
  costAgreement: number,
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): number {
  const total = weights.coarse + weights.refined + weights.cost;
  const safeTotal = total <= 0 ? 1 : total;
  const weighted =
    coarseScore * weights.coarse + refinedScore * weights.refined + costAgreement * weights.cost;
  return Math.max(0, Math.min(1, weighted / safeTotal));
}

/**
 * 把粗筛命中 + 精排结果 + 费用先验融合成有序候选列表。
 *
 * @param hits 精排命中（含粗筛字段）。
 * @param costGuess 费用先验结果；null = 未知。
 * @param weights 权重。
 */
export function fuseAll(
  hits: RefinedHit[],
  costGuess: Cost | null,
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): FusedCandidate[] {
  const fused: FusedCandidate[] = hits.map((hit) => {
    const costAgreement =
      costGuess === null ? NEUTRAL_COST_AGREEMENT : hit.cost === costGuess ? 1 : 0;
    return {
      championId: hit.championId,
      cost: hit.cost,
      coarseScore: hit.score,
      refinedScore: hit.refinedScore,
      costAgreement,
      score: fuseScore(hit.score, hit.refinedScore, costAgreement, weights),
    };
  });

  // 同一弈子多张模板 → 取最高分
  const best = new Map<string, FusedCandidate>();
  for (const item of fused) {
    const current = best.get(item.championId);
    if (current === undefined || item.score > current.score) {
      best.set(item.championId, item);
    }
  }

  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.championId.localeCompare(b.championId),
  );
}

/** 裁决结果。 */
export interface MatchDecision {
  /** 采信的弈子 id；null = 没有候选（空格/未知）。 */
  championId: string | null;
  /** 0..1。 */
  confidence: number;
  /** 是否需要 UI 高亮提示手动校正。 */
  lowConfidence: boolean;
  /** Top-N 候选，供校正面板展示。 */
  candidates: Candidate[];
  /** 冠军与亚军的分数差（越小越不确定）。 */
  margin: number;
}

/**
 * 最终裁决。
 *
 * @param candidates 融合后的候选（已降序）。
 * @param threshold 采信阈值；缺省 `MATCH_THRESHOLD`(0.72)。
 * @param topN 返回给 UI 的候选数量，默认 5。
 */
export function decideMatch(
  candidates: FusedCandidate[],
  threshold: number = MATCH_THRESHOLD,
  topN = 5,
): MatchDecision {
  if (candidates.length === 0) {
    return { championId: null, confidence: 0, lowConfidence: true, candidates: [], margin: 0 };
  }

  const first = candidates[0] as FusedCandidate;
  const second = candidates[1];
  const margin = second === undefined ? 1 : Math.max(0, first.score - second.score);

  // 分数不够，或与亚军太接近（说明模板库分辨不出）→ 低置信
  const lowConfidence = first.score < threshold || margin < 0.05;

  return {
    championId: first.championId,
    confidence: Math.max(0, Math.min(1, first.score)),
    lowConfidence,
    candidates: candidates.slice(0, Math.max(1, topN)).map((item) => ({
      championId: item.championId,
      score: item.score,
    })),
    margin,
  };
}

/**
 * 由粗筛命中直接构造候选（无精排时的降级路径）。
 *
 * @param hits 粗筛命中。
 * @param costGuess 费用先验。
 */
export function fuseFromCoarse(
  hits: CoarseHit[],
  costGuess: Cost | null,
): FusedCandidate[] {
  return fuseAll(
    hits.map((hit) => ({ ...hit, refinedScore: hit.score, matcher: 'ncc' as const })),
    costGuess,
  );
}
