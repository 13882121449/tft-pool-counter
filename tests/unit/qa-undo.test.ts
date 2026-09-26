/**
 * QA 审计 —— 撤销栈一致性（applyCorrection / clearSeat / markEliminated / reset）。
 *
 * 审计点：撤销必须让台账**完全**回到变更前状态（整体快照回滚策略），
 * 不能只回滚"张数"却留下状态位 / 扫描计数 / 槽位的残差。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import {
  applyCorrection,
  canUndo,
  countCopiesOf,
  createLedgerState,
  resetLedger,
  undoCorrection,
  type LedgerState,
} from '../../src/core/ledger/ledger-store';
import { UNDO_STACK_CAPACITY } from '../../src/shared/constants';
import { loadTestBaseline } from '../helpers/goldens';
import { QA_NOW } from '../helpers/qa-builders';

let baseline: PoolBaseline;
let championA: string;
let championB: string;

beforeAll(() => {
  baseline = loadTestBaseline();
  championA = baseline.champions.find((item) => item.cost === 1)!.id;
  championB = baseline.champions.filter((item) => item.cost === 1)[1]!.id;
});

/** 便于断言的台账指纹。 */
function fingerprint(state: LedgerState) {
  return state.ledgers.map((ledger) => ({
    seat: ledger.seat,
    status: ledger.status,
    scanCount: ledger.scanCount,
    lastScanAt: ledger.lastScanAt,
    slotCount: Object.keys(ledger.slots).length,
  }));
}

describe('撤销栈：整体回滚语义', () => {
  it('空栈时 undo 为 no-op', () => {
    const state = createLedgerState(QA_NOW);
    expect(canUndo(state)).toBe(false);
    expect(undoCorrection(state)).toBe(state);
  });

  it('set-copies 后撤销：完全回到变更前（槽位/状态/计数一致）', () => {
    const before = createLedgerState(QA_NOW);
    const after = applyCorrection(
      before,
      { kind: 'set-copies', championId: championA, seat: 1, value: 9 },
      baseline,
      { now: QA_NOW },
    );

    expect(countCopiesOf(after, championA, 1)).toBe(9);
    expect(fingerprint(after)).not.toEqual(fingerprint(before));

    const undone = undoCorrection(after);
    expect(fingerprint(undone)).toEqual(fingerprint(before));
    expect(countCopiesOf(undone, championA, 1)).toBe(0);
    expect(undone.updatedAt).toBe(before.updatedAt);
    expect(canUndo(undone)).toBe(false);
  });

  it('两步校正按 LIFO 逐步撤销', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 1, value: 5 },
      baseline,
      { now: QA_NOW },
    );
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championB, seat: 1, value: 3 },
      baseline,
      { now: QA_NOW },
    );
    expect(countCopiesOf(state, championA, 1)).toBe(5);
    expect(countCopiesOf(state, championB, 1)).toBe(3);
    expect(state.undo).toHaveLength(2);

    const step1 = undoCorrection(state);
    expect(countCopiesOf(step1, championA, 1)).toBe(5);
    expect(countCopiesOf(step1, championB, 1)).toBe(0);

    const step2 = undoCorrection(step1);
    expect(countCopiesOf(step2, championA, 1)).toBe(0);
    expect(countCopiesOf(step2, championB, 1)).toBe(0);
    expect(canUndo(step2)).toBe(false);
  });

  it('clear-seat 后撤销：状态位 / scanCount / 槽位全部还原', () => {
    const id = championA;
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 2, value: 3 },
      baseline,
      { now: QA_NOW },
    );

    const beforeClear = fingerprint(state);
    const cleared = applyCorrection(state, { kind: 'clear-seat', seat: 2 }, baseline, {
      now: QA_NOW + 1000,
    });
    expect(cleared.ledgers.find((ledger) => ledger.seat === 2)!.status).toBe('unscanned');
    expect(cleared.ledgers.find((ledger) => ledger.seat === 2)!.scanCount).toBe(0);

    const undone = undoCorrection(cleared);
    expect(fingerprint(undone)).toEqual(beforeClear);
    expect(countCopiesOf(undone, id, 2)).toBe(3);
  });

  it('mark-eliminated 后撤销：状态从 eliminated 还原为 scanned', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 4, value: 9 },
      baseline,
      { now: QA_NOW },
    );

    const eliminated = applyCorrection(state, { kind: 'mark-eliminated', seat: 4 }, baseline, {
      now: QA_NOW,
    });
    expect(eliminated.ledgers.find((ledger) => ledger.seat === 4)!.status).toBe('eliminated');
    expect(countCopiesOf(eliminated, championA, 4)).toBe(0);

    const undone = undoCorrection(eliminated);
    expect(undone.ledgers.find((ledger) => ledger.seat === 4)!.status).toBe('scanned');
    expect(countCopiesOf(undone, championA, 4)).toBe(9);
  });

  it('adjust-copies 后撤销：回到调整前的张数', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 5, value: 2 },
      baseline,
      { now: QA_NOW },
    );
    state = applyCorrection(
      state,
      { kind: 'adjust-copies', championId: championA, seat: 5, delta: 4 },
      baseline,
      { now: QA_NOW },
    );
    expect(countCopiesOf(state, championA, 5)).toBe(6);

    const undone = undoCorrection(state);
    expect(countCopiesOf(undone, championA, 5)).toBe(2);
  });

  it('撤销后再次校正：新变更正常入栈', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 6, value: 3 },
      baseline,
      { now: QA_NOW },
    );
    state = undoCorrection(state);
    expect(canUndo(state)).toBe(false);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 6, value: 7 },
      baseline,
      { now: QA_NOW },
    );
    expect(countCopiesOf(state, championA, 6)).toBe(7);
    expect(state.undo).toHaveLength(1);
  });

  it('trackUndo:false 的校正不入栈（供撤销自身 / 程序化迁移使用）', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 7, value: 3 },
      baseline,
      { now: QA_NOW, trackUndo: false },
    );
    expect(countCopiesOf(state, championA, 7)).toBe(3);
    expect(state.undo).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
  });

  it('未知指令 / 越界座位不改变状态', () => {
    const state = createLedgerState(QA_NOW);
    const unchanged = applyCorrection(
      state,
      { kind: 'set-lock', championId: championA, seat: 99 as never, locked: true },
      baseline,
      { now: QA_NOW },
    );
    expect(unchanged.ledgers).toEqual(state.ledgers);
  });

  it('撤销栈容量上限为 50，超出丢弃最旧', () => {
    expect(UNDO_STACK_CAPACITY).toBe(50);
    let state = createLedgerState(QA_NOW);
    for (let index = 0; index < 60; index += 1) {
      state = applyCorrection(
        state,
        { kind: 'set-copies', championId: championA, seat: 0, value: index + 1 },
        baseline,
        { now: QA_NOW + index },
      );
    }
    expect(state.undo).toHaveLength(UNDO_STACK_CAPACITY);
  });

  it('resetLedger 清空台账与撤销栈', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 1, value: 9 },
      baseline,
      { now: QA_NOW },
    );
    const reset = resetLedger(state, QA_NOW + 5000);

    expect(canUndo(reset)).toBe(false);
    expect(reset.history).toEqual([]);
    expect(countCopiesOf(reset, championA, 1)).toBe(0);
    for (const ledger of reset.ledgers) {
      expect(ledger.status).toBe('unscanned');
      expect(ledger.slots).toEqual({});
      expect(ledger.isSelf).toBe(ledger.seat === 0);
    }
    expect(reset.ledgers.map((ledger) => ledger.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('撤销不修改原状态对象（不可变性）', () => {
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 1, value: 9 },
      baseline,
      { now: QA_NOW },
    );
    const snapshotBeforeUndo = JSON.stringify(state.ledgers);
    undoCorrection(state);
    expect(JSON.stringify(state.ledgers)).toBe(snapshotBeforeUndo);
  });

  it('撤销不恢复 history 环形缓冲（当前实现：history 只增不减）', () => {
    // 记录当前行为，供审计报告判断是否需要产品确认。
    let state = createLedgerState(QA_NOW);
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 1, value: 9 },
      baseline,
      { now: QA_NOW },
    );
    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: championA, seat: 1, value: 3 },
      baseline,
      { now: QA_NOW + 1 },
    );
    const historyAfter = state.history.length;
    const undone = undoCorrection(state);
    // 仅断言"台账正确回滚"，history 长度按现状记录（不视为功能缺陷）
    expect(countCopiesOf(undone, championA, 1)).toBe(9);
    expect(undone.history.length).toBeGreaterThanOrEqual(historyAfter);
  });
});
