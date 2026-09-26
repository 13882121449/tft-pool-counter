/**
 * 引擎内部工具与边界路径单测（补齐覆盖率 + 锁定行为契约）。
 */

import { describe, expect, it } from 'vitest';
import type { AppError, PoolBaseline, UnitInstance } from '../../../src/shared/types/domain';
import {
  attachPrevRemaining,
  aggregateOfChampion,
  computeRemaining,
  createDefaultRegistry,
  resolveEstimateConfig,
} from '../../../src/core/pool-engine/compute-remaining';
import {
  applyCorrection,
  applyScan,
  createLedgerState,
} from '../../../src/core/ledger/ledger-store';
import { findInstance, moveFromUnknown } from '../../../src/core/ledger/player-identity';
import { remainingTone } from '../../../src/core/ledger/selectors';
import { loadTestBaseline, makeScan, obs } from '../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();
const T0 = 1_700_000_000_000;

/** 构造一个实例。 */
function inst(championId: string, seat = 0, copies = 1): UnitInstance {
  return {
    instanceId: `x-${championId}-${seat}`,
    championId,
    star: 1,
    copies,
    seat: seat as UnitInstance['seat'],
    zone: 'board',
    slotIndex: seat,
    slotSpan: 1,
    confidence: 0.9,
    fingerprint: '0'.repeat(16),
    firstSeenAt: T0,
    lastSeenAt: T0,
    source: 'auto',
    locked: false,
  };
}

describe('resolveEstimateConfig', () => {
  it('未传参时使用默认全档 1 张 / 家', () => {
    const config = resolveEstimateConfig();
    expect(config.perSeatByCost).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
    expect(config.lowCoverageThreshold).toBe(5);
    expect(config.lowConfidenceThreshold).toBe(0.6);
    expect(config.staleTtlMs).toBe(8_000);
  });

  it('局部覆盖时未指定的档位保持默认', () => {
    const config = resolveEstimateConfig({ perSeatByCost: { 5: 3 } as never });
    expect(config.perSeatByCost[5]).toBe(3);
    expect(config.perSeatByCost[1]).toBe(1);
  });
});

describe('createDefaultRegistry', () => {
  it('注册 5 个内置插件，顺序为 非池 → 双槽 → 淘汰 → 化身 → 超额', () => {
    const ids = createDefaultRegistry()
      .list()
      .map((plugin) => plugin.id);
    expect(ids).toEqual([
      'non-pool-filter',
      'double-slot',
      'elimination',
      'lux-avatar',
      'duplicator-overflow',
    ]);
  });
});

describe('aggregateOfChampion', () => {
  it('存在的弈子返回聚合，不存在的返回 null', () => {
    let state = createLedgerState(T0);
    state = { ...state, ledgers: state.ledgers };
    const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
    ledgers[0]!.slots['0|board|0'] = inst('veigar', 0, 3);

    expect(aggregateOfChampion(ledgers, baseline, 'veigar')?.observedCopies).toBe(3);
    expect(aggregateOfChampion(ledgers, baseline, 'definitely-not-here')).toBeNull();
  });
});

describe('attachPrevRemaining', () => {
  it('仅在数值变化时写入 prevRemaining', () => {
    const make = (remaining: number, championId = 'veigar') =>
      ({
        championId,
        cost: 1,
        poolTotal: 30,
        observedCopies: 30 - remaining,
        remaining,
        overflow: 0,
        remainingOptimistic: remaining,
        remainingPessimistic: remaining,
        bySeat: new Array(8).fill(0),
        seatHasAny: new Array(8).fill(false),
        coveredSeats: [],
        confidence: 1,
        flags: [],
        locked: false,
        updatedAt: 0,
      }) as never;

    const rows = [make(10, 'veigar'), make(5, 'ahri')];
    attachPrevRemaining(rows as never, [make(8, 'veigar'), make(5, 'ahri')] as never);
    // 变化了 → 记录旧值；没变化 → 不记录
    expect((rows[0] as unknown as { prevRemaining?: number }).prevRemaining).toBe(8);
    expect((rows[1] as unknown as { prevRemaining?: number }).prevRemaining).toBeUndefined();
  });
});

describe('未知弈子兜底', () => {
  it('台账里的未知 id 被过滤，不进入输出行并产出 ENG_UNKNOWN_CHAMPION', () => {
    const state = createLedgerState(T0);
    const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
    ledgers[0]!.slots['0|board|0'] = inst('ghost-unit', 0, 5);
    ledgers[0]!.status = 'scanned';
    ledgers[0]!.scanCount = 1;

    const errors: AppError[] = [];
    const rows = computeRemaining(ledgers, baseline, {}, { now: T0, errors });

    expect(rows.some((row) => row.championId === 'ghost-unit')).toBe(false);
    expect(errors.some((error) => error.code === 'ENG_UNKNOWN_CHAMPION')).toBe(true);
  });

  it('非池黑名单 id 同样被剔除', () => {
    const state = createLedgerState(T0);
    const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
    ledgers[1]!.slots['1|board|0'] = inst('event-wisp', 1, 2);
    const rows = computeRemaining(ledgers, baseline, {}, { now: T0 });
    const veigar = rows.find((row) => row.championId === 'veigar');
    // 未受影响：剩余仍为池总数
    expect(veigar?.remaining).toBe(30);
  });
});

describe('player-identity 边界', () => {
  it('findInstance 找不到时返回 null', () => {
    const state = createLedgerState(T0);
    expect(findInstance(state, 'nope')).toBeNull();
  });

  it('moveFromUnknown 目标等于当前座位时原样返回', () => {
    const state = createLedgerState(T0);
    const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
    ledgers[8]!.slots['8|board|0'] = inst('veigar', 8, 1);
    const withInstance = { ...state, ledgers };
    expect(moveFromUnknown(withInstance, 'x-veigar-8', 8, T0)).toBe(withInstance);
  });

  it('moveFromUnknown 目标座位不存在时原样返回', () => {
    const state = createLedgerState(T0);
    const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
    ledgers[8]!.slots['8|board|0'] = inst('veigar', 8, 1);
    const withInstance = { ...state, ledgers };
    expect(moveFromUnknown(withInstance, 'x-veigar-8', 99 as 0, T0)).toBe(withInstance);
  });
});

describe('selectors 边界', () => {
  it('poolTotal 为 0 时 remainingTone 归为 out', () => {
    const row = {
      championId: 'x',
      cost: 1 as const,
      poolTotal: 0,
      observedCopies: 0,
      remaining: 0,
      overflow: 0,
      remainingOptimistic: 0,
      remainingPessimistic: 0,
      bySeat: [0, 0, 0, 0, 0, 0, 0, 0],
      seatHasAny: [false, false, false, false, false, false, false, false],
      coveredSeats: [],
      confidence: 1,
      flags: [],
      locked: false,
      updatedAt: 0,
    };
    expect(remainingTone(row)).toBe('out');
  });
});

describe('applyScan 的人工校正屏蔽', () => {
  it('人工锁定后，该家该弈子的自动观测被丢弃', () => {
    let state = createLedgerState(T0);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: 'ahri', seat: 2, value: 2 },
      baseline,
      { now: T0 },
    );
    state = applyScan(
      state,
      makeScan(2, [obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 3 })], {
        scanId: 's-shield',
        at: T0 + 1_000,
      }),
      baseline,
    );
    // 只剩人工实例（2 张），自动的 9 张没有叠加进来
    expect(
      Object.values(state.ledgers[2]!.slots).reduce((sum, item) => sum + item.copies, 0),
    ).toBe(2);
  });
});
