/**
 * duplicator-overflow 规则单测（算例 C）。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline, UnitInstance } from '../../../../src/shared/types/domain';
import type { ChampionAggregate, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate } from '../../../../src/core/pool-engine/rules/types';
import { createDuplicatorOverflowRule } from '../../../../src/core/pool-engine/rules/duplicator-overflow.rule';
import { createAggregate } from '../../../../src/core/pool-engine/instance-aggregator';
import { loadTestBaseline } from '../../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 构造实例。 */
function inst(championId: string, copies: number, seat = 0): UnitInstance {
  return {
    instanceId: `i-${championId}-${seat}-${copies}`,
    championId,
    star: 1,
    copies,
    seat: seat as UnitInstance['seat'],
    zone: 'board',
    slotIndex: seat,
    slotSpan: 1,
    confidence: 0.9,
    fingerprint: '0'.repeat(16),
    firstSeenAt: 0,
    lastSeenAt: 0,
    source: 'auto',
    locked: false,
  };
}

/** 构造上下文。 */
function makeContext(aggregates: Map<string, ChampionAggregate>): RuleContext {
  return {
    baseline,
    championIndex: new Map(baseline.champions.map((c) => [c.id, c])),
    aggregates,
    ledgers: [],
    coverage: { scanned: 8, total: 8, seats: [0, 1, 2, 3, 4, 5, 6, 7], missing: [] },
    config: { perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, lowCoverageThreshold: 5 },
    eliminatedSeats: [],
    now: 0,
    errors: [],
  };
}

describe('duplicator-overflow', () => {
  it('观测 > 池总数 → remaining=0、overflow=N、打标记 + 错误', () => {
    const champion = baseline.champions.find((item) => item.id === 'ashe');
    if (!champion) {
      throw new Error('基线缺少 ashe');
    }
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('ashe', 9), inst('ashe', 1, 1)];
    recomputeAggregate(aggregate);
    expect(aggregate.observedCopies).toBe(10);

    const ctx = makeContext(new Map([[champion.id, aggregate]]));
    createDuplicatorOverflowRule().apply(ctx);

    expect(aggregate.remaining).toBe(0);
    expect(aggregate.overflow).toBe(1);
    expect(aggregate.flags).toContain('OVERFLOW_DUPLICATOR');
    expect(ctx.errors.some((error) => error.code === 'ENG_OVERFLOW')).toBe(true);
  });

  it('观测 == 池总数 → remaining=0，无 overflow', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, champion.poolTotal)];
    recomputeAggregate(aggregate);

    const ctx = makeContext(new Map([[champion.id, aggregate]]));
    createDuplicatorOverflowRule().apply(ctx);

    expect(aggregate.remaining).toBe(0);
    expect(aggregate.overflow).toBe(0);
    expect(aggregate.flags).not.toContain('OVERFLOW_DUPLICATOR');
    expect(ctx.errors.length).toBe(0);
  });

  it('重复执行不清掉已设置的 overflow（幂等）', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, champion.poolTotal + 3)];
    recomputeAggregate(aggregate);

    const ctx = makeContext(new Map([[champion.id, aggregate]]));
    createDuplicatorOverflowRule().apply(ctx);
    createDuplicatorOverflowRule().apply(ctx);

    expect(aggregate.overflow).toBe(3);
    expect(aggregate.remaining).toBe(0);
  });
});
