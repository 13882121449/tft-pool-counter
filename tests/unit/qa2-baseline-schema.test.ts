/**
 * QA2 独立审计 —— baseline 数据契约一致性。
 *
 * 用**原始 JSON**（独立于 loader）交叉核对加载后的 `PoolBaseline`：
 *   a) 65 个弈子、id 唯一、无重复；
 *   b) 各费用档种类数（14/13/14/14/10）与声明值一致；
 *   c) 每个弈子 poolTotal == pool_size_by_cost[cost].copies_per_champion；
 *   d) tierTotal == copies_per_champion × distinct_champions；
 *   e) starCopyCost / setNumber / schemaVersion / confirmed 与原始文件一致；
 *   f) 特殊机制（elderdragon teamSlots=2、lux 共享池）元数据齐全；
 *   g) traits 与 traits_cn 一一对应；非池黑名单非空且不含任何弈子 id。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Cost, PoolBaseline } from '../../src/shared/types/domain';
import { loadTestBaseline, PROJECT_ROOT } from '../helpers/goldens';

interface RawChampion {
  id: string;
  name_en: string;
  name_cn: string;
  cost: Cost;
  traits: string[];
  traits_cn: Array<string | null>;
  pool_total: number;
  special?: { team_slots?: number; pool_copies_consumed?: number; shared_pool_note?: string };
}
interface RawBaseline {
  meta: { schema_version: string; set_number: number; CONFIRMED: boolean };
  pool_size_by_cost: Record<string, { copies_per_champion: number; distinct_champions: number; tier_total: number }>;
  star_copy_cost: Record<string, number>;
  champions: RawChampion[];
}

let baseline: PoolBaseline;
let raw: RawBaseline;
let rawNonPool: { units: Array<{ id: string }> };

beforeAll(() => {
  baseline = loadTestBaseline();
  raw = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'data', 'pool-baseline.json'), 'utf8')) as RawBaseline;
  rawNonPool = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'data', 'non-pool-units.json'), 'utf8'),
  ) as { units: Array<{ id: string }> };
});

const EXPECTED_DISTINCT: Record<Cost, number> = { 1: 14, 2: 13, 3: 14, 4: 14, 5: 10 };
const EXPECTED_POOL: Record<Cost, number> = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 };

describe('baseline：规模与唯一性', () => {
  it('恰好 65 个弈子，且 id 全局唯一', () => {
    expect(raw.champions).toHaveLength(65);
    expect(baseline.champions).toHaveLength(65);
    const ids = baseline.champions.map((c) => c.id);
    expect(new Set(ids).size).toBe(65);
    // loader 与原始 JSON 顺序 / id 一致
    expect(ids).toEqual(raw.champions.map((c) => c.id));
  });

  it('id 非空且形如 kebab/单词（无空白）', () => {
    for (const c of baseline.champions) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.id).toBe(c.id.trim());
      expect(/\s/.test(c.id)).toBe(false);
    }
  });
});

describe('baseline：费用档与池总数自洽', () => {
  it('各费用档种类数 = 14/13/14/14/10', () => {
    const byCost: Record<number, number> = {};
    for (const c of baseline.champions) {
      byCost[c.cost] = (byCost[c.cost] ?? 0) + 1;
    }
    expect(byCost).toEqual({ 1: 14, 2: 13, 3: 14, 4: 14, 5: 10 });
    // 与原始文件声明的 distinct_champions 一致
    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      expect(raw.pool_size_by_cost[String(cost)]!.distinct_champions).toBe(EXPECTED_DISTINCT[cost]);
    }
  });

  it('每个弈子 poolTotal == copies_per_champion（读数据非硬编码）', () => {
    for (const c of baseline.champions) {
      expect(c.poolTotal).toBe(EXPECTED_POOL[c.cost]);
      expect(c.poolTotal).toBe(raw.pool_size_by_cost[String(c.cost)]!.copies_per_champion);
    }
  });

  it('tierTotal == copies_per_champion × distinct_champions', () => {
    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      const tier = raw.pool_size_by_cost[String(cost)]!;
      expect(tier.tier_total).toBe(tier.copies_per_champion * tier.distinct_champions);
    }
  });

  it('星级换算表 = {1:1,2:3,3:9,4:9}', () => {
    expect(baseline.starCopyCost).toEqual({ 1: 1, 2: 3, 3: 9, 4: 9 });
    expect(baseline.starCopyCost[1]).toBe(raw.star_copy_cost['1']);
    expect(baseline.starCopyCost[3]).toBe(raw.star_copy_cost['3']);
  });
});

describe('baseline：元信息与特殊机制', () => {
  it('setNumber=18，schemaVersion=1.0，confirmed=false', () => {
    expect(baseline.meta.setNumber).toBe(18);
    expect(baseline.meta.setNumber).toBe(raw.meta.set_number);
    expect(baseline.meta.schemaVersion).toBe(raw.meta.schema_version);
    expect(baseline.meta.confirmed).toBe(false);
    expect(baseline.meta.confirmed).toBe(raw.meta.CONFIRMED);
  });

  it('elderdragon: teamSlots=2 / poolCopiesConsumed=1；lux: 共享池说明', () => {
    const dragon = baseline.champions.find((c) => c.id === 'elderdragon')!;
    expect(dragon.special?.teamSlots).toBe(2);
    expect(dragon.special?.poolCopiesConsumed).toBe(1);

    const lux = baseline.champions.find((c) => c.id === 'lux')!;
    expect(typeof lux.special?.sharedPoolNote).toBe('string');

    const specials = baseline.champions.filter((c) => c.special).map((c) => c.id).sort();
    expect(specials).toEqual(['elderdragon', 'lux']);
  });

  it('每个弈子 traits 与 traitsCn 一一对应，名称非空', () => {
    for (const c of baseline.champions) {
      expect(c.traits.length).toBe(c.traitsCn.length);
      expect(c.nameEn.length).toBeGreaterThan(0);
      expect(c.nameCn.length).toBeGreaterThan(0);
    }
  });
});

describe('baseline：非池黑名单', () => {
  it('黑名单非空，且与原始文件 units 数量一致', () => {
    expect(baseline.nonPoolUnitIds.length).toBeGreaterThan(0);
    expect(baseline.nonPoolUnitIds.length).toBe(rawNonPool.units.length);
  });

  it('黑名单中不含任何合法弈子 id（避免误伤）', () => {
    const championIds = new Set(baseline.champions.map((c) => c.id));
    for (const id of baseline.nonPoolUnitIds) {
      expect(championIds.has(id)).toBe(false);
    }
  });
});
