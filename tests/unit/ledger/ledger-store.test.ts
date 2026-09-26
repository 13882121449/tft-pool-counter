/**
 * 台账 reducer 单测。
 */

import { describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../../src/shared/types/domain';
import {
  applyCorrection,
  applyScan,
  canUndo,
  clearSeat,
  countCopiesOf,
  createLedgerState,
  instancesOf,
  locate,
  markEliminated,
  resetLedger,
  setCopies,
  setLock,
  undoCorrection,
} from '../../../src/core/ledger/ledger-store';
import {
  findFreeSlotIndex,
  listUnknownInstances,
  moveFromUnknown,
  resolveSeat,
  SEAT_CONFIDENCE_FLOOR,
} from '../../../src/core/ledger/player-identity';
import { HistoryStack, InstanceHistory } from '../../../src/core/ledger/history';
import { copiesToThreeStar, remainingTone, selectSeatDetail, selectWatchlist } from '../../../src/core/ledger/selectors';
import { computeRemaining } from '../../../src/core/pool-engine/compute-remaining';
import { freshState, loadTestBaseline, makeScan, obs } from '../../helpers/goldens';

const baseline: PoolBaseline = loadTestBaseline();
const T0 = 1_700_000_000_000;

describe('createLedgerState', () => {
  it('创建 9 个台账（8 家 + UNKNOWN 暂存区）', () => {
    const state = createLedgerState(0);
    expect(state.ledgers.length).toBe(9);
    expect(state.ledgers[0]?.isSelf).toBe(true);
    expect(state.ledgers[8]?.seat).toBe(8);
    expect(state.ledgers[1]?.isSelf).toBe(false);
  });

  it('初始状态为 unscanned 且无槽位', () => {
    const state = createLedgerState(0);
    expect(state.ledgers.every((ledger) => ledger.status === 'unscanned')).toBe(true);
    expect(state.ledgers.every((ledger) => Object.keys(ledger.slots).length === 0)).toBe(true);
  });
});

describe('applyScan', () => {
  it('写入目标座位并标记 scanned', () => {
    const state = applyScan(
      freshState(T0),
      makeScan(3, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'a'.repeat(16) })], {
        scanId: 's1',
        at: T0,
      }),
      baseline,
    );
    expect(state.ledgers[3]?.status).toBe('scanned');
    expect(state.ledgers[3]?.scanCount).toBe(1);
    expect(state.ledgers[3]?.slots['3|board|0']?.championId).toBe('veigar');
  });

  it('未知归属写入 UNKNOWN(8) 暂存区，绝不猜测', () => {
    const state = applyScan(
      freshState(T0),
      makeScan(8, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1 })], {
        scanId: 's-unknown',
        at: T0,
        method: 'unknown',
      }),
      baseline,
    );
    expect(state.ledgers[8]?.slots['8|board|0']).toBeDefined();
    expect(listUnknownInstances(state).length).toBe(1);
  });

  it('原状态不被修改（纯函数）', () => {
    const before = freshState(T0);
    const snapshot = JSON.stringify(before);
    applyScan(
      before,
      makeScan(0, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1 })], { scanId: 's2', at: T0 }),
      baseline,
    );
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('人工校正', () => {
  it('set-copies：设为指定张数，且不被自动扫描重复计入', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(
        3,
        [
          obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 2, fingerprint: 'b'.repeat(16) }),
        ],
        { scanId: 's3', at: T0 },
      ),
      baseline,
    );
    expect(countCopiesOf(state, 'ahri', 3)).toBe(3);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: 'ahri', seat: 3, value: 2 },
      baseline,
      { now: T0 + 1_000 },
    );

    const row = computeRemaining(state.ledgers, baseline, {}, { now: T0 + 1_000 }).find(
      (item) => item.championId === 'ahri',
    );
    // 人工值 2 覆盖自动值 3
    expect(row?.bySeat[3]).toBe(2);
    expect(row?.flags).toContain('MANUAL_OVERRIDE');
    expect(row?.locked).toBe(true);
  });

  it('adjust-copies：在原值上增减', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(2, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'c'.repeat(16) })], {
        scanId: 's4',
        at: T0,
      }),
      baseline,
    );
    expect(countCopiesOf(state, 'veigar', 2)).toBe(1);

    state = applyCorrection(state, { kind: 'adjust-copies', championId: 'veigar', seat: 2, delta: 2 }, baseline, {
      now: T0 + 1_000,
    });
    expect(countCopiesOf(state, 'veigar', 2)).toBe(3);

    state = applyCorrection(state, { kind: 'adjust-copies', championId: 'veigar', seat: 2, delta: -5 }, baseline, {
      now: T0 + 2_000,
    });
    expect(countCopiesOf(state, 'veigar', 2)).toBe(0);
  });

  it('set-copies 0 张 → 清空该家该弈子', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(4, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'd'.repeat(16) })], {
        scanId: 's5',
        at: T0,
      }),
      baseline,
    );
    state = applyCorrection(state, { kind: 'set-copies', championId: 'veigar', seat: 4, value: 0 }, baseline, {
      now: T0 + 1_000,
    });
    expect(instancesOf(state, 'veigar', 4).length).toBe(0);
  });

  it('锁定后自动扫描不覆盖用户值', () => {
    let state = applyCorrection(
      freshState(T0),
      { kind: 'set-copies', championId: 'ahri', seat: 5, value: 4, lock: true },
      baseline,
      { now: T0 },
    );
    state = applyScan(
      state,
      makeScan(5, [obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 3, fingerprint: 'e'.repeat(16) })], {
        scanId: 's6',
        at: T0 + 1_000,
      }),
      baseline,
    );
    expect(countCopiesOf(state, 'ahri', 5)).toBe(4);
  });

  it('set-lock 切换锁定状态', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(6, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'f'.repeat(16) })], {
        scanId: 's7',
        at: T0,
      }),
      baseline,
    );
    state = setLock(state, 'veigar', 6, true);
    expect(state.ledgers[6]?.slots['6|board|0']?.locked).toBe(true);
    state = setLock(state, 'veigar', 6, false);
    expect(state.ledgers[6]?.slots['6|board|0']?.locked).toBe(false);
  });
});

describe('撤销栈', () => {
  it('Ctrl+Z 回滚到校正前', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(1, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '1'.repeat(16) })], {
        scanId: 's8',
        at: T0,
      }),
      baseline,
    );
    const beforeUndo = countCopiesOf(state, 'veigar', 1);
    expect(beforeUndo).toBe(1);

    state = applyCorrection(state, { kind: 'adjust-copies', championId: 'veigar', seat: 1, delta: 5 }, baseline, {
      now: T0 + 1_000,
    });
    expect(countCopiesOf(state, 'veigar', 1)).toBe(6);
    expect(canUndo(state)).toBe(true);

    state = undoCorrection(state);
    expect(countCopiesOf(state, 'veigar', 1)).toBe(1);
    expect(canUndo(state)).toBe(false);
  });

  it('无可撤销内容时原样返回', () => {
    const state = freshState(0);
    expect(undoCorrection(state)).toBe(state);
    expect(canUndo(state)).toBe(false);
  });

  it('trackUndo=false 时不入栈', () => {
    const state = applyCorrection(
      freshState(T0),
      { kind: 'set-copies', championId: 'veigar', seat: 0, value: 3 },
      baseline,
      { now: T0, trackUndo: false },
    );
    expect(canUndo(state)).toBe(false);
  });
});

describe('clearSeat / markEliminated / reset', () => {
  it('clearSeat 清空该家并回到 unscanned', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(2, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 2, fingerprint: '2'.repeat(16) })], {
        scanId: 's9',
        at: T0,
      }),
      baseline,
    );
    state = clearSeat(state, 2, T0 + 1_000);
    expect(Object.keys(state.ledgers[2]?.slots ?? {}).length).toBe(0);
    expect(state.ledgers[2]?.status).toBe('unscanned');
    expect(state.ledgers[2]?.scanCount).toBe(0);
  });

  it('markEliminated 清空并标记 eliminated（引擎侧自动回池）', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(2, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 2, fingerprint: '3'.repeat(16) })], {
        scanId: 's10',
        at: T0,
      }),
      baseline,
    );
    const before = computeRemaining(state.ledgers, baseline, {}, { now: T0 }).find(
      (item) => item.championId === 'veigar',
    );
    expect(before?.observedCopies).toBe(3);

    state = markEliminated(state, 2, T0 + 1_000);
    const after = computeRemaining(state.ledgers, baseline, {}, { now: T0 + 1_000 }).find(
      (item) => item.championId === 'veigar',
    );
    expect(after?.observedCopies).toBe(0);
    expect(state.ledgers[2]?.status).toBe('eliminated');
  });

  it('通过指令 mark-eliminated 也能生效', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(7, [obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 1, fingerprint: '4'.repeat(16) })], {
        scanId: 's11',
        at: T0,
      }),
      baseline,
    );
    state = applyCorrection(state, { kind: 'mark-eliminated', seat: 7 }, baseline, { now: T0 + 1 });
    expect(state.ledgers[7]?.status).toBe('eliminated');
  });

  it('通过指令 clear-seat 也能生效', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(7, [obs({ zone: 'board', slotIndex: 0, championId: 'ahri', star: 1, fingerprint: '5'.repeat(16) })], {
        scanId: 's12',
        at: T0,
      }),
      baseline,
    );
    state = applyCorrection(state, { kind: 'clear-seat', seat: 7 }, baseline, { now: T0 + 1 });
    expect(Object.keys(state.ledgers[7]?.slots ?? {}).length).toBe(0);
  });

  it('resetLedger 清空全部台账与撤销栈', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(0, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '6'.repeat(16) })], {
        scanId: 's13',
        at: T0,
      }),
      baseline,
    );
    state = resetLedger(state, T0 + 1);
    expect(state.ledgers.every((ledger) => Object.keys(ledger.slots).length === 0)).toBe(true);
    expect(state.undo.length).toBe(0);
  });
});

describe('player-identity', () => {
  it('resolveSeat：合法高置信 → 该座位', () => {
    const state = freshState(0);
    expect(resolveSeat({ seat: 4, confidence: 0.9, method: 'scoreboard' }, state.ledgers)).toBe(4);
  });

  it('resolveSeat：unknown 方法 / UNKNOWN 座位 → 8', () => {
    const state = freshState(0);
    expect(resolveSeat({ seat: 4, confidence: 0.9, method: 'unknown' }, state.ledgers)).toBe(8);
    expect(resolveSeat({ seat: 8, confidence: 0.9, method: 'scoreboard' }, state.ledgers)).toBe(8);
  });

  it('resolveSeat：低置信 → 8（绝不猜测）', () => {
    const state = freshState(0);
    expect(resolveSeat({ seat: 4, confidence: SEAT_CONFIDENCE_FLOOR - 0.01, method: 'board-fingerprint' }, state.ledgers)).toBe(8);
  });

  it('resolveSeat：越界座位 → 8', () => {
    const state = freshState(0);
    expect(resolveSeat({ seat: 99 as 8, confidence: 1, method: 'manual' }, state.ledgers)).toBe(8);
  });

  it('moveFromUnknown 把暂存区实例搬到目标家', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(8, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1 })], {
        scanId: 's14',
        at: T0,
        method: 'unknown',
      }),
      baseline,
    );
    const instanceId = listUnknownInstances(state)[0]?.instanceId;
    expect(instanceId).toBeTruthy();

    state = moveFromUnknown(state, instanceId as string, 3, T0 + 1_000);
    expect(listUnknownInstances(state).length).toBe(0);
    expect(instancesOf(state, 'veigar', 3).length).toBe(1);
  });

  it('moveFromUnknown 对不存在的 id 安全返回', () => {
    const state = freshState(0);
    expect(moveFromUnknown(state, 'not-exist', 3, 0)).toBe(state);
  });

  it('通过指令 move-instance 搬移', () => {
    let state = applyScan(
      freshState(T0),
      makeScan(8, [obs({ zone: 'bench', slotIndex: 2, championId: 'ahri', star: 1 })], {
        scanId: 's15',
        at: T0,
        method: 'unknown',
      }),
      baseline,
    );
    const instanceId = listUnknownInstances(state)[0]?.instanceId as string;
    state = applyCorrection(state, { kind: 'move-instance', instanceId, toSeat: 6 }, baseline, { now: T0 + 1 });
    expect(instancesOf(state, 'ahri', 6).length).toBe(1);
  });

  it('findFreeSlotIndex 跳过已占用槽位', () => {
    let state = freshState(T0);
    state = applyScan(
      state,
      makeScan(
        0,
        [
          obs({ zone: 'bench', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: '7'.repeat(16) }),
          obs({ zone: 'bench', slotIndex: 1, championId: 'veigar', star: 1, fingerprint: '8'.repeat(16) }),
        ],
        { scanId: 's16', at: T0 },
      ),
      baseline,
    );
    expect(findFreeSlotIndex(state.ledgers[0] as NonNullable<typeof state.ledgers[0]>, 'bench')).toBe(2);
  });

  it('locate 可跨家定位实例', () => {
    let state = freshState(T0);
    state = applyScan(
      state,
      makeScan(5, [obs({ zone: 'board', slotIndex: 9, championId: 'veigar', star: 1, fingerprint: '9'.repeat(16) })], {
        scanId: 's17',
        at: T0,
      }),
      baseline,
    );
    const id = instancesOf(state, 'veigar', 5)[0]?.instanceId as string;
    expect(locate(state, id)?.ledger.seat).toBe(5);
  });
});

describe('history / undo 容器', () => {
  it('InstanceHistory 环形缓冲按容量淘汰最旧', () => {
    const history = new InstanceHistory(3);
    for (let i = 0; i < 5; i += 1) {
      history.push([
        {
          instanceId: `i-${i}`,
          championId: 'x',
          star: 1,
          copies: 1,
          seat: 0,
          zone: 'board',
          slotIndex: i,
          slotSpan: 1,
          confidence: 1,
          fingerprint: '0'.repeat(16),
          firstSeenAt: 0,
          lastSeenAt: 0,
          source: 'auto',
          locked: false,
        },
      ]);
    }
    expect(history.size()).toBe(3);
    expect(history.all().map((item) => item.instanceId)).toEqual(['i-2', 'i-3', 'i-4']);
    history.clear();
    expect(history.size()).toBe(0);
  });

  it('HistoryStack 栈语义与容量', () => {
    const stack = new HistoryStack<number>(2);
    expect(stack.canUndo()).toBe(false);
    expect(stack.undo()).toBeNull();
    stack.push({ kind: 'clear-seat', seat: 0 }, 1, 10);
    stack.push({ kind: 'clear-seat', seat: 1 }, 2, 20);
    stack.push({ kind: 'clear-seat', seat: 2 }, 3, 30);
    expect(stack.size()).toBe(2);
    expect(stack.undo()?.snapshot).toBe(3);
    expect(stack.entries().length).toBe(1);
    stack.clear();
    expect(stack.canUndo()).toBe(false);
  });
});

describe('selectors', () => {
  it('selectWatchlist 只返回关注的弈子', () => {
    let state = freshState(T0);
    state = applyScan(
      state,
      makeScan(0, [obs({ zone: 'board', slotIndex: 0, championId: 'veigar', star: 1, fingerprint: 'a1'.repeat(8) })], {
        scanId: 's18',
        at: T0,
      }),
      baseline,
    );
    const rows = selectWatchlist(state, ['veigar'], baseline, { now: T0 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.championId).toBe('veigar');
    expect(selectWatchlist(state, [], baseline, { now: T0 }).length).toBe(0);
  });

  it('selectSeatDetail 返回该家实例（按 slotIndex 排序）', () => {
    let state = freshState(T0);
    state = applyScan(
      state,
      makeScan(
        3,
        [
          obs({ zone: 'board', slotIndex: 5, championId: 'veigar', star: 1, fingerprint: 'b1'.repeat(8) }),
          obs({ zone: 'board', slotIndex: 1, championId: 'ahri', star: 1, fingerprint: 'b2'.repeat(8) }),
        ],
        { scanId: 's19', at: T0 },
      ),
      baseline,
    );
    const detail = selectSeatDetail(state, 3);
    expect(detail.map((item) => item.slotIndex)).toEqual([1, 5]);
    expect(selectSeatDetail(state, 99 as unknown as 0).length).toBe(0);
  });

  it('copiesToThreeStar 与 remainingTone', () => {
    const row = {
      championId: 'veigar',
      cost: 1 as const,
      poolTotal: 30,
      observedCopies: 5,
      remaining: 25,
      overflow: 0,
      remainingOptimistic: 25,
      remainingPessimistic: 25,
      bySeat: [5, 0, 0, 0, 0, 0, 0, 0],
      seatHasAny: [true, false, false, false, false, false, false, false],
      coveredSeats: [0, 1, 2, 3, 4, 5, 6, 7] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7>,
      confidence: 1,
      flags: [],
      locked: false,
      updatedAt: 0,
    };
    expect(copiesToThreeStar(row)).toBe(4);
    expect(remainingTone(row)).toBe('plenty');
    expect(remainingTone({ ...row, remaining: 8 })).toBe('enough');
    expect(remainingTone({ ...row, remaining: 2 })).toBe('low');
    expect(remainingTone({ ...row, remaining: 0 })).toBe('out');
  });
});

describe('setCopies 直接调用', () => {
  it('生成 source=manual 且位于保留槽位（不冲突真实棋盘格）', () => {
    const state = setCopies(freshState(T0), 'veigar', 2, 4, baseline, T0);
    const instance = instancesOf(state, 'veigar', 2)[0];
    expect(instance?.source).toBe('manual');
    expect(instance?.slotIndex).toBeGreaterThanOrEqual(1_000);
    // 4 张 → 最接近的不超过星级 = 2★（3 张），copies 直接取人工值
    expect(instance?.copies).toBe(4);
    expect(instance?.star).toBe(2);
  });

  it('对不存在的座位安全返回', () => {
    const state = freshState(0);
    expect(setCopies(state, 'veigar', 99 as unknown as 0, 3, baseline)).toBe(state);
  });
});
