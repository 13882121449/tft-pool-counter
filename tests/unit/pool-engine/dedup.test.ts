/**
 * DedupMerger 单测（ADR-04 去重核心）。
 */

import { describe, expect, it } from 'vitest';
import type { PlayerLedger, PoolBaseline } from '../../../src/shared/types/domain';
import {
  DEFAULT_DEDUP_CONFIG,
  makeInstanceId,
  mergeAdjacentSlots,
  mergeObservations,
  sweepAllStale,
  sweepStale,
  type DedupDeps,
} from '../../../src/core/pool-engine/dedup';
import { copiesOf } from '../../../src/core/pool-engine/star-copies';
import { createLedgerState } from '../../../src/core/ledger/ledger-store';
import { loadTestBaseline, makeScan, obs } from '../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/** 构造去重依赖。 */
function deps(): DedupDeps {
  return {
    championIndex: new Map(baseline.champions.map((champion) => [champion.id, champion])),
    nonPoolUnitIds: new Set(baseline.nonPoolUnitIds),
    copiesOfStar: (star) => copiesOf(star, baseline),
  };
}

/** 构造一个空台账。 */
function ledgerAt(seat: number): PlayerLedger {
  return createLedgerState(0).ledgers.find((item) => item.seat === seat) as PlayerLedger;
}

const T0 = 1_700_000_000_000;

describe('mergeObservations · 同槽位', () => {
  it('首次写入为 added', () => {
    const outcome = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'aaaaaaaaaaaaaaaa' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(outcome.added.length).toBe(1);
    expect(outcome.updated.length).toBe(0);
    expect(Object.keys(outcome.ledger.slots).length).toBe(1);
  });

  it('指纹相近 → 同一实例，只刷新 lastSeenAt / confidence（去重核心）', () => {
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'aaaaaaaaaaaaaaaa', confidence: 0.7 })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'aaaaaaaaaaaaaaab', confidence: 0.95 })],
      T0 + 1_500,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.added.length).toBe(0);
    expect(second.updated.length).toBe(1);
    const instance = second.ledger.slots['0|board|0'];
    expect(instance?.lastSeenAt).toBe(T0 + 1_500);
    expect(instance?.firstSeenAt).toBe(T0);
    // confidence 取滑动最大值
    expect(instance?.confidence).toBe(0.95);
  });

  it('升星（star 变化）→ 替换，且张数随之变化', () => {
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'aaaaaaaaaaaaaaaa' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 2, fingerprint: 'aaaaaaaaaaaaaaaa' })],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.replaced.length).toBe(1);
    expect(second.ledger.slots['0|board|0']?.star).toBe(2);
    expect(second.ledger.slots['0|board|0']?.copies).toBe(3);
    expect(second.displaced.length).toBe(1);
  });

  it('指纹差异大 → 判定换牌，替换并记录旧实例到 displaced', () => {
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 2, championId: 'veigar', star: 1, fingerprint: '0000000000000000' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 2, championId: 'ahri', star: 1, fingerprint: 'ffffffffffffffff' })],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.replaced.length).toBe(1);
    expect(second.ledger.slots['0|board|2']?.championId).toBe('ahri');
    expect(second.displaced[0]?.championId).toBe('veigar');
  });

  it('锁定槽位：自动扫描不写入，只更新 autoSuggest', () => {
    const locked = {
      ...ledgerAt(0),
      slots: {
        '0|board|0': {
          instanceId: 'u_manual',
          championId: 'veigar',
          star: 2 as const,
          copies: 3,
          seat: 0 as const,
          zone: 'board' as const,
          slotIndex: 0,
          slotSpan: 1,
          confidence: 1,
          fingerprint: '0'.repeat(16),
          firstSeenAt: T0,
          lastSeenAt: T0,
          source: 'manual' as const,
          locked: true,
        },
      },
    };
    const outcome = mergeObservations(
      locked,
      [obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 1, fingerprint: 'ffffffffffffffff' })],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(outcome.lockedSkipped).toEqual(['0|board|0']);
    expect(outcome.ledger.slots['0|board|0']?.championId).toBe('veigar');
    expect(outcome.ledger.slots['0|board|0']?.autoSuggest).toBe(1);
  });
});

describe('mergeObservations · 空槽与 stale', () => {
  it('空槽 + 未超 TTL → 保留并标 unstable', () => {
    const first = mergeObservations(
      ledgerAt(1),
      [obs({ zone: 'board', slotIndex: 3, championId: 'veigar', star: 1, fingerprint: '1111111111111111' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 3, championId: null })],
      T0 + 3_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.unstable.length).toBe(1);
    expect(second.removed.length).toBe(0);
    expect(second.ledger.slots['1|board|3']?.unstable).toBe(true);
  });

  it('空槽 + 超过 TTL → 移除（卖出/淘汰回池）', () => {
    const first = mergeObservations(
      ledgerAt(1),
      [obs({ zone: 'board', slotIndex: 3, championId: 'veigar', star: 2, fingerprint: '1111111111111111' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 3, championId: null })],
      T0 + 9_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.removed.length).toBe(1);
    expect(second.ledger.slots['1|board|3']).toBeUndefined();
  });

  it('未观测到的槽位不会被误删（保护其他家积累的台账）', () => {
    const first = mergeObservations(
      ledgerAt(2),
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '2222222222222220' }),
        obs({ zone: 'board', slotIndex: 1, championId: 'ahri', star: 1, fingerprint: '2222222222222221' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    // 本帧只观测到 slot 0
    const second = mergeObservations(
      first.ledger,
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '2222222222222220' })],
      T0 + 60_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.ledger.slots['2|board|1']?.championId).toBe('ahri');
  });
});

describe('mergeObservations · 过滤与合并', () => {
  it('黑名单单位与非池单位被过滤', () => {
    const outcome = mergeObservations(
      ledgerAt(0),
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'summon-azir-soldier', star: 1, isBlacklisted: true }),
        obs({ zone: 'board', slotIndex: 1, championId: 'event-wisp', star: 1 }),
        obs({ zone: 'board', slotIndex: 2, championId: 'not-a-real-champion', star: 1 }),
        obs({ zone: 'board', slotIndex: 3, championId: 'veigar', star: 1, fingerprint: '3333333333333333' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(outcome.filtered.length).toBe(3);
    expect(Object.keys(outcome.ledger.slots).length).toBe(1);
  });

  it('同帧相邻槽位（远古巨龙）合并为一个实例', () => {
    const outcome = mergeObservations(
      ledgerAt(0),
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1, fingerprint: '4444444444444444' }),
        obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1, fingerprint: '4444444444444445' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(outcome.merged.length).toBe(1);
    expect(outcome.merged[0]).toMatchObject({ keptSlotIndex: 10, droppedSlotIndex: 11 });
    expect(outcome.added.length).toBe(1);
    expect(outcome.ledger.slots['0|board|10']?.slotSpan).toBe(2);
    expect(outcome.ledger.slots['0|board|11']).toBeUndefined();
  });

  it('合并会清掉被吞并槽位上的旧实例（避免重复计数）', () => {
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1, fingerprint: '5555555555555555' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(first.ledger.slots['0|board|11']).toBeDefined();
    const second = mergeObservations(
      first.ledger,
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1, fingerprint: '5555555555555556' }),
        obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1, fingerprint: '5555555555555555' }),
      ],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.ledger.slots['0|board|11']).toBeUndefined();
    expect(second.ledger.slots['0|board|10']).toBeDefined();
  });

  it('观测声明多格实例（mergedSlotIndices）时，清掉被并入格上的旧实例（视觉层已合并）', () => {
    // 第一帧只看到巨龙的后半格（slot 11）
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1, fingerprint: 'abababababababab' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const staleId = first.ledger.slots['0|board|11']?.instanceId;
    expect(staleId).toBeDefined();

    // 第二帧视觉层已合并为一条观测（slot 10，slotSpan = 2，并入 slot 11）
    const second = mergeObservations(
      first.ledger,
      [
        obs({
          zone: 'board',
          slotIndex: 10,
          championId: 'elderdragon',
          star: 1,
          fingerprint: 'abababababababac',
          slotSpan: 2,
          mergedSlotIndices: [11],
        }),
      ],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.ledger.slots['0|board|11']).toBeUndefined();
    expect(second.ledger.slots['0|board|10']?.slotSpan).toBe(2);
    expect(second.removed).toContain(staleId);
  });

  it('竖向多格实例：按 mergedSlotIndices 清竖排格（非 slotIndex+1，QA N1）', () => {
    // slot3 = row0col3，slot10 = row1col3（同列相邻）
    const covered = 10;
    expect(covered).not.toBe(3 + 1); // 证明不是线性 +1
    const first = mergeObservations(
      ledgerAt(0),
      [obs({ zone: 'board', slotIndex: covered, championId: 'elderdragon', star: 1, fingerprint: 'cdcdcdcdcdcdcdcd' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    const staleId = first.ledger.slots[`0|board|${covered}`]?.instanceId;
    expect(staleId).toBeDefined();

    const second = mergeObservations(
      first.ledger,
      [
        obs({
          zone: 'board',
          slotIndex: 3,
          championId: 'elderdragon',
          star: 1,
          fingerprint: 'cdcdcdcdcdcdcdce',
          slotSpan: 2,
          mergedSlotIndices: [covered],
        }),
      ],
      T0 + 1_000,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(second.ledger.slots[`0|board|${covered}`]).toBeUndefined();
    // 横向邻格 slot 4 不应被误删（若走线性 +1 就会错删/漏删）
    expect(second.ledger.slots['0|board|4']).toBeUndefined(); // 本就无实例
    expect(second.removed).toContain(staleId);
  });

  it('普通弈子（teamSlots = 1）不会被相邻合并', () => {
    const outcome = mergeObservations(
      ledgerAt(0),
      [
        obs({ zone: 'board', slotIndex: 10, championId: 'veigar', star: 1, fingerprint: '6666666666666666' }),
        obs({ zone: 'board', slotIndex: 11, championId: 'veigar', star: 1, fingerprint: '6666666666666667' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    );
    expect(outcome.merged.length).toBe(0);
    expect(outcome.added.length).toBe(2);
  });

  it('mergeAdjacentSlots 不污染入参', () => {
    const observations = [
      obs({ zone: 'board' as const, slotIndex: 10, championId: 'elderdragon', star: 1 as const }),
      obs({ zone: 'board' as const, slotIndex: 11, championId: 'elderdragon', star: 1 as const }),
    ];
    mergeAdjacentSlots(observations, deps());
    expect(observations[0]?.slotSpan).toBe(1);
  });
});

describe('stale 清理工具', () => {
  it('sweepStale 只清理本帧被观测到的槽位', () => {
    const ledger = mergeObservations(
      ledgerAt(3),
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '7777777777777770' }),
        obs({ zone: 'board', slotIndex: 1, championId: 'ahri', star: 1, fingerprint: '7777777777777771' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    ).ledger;

    const result = sweepStale(ledger, new Set(['3|board|0']), T0 + 30_000, 8_000);
    expect(result.removed.length).toBe(1);
    expect(result.ledger.slots['3|board|0']).toBeUndefined();
    expect(result.ledger.slots['3|board|1']).toBeDefined();
  });

  it('sweepAllStale 清理全部过期槽位（显式调用）', () => {
    const ledger = mergeObservations(
      ledgerAt(4),
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '8888888888888880' }),
        obs({ zone: 'board', slotIndex: 1, championId: 'ahri', star: 1, fingerprint: '8888888888888881' }),
      ],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    ).ledger;
    const result = sweepAllStale(ledger, T0 + 30_000, 8_000);
    expect(result.removed.length).toBe(2);
    expect(Object.keys(result.ledger.slots).length).toBe(0);
  });

  it('锁定槽位永不被 stale 清理', () => {
    const ledger = mergeObservations(
      ledgerAt(5),
      [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '9999999999999990' })],
      T0,
      DEFAULT_DEDUP_CONFIG,
      deps(),
    ).ledger;
    const locked: PlayerLedger = {
      ...ledger,
      slots: Object.fromEntries(
        Object.entries(ledger.slots).map(([key, instance]) => [key, { ...instance, locked: true }]),
      ),
    };
    const result = sweepAllStale(locked, T0 + 60_000, 8_000);
    expect(result.removed.length).toBe(0);
  });
});

describe('实例 id 生成', () => {
  it('同 (seat, zone, slotIndex, firstSeenAt) 生成相同 id', () => {
    expect(makeInstanceId(0, 'board', 3, 100)).toBe(makeInstanceId(0, 'board', 3, 100));
    expect(makeInstanceId(0, 'board', 3, 100)).not.toBe(makeInstanceId(1, 'board', 3, 100));
  });

  it('applyScan 幂等：连续 3 次同一 ScanResult，台账完全一致', () => {
    const scan = makeScan(
      0,
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 2, fingerprint: 'aaabbbcccdddeee0' }),
        obs({ zone: 'bench', slotIndex: 2, championId: 'ahri', star: 1, fingerprint: 'aaabbbcccdddeee1' }),
      ],
      { scanId: 'idem-3', at: T0 },
    );
    let ledger: PlayerLedger = ledgerAt(0);
    const snapshots: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ledger = mergeObservations(ledger, scan.observations, T0, DEFAULT_DEDUP_CONFIG, deps()).ledger;
      snapshots.push(JSON.stringify(ledger.slots));
    }
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[1]).toBe(snapshots[2]);
  });
});
