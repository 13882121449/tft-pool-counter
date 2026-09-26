/**
 * 化身（拉克丝）共享卡池规则。
 *
 * 拉克丝只有一个共享池（S18 为 9 张）：无论商店里出现的是哪种形态，
 * 全形态共享同一池，必须按**单一弈子**计数，否则会重复计算消耗。
 *
 * 实现：把 `special.sharedPoolNote` 存在（或 id 属于同一形态前缀族）的
 * 弈子映射到同一个 `poolGroupId`，同组内所有成员的 `observedCopies`
 * 统一为组内总和 —— 于是每一种形态展示的剩余数都相同且正确。
 */

import type { Champion } from '../../../shared/types/domain';
import type { ChampionAggregate, PoolRulePlugin, RuleContext } from './types';

/**
 * 计算共享卡池分组 id。
 *
 * @param champion 弈子定义。
 * @param baselineChampions 全部弈子（用于找出同族形态）。
 */
export function resolvePoolGroupId(
  champion: Champion,
  baselineChampions: ReadonlyArray<Champion>,
): string {
  if (champion.special?.sharedPoolNote) {
    // 化身机制：形态名以基础 id 为前缀（lux、lux-dawn、lux-dusk …）
    const base = champion.id.split('-')[0] ?? champion.id;
    const family = baselineChampions.filter(
      (candidate) => candidate.id === base || candidate.id.startsWith(`${base}-`),
    );
    if (family.length > 0) {
      return base;
    }
    return base;
  }
  return champion.id;
}

/**
 * 建立 championId → poolGroupId 映射。
 *
 * @param champions 全部弈子。
 */
export function buildPoolGroupMap(champions: ReadonlyArray<Champion>): Map<string, string> {
  const map = new Map<string, string>();
  for (const champion of champions) {
    map.set(champion.id, resolvePoolGroupId(champion, champions));
  }
  return map;
}

/** 构造化身共享池规则。 */
export function createLuxAvatarRule(): PoolRulePlugin {
  return {
    id: 'lux-avatar',
    order: 40,
    apply(ctx: RuleContext): void {
      const groups = new Map<string, ChampionAggregate[]>();
      for (const aggregate of ctx.aggregates.values()) {
        const groupId = aggregate.poolGroupId;
        const bucket = groups.get(groupId);
        if (bucket) {
          bucket.push(aggregate);
        } else {
          groups.set(groupId, [aggregate]);
        }
      }

      for (const members of groups.values()) {
        if (members.length < 2) {
          // 只有一种形态：无需合并（当前基线即此情形，规则保持幂等）
          continue;
        }
        const total = members.reduce((sum, member) => sum + member.observedCopies, 0);
        for (const member of members) {
          member.observedCopies = total;
        }
      }
    },
  };
}

/** 默认实例。 */
export const luxAvatarRule: PoolRulePlugin = createLuxAvatarRule();
