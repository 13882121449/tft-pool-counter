/**
 * 阵容候选生成。
 *
 * 用启发式而非穷举：把「8 人口从 65 张牌里选」的组合爆炸问题，降维成
 * 「以若干条主线为种子，各自贪心挑人」，复杂度 O(羁绊数 × 人口 × 成员数)，
 * 单次计算在毫秒级，可以在每次扫描推送后实时重算。
 *
 * 两条生成策略：
 * 1. **以我已有为核心**（seedTrait = null）：优先保住我手上已经投了钱的牌；
 * 2. **以某个羁绊为核心**（seedTrait = trait）：围绕一条羁绊主线搭阵容。
 *
 * 挑人时除了「已有张数 / 可得性 / 费用」三项基础分，还叠加**与已选成员的羁绊重叠数**，
 * 让阵容自然收敛成「一两条主线 + 若干副羁绊」，而不是八张互不相干的牌。
 */

import type { Champion } from '../../shared/types/domain';
import type { ChampionAvailability } from './availability';
import type { TraitEntry } from './trait-index';

/** 一条尚未评分的阵容草案。 */
export interface LineupDraft {
  id: string;
  /** 核心羁绊；null 表示「以我已有牌为核心」。 */
  seedTrait: string | null;
  memberIds: string[];
}

/** compose 的输入。 */
export interface ComposeInput {
  champions: readonly Champion[];
  traitIndex: ReadonlyMap<string, TraitEntry>;
  availability: ReadonlyMap<string, ChampionAvailability>;
  /** 上阵人口（阵容人数上限）。 */
  population: number;
  /** 单条候选人数下限，低于此值不产出。 */
  minMembers?: number;
}

/** 基础优先级分：已有的 > 牌库剩得多的 > 高费的。 */
function priority(av: ChampionAvailability): number {
  return av.owned * 1.0 + av.ratio * 2.0 + av.cost * 0.4;
}

/**
 * 从候选池里贪心挑人。
 *
 * @param pool 候选池（已按需过滤）。
 * @param population 人数上限。
 * @param traitsByChampion championId → traits。
 */
function pickMembers(
  pool: readonly ChampionAvailability[],
  population: number,
  traitsByChampion: ReadonlyMap<string, readonly string[]>,
): string[] {
  const remaining = [...pool];
  const chosen: ChampionAvailability[] = [];
  const chosenTraitCount = new Map<string, number>();

  while (chosen.length < population && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (candidate === undefined) {
        continue;
      }
      let synergy = 0;
      if (chosen.length > 0) {
        const traits = traitsByChampion.get(candidate.championId) ?? [];
        for (const trait of traits) {
          synergy += (chosenTraitCount.get(trait) ?? 0) * 0.6;
        }
      }
      const score = priority(candidate) + synergy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const picked = remaining[bestIndex];
    if (picked === undefined) {
      break;
    }
    remaining.splice(bestIndex, 1);
    chosen.push(picked);
    for (const trait of traitsByChampion.get(picked.championId) ?? []) {
      chosenTraitCount.set(trait, (chosenTraitCount.get(trait) ?? 0) + 1);
    }
  }

  return chosen.map((entry) => entry.championId);
}

/**
 * 生成候选阵容。
 *
 * @param input 见 {@link ComposeInput}。
 */
export function composeLineups(input: ComposeInput): LineupDraft[] {
  const { champions, traitIndex, availability, population } = input;
  const minMembers = input.minMembers ?? 4;

  const traitsByChampion = new Map<string, readonly string[]>();
  for (const champion of champions) {
    traitsByChampion.set(champion.id, champion.traits);
  }

  const all = [...availability.values()];
  const drafts: LineupDraft[] = [];
  const seen = new Set<string>();

  const pushDraft = (seedTrait: string | null, memberIds: string[]): void => {
    if (memberIds.length < minMembers) {
      return;
    }
    const sorted = [...memberIds].sort();
    const id = sorted.join('+');
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    drafts.push({ id, seedTrait, memberIds });
  };

  // 策略 1：以我已有为核心（我一张牌都没有时不产出，否则会退化成「全局最优 8 张」）
  const ownedPool = all.filter((entry) => entry.owned > 0);
  if (ownedPool.length > 0) {
    const seeded = [...ownedPool];
    if (seeded.length < population) {
      const extra = all
        .filter((entry) => entry.owned === 0)
        .sort((a, b) => priority(b) - priority(a))
        .slice(0, population - seeded.length);
      seeded.push(...extra);
    }
    pushDraft(null, pickMembers(seeded, population, traitsByChampion));
  }

  // 策略 2：每条羁绊各出一条，成员不足时用全局高分牌补足
  const traitEntries = [...traitIndex.values()].sort((a, b) => a.trait.localeCompare(b.trait));
  for (const entry of traitEntries) {
    const members: ChampionAvailability[] = [];
    for (const member of entry.members) {
      const av = availability.get(member.id);
      if (av !== undefined) {
        members.push(av);
      }
    }
    if (members.length === 0) {
      continue;
    }

    const pool = [...members];
    if (pool.length < population) {
      const present = new Set(pool.map((item) => item.championId));
      const extra = all
        .filter((item) => !present.has(item.championId))
        .sort((a, b) => priority(b) - priority(a))
        .slice(0, population - pool.length);
      pool.push(...extra);
    }

    pushDraft(entry.trait, pickMembers(pool, population, traitsByChampion));
  }

  return drafts;
}

/** 兜底导出，供单测直接验证挑人策略。 */
export const __internals = { priority, pickMembers };
