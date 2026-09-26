/**
 * QA2 独立审计 —— 2.1 幂等端到端链路。
 *
 * 走**黑盒**路径：`ScanResult → applyScan → computeRemaining`，验证：
 *   a) 同一条扫描连续应用 3 次，剩余数逐字段不变（幂等）；
 *   b) 同一 scanId 不重复累加 scanCount；
 *   c) 同槽位换牌 → 旧弈子回池、新弈子入账（槽位覆盖语义）；
 *   d) applyScan 不修改入参（纯函数）；
 *   e) pipeline 契约：行数与顺序严格对齐 baseline.champions。
 *
 * 本文件为 independent 复核，不复用工程师测试与 T02 的断言。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { applyScan, createLedgerState } from '../../src/core/ledger/ledger-store';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { loadTestBaseline, makeScan, type ObsSpec } from '../helpers/goldens';

let baseline: PoolBaseline;
const ALL_SEATS = [0, 1, 2, 3, 4, 5, 6, 7];
const AT = 1_800_000_000_000;

beforeAll(() => {
  baseline = loadTestBaseline();
});

/** 取指定费用档的某个弈子 id（按索引）。 */
function idOfCost(cost: 1 | 2 | 3 | 4 | 5, index = 0): string {
  return baseline.champions.filter((c) => c.cost === cost)[index]!.id;
}

describe('2.1 幂等链路：ScanResult → ledger → 剩余数', () => {
  it('同一条扫描连续 apply 3 次：台账与剩余数逐字段不变', () => {
    const championId = idOfCost(2);
    const scan = makeScan(
      0,
      [
        { zone: 'board', slotIndex: 0, championId, star: 2, fingerprint: 'a'.repeat(16) },
        { zone: 'bench', slotIndex: 3, championId: idOfCost(5), star: 1 },
      ],
      { scanId: 'scan-idem-1', at: AT },
    );

    const s0 = createLedgerState(AT);
    const s1 = applyScan(s0, scan, baseline, { now: AT });
    const s2 = applyScan(s1, scan, baseline, { now: AT });
    const s3 = applyScan(s2, scan, baseline, { now: AT });

    // 台账（含槽位、状态）完全一致
    expect(JSON.stringify(s3.ledgers)).toBe(JSON.stringify(s1.ledgers));
    // scanCount 因同一 scanId 不累加
    expect(s1.ledgers[0]!.scanCount).toBe(1);
    expect(s3.ledgers[0]!.scanCount).toBe(1);

    const rows1 = computeRemaining(s1.ledgers, baseline, {}, { now: AT });
    const rows2 = computeRemaining(s2.ledgers, baseline, {}, { now: AT });
    const rows3 = computeRemaining(s3.ledgers, baseline, {}, { now: AT });
    expect(JSON.stringify(rows2)).toBe(JSON.stringify(rows1));
    expect(JSON.stringify(rows3)).toBe(JSON.stringify(rows1));

    // 2★ 消耗 3 张
    const row = rows1.find((r) => r.championId === championId)!;
    expect(row.observedCopies).toBe(3);
    expect(row.bySeat[0]).toBe(3);
  });

  it('不同 scanId 每次递增 scanCount（幂等只在同一 scanId 内成立）', () => {
    const scanA = makeScan(1, [{ zone: 'board', slotIndex: 0, championId: idOfCost(1), star: 1 }], {
      scanId: 'a',
      at: AT,
    });
    const scanB = makeScan(1, [{ zone: 'board', slotIndex: 0, championId: idOfCost(1), star: 1 }], {
      scanId: 'b',
      at: AT + 1000,
    });
    let state = createLedgerState(AT);
    state = applyScan(state, scanA, baseline, { now: AT });
    expect(state.ledgers[1]!.scanCount).toBe(1);
    state = applyScan(state, scanB, baseline, { now: AT + 1000 });
    expect(state.ledgers[1]!.scanCount).toBe(2);
  });

  it('同槽位换牌：旧弈子回池、新弈子入账（槽位覆盖，非累加）', () => {
    const oldId = idOfCost(1, 0);
    const newId = idOfCost(1, 1);
    expect(oldId).not.toBe(newId);

    const scanOld = makeScan(
      2,
      [{ zone: 'board', slotIndex: 5, championId: oldId, star: 1, fingerprint: 'b'.repeat(16) }],
      { scanId: 'swap-1', at: AT },
    );
    const scanNew = makeScan(
      2,
      [{ zone: 'board', slotIndex: 5, championId: newId, star: 1, fingerprint: 'c'.repeat(16) }],
      { scanId: 'swap-2', at: AT + 500 },
    );

    let state = createLedgerState(AT);
    state = applyScan(state, scanOld, baseline, { now: AT });
    expect(computeRemaining(state.ledgers, baseline).find((r) => r.championId === oldId)!.observedCopies).toBe(1);

    state = applyScan(state, scanNew, baseline, { now: AT + 500 });
    const rows = computeRemaining(state.ledgers, baseline);
    // 旧牌已被新牌覆盖 → 回池
    expect(rows.find((r) => r.championId === oldId)!.observedCopies).toBe(0);
    expect(rows.find((r) => r.championId === newId)!.observedCopies).toBe(1);
    // 该家该槽位只剩 1 个实例
    const slots = Object.keys(state.ledgers[2]!.slots);
    expect(slots).toHaveLength(1);
  });

  it('applyScan 是纯函数：不修改入参 state', () => {
    const scan = makeScan(3, [{ zone: 'board', slotIndex: 0, championId: idOfCost(3), star: 1 }], {
      scanId: 'pure-1',
      at: AT,
    });
    const state = createLedgerState(AT);
    const before = JSON.stringify(state);
    applyScan(state, scan, baseline, { now: AT });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('pipeline 契约：输出 65 行且顺序严格等于 baseline.champions', () => {
    const scan = makeScan(4, [{ zone: 'board', slotIndex: 0, championId: idOfCost(4), star: 1 }], {
      scanId: 'order-1',
      at: AT,
    });
    const state = applyScan(createLedgerState(AT), scan, baseline, { now: AT });
    const rows = computeRemaining(state.ledgers, baseline, {}, { now: AT });
    expect(rows).toHaveLength(baseline.champions.length);
    expect(rows.map((r) => r.championId)).toEqual(baseline.champions.map((c) => c.id));
  });

  it('applyScan 后 computeRemaining 的 bySeat 之和 == observedCopies', () => {
    const observations: ObsSpec[] = [
      { zone: 'board', slotIndex: 0, championId: idOfCost(1, 0), star: 1 },
      { zone: 'board', slotIndex: 1, championId: idOfCost(1, 0), star: 1 },
      { zone: 'board', slotIndex: 2, championId: idOfCost(1, 0), star: 1 },
    ];
    const state = applyScan(createLedgerState(AT), makeScan(5, observations, { at: AT }), baseline, {
      now: AT,
    });
    const rows = computeRemaining(state.ledgers, baseline, {}, { now: AT });
    for (const row of rows) {
      expect(row.bySeat.reduce((s, v) => s + v, 0)).toBe(row.observedCopies);
    }
    expect(ALL_SEATS).toHaveLength(8);
  });
});
