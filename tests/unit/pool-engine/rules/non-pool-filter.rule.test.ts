/**
 * non-pool-filter 规则单测（E5）。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline, UnitInstance } from '../../../../src/shared/types/domain';
import type { ChampionAggregate, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate } from '../../../../src/core/pool-engine/rules/types';
import { createNonPoolFilterRule } from '../../../../src/core/pool-engine/rules/non-pool-filter.rule';
import { createAggregate } from '../../../../src/core/pool-engine/instance-aggregator';
import { loadTestBaseline } from '../../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 构造一个实例。 */
function inst(championId: string, seat = 0, copies = 1): UnitInstance {
  return {
    instanceId: `i-${championId}-${seat}`,
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
    config: {
      perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
      lowCoverageThreshold: 5,
    },
    eliminatedSeats: [],
    now: 0,
    errors: [],
  };
}

describe('non-pool-filter', () => {
  it('剔除黑名单单位（召唤物/地形/小精灵）', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [
      inst(champion.id, 0, 2),
      inst('summon-azir-soldier', 1, 1),
      inst('event-wisp', 2, 1),
    ];
    recomputeAggregate(aggregate);
    expect(aggregate.observedCopies).toBe(4);

    const aggregates = new Map([[champion.id, aggregate]]);
    const ctx = makeContext(aggregates);
    createNonPoolFilterRule().apply(ctx);

    expect(aggregate.instances.length).toBe(1);
    expect(aggregate.observedCopies).toBe(2);
  });

  it('未知 championId 被剔除并产出 ENG_UNKNOWN_CHAMPION', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 1), inst('mystery-unit', 1, 5)];
    recomputeAggregate(aggregate);

    const aggregates = new Map([[champion.id, aggregate]]);
    const ctx = makeContext(aggregates);
    createNonPoolFilterRule().apply(ctx);

    expect(aggregate.instances.length).toBe(1);
    expect(ctx.errors.some((error) => error.code === 'ENG_UNKNOWN_CHAMPION')).toBe(true);
  });

  it('全部为合法单位时不产生任何变更与错误', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const second = baseline.champions[1] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 1), inst(second.id, 1, 3)];
    recomputeAggregate(aggregate);
    const before = aggregate.observedCopies;

    const ctx = makeContext(new Map([[champion.id, aggregate]]));
    createNonPoolFilterRule().apply(ctx);

    expect(aggregate.observedCopies).toBe(before);
    expect(ctx.errors.length).toBe(0);
  });

  it('可通过 options 注入自定义黑名单（单测友好）', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 1)];
    recomputeAggregate(aggregate);

    const ctx = makeContext(new Map([[champion.id, aggregate]]));
    createNonPoolFilterRule({ nonPoolUnitIds: new Set([champion.id]) }).apply(ctx);

    expect(aggregate.instances.length).toBe(0);
    expect(aggregate.observedCopies).toBe(0);
  });
});
