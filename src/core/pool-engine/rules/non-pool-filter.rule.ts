/**
 * 非池单位过滤规则（E5）。
 *
 * 识别阶段已经过滤过一次，这里是引擎层的**二次兜底**：
 * 召唤物 / 地形单位 / 镜像 / 小精灵若被误判为弈子，会系统性高估消耗。
 * 同时把"不在基线名单里的未知 id"剔除并记 ENG_UNKNOWN_CHAMPION。
 */

import type { PoolRulePlugin, RuleContext } from './types';
import { recomputeAggregate } from './types';
import { makeError } from '../../../shared/ipc/error-codes';

/**
 * 构造非池过滤规则。
 *
 * @param options 可选覆盖（单测里注入更小的数据集）。
 */
export function createNonPoolFilterRule(
  options: { nonPoolUnitIds?: ReadonlySet<string> } = {},
): PoolRulePlugin {
  return {
    id: 'non-pool-filter',
    order: 10,
    apply(ctx: RuleContext): void {
      const blacklist =
        options.nonPoolUnitIds ?? new Set(ctx.baseline.nonPoolUnitIds ?? []);

      for (const aggregate of ctx.aggregates.values()) {
        const kept = aggregate.instances.filter((instance) => {
          if (blacklist.has(instance.championId)) {
            return false;
          }
          if (!ctx.championIndex.has(instance.championId)) {
            ctx.errors.push(
              makeError('ENG_UNKNOWN_CHAMPION', {
                detail: { championId: instance.championId, rule: 'non-pool-filter' },
                at: ctx.now,
              }),
            );
            return false;
          }
          return true;
        });

        if (kept.length !== aggregate.instances.length) {
          aggregate.instances = kept;
          recomputeAggregate(aggregate);
        }
      }
    },
  };
}

/** 默认实例。 */
export const nonPoolFilterRule: PoolRulePlugin = createNonPoolFilterRule();
