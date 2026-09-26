/**
 * 牌库引擎主流程单测：算例 A/B/C + 三条关键正确性保证。
 *
 * 三条命门（ADR-04）：
 * 1. 幂等：同一 ScanResult 连续 applyScan 3 次，台账与剩余数完全不变；
 * 2. 卖回池：空槽 + 超 TTL → 剩余数回升；
 * 3. 双槽位弈子：同帧 2 个相邻槽位同一实例 → 只计 1 张。
 */

import { describe, expect, it } from 'vitest';
import type { AppError, PoolBaseline, RemainingResult } from '../../../src/shared/types/domain';
import { applyScan } from '../../../src/core/ledger/ledger-store';
import { computeRemaining } from '../../../src/core/pool-engine/compute-remaining';
import { selectRows } from '../../../src/core/ledger/selectors';
import {
  freshState,
  goldenToScan,
  loadGolden,
  loadTestBaseline,
  makeScan,
  obs,
  type GoldenCase,
} from '../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();

/**
 * 跑完一个 golden 算例的全部扫描。
 *
 * @param golden 算例。
 */
function runGolden(golden: GoldenCase) {
  let state = freshState(golden.baseTime);
  for (const scan of golden.scans) {
    state = applyScan(state, goldenToScan(scan, golden.baseTime), baseline);
  }
  return state;
}

describe('算例 A：维迦（1 费，继续追）', () => {
  const golden = loadGolden('case-a-veigar');
  const state = runGolden(golden);
  const rows = computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime });
  const row = rows.find((item) => item.championId === 'veigar');

  it('池总数来自数据文件（1 费 = 30），不是硬编码', () => {
    expect(baseline.poolSizeByCost[1].copiesPerChampion).toBe(30);
    expect(row?.poolTotal).toBe(30);
  });

  it('已观测消耗 = 5 + 1 + 3 + 2 = 11', () => {
    expect(row?.observedCopies).toBe(golden.expect.observedCopies);
  });

  it('剩余 = 30 − 11 = 19', () => {
    expect(row?.remaining).toBe(19);
    expect(row?.remainingOptimistic).toBe(19);
  });

  it('已巡查 8/8，悲观估计等于点估计', () => {
    const snapshot = row as RemainingResult;
    expect(snapshot.coveredSeats.length).toBe(8);
    expect(snapshot.remainingPessimistic).toBe(19);
  });

  it('各家持有分布 = [5,1,3,2,0,0,0,0]', () => {
    expect(row?.bySeat).toEqual([5, 1, 3, 2, 0, 0, 0, 0]);
    expect(row?.seatHasAny).toEqual([true, true, true, true, false, false, false, false]);
  });

  it('覆盖率充足，不打 LOW_COVERAGE / OVERFLOW 标记', () => {
    expect(row?.flags).not.toContain('LOW_COVERAGE');
    expect(row?.flags).not.toContain('OVERFLOW_DUPLICATOR');
  });
});

describe('算例 B：阿狸（4 费，立即止损）', () => {
  const golden = loadGolden('case-b-ahri');
  const state = runGolden(golden);
  const rows = computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime });
  const row = rows.find((item) => item.championId === 'ahri');

  it('池总数 10（4 费）', () => {
    expect(row?.poolTotal).toBe(10);
  });

  it('已观测消耗 = 4 + 3 + 2 = 9，剩余 1', () => {
    expect(row?.observedCopies).toBe(9);
    expect(row?.remaining).toBe(1);
    expect(row?.remainingOptimistic).toBe(1);
  });

  it('已巡查 6/8 → 悲观估计 = max(0, 1 − 2×1) = 0', () => {
    expect(row?.coveredSeats.length).toBe(6);
    expect(row?.remainingPessimistic).toBe(0);
  });

  it('各家持有分布 = [4,0,3,0,0,2,0,0]', () => {
    expect(row?.bySeat).toEqual([4, 0, 3, 0, 0, 2, 0, 0]);
  });

  it('剩余 1/10 属"low"档（红色告警区间）', () => {
    expect(row?.remaining).toBeLessThanOrEqual(2);
  });
});

describe('算例 B 回滚：卖回池（第 2 家卖掉 2★ 阿狸）', () => {
  const golden = loadGolden('case-b-ahri');
  const rollback = golden.rollback;
  if (!rollback) {
    throw new Error('golden 缺少 rollback 段');
  }
  let state = runGolden(golden);
  const before = computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime }).find(
    (item) => item.championId === 'ahri',
  );
  expect(before?.remaining).toBe(1);

  // 超过 TTL（8s）后再次扫描，该槽为空 → 判定卖出回池
  const later = golden.baseTime + rollback.advanceMs;
  state = applyScan(
    state,
    makeScan(
      rollback.seat as 0,
      [obs({ zone: rollback.emptyZone, slotIndex: rollback.emptySlotIndex, championId: null })],
      { scanId: rollback.scanId, at: later },
    ),
    baseline,
  );
  const after = computeRemaining(state.ledgers, baseline, {}, { now: later }).find(
    (item) => item.championId === 'ahri',
  );

  it('已观测消耗 9 → 6，剩余从 1 回升到 4（UI 显示 ↑3）', () => {
    expect(after?.observedCopies).toBe(6);
    expect(after?.remaining).toBe(4);
  });

  it('第 2 家台账归零', () => {
    expect(after?.bySeat).toEqual([4, 0, 0, 0, 0, 2, 0, 0]);
    expect(after?.seatHasAny[2]).toBe(false);
  });

  it('prevRemaining 记录了变化前的 1（供 UI 显示 ↑3）', () => {
    const withPrev = computeRemaining(state.ledgers, baseline, {}, {
      now: later,
      prevRows: [before as RemainingResult],
    }).find((item) => item.championId === 'ahri');
    expect(withPrev?.prevRemaining).toBe(1);
  });
});

describe('算例 C：复制器超额（边界）', () => {
  const golden = loadGolden('case-c-overflow');
  const state = runGolden(golden);
  const errors: AppError[] = [];
  const rows = computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime });
  const row = rows.find((item) => item.championId === 'ashe');

  it('池总数 9（5 费）', () => {
    expect(row?.poolTotal).toBe(9);
  });

  it('已观测 10 > 池 9 → overflow = 1，绝不显示负数', () => {
    expect(row?.observedCopies).toBe(10);
    expect(row?.overflow).toBe(1);
    expect(row?.remaining).toBe(0);
  });

  it('打上 OVERFLOW_DUPLICATOR 标记', () => {
    expect(row?.flags).toContain('OVERFLOW_DUPLICATOR');
  });

  it('覆盖率 1/8 → 同时打 LOW_COVERAGE 标记', () => {
    expect(row?.coveredSeats.length).toBe(1);
    expect(row?.flags).toContain('LOW_COVERAGE');
  });

  it('引擎产出 ENG_OVERFLOW 错误（不抛异常）', () => {
    computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime, errors });
    expect(errors.some((error) => error.code === 'ENG_OVERFLOW')).toBe(true);
  });
});

describe('关键正确性 ①：幂等', () => {
  it('同一 ScanResult 连续 applyScan 3 次，台账与剩余数完全不变', () => {
    const scan = makeScan(
      0,
      [
        obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 2, fingerprint: '1111111111111111' }),
        obs({ zone: 'bench', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '2222222222222222' }),
      ],
      { scanId: 'idem-1', at: 1_700_000_000_000 },
    );

    let state = freshState(1_700_000_000_000);
    state = applyScan(state, scan, baseline);
    const firstState = JSON.stringify(state.ledgers);
    const firstRows = JSON.stringify(
      computeRemaining(state.ledgers, baseline, {}, { now: 1_700_000_000_000 }),
    );

    state = applyScan(state, scan, baseline);
    state = applyScan(state, scan, baseline);

    expect(JSON.stringify(state.ledgers)).toBe(firstState);
    expect(
      JSON.stringify(computeRemaining(state.ledgers, baseline, {}, { now: 1_700_000_000_000 })),
    ).toBe(firstRows);
  });

  it('幂等语义下 scanCount 不因重复扫描而增长', () => {
    const scan = makeScan(3, [obs({ zone: 'board', slotIndex: 1, championId: 'ahri', star: 1 })], {
      scanId: 'idem-2',
      at: 1_700_000_000_000,
    });
    let state = freshState(0);
    state = applyScan(state, scan, baseline);
    state = applyScan(state, scan, baseline);
    expect(state.ledgers[3]?.scanCount).toBe(1);
  });
});

describe('关键正确性 ②：卖回池', () => {
  it('空槽未超 TTL 时保留（防抖动），超 TTL 后移除', () => {
    const t0 = 1_700_000_000_000;
    let state = freshState(t0);
    state = applyScan(
      state,
      makeScan(
        2,
        [obs({ zone: 'board', slotIndex: 4, championId: 'ahri', star: 2, fingerprint: 'abcdefabcdefabcd' })],
        { scanId: 'sell-1', at: t0 },
      ),
      baseline,
    );
    const before = computeRemaining(state.ledgers, baseline, {}, { now: t0 }).find(
      (item) => item.championId === 'ahri',
    );
    expect(before?.observedCopies).toBe(3);

    // 5s 后（< 8s TTL）扫描到空槽：保留，只是标记 unstable
    const t1 = t0 + 5_000;
    state = applyScan(
      state,
      makeScan(2, [obs({ zone: 'board', slotIndex: 4, championId: null })], {
        scanId: 'sell-2',
        at: t1,
      }),
      baseline,
    );
    const mid = computeRemaining(state.ledgers, baseline, {}, { now: t1 }).find(
      (item) => item.championId === 'ahri',
    );
    expect(mid?.observedCopies).toBe(3);
    expect(state.ledgers[2]?.slots['2|board|4']?.unstable).toBe(true);

    // 再过 5s（累计 10s > 8s TTL）扫描到空槽：移除，剩余回升
    const t2 = t0 + 10_000;
    state = applyScan(
      state,
      makeScan(2, [obs({ zone: 'board', slotIndex: 4, championId: null })], {
        scanId: 'sell-3',
        at: t2,
      }),
      baseline,
    );
    const after = computeRemaining(state.ledgers, baseline, {}, { now: t2 }).find(
      (item) => item.championId === 'ahri',
    );
    expect(after?.observedCopies).toBe(0);
    expect(after?.remaining).toBe(10);
  });
});

describe('关键正确性 ③：双槽位弈子（远古巨龙）', () => {
  it('同帧 2 个相邻槽位属于同一实例 → 只计 1 张', () => {
    // elderdragon: special.teamSlots = 2, poolCopiesConsumed = 1
    const dragon = baseline.champions.find((item) => item.id === 'elderdragon');
    expect(dragon?.special?.teamSlots).toBe(2);

    const t0 = 1_700_000_000_000;
    let state = freshState(t0);
    state = applyScan(
      state,
      makeScan(
        0,
        [
          obs({ zone: 'board', slotIndex: 10, championId: 'elderdragon', star: 1, fingerprint: 'dddddddddddddddd' }),
          obs({ zone: 'board', slotIndex: 11, championId: 'elderdragon', star: 1, fingerprint: 'ddddddddddddddde' }),
        ],
        { scanId: 'dragon-1', at: t0 },
      ),
      baseline,
    );

    const row = computeRemaining(state.ledgers, baseline, {}, { now: t0 }).find(
      (item) => item.championId === 'elderdragon',
    );
    expect(row?.observedCopies).toBe(1);
    expect(row?.remaining).toBe(8); // 池 9 − 1
  });

  it('引擎层兜底：台账里残留 2 个相邻实例时，double-slot 规则仍合并为 1 张', () => {
    const t0 = 1_700_000_000_000;
    let state = freshState(t0);
    // 两次分别落在**水平相邻**槽位（同属第 2 行 col5/col6；模拟去重未生效的极端情况）
    state = applyScan(
      state,
      makeScan(
        1,
        [obs({ zone: 'board', slotIndex: 19, championId: 'elderdragon', star: 1, fingerprint: 'eeeeeeeeeeeeeeee' })],
        { scanId: 'dragon-2a', at: t0 },
      ),
      baseline,
    );
    state = applyScan(
      state,
      makeScan(
        1,
        [obs({ zone: 'board', slotIndex: 20, championId: 'elderdragon', star: 1, fingerprint: 'eeeeeeeeeeeeeeef' })],
        { scanId: 'dragon-2b', at: t0 },
      ),
      baseline,
    );
    const row = computeRemaining(state.ledgers, baseline, {}, { now: t0 }).find(
      (item) => item.championId === 'elderdragon',
    );
    expect(row?.observedCopies).toBe(1);
  });

  it('不相邻的两只远古巨龙各自独立计数（不误并）', () => {
    const t0 = 1_700_000_000_000;
    let state = freshState(t0);
    state = applyScan(
      state,
      makeScan(
        1,
        [
          obs({ zone: 'board', slotIndex: 0, championId: 'elderdragon', star: 1, fingerprint: 'f000000000000000' }),
          obs({ zone: 'board', slotIndex: 5, championId: 'elderdragon', star: 1, fingerprint: 'f000000000000001' }),
        ],
        { scanId: 'dragon-3', at: t0 },
      ),
      baseline,
    );
    const row = computeRemaining(state.ledgers, baseline, {}, { now: t0 }).find(
      (item) => item.championId === 'elderdragon',
    );
    expect(row?.observedCopies).toBe(2);
  });
});

describe('引擎输出形态', () => {
  it('输出 65 行，顺序与 baseline.champions 一致', () => {
    const rows = computeRemaining(freshState(0).ledgers, baseline, {}, { now: 0 });
    expect(rows.length).toBe(baseline.champions.length);
    expect(rows.length).toBe(65);
    expect(rows.map((row) => row.championId)).toEqual(baseline.champions.map((c) => c.id));
  });

  it('未扫描任何一家时，所有行剩余 = 池总数，覆盖率 0/8', () => {
    const rows = computeRemaining(freshState(0).ledgers, baseline, {}, { now: 0 });
    for (const row of rows) {
      expect(row.observedCopies).toBe(0);
      expect(row.remaining).toBe(row.poolTotal);
    }
    expect(rows[0]?.coveredSeats.length).toBe(0);
    expect(rows[0]?.flags).toContain('LOW_COVERAGE');
  });

  it('selectRows 与 computeRemaining 口径一致', () => {
    const golden = loadGolden('case-a-veigar');
    const state = runGolden(golden);
    const viaSelector = selectRows(state, baseline, { now: golden.baseTime });
    const viaEngine = computeRemaining(state.ledgers, baseline, {}, { now: golden.baseTime });
    expect(viaSelector.find((row) => row.championId === 'veigar')?.remaining).toBe(
      viaEngine.find((row) => row.championId === 'veigar')?.remaining,
    );
  });
});
