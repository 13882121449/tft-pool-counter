/**
 * 复制器超额规则（E3 / 算例 C）。
 *
 * 英雄复制器（妮蔻之助）可以在池为 0 时继续生成"额外副本"，
 * 导致观测消耗 > 池总数。此时：
 * - `remaining` clamp 到 0，**绝不显示负数**；
 * - `overflow = observed - poolTotal`，UI 显示「+N 复制器」；
 * - 打 `OVERFLOW_DUPLICATOR` 标记并产出一条非致命 `ENG_OVERFLOW` 错误。
 */

import type { PoolRulePlugin, RuleContext } from './types';
import { makeError } from '../../../shared/ipc/error-codes';

/** 构造复制器超额规则。 */
export function createDuplicatorOverflowRule(): PoolRulePlugin {
  return {
    id: 'duplicator-overflow',
    order: 50,
    apply(ctx: RuleContext): void {
      for (const aggregate of ctx.aggregates.values()) {
        if (aggregate.observedCopies <= aggregate.poolTotal) {
          aggregate.overflow = 0;
          aggregate.remaining = aggregate.poolTotal - aggregate.observedCopies;
          continue;
        }
        aggregate.overflow = aggregate.observedCopies - aggregate.poolTotal;
        aggregate.remaining = 0;
        if (!aggregate.flags.includes('OVERFLOW_DUPLICATOR')) {
          aggregate.flags.push('OVERFLOW_DUPLICATOR');
        }
        ctx.errors.push(
          makeError('ENG_OVERFLOW', {
            detail: {
              championId: aggregate.championId,
              observedCopies: aggregate.observedCopies,
              poolTotal: aggregate.poolTotal,
              overflow: aggregate.overflow,
            },
            at: ctx.now,
          }),
        );
      }
    },
  };
}

/** 默认实例。 */
export const duplicatorOverflowRule: PoolRulePlugin = createDuplicatorOverflowRule();
