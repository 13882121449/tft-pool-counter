/**
 * 规则注册表与引擎辅助模块单测。
 */

import { describe, expect, it } from 'vitest';
import type {
  AppError,
  Coverage,
  PoolBaseline,
  Seat,
  UnitInstance,
} from '../../../../src/shared/types/domain';
import type { ChampionAggregate, PoolRulePlugin, RuleContext } from '../../../../src/core/pool-engine/rules/types';
import { recomputeAggregate, refreshCopies } from '../../../../src/core/pool-engine/rules/types';
import { RuleRegistry } from '../../../../src/core/pool-engine/rules/registry';
import { createAggregate } from '../../../../src/core/pool-engine/instance-aggregator';
import { copiesOf, isStar, starFromCopies } from '../../../../src/core/pool-engine/star-copies';
import { computeCoverage, isSeatCovered, pessimisticRemaining, uncoveredSeatCount } from '../../../../src/core/pool-engine/coverage';
import { averageConfidence, confidenceOfChampion, uncertaintyFromCoverage } from '../../../../src/core/pool-engine/confidence';
import { resolveFlags } from '../../../../src/core/pool-engine/flags';
import { createLedgerState } from '../../../../src/core/ledger/ledger-store';
import { loadTestBaseline } from '../../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 构造实例。 */
function inst(championId: string, seat: number, copies = 1, star: UnitInstance['star'] = 1): UnitInstance {
  return {
    instanceId: `i-${championId}-${seat}`,
    championId,
    star,
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

describe('RuleRegistry', () => {
  it('按 order 升序执行', () => {
    const calls: string[] = [];
    const registry = new RuleRegistry();
    registry.registerAll([
      { id: 'c', order: 30, apply: () => calls.push('c') },
      { id: 'a', order: 10, apply: () => calls.push('a') },
      { id: 'b', order: 20, apply: () => calls.push('b') },
    ]);
    registry.runAll({
      baseline,
      championIndex: new Map(),
      aggregates: new Map<string, ChampionAggregate>(),
      ledgers: [],
      coverage: { scanned: 8, total: 8, seats: [], missing: [] },
      config: { perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, lowCoverageThreshold: 5 },
      eliminatedSeats: [],
      now: 0,
      errors: [],
    });
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('单个插件抛异常不中断整条链，转为 errors', () => {
    const errors: AppError[] = [];
    const boom: PoolRulePlugin = {
      id: 'boom',
      order: 10,
      apply: () => {
        throw new Error('kaboom');
      },
    };
    const ok: PoolRulePlugin = { id: 'ok', order: 20, apply: () => undefined };
    const registry = new RuleRegistry();
    registry.registerAll([boom, ok]);
    const ctx: RuleContext = {
      baseline,
      championIndex: new Map(),
      aggregates: new Map(),
      ledgers: [],
      coverage: { scanned: 8, total: 8, seats: [], missing: [] },
      config: { perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, lowCoverageThreshold: 5 },
      eliminatedSeats: [],
      now: 0,
      errors,
    };
    registry.runAll(ctx);
    expect(errors.length).toBe(1);
    expect(registry.list().map((plugin) => plugin.id)).toEqual(['boom', 'ok']);
  });

  it('unregister 可移除插件', () => {
    const registry = new RuleRegistry();
    registry.register({ id: 'x', order: 1, apply: () => undefined });
    expect(registry.list().length).toBe(1);
    registry.unregister('x');
    expect(registry.list().length).toBe(0);
  });
});

describe('star-copies', () => {
  it('换算表来自基线：1★=1、2★=3、3★=9、4★=9', () => {
    expect(copiesOf(1, baseline)).toBe(1);
    expect(copiesOf(2, baseline)).toBe(3);
    expect(copiesOf(3, baseline)).toBe(9);
    expect(copiesOf(4, baseline)).toBe(9);
  });

  it('基线缺字段时回退到默认表', () => {
    const broken = { ...baseline, starCopyCost: {} as PoolBaseline['starCopyCost'] };
    expect(copiesOf(3, broken)).toBe(9);
  });

  it('starFromCopies 取不超过 copies 的最大星级', () => {
    expect(starFromCopies(1, baseline)).toBe(1);
    expect(starFromCopies(3, baseline)).toBe(2);
    expect(starFromCopies(8, baseline)).toBe(2);
    expect(starFromCopies(9, baseline)).toBe(3);
    expect(starFromCopies(99, baseline)).toBe(4);
    expect(starFromCopies(0, baseline)).toBe(1);
  });

  it('isStar 校验星级合法性', () => {
    expect(isStar(1)).toBe(true);
    expect(isStar(4)).toBe(true);
    expect(isStar(5)).toBe(false);
    expect(isStar('2')).toBe(false);
  });

  it('refreshCopies 依基线重算实例张数', () => {
    const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
    const aggregate = createAggregate(champion, champion.id);
    aggregate.instances = [inst(champion.id, 0, 1, 2)];
    refreshCopies(aggregate, baseline);
    expect(aggregate.instances[0]?.copies).toBe(3);
    expect(aggregate.observedCopies).toBe(3);
  });
});

describe('coverage', () => {
  it('未扫描时覆盖率为 0/8', () => {
    const state = createLedgerState(0);
    const coverage = computeCoverage(state.ledgers);
    expect(coverage.scanned).toBe(0);
    expect(coverage.total).toBe(8);
    expect(coverage.missing.length).toBe(8);
    expect(uncoveredSeatCount(coverage)).toBe(8);
  });

  it('scanCount > 0 即视为已巡查', () => {
    const state = createLedgerState(0);
    const ledgers = state.ledgers.map((ledger) =>
      ledger.seat < 3 ? { ...ledger, scanCount: 1, status: 'scanned' as const } : ledger,
    );
    const coverage = computeCoverage(ledgers);
    expect(coverage.scanned).toBe(3);
    expect(coverage.seats).toEqual([0, 1, 2]);
    expect(coverage.missing).toEqual([3, 4, 5, 6, 7]);
  });

  it('被淘汰的家也算已覆盖（其持有量已知为 0）', () => {
    const state = createLedgerState(0);
    const ledgers = state.ledgers.map((ledger) =>
      ledger.seat === 5 ? { ...ledger, status: 'eliminated' as const } : ledger,
    );
    expect(isSeatCovered(ledgers[5])).toBe(true);
    expect(computeCoverage(ledgers).scanned).toBe(1);
  });

  it('isSeatCovered 对缺失台账返回 false', () => {
    expect(isSeatCovered(undefined)).toBe(false);
  });

  it('pessimisticRemaining 扣掉未巡查家的估计持有', () => {
    const coverage: Coverage = {
      scanned: 6,
      total: 8,
      seats: [0, 1, 2, 3, 4, 5] as Seat[],
      missing: [6, 7] as Seat[],
    };
    const config = { perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, lowCoverageThreshold: 5 };
    expect(pessimisticRemaining(1, coverage, config, 4)).toBe(0);
    expect(pessimisticRemaining(5, coverage, config, 4)).toBe(3);
    const full: Coverage = {
      scanned: 8,
      total: 8,
      seats: [0, 1, 2, 3, 4, 5, 6, 7] as Seat[],
      missing: [],
    };
    expect(pessimisticRemaining(3, full, config, 1)).toBe(3);
  });

  it('perSeatByCost 可按费用档配置', () => {
    const coverage = { scanned: 4, total: 8, seats: [], missing: [] };
    const config = { perSeatByCost: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, lowCoverageThreshold: 5 };
    expect(pessimisticRemaining(10, coverage, config, 5)).toBe(2);
  });
});

describe('confidence', () => {
  const fullCoverage = { scanned: 8, total: 8, seats: [], missing: [] };

  it('无实例时置信度只受覆盖率影响', () => {
    expect(confidenceOfChampion([], fullCoverage)).toBeCloseTo(1, 5);
  });

  it('取最弱实例的置信度（弱链优先）', () => {
    const instances = [inst('x', 0), { ...inst('x', 1), confidence: 0.5 }];
    expect(confidenceOfChampion(instances, fullCoverage)).toBeCloseTo(0.5, 5);
  });

  it('覆盖率越低置信度越低', () => {
    const half = { scanned: 4, total: 8, seats: [], missing: [] };
    expect(confidenceOfChampion([], half)).toBeLessThan(confidenceOfChampion([], fullCoverage));
  });

  it('uncertaintyFromCoverage 与未覆盖家数成正比', () => {
    expect(uncertaintyFromCoverage(fullCoverage)).toBe(0);
    expect(uncertaintyFromCoverage({ scanned: 6, total: 8, seats: [], missing: [] })).toBeCloseTo(0.25, 5);
  });

  it('averageConfidence 取均值，空数组返回 0', () => {
    expect(averageConfidence([1, 0.5])).toBeCloseTo(0.75, 5);
    expect(averageConfidence([])).toBe(0);
  });
});

describe('flags', () => {
  const champion = baseline.champions[0] as NonNullable<(typeof baseline.champions)[number]>;
  const coverage = { scanned: 8, total: 8, seats: [], missing: [] };
  const config = {
    perSeatByCost: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    lowCoverageThreshold: 5,
    lowConfidenceThreshold: 0.6,
    staleTtlMs: 8_000,
  };

  /** 构造聚合。 */
  function agg(): ChampionAggregate {
    return createAggregate(champion, champion.id);
  }

  it('超额 → OVERFLOW_DUPLICATOR', () => {
    const aggregate = agg();
    aggregate.overflow = 2;
    expect(resolveFlags({ aggregate, coverage, config, now: 0 })).toContain('OVERFLOW_DUPLICATOR');
  });

  it('覆盖率不足 → LOW_COVERAGE', () => {
    const aggregate = agg();
    expect(
      resolveFlags({
        aggregate,
        coverage: { scanned: 3, total: 8, seats: [], missing: [] },
        config,
        now: 0,
      }),
    ).toContain('LOW_COVERAGE');
  });

  it('低置信 → LOW_CONFIDENCE', () => {
    const aggregate = agg();
    aggregate.confidence = 0.3;
    expect(resolveFlags({ aggregate, coverage, config, now: 0 })).toContain('LOW_CONFIDENCE');
  });

  it('锁定 / 人工校正 → LOCKED / MANUAL_OVERRIDE', () => {
    const locked = agg();
    locked.locked = true;
    expect(resolveFlags({ aggregate: locked, coverage, config, now: 0 })).toContain('LOCKED');

    const manual = agg();
    manual.manualOverride = true;
    expect(resolveFlags({ aggregate: manual, coverage, config, now: 0 })).toContain('MANUAL_OVERRIDE');
  });

  it('超过 TTL 未再看到 → STALE', () => {
    const aggregate = agg();
    aggregate.latestSeenAt = 1_000;
    expect(resolveFlags({ aggregate, coverage, config, now: 20_000 })).toContain('STALE');
    expect(resolveFlags({ aggregate, coverage, config, now: 1_000 })).not.toContain('STALE');
  });

  it('UNKNOWN 暂存区有实例 → SEAT_UNKNOWN', () => {
    const aggregate = agg();
    aggregate.instances = [{ ...inst(champion.id, 0), seat: 8 }];
    expect(resolveFlags({ aggregate, coverage, config, now: 0 })).toContain('SEAT_UNKNOWN');
  });

  it('recomputeAggregate 回填人工覆盖值，且自动实例不重复计入', () => {
    const aggregate = agg();
    aggregate.manualOverrideBySeat[2] = 4;
    aggregate.instances = [inst(champion.id, 2, 9)];
    recomputeAggregate(aggregate);
    expect(aggregate.bySeat[2]).toBe(4);
    expect(aggregate.observedCopies).toBe(4);
    expect(aggregate.manualOverride).toBe(true);
  });
});
