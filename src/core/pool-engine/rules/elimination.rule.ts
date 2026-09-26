/**
 * 玩家淘汰回池规则。
 *
 * 玩家被淘汰后，其棋盘 + 备战席的全部弈子回到池中。
 * 台账层（ledger-store.markEliminated）已经清空了该 seat 的槽位，
 * 这里是引擎层的**二次兜底**：即使台账残留，也不会把已淘汰玩家的持有量算进消耗。
 */

import type { PoolRulePlugin, RuleContext } from './types';
import { recomputeAggregate } from './types';

/** 构造淘汰回池规则。 */
export function createEliminationRule(): PoolRulePlugin {
  return {
    id: 'elimination',
    order: 30,
    apply(ctx: RuleContext): void {
      if (ctx.eliminatedSeats.length === 0) {
        return;
      }
      const eliminated = new Set<number>(ctx.eliminatedSeats);

      for (const aggregate of ctx.aggregates.values()) {
        const kept = aggregate.instances.filter((instance) => !eliminated.has(instance.seat));
        // 已淘汰座位在 bySeat 中必须归零
        for (const seat of eliminated) {
          if (seat >= 0 && seat <= 7) {
            aggregate.bySeat[seat] = 0;
            aggregate.seatHasAny[seat] = false;
          }
        }
        if (kept.length !== aggregate.instances.length) {
          aggregate.instances = kept;
        }
        recomputeAggregate(aggregate);
      }
    },
  };
}

/** 默认实例。 */
export const eliminationRule: PoolRulePlugin = createEliminationRule();
