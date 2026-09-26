/**
 * 羁绊索引：把基线里的 `champions[].traits` 反转成 `trait → 成员`。
 *
 * 纯函数，无副作用，便于在推荐流程里复用与单测。
 */

import type { Champion, Cost } from '../../shared/types/domain';

/** 羁绊成员（只保留推荐需要的字段）。 */
export interface TraitMember {
  id: string;
  cost: Cost;
}

/** 一个羁绊及其成员。 */
export interface TraitEntry {
  /** 英文 key。 */
  trait: string;
  /** 国服译名，基线缺译时为 null。 */
  nameCn: string | null;
  members: TraitMember[];
}

/**
 * 构建羁绊索引。
 *
 * 中文名从同羁绊的所有弈子里取第一个非 null 的 `traitsCn[i]` 补齐 ——
 * 基线里部分弈子的译名待核实（Q9），不能因为个别 null 就丢掉整个羁绊的译名。
 *
 * @param champions 基线弈子列表。
 * @param excluded 需要排除的弈子 id（如非池单位）。
 */
export function buildTraitIndex(
  champions: readonly Champion[],
  excluded: ReadonlySet<string> = new Set(),
): Map<string, TraitEntry> {
  const index = new Map<string, TraitEntry>();

  for (const champion of champions) {
    if (excluded.has(champion.id)) {
      continue;
    }
    for (let i = 0; i < champion.traits.length; i += 1) {
      const trait = champion.traits[i];
      if (trait === undefined || trait.length === 0) {
        continue;
      }
      const nameCn = champion.traitsCn[i] ?? null;
      const existing = index.get(trait);
      if (existing === undefined) {
        index.set(trait, {
          trait,
          nameCn,
          members: [{ id: champion.id, cost: champion.cost }],
        });
        continue;
      }
      if (existing.nameCn === null && nameCn !== null) {
        existing.nameCn = nameCn;
      }
      existing.members.push({ id: champion.id, cost: champion.cost });
    }
  }

  // 成员按费用降序：推荐时高费核心优先
  for (const entry of index.values()) {
    entry.members.sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id));
  }
  return index;
}

/**
 * 取某弈子的全部羁绊 key。
 *
 * @param championsById id → 弈子。
 * @param championId 弈子 id。
 */
export function traitsOf(
  championsById: ReadonlyMap<string, Champion>,
  championId: string,
): readonly string[] {
  return championsById.get(championId)?.traits ?? [];
}

/** 羁绊显示名：译名优先，缺失时回退英文 key。 */
export function traitLabel(entry: TraitEntry | undefined, trait: string): string {
  return entry?.nameCn ?? trait;
}
