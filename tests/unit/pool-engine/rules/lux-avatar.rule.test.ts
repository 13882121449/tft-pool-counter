/**
 * lux-avatar 规则单测（化身拉克丝共享卡池）。
 */

import { describe, expect, it } from 'vitest';
import type { Champion, PoolBaseline, UnitInstance } from '../../../../src/shared/types/domain';
import type { ChampionAggregate, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate } from '../../../../src/core/pool-engine/rules/types';
import {
  buildPoolGroupMap,
  createLuxAvatarRule,
  resolvePoolGroupId,
} from '../../../../src/core/pool-engine/rules/lux-avatar.rule';
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

describe('poolGroupId 解析', () => {
  it('拉克丝映射到共享分组 lux', () => {
    const lux = baseline.champions.find((item) => item.id === 'lux') as Champion;
    expect(resolvePoolGroupId(lux, baseline.champions)).toBe('lux');
  });

  it('普通弈子的分组等于自身 id', () => {
    const ahri = baseline.champions.find((item) => item.id === 'ahri') as Champion;
    expect(resolvePoolGroupId(ahri, baseline.champions)).toBe('ahri');
  });

  it('buildPoolGroupMap 为全部弈子建立映射', () => {
    const map = buildPoolGroupMap(baseline.champions);
    expect(map.size).toBe(baseline.champions.length);
    expect(map.get('lux')).toBe('lux');
  });
});

describe('lux-avatar（共享卡池）', () => {
  it('单一形态时保持原值（当前基线行为，规则幂等）', () => {
    const lux = baseline.champions.find((item) => item.id === 'lux') as Champion;
    const aggregate = createAggregate(lux, 'lux');
    aggregate.instances = [inst('lux', 0, 2), inst('lux', 1, 1)];
    recomputeAggregate(aggregate);

    createLuxAvatarRule().apply(makeContext(new Map([['lux', aggregate]])));

    expect(aggregate.observedCopies).toBe(3);
  });

  it('多形态时把同组消耗合计，各形态展示同一剩余数', () => {
    const lux = baseline.champions.find((item) => item.id === 'lux') as Champion;
    const formA: Champion = { ...lux, id: 'lux-dawn' };
    const formB: Champion = { ...lux, id: 'lux-dusk' };

    const aggA = createAggregate(formA, 'lux');
    aggA.instances = [inst('lux-dawn', 0, 2)];
    recomputeAggregate(aggA);

    const aggB = createAggregate(formB, 'lux');
    aggB.instances = [inst('lux-dusk', 1, 1)];
    recomputeAggregate(aggB);

    createLuxAvatarRule().apply(
      makeContext(
        new Map([
          ['lux-dawn', aggA],
          ['lux-dusk', aggB],
        ]),
      ),
    );

    expect(aggA.observedCopies).toBe(3);
    expect(aggB.observedCopies).toBe(3);
  });
});
