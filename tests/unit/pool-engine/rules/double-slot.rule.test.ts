/**
 * double-slot 规则单测（E8 远古巨龙）。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline, UnitInstance } from '../../../../src/shared/types/domain';
import type { ChampionAggregate, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate } from '../../../../src/core/pool-engine/rules/types';
import { createDoubleSlotRule } from '../../../../src/core/pool-engine/rules/double-slot.rule';
import { createAggregate } from '../../../../src/core/pool-engine/instance-aggregator';
import { loadTestBaseline } from '../../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 取基线中的弈子定义。 */
function championOf(id: string) {
  const champion = baseline.champions.find((item) => item.id === id);
  if (!champion) {
    throw new Error(`基线中缺少 ${id}`);
  }
  return champion;
}

/** 构造实例。 */
function inst(
  championId: string,
  slotIndex: number,
  options: { seat?: number; star?: UnitInstance['star']; copies?: number; slotSpan?: number } = {},
): UnitInstance {
  return {
    instanceId: `i-${championId}-${slotIndex}-${options.seat ?? 0}`,
    championId,
    star: options.star ?? 1,
    copies: options.copies ?? 1,
    seat: (options.seat ?? 0) as UnitInstance['seat'],
    zone: 'board',
    slotIndex,
    slotSpan: options.slotSpan ?? 1,
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

describe('double-slot（远古巨龙）', () => {
  it('相邻槽位 + 同星级 → 合并为一个实例，只计 1 张', () => {
    const champion = championOf('elderdragon');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('elderdragon', 10), inst('elderdragon', 11)];
    recomputeAggregate(aggregate);
    expect(aggregate.observedCopies).toBe(2);

    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));

    expect(aggregate.instances.length).toBe(1);
    expect(aggregate.observedCopies).toBe(1);
  });

  it('2★ 巨龙仍按 3 张计（合并的是"实例数"，不是张数）', () => {
    const champion = championOf('elderdragon');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [
      inst('elderdragon', 10, { star: 2, copies: 3 }),
      inst('elderdragon', 11, { star: 2, copies: 3 }),
    ];
    recomputeAggregate(aggregate);
    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));
    expect(aggregate.observedCopies).toBe(3);
  });

  it('不相邻的两只各自独立计数', () => {
    const champion = championOf('elderdragon');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('elderdragon', 0), inst('elderdragon', 5)];
    recomputeAggregate(aggregate);
    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));
    expect(aggregate.observedCopies).toBe(2);
  });

  it('不同星级不合并（升星期间的中间态）', () => {
    const champion = championOf('elderdragon');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('elderdragon', 10, { star: 1 }), inst('elderdragon', 11, { star: 2, copies: 3 })];
    recomputeAggregate(aggregate);
    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));
    expect(aggregate.observedCopies).toBe(4);
  });

  it('普通弈子（teamSlots = 1）不受影响', () => {
    const champion = championOf('veigar');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('veigar', 10), inst('veigar', 11)];
    recomputeAggregate(aggregate);
    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));
    expect(aggregate.observedCopies).toBe(2);
  });

  it('不同家的巨龙不会被跨家合并', () => {
    const champion = championOf('elderdragon');
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst('elderdragon', 10, { seat: 0 }), inst('elderdragon', 11, { seat: 1 })];
    recomputeAggregate(aggregate);
    createDoubleSlotRule().apply(makeContext(new Map([[champion.id, aggregate]])));
    expect(aggregate.observedCopies).toBe(2);
  });
});
