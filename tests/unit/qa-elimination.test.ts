/**
 * QA 审计 —— 玩家淘汰后单位回池语义（PRD RQ-14 / §2.3 规则表）。
 *
 * PRD 明确：**被淘汰玩家的棋盘 + 备战席全部回池**。
 * 因此淘汰后该家的持有量必须归零、剩余数必须回升 —— 这是本项目的
 * 核心规则之一，语义搞反会导致剩余数长期偏低。
 *
 * 同时验证台账层（markEliminated）与引擎层（elimination rule 兜底）
 * 两处都符合该语义。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { collectInstances } from '../../src/core/pool-engine/instance-aggregator';
import {
  applyCorrection,
  createLedgerState,
  markEliminated,
} from '../../src/core/ledger/ledger-store';
import { loadTestBaseline } from '../helpers/goldens';
import { inst, ledgersOf, QA_NOW, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
});

describe('淘汰 → 单位回池（PRD 语义正确性）', () => {
  it('台账层 markEliminated 清空槽位并置状态为 eliminated', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);

    state = applyCorrection(
      state,
      { kind: 'set-copies', championId: id, seat: 3, value: 9 },
      baseline,
      { now: QA_NOW },
    );
    expect(Object.keys(state.ledgers.find((ledger) => ledger.seat === 3)!.slots)).toHaveLength(1);

    state = applyCorrection(state, { kind: 'mark-eliminated', seat: 3 }, baseline, {
      now: QA_NOW,
    });

    const ledger = state.ledgers.find((item) => item.seat === 3)!;
    expect(ledger.status).toBe('eliminated');
    expect(ledger.slots).toEqual({});
  });

  it('淘汰后剩余数回升 9 张（3★ 回池）', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    // 未淘汰：seat 3 持有 3★（9 张）
    const before = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 3, star: 3 }, baseline)], {
          scannedSeats: ALL,
        }),
        baseline,
      ),
      id,
    );
    expect(before.observedCopies).toBe(9);
    expect(before.remaining).toBe(21);
    expect(before.bySeat[3]).toBe(9);

    // 淘汰后：其单位回池
    const after = rowOf(
      computeRemaining(
        ledgersOf([inst({ championId: id, seat: 3, star: 3 }, baseline)], {
          scannedSeats: ALL,
          eliminatedSeats: [3],
        }),
        baseline,
      ),
      id,
    );
    expect(after.observedCopies).toBe(0);
    expect(after.remaining).toBe(30);
    expect(after.bySeat[3]).toBe(0);
    expect(after.seatHasAny[3]).toBe(false);
  });

  it('多家中一家被淘汰：仅该家归零，其他家不受影响', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: id, seat: 1, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: id, seat: 2, star: 2, slotIndex: 1 }, baseline),
          inst({ championId: id, seat: 5, star: 1, slotIndex: 2 }, baseline),
        ],
        { scannedSeats: ALL, eliminatedSeats: [2] },
      ),
      baseline,
    );

    const row = rowOf(rows, id);
    expect(row.bySeat[1]).toBe(9);
    expect(row.bySeat[2]).toBe(0);
    expect(row.bySeat[5]).toBe(1);
    expect(row.observedCopies).toBe(10);
    expect(row.remaining).toBe(20);
  });

  it('引擎层兜底：台账残留已淘汰玩家的槽位，也不计入消耗', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;

    // dropEliminatedSlots:false —— 故意让"已淘汰家"的槽位残留，
    // 验证 elimination rule 的二次兜底真的生效。
    const ledgers = ledgersOf(
      [
        inst({ championId: id, seat: 3, star: 3, slotIndex: 0 }, baseline),
        inst({ championId: id, seat: 4, star: 1, slotIndex: 1 }, baseline),
      ],
      { scannedSeats: ALL, eliminatedSeats: [3], dropEliminatedSlots: false },
    );

    // 台账里确实残留了 seat 3 的实例
    const seat3 = ledgers.find((ledger) => ledger.seat === 3)!;
    expect(Object.keys(seat3.slots)).toHaveLength(1);

    const row = rowOf(computeRemaining(ledgers, baseline), id);
    expect(row.bySeat[3]).toBe(0);
    expect(row.observedCopies).toBe(1);
    expect(row.remaining).toBe(29);
  });

  it('collectInstances 直接跳过已淘汰家的实例', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const ledgers = ledgersOf(
      [inst({ championId: id, seat: 3, star: 3 }, baseline)],
      { scannedSeats: ALL, eliminatedSeats: [3], dropEliminatedSlots: false },
    );

    const collected = collectInstances(ledgers);
    expect(collected.size).toBe(0);
  });

  it('淘汰的家仍算作"已巡查"（其持有量已知为 0）', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 1 }, baseline)], {
        scannedSeats: [0],
        eliminatedSeats: [1, 2, 3, 4],
      }),
      baseline,
    );
    const row = rowOf(rows, id);
    // 已覆盖 = seat 0 + 4 个淘汰家 = 5 → 恰好达到 LOW_COVERAGE 阈值
    expect(row.coveredSeats).toHaveLength(5);
    expect(row.flags).not.toContain('LOW_COVERAGE');
    expect(row.remainingPessimistic).toBe(30 - 1 - 3 * 1);
  });

  it('8 家全部淘汰：全部单位回池，剩余 == 池总数', () => {
    const instances = baseline.champions.map((champion, index) =>
      inst({ championId: champion.id, seat: index % 8, star: 2, slotIndex: index }, baseline),
    );

    const rows = computeRemaining(
      ledgersOf(instances, { eliminatedSeats: ALL }),
      baseline,
    );

    for (const row of rows) {
      expect(row.observedCopies).toBe(0);
      expect(row.remaining).toBe(row.poolTotal);
      expect(row.bySeat.every((value) => value === 0)).toBe(true);
    }
  });

  it('markEliminated 清空的是槽位而非整个台账对象（isSelf / seat 保留）', () => {
    let state = createLedgerState(QA_NOW);
    state = markEliminated(state, 0, QA_NOW);
    const ledger = state.ledgers.find((item) => item.seat === 0)!;
    expect(ledger.seat).toBe(0);
    expect(ledger.isSelf).toBe(true);
    expect(ledger.status).toBe('eliminated');
    expect(ledger.slots).toEqual({});
  });
});
