/**
 * QA 审计 —— 非池单位过滤（E5：假人 / 召唤物 / 地形 / 镜像 / 妮蔻复制体）。
 *
 * 审计点：
 * - `data/non-pool-units.json` 里的每个 id 在**识别阶段（dedup）与引擎层**都被过滤；
 * - 被过滤的单位绝不影响任何一行的 observedCopies / remaining；
 * - 不在基线名单里的未知 id 会被剔除并产出 ENG_UNKNOWN_CHAMPION（而不是静默计入）。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppError, PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { aggregateInstances } from '../../src/core/pool-engine/instance-aggregator';
import { applyScan, createLedgerState } from '../../src/core/ledger/ledger-store';
import { loadTestBaseline, makeScan, PROJECT_ROOT } from '../helpers/goldens';
import { inst, ledgersOf, QA_NOW, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
let nonPoolIds: string[];
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
  const raw = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'data', 'non-pool-units.json'), 'utf8'),
  ) as { units: Array<{ id: string }> };
  nonPoolIds = raw.units.map((unit) => unit.id);
});

describe('非池单位黑名单数据', () => {
  it('黑名单非空，且与基线 nonPoolUnitIds 一致', () => {
    expect(nonPoolIds.length).toBe(10);
    expect(baseline.nonPoolUnitIds).toHaveLength(10);
    expect(new Set(baseline.nonPoolUnitIds)).toEqual(new Set(nonPoolIds));
  });

  it('黑名单覆盖召唤物 / 地形 / 特殊事件 / 镜像四类', () => {
    expect(nonPoolIds.some((id) => id.startsWith('summon-'))).toBe(true);
    expect(nonPoolIds.some((id) => id.startsWith('terrain-'))).toBe(true);
    expect(nonPoolIds.some((id) => id.startsWith('event-'))).toBe(true);
    expect(nonPoolIds.some((id) => id.startsWith('mirror-'))).toBe(true);
  });

  it('黑名单不含任何真实弈子 id', () => {
    const championIds = new Set(baseline.champions.map((champion) => champion.id));
    const overlap = nonPoolIds.filter((id) => championIds.has(id));
    expect(overlap).toEqual([]);
  });
});

describe('引擎层过滤：非池单位不参与计数', () => {
  it('把全部 10 个非池单位铺满全场，任何一行 observedCopies 都不受影响', () => {
    const before = computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline);

    const nonPoolInstances = nonPoolIds.flatMap((id, index) =>
      ALL.map((seat) =>
        inst({ championId: id, seat, star: 2, slotIndex: index * 10 + seat }, baseline),
      ),
    );
    const after = computeRemaining(
      ledgersOf(nonPoolInstances, { scannedSeats: ALL }),
      baseline,
    );

    expect(after).toHaveLength(65);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index]!.championId).toBe(before[index]!.championId);
      expect(after[index]!.observedCopies).toBe(before[index]!.observedCopies);
      expect(after[index]!.remaining).toBe(before[index]!.poolTotal);
    }
  });

  it('非池单位不会出现在输出行里（输出只含基线 65 个弈子）', () => {
    const rows = computeRemaining(
      ledgersOf(
        nonPoolIds.map((id, index) =>
          inst({ championId: id, seat: index % 8, star: 1, slotIndex: index }, baseline),
        ),
        { scannedSeats: ALL },
      ),
      baseline,
    );
    const ids = new Set(rows.map((row) => row.championId));
    for (const id of nonPoolIds) {
      expect(ids.has(id)).toBe(false);
    }
    expect(rows).toHaveLength(65);
  });

  it('混合场景：真实弈子 + 非池单位同场，只有真实弈子被计入', () => {
    const real = baseline.champions.find((item) => item.cost === 1)!.id;

    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: real, seat: 0, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: nonPoolIds[0]!, seat: 0, star: 3, slotIndex: 1 }, baseline),
          inst({ championId: nonPoolIds[1]!, seat: 1, star: 3, slotIndex: 2 }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );

    const row = rowOf(rows, real);
    expect(row.observedCopies).toBe(9);
    expect(row.remaining).toBe(21);
  });

  it('aggregateInstances 会为非池 id 建聚合，但规则链把它剔除', () => {
    const nonPool = nonPoolIds[0]!;
    const ledgers = ledgersOf([inst({ championId: nonPool, seat: 0, star: 1 }, baseline)], {
      scannedSeats: ALL,
    });

    // 聚合阶段确实存在该条目（识别阶段漏网时的兜底入口）
    const aggregates = aggregateInstances(ledgers, baseline, { now: QA_NOW });
    expect(aggregates.has(nonPool)).toBe(true);

    // 但经过规则链后不进入最终输出
    const errors: AppError[] = [];
    const rows = computeRemaining(ledgers, baseline, {}, { errors });
    expect(rows.some((row) => row.championId === nonPool)).toBe(false);
    // 黑名单命中先于"未知 id"判定 → 不应误报 ENG_UNKNOWN_CHAMPION
    expect(errors.some((error) => error.code === 'ENG_UNKNOWN_CHAMPION')).toBe(false);
  });
});

describe('识别阶段过滤（applyScan / dedup）', () => {
  it('非池单位观测在 applyScan 阶段即被丢弃，不写入台账', () => {
    let state = createLedgerState(QA_NOW);
    state = applyScan(
      state,
      makeScan(1, [
        { zone: 'board', slotIndex: 0, championId: nonPoolIds[0]! },
        { zone: 'board', slotIndex: 1, championId: nonPoolIds[1]! },
      ]),
      baseline,
    );

    const ledger = state.ledgers.find((item) => item.seat === 1)!;
    expect(Object.keys(ledger.slots)).toHaveLength(0);
  });

  it('isBlacklisted 标记为 true 的观测即使 id 合法也被丢弃', () => {
    const real = baseline.champions.find((item) => item.cost === 1)!.id;
    let state = createLedgerState(QA_NOW);
    state = applyScan(
      state,
      makeScan(2, [
        { zone: 'board', slotIndex: 0, championId: real, isBlacklisted: true },
        { zone: 'board', slotIndex: 1, championId: real, isBlacklisted: false },
      ]),
      baseline,
    );

    const ledger = state.ledgers.find((item) => item.seat === 2)!;
    expect(Object.keys(ledger.slots)).toHaveLength(1);
    expect(Object.keys(ledger.slots)[0]).toBe('2|board|1');
  });

  it('未知（不在基线名单）的 id 在 dedup 阶段被丢弃', () => {
    let state = createLedgerState(QA_NOW);
    state = applyScan(
      state,
      makeScan(3, [{ zone: 'board', slotIndex: 0, championId: 'not-a-real-champion' }]),
      baseline,
    );

    const ledger = state.ledgers.find((item) => item.seat === 3)!;
    expect(Object.keys(ledger.slots)).toHaveLength(0);
  });
});

describe('未知 id 兜底（引擎层二次防线）', () => {
  it('未知 id 被剔除并产出 ENG_UNKNOWN_CHAMPION 告警', () => {
    const errors: AppError[] = [];
    const rows = computeRemaining(
      ledgersOf([inst({ championId: 'ghost-champion', seat: 0, star: 1 }, baseline)], {
        scannedSeats: ALL,
      }),
      baseline,
      {},
      { errors },
    );

    expect(rows).toHaveLength(65);
    expect(errors.some((error) => error.code === 'ENG_UNKNOWN_CHAMPION')).toBe(true);
    const unknownError = errors.find((error) => error.code === 'ENG_UNKNOWN_CHAMPION')!;
    expect((unknownError.detail as { championId: string }).championId).toBe('ghost-champion');
  });

  it('未知 id 不污染任何真实弈子的剩余数', () => {
    const real = baseline.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'ghost-champion', seat: 0, star: 3, slotIndex: 0 }, baseline),
          inst({ championId: real, seat: 1, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, real).observedCopies).toBe(1);
    expect(rowOf(rows, real).remaining).toBe(29);
  });
});
