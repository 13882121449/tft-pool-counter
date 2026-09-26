/**
 * pHash 粗筛（ADR-02 第 4 步）：用汉明距离把 65×N 个模板砍到 Top-N。
 *
 * 这一层是**纯计算、纯 JS、零依赖**的，所以它永远可用 —— 即使 `sharp` 与
 * `opencv-js` 全都没装，粗筛仍能把候选收敛到 5 个以内，识别链路的
 * "最低可用形态"由它保证。
 */

import { hammingDistance } from '../../shared/math/hash';
import type { Cost } from '../../shared/types/domain';
import { COARSE_TOP_N } from '../../shared/constants';
import type { ChampionTemplate } from './template-store';

/** 粗筛命中项。 */
export interface CoarseHit {
  championId: string;
  cost: Cost;
  /** 模板在候选数组中的下标。 */
  templateIndex: number;
  /** pHash 汉明距离（0..64，越小越像）。 */
  distance: number;
  /** 归一化相似度 0..1（= 1 - distance / 64）。 */
  score: number;
  /** dHash 距离（辅助排序，缺省 64）。 */
  dHashDistance: number;
}

/** 粗筛参数。 */
export interface CoarseRankOptions {
  /** 取前 N 个，默认 `COARSE_TOP_N`(5)。 */
  topN?: number;
  /** 参与粗筛的模板；缺省 = 全部。 */
  templates?: ChampionTemplate[];
}

/**
 * 粗筛：按 pHash 汉明距离排序取 Top-N。
 *
 * 同分时用 dHash 距离决胜（更稳定），再同分则按 championId 字典序
 * 保证**结果确定性**（可单测、可复现）。
 *
 * @param pHash 观测格的 pHash。
 * @param dHash 观测格的 dHash。
 * @param templates 候选模板集合。
 * @param options 参数。
 * @returns 排序后的 Top-N。
 */
export function coarseRank(
  pHash: string,
  dHash: string,
  templates: ChampionTemplate[],
  options: CoarseRankOptions = {},
): CoarseHit[] {
  const topN = Math.max(1, options.topN ?? COARSE_TOP_N);
  const pool = options.templates ?? templates;

  const hits: CoarseHit[] = pool.map((template, templateIndex) => {
    const distance = hammingDistance(pHash, template.fingerprint);
    const dHashDistance = hammingDistance(dHash, template.dHash);
    return {
      championId: template.championId,
      cost: template.cost,
      templateIndex,
      distance,
      score: Math.max(0, 1 - distance / 64),
      dHashDistance,
    };
  });

  hits.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    if (a.dHashDistance !== b.dHashDistance) {
      return a.dHashDistance - b.dHashDistance;
    }
    return a.championId.localeCompare(b.championId);
  });

  return hits.slice(0, topN);
}

/**
 * 按费用先验剪枝后的候选模板集合。
 *
 * @param templates 全部模板。
 * @param costs 允许的费用档；空数组 = 不剪枝（unknown-cost-scan-all）。
 */
export function filterTemplatesByCost(
  templates: ChampionTemplate[],
  costs: readonly Cost[],
): ChampionTemplate[] {
  if (costs.length === 0) {
    return templates;
  }
  const allowed = new Set<number>(costs);
  const filtered = templates.filter((template) => allowed.has(template.cost));
  // 剪枝后为空说明费用先验与模板库不一致（尚未采集该费用档）→ 回退全量，绝不漏检
  return filtered.length > 0 ? filtered : templates;
}

/**
 * 把粗筛命中按 championId 合并（同一弈子多张模板取最优）。
 *
 * @param hits 粗筛命中。
 * @param limit 最多保留几个弈子。
 */
export function dedupeByChampion(hits: CoarseHit[], limit = COARSE_TOP_N): CoarseHit[] {
  const best = new Map<string, CoarseHit>();
  for (const hit of hits) {
    const current = best.get(hit.championId);
    if (current === undefined || hit.distance < current.distance) {
      best.set(hit.championId, hit);
    }
  }
  return [...best.values()]
    .sort((a, b) => a.distance - b.distance || a.championId.localeCompare(b.championId))
    .slice(0, Math.max(1, limit));
}
