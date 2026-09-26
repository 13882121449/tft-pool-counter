/**
 * elimination 规则单测（玩家淘汰回池）。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline, UnitInstance } from '../../../../src/shared/types/domain';
import type { ChampionAggregate, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate } from '../../../../src/core/pool-engine/rules/types';
import { createEliminationRule } from '../../../../src/core/pool-engine/rules/elimination.rule';
import { createAggregate } from '../../../../src/core/pool-engine/instance-aggregator';
import { loadTestBaseline } from '../../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 构造实例。 */
function inst(championId: string, seat: number, copies = 1): UnitInstance {
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
function makeContext(
  aggregates: Map<string, ChampionAggregate>,
  eliminatedSeats: number[],
): RuleContext {
  return {
    baseline,
    championIndex: new Map(baseline.champions.map((c) => [c.id, c])),
    aggregates,
    ledgers: [],
    coverage: { scanned: 8, total: 8, seats: [0, 1, 2, 3, 4, 5, 6, 7], missing: [] },
    config: { perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, lowCoverageThreshold: 5 },
    eliminatedSeats: eliminatedSeats as RuleContext['eliminatedSeats'],
    now: 0,
    errors: [],
  };
}

describe('elimination（淘汰回池）', () => {
  it('被淘汰家的持有量归零，剩余回升', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 2), inst(champion.id, 3, 3)];
    recomputeAggregate(aggregate);
    expect(aggregate.observedCopies).toBe(5);

    createEliminationRule().apply(makeContext(new Map([[champion.id, aggregate]]), [3]));

    expect(aggregate.observedCopies).toBe(2);
    expect(aggregate.bySeat[3]).toBe(0);
    expect(aggregate.seatHasAny[3]).toBe(false);
    expect(aggregate.instances.length).toBe(1);
  });

  it('没有淘汰玩家时不做任何改动', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 2), inst(champion.id, 3, 3)];
    recomputeAggregate(aggregate);
    const before = aggregate.observedCopies;

    createEliminationRule().apply(makeContext(new Map([[champion.id, aggregate]]), []));

    expect(aggregate.observedCopies).toBe(before);
  });

  it('多家同时淘汰全部归零', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 1), inst(champion.id, 5, 1), inst(champion.id, 6, 1)];
    recomputeAggregate(aggregate);

    createEliminationRule().apply(makeContext(new Map([[champion.id, aggregate]]), [5, 6]));

    expect(aggregate.observedCopies).toBe(1);
    expect(aggregate.bySeat[5]).toBe(0);
    expect(aggregate.bySeat[6]).toBe(0);
  });
});
