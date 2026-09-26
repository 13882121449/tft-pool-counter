/**
 * 卡池基线加载与校验单测。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolBaseline } from '../../../src/shared/types/domain';
import {
  DEFAULT_NON_POOL_UNIT_IDS,
  getChampion,
  indexChampions,
  loadBaseline,
  loadBaselineOrThrow,
  normalizeChampion,
  normalizePoolSizeByCost,
  normalizeStarCopyCost,
} from '../../../src/core/baseline/load-baseline';
import {
  createSchemaValidator,
  isChampionList,
  looksLikeRawBaseline,
  validateBaseline,
} from '../../../src/core/baseline/validate-baseline';
import { BASELINE_PATH, PROJECT_ROOT, loadTestBaseline } from '../../helpers/goldens';

const rawText: string = readFileSync(BASELINE_PATH, 'utf8');
const raw: unknown = JSON.parse(rawText) as unknown;

describe('真实基线文件加载', () => {
  const result = loadBaseline(rawText);

  it('加载成功且无 error', () => {
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.baseline).not.toBeNull();
  });

  it('Set 18、65 个弈子', () => {
    expect(result.baseline?.meta.setNumber).toBe(18);
    expect(result.baseline?.champions.length).toBe(65);
  });

  it('池大小来自数据文件：1费30 / 2费25 / 3费18 / 4费10 / 5费9', () => {
    const pool = result.baseline?.poolSizeByCost;
    expect(pool?.[1].copiesPerChampion).toBe(30);
    expect(pool?.[2].copiesPerChampion).toBe(25);
    expect(pool?.[3].copiesPerChampion).toBe(18);
    expect(pool?.[4].copiesPerChampion).toBe(10);
    expect(pool?.[5].copiesPerChampion).toBe(9);
  });

  it('星级换算来自数据文件：1/3/9/9', () => {
    const table = result.baseline?.starCopyCost;
    expect(table?.[1]).toBe(1);
    expect(table?.[2]).toBe(3);
    expect(table?.[3]).toBe(9);
    expect(table?.[4]).toBe(9);
  });

  it('CONFIRMED=false → 产出 BASE_UNCONFIRMED 告警', () => {
    expect(result.warnings.some((warning) => warning.code === 'BASE_UNCONFIRMED')).toBe(true);
  });

  it('非池黑名单来自 data/non-pool-units.json（数据驱动）', () => {
    expect(DEFAULT_NON_POOL_UNIT_IDS.length).toBeGreaterThan(0);
    expect(result.baseline?.nonPoolUnitIds).toEqual(DEFAULT_NON_POOL_UNIT_IDS);
  });

  it('远古巨龙 special 字段正确归一化', () => {
    const dragon = getChampion(result.baseline as PoolBaseline, 'elderdragon');
    expect(dragon?.special?.teamSlots).toBe(2);
    expect(dragon?.special?.poolCopiesConsumed).toBe(1);
  });

  it('拉克丝 special.sharedPoolNote 被填充', () => {
    const lux = getChampion(result.baseline as PoolBaseline, 'lux');
    expect(typeof lux?.special?.sharedPoolNote).toBe('string');
  });
});

describe('校验失败路径', () => {
  it('非法 JSON 字符串 → BASE_INVALID_JSON', () => {
    const result = loadBaseline('{ 这不是 JSON');
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('BASE_INVALID_JSON');
  });

  it('非对象输入 → BASE_INVALID_JSON', () => {
    expect(validateBaseline(42).errors[0]?.code).toBe('BASE_INVALID_JSON');
    expect(validateBaseline(null).errors[0]?.code).toBe('BASE_INVALID_JSON');
  });

  it('缺少必填字段 → BASE_SCHEMA_FAIL', () => {
    const broken = { meta: { schema_version: '1.0', set_number: 18, patch: '18.1' } };
    expect(validateBaseline(broken).errors[0]?.code).toBe('BASE_SCHEMA_FAIL');
  });

  it('赛季号不匹配 → BASE_SET_MISMATCH（默认致命）', () => {
    const cloned = JSON.parse(rawText) as Record<string, unknown>;
    (cloned.meta as Record<string, unknown>).set_number = 17;
    const outcome = validateBaseline(cloned);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.some((error) => error.code === 'BASE_SET_MISMATCH')).toBe(true);
  });

  it('strictSet=false 时赛季号不匹配只告警', () => {
    const cloned = JSON.parse(rawText) as Record<string, unknown>;
    (cloned.meta as Record<string, unknown>).set_number = 17;
    const outcome = validateBaseline(cloned, { strictSet: false });
    expect(outcome.ok).toBe(true);
    expect(outcome.warnings.some((warning) => warning.code === 'BASE_SET_MISMATCH')).toBe(true);
  });

  it('champion id 重复 → BASE_SCHEMA_FAIL', () => {
    const cloned = JSON.parse(rawText) as { champions: Array<Record<string, unknown>> };
    cloned.champions[1] = { ...cloned.champions[0] };
    const outcome = validateBaseline(cloned);
    expect(outcome.errors.some((error) => error.code === 'BASE_SCHEMA_FAIL')).toBe(true);
  });

  it('pool_total 与费用档不一致 → 告警（以 champion.pool_total 为准）', () => {
    const cloned = JSON.parse(rawText) as { champions: Array<Record<string, unknown>> };
    (cloned.champions[0] as Record<string, unknown>).pool_total = 999;
    const outcome = validateBaseline(cloned);
    expect(outcome.warnings.length).toBeGreaterThan(0);
  });

  it('loadBaselineOrThrow 在致命错误时抛错', () => {
    const cloned = JSON.parse(rawText) as Record<string, unknown>;
    (cloned.meta as Record<string, unknown>).set_number = 99;
    expect(() => loadBaselineOrThrow(cloned)).toThrow();
  });

  it('自定义期望赛季号可注入', () => {
    expect(validateBaseline(raw, { supportedSetNumber: 18 }).ok).toBe(true);
    expect(validateBaseline(raw, { supportedSetNumber: 17 }).ok).toBe(false);
  });
});

describe('归一化函数', () => {
  it('normalizeChampion 补全缺失字段', () => {
    const champion = normalizeChampion({
      id: 'test',
      name_en: 'Test',
      name_cn: null,
      cost: 3,
      traits: ['A', 'B'],
      traits_cn: ['甲'],
      pool_total: 18,
    });
    expect(champion.nameCn).toBe('Test');
    expect(champion.cost).toBe(3);
    // traits_cn 长度不足时用 null 补齐
    expect(champion.traitsCn).toEqual([null, null]);
    expect(champion.confirmed).toBe(false);
  });

  it('normalizePoolSizeByCost 覆盖 1~5 费', () => {
    const table = normalizePoolSizeByCost({ 1: { copies_per_champion: 30, distinct_champions: 14 } });
    expect(Object.keys(table).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(table[1].copiesPerChampion).toBe(30);
    expect(table[5].copiesPerChampion).toBe(0);
  });

  it('normalizeStarCopyCost 缺字段时回退默认', () => {
    expect(normalizeStarCopyCost({})[3]).toBe(9);
    expect(normalizeStarCopyCost({ 3: 7 })[3]).toBe(7);
  });

  it('indexChampions / getChampion', () => {
    const baseline = loadTestBaseline();
    const index = indexChampions(baseline);
    expect(index.size).toBe(65);
    expect(getChampion(baseline, 'ahri')?.nameCn).toBe('阿狸');
    expect(getChampion(baseline, 'nope')).toBeUndefined();
  });
});

describe('类型守卫与 schema 校验器', () => {
  it('looksLikeRawBaseline', () => {
    expect(looksLikeRawBaseline(raw)).toBe(true);
    expect(looksLikeRawBaseline({})).toBe(false);
    expect(looksLikeRawBaseline(null)).toBe(false);
  });

  it('isChampionList', () => {
    expect(isChampionList([{ id: 'a' }])).toBe(true);
    expect(isChampionList([1, 2])).toBe(false);
  });

  it('createSchemaValidator 对真实文件通过', () => {
    const validate = createSchemaValidator();
    expect(validate(raw)).toBe(true);
  });

  it('基线 schema 文件本身存在', () => {
    const schemaPath = resolve(PROJECT_ROOT, 'data', 'pool-baseline.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    expect(schema).toBeTruthy();
  });
});
