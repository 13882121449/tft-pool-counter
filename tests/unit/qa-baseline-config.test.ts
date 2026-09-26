/**
 * QA 审计 —— 卡池基数可配置性 + 数据/schema 一致性。
 *
 * 审计点：
 * - 把基数换成备选预设 22/20/17/10/9 后，同一份台账的重算结果必须正确变化
 *   （若结果不变，说明某处硬编码了 30/25/18/10/9）；
 * - `data/pool-baseline.json` 必须能通过 `data/pool-baseline.schema.json`；
 * - 65 个弈子 id 唯一、费用档与池总数、各档弈子数与声明一致。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Cost, PoolBaseline } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { loadBaseline } from '../../src/core/baseline/load-baseline';
import { validateBaseline } from '../../src/core/baseline/validate-baseline';
import { copiesOf } from '../../src/core/pool-engine/star-copies';
import { loadTestBaseline, PROJECT_ROOT } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
let rawBaseline: Record<string, unknown>;

const ALL_SCANNED = [0, 1, 2, 3, 4, 5, 6, 7];

beforeAll(() => {
  baseline = loadTestBaseline();
  rawBaseline = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'data', 'pool-baseline.json'), 'utf8'),
  ) as Record<string, unknown>;
});

/** 用给定的每档基数重建一份基线。 */
function withPoolSizes(sizes: Record<Cost, number>): PoolBaseline {
  const clone = JSON.parse(JSON.stringify(rawBaseline)) as {
    pool_size_by_cost: Record<string, { copies_per_champion: number }>;
    champions: Array<{ cost: number; pool_total: number }>;
  };
  for (const [cost, size] of Object.entries(sizes)) {
    clone.pool_size_by_cost[cost].copies_per_champion = size;
  }
  for (const champion of clone.champions) {
    champion.pool_total = sizes[champion.cost as unknown as Cost];
  }
  const result = loadBaseline(clone);
  if (!result.ok || !result.baseline) {
    throw new Error(`重建基线失败：${JSON.stringify(result.errors)}`);
  }
  return result.baseline;
}

describe('卡池基数可配置（备选预设 22/20/17/10/9）', () => {
  it('同一份台账：30/25/18/10/9 → 剩余 28；22/20/17/10/9 → 剩余 20', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const ledgers = ledgersOf(
      [
        inst({ championId: id, seat: 0, star: 1, slotIndex: 0 }, baseline),
        inst({ championId: id, seat: 1, star: 1, slotIndex: 1 }, baseline),
      ],
      { scannedSeats: ALL_SCANNED },
    );

    const current = rowOf(computeRemaining(ledgers, baseline), id);
    const legacy = rowOf(computeRemaining(ledgers, withPoolSizes({ 1: 22, 2: 20, 3: 17, 4: 10, 5: 9 })), id);

    expect(current.poolTotal).toBe(30);
    expect(current.observedCopies).toBe(2);
    expect(current.remaining).toBe(28);

    expect(legacy.poolTotal).toBe(22);
    expect(legacy.observedCopies).toBe(2);
    expect(legacy.remaining).toBe(20);

    // 关键：结果必须随基数变化 —— 不变即说明被硬编码
    expect(legacy.remaining).not.toBe(current.remaining);
    expect(current.remaining - legacy.remaining).toBe(8);
  });

  it('基数调小后，原本不溢出的场景会正确变为溢出', () => {
    const id = baseline.champions.find((item) => item.cost === 1)!.id;
    const ledgers = ledgersOf(
      [0, 1, 2, 3, 4, 5, 6, 7].map((seat) =>
        inst({ championId: id, seat, star: 2, slotIndex: seat }, baseline),
      ),
      { scannedSeats: ALL_SCANNED },
    );
    // 8 家 × 2★(3 张) = 24 张
    const current = rowOf(computeRemaining(ledgers, baseline), id);
    expect(current.observedCopies).toBe(24);
    expect(current.remaining).toBe(6);
    expect(current.overflow).toBe(0);

    const tiny = rowOf(computeRemaining(ledgers, withPoolSizes({ 1: 22, 2: 20, 3: 17, 4: 10, 5: 9 })), id);
    expect(tiny.poolTotal).toBe(22);
    expect(tiny.remaining).toBe(0);
    expect(tiny.overflow).toBe(2);
    expect(tiny.flags).toContain('OVERFLOW_DUPLICATOR');
  });

  it('全部 65 行的 poolTotal 都随基数切换而改变（逐行验证无硬编码）', () => {
    const ledgers = ledgersOf([], { scannedSeats: ALL_SCANNED });
    const current = computeRemaining(ledgers, baseline);
    const legacy = computeRemaining(ledgers, withPoolSizes({ 1: 22, 2: 20, 3: 17, 4: 10, 5: 9 }));

    const expectTotal: Record<number, number> = { 1: 22, 2: 20, 3: 17, 4: 10, 5: 9 };
    // 备选预设只改 1/2/3 费档（4 费 10、5 费 9 与现行一致），
    // 因此只有前三档的 poolTotal 应当变化。
    const changedCosts = new Set([1, 2, 3]);
    expect(legacy).toHaveLength(65);
    for (let i = 0; i < current.length; i += 1) {
      const before = current[i]!;
      const after = legacy[i]!;
      expect(after.championId).toBe(before.championId);
      expect(after.poolTotal).toBe(expectTotal[before.cost]);
      if (changedCosts.has(before.cost)) {
        expect(after.poolTotal).not.toBe(before.poolTotal);
      }
      expect(after.remaining).toBe(after.poolTotal);
    }
  });

  it('星级换算表同样可配置：把 3★ 改成 27 后，一个 3★ 消耗 27 张', () => {
    const clone = JSON.parse(JSON.stringify(rawBaseline)) as {
      star_copy_cost: Record<string, number>;
    };
    clone.star_copy_cost['3'] = 27;
    const result = loadBaseline(clone);
    expect(result.ok).toBe(true);
    const tweaked = result.baseline!;

    expect(copiesOf(3, tweaked)).toBe(27);

    const id = tweaked.champions.find((item) => item.cost === 1)!.id;
    const rows = computeRemaining(
      ledgersOf([inst({ championId: id, seat: 0, star: 3 }, tweaked)], {
        scannedSeats: ALL_SCANNED,
      }),
      tweaked,
    );
    expect(rowOf(rows, id).observedCopies).toBe(27);
    expect(rowOf(rows, id).remaining).toBe(3);
  });
});

describe('data/pool-baseline.json 与 schema 的一致性', () => {
  it('真实数据文件能通过内置 JSON Schema 校验', () => {
    const outcome = validateBaseline(rawBaseline);
    expect(outcome.errors).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  it('65 个弈子，id 唯一非空', () => {
    const ids = baseline.champions.map((champion) => champion.id);
    expect(ids).toHaveLength(65);
    expect(new Set(ids).size).toBe(65);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('每个弈子的 poolTotal 与其费用档声明的 copies_per_champion 一致', () => {
    for (const champion of baseline.champions) {
      const declared = baseline.poolSizeByCost[champion.cost].copiesPerChampion;
      expect(champion.poolTotal).toBe(declared);
    }
  });

  it('各费用档弈子数量与 distinct_champions 声明一致（14/13/14/14/10）', () => {
    const actual: Record<string, number> = {};
    for (const champion of baseline.champions) {
      actual[String(champion.cost)] = (actual[String(champion.cost)] ?? 0) + 1;
    }
    expect(actual).toEqual({ 1: 14, 2: 13, 3: 14, 4: 14, 5: 10 });

    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      expect(baseline.poolSizeByCost[cost].distinctChampions).toBe(actual[String(cost)]);
    }
  });

  it('费用档池总数为 30/25/18/10/9，且 tierTotal 自洽', () => {
    expect(baseline.poolSizeByCost[1].copiesPerChampion).toBe(30);
    expect(baseline.poolSizeByCost[2].copiesPerChampion).toBe(25);
    expect(baseline.poolSizeByCost[3].copiesPerChampion).toBe(18);
    expect(baseline.poolSizeByCost[4].copiesPerChampion).toBe(10);
    expect(baseline.poolSizeByCost[5].copiesPerChampion).toBe(9);

    // tierTotal = copiesPerChampion × distinctChampions
    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      const entry = baseline.poolSizeByCost[cost];
      expect(entry.tierTotal).toBe(entry.copiesPerChampion * entry.distinctChampions);
    }
  });

  it('星级换算表为 {1:1,2:3,3:9,4:9}', () => {
    expect(baseline.starCopyCost).toEqual({ 1: 1, 2: 3, 3: 9, 4: 9 });
  });

  it('每个弈子的 cost 合法且 poolTotal ≥ 1', () => {
    for (const champion of baseline.champions) {
      expect([1, 2, 3, 4, 5]).toContain(champion.cost);
      expect(champion.poolTotal).toBeGreaterThanOrEqual(1);
      expect(champion.nameEn.length).toBeGreaterThan(0);
    }
  });

  it('非池单位黑名单非空且不含任何真实弈子 id', () => {
    const championIds = new Set(baseline.champions.map((champion) => champion.id));
    expect(baseline.nonPoolUnitIds.length).toBeGreaterThan(0);
    for (const id of baseline.nonPoolUnitIds) {
      expect(championIds.has(id)).toBe(false);
    }
  });

  it('基线尚未实测确认时，校验产出 BASE_UNCONFIRMED 告警（不阻断）', () => {
    const outcome = validateBaseline(rawBaseline);
    expect(outcome.ok).toBe(true);
    expect(outcome.warnings.some((warning) => warning.code === 'BASE_UNCONFIRMED')).toBe(true);
  });
});
