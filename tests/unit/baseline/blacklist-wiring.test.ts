/**
 * 非池单位黑名单的**接线回归护栏**（QA I2）。
 *
 * 问题原状：`data/pool-baseline.json` 里只有描述性的
 * `non_pool_units_blacklist.items`（中文句子），而 loader 读的是**并不存在**的
 * `non_pool_unit_ids` → 永远回退到 `data/non-pool-units.json`。
 * 也就是说"基线自带的那份黑名单"是死数据：改它没有任何效果，
 * 而 E5（召唤物被误计为弈子 → 系统性高估消耗）恰恰靠它兜底。
 *
 * 本文件锁死两件事：
 *   1. `resolveNonPoolUnitIds` 的优先级；
 *   2. 真实基线文件自带的 id 列表确实被 loader 采纳（改基线能生效），
 *      且与 `data/non-pool-units.json` 一一对应（防止两份数据悄悄漂移）。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NON_POOL_UNIT_IDS,
  loadBaseline,
  resolveNonPoolUnitIds,
} from '../../../src/core/baseline/load-baseline';
import type { RawBaseline } from '../../../src/core/baseline/validate-baseline';
import { BASELINE_PATH, PROJECT_ROOT } from '../../helpers/goldens';
import { resolve as resolvePath } from 'node:path';

/** 读真实基线文件原文与解析结果。 */
function rawBaselineText(): string {
  return readFileSync(BASELINE_PATH, 'utf8');
}

function rawBaselineObject(): RawBaseline {
  return JSON.parse(rawBaselineText()) as RawBaseline;
}

/** 读 data/non-pool-units.json。 */
function nonPoolUnitsFile(): { units: Array<{ id: string }> } {
  return JSON.parse(
    readFileSync(resolvePath(PROJECT_ROOT, 'data', 'non-pool-units.json'), 'utf8'),
  ) as { units: Array<{ id: string }> };
}

describe('resolveNonPoolUnitIds —— 优先级', () => {
  const base = rawBaselineObject();

  it('① 调用方注入优先于一切', () => {
    expect(resolveNonPoolUnitIds(base, ['custom-a'])).toEqual(['custom-a']);
  });

  it('② 基线内嵌 non_pool_units_blacklist.non_pool_unit_ids 被采纳', () => {
    const typed = {
      ...base,
      non_pool_units_blacklist: { items: ['描述文字'], non_pool_unit_ids: ['nested-a', 'nested-b'] },
    } as RawBaseline;
    expect(resolveNonPoolUnitIds(typed)).toEqual(['nested-a', 'nested-b']);
  });

  it('③ 兼容顶层 non_pool_unit_ids（旧数据形状）', () => {
    const typed = {
      ...base,
      non_pool_units_blacklist: undefined,
      non_pool_unit_ids: ['top-a'],
    } as RawBaseline;
    expect(resolveNonPoolUnitIds(typed)).toEqual(['top-a']);
  });

  it('④ 两者都没有时回退到内置兜底', () => {
    const typed = { ...base, non_pool_units_blacklist: undefined } as RawBaseline;
    delete typed.non_pool_unit_ids;
    expect(resolveNonPoolUnitIds(typed)).toEqual(DEFAULT_NON_POOL_UNIT_IDS);
  });

  it('空数组视为"未提供"，继续向下回退（避免被空数组静默清空黑名单）', () => {
    const typed = {
      ...base,
      non_pool_units_blacklist: { non_pool_unit_ids: [] },
      non_pool_unit_ids: ['top-fallback'],
    } as RawBaseline;
    expect(resolveNonPoolUnitIds(typed)).toEqual(['top-fallback']);
  });

  it('描述性 items 永不参与过滤', () => {
    const typed = {
      ...base,
      non_pool_units_blacklist: { items: ['约里克的召唤物', '婕拉的植物'] },
    } as RawBaseline;
    delete typed.non_pool_unit_ids;
    const resolved = resolveNonPoolUnitIds(typed);
    expect(resolved).not.toContain('约里克的召唤物');
    expect(resolved).toEqual(DEFAULT_NON_POOL_UNIT_IDS);
  });
});

describe('真实基线 data/pool-baseline.json —— 自带的黑名单确实生效', () => {
  const raw = rawBaselineObject();
  const loaded = loadBaseline(rawBaselineText());

  it('基线自身声明了 non_pool_unit_ids（而不是只有描述性 items）', () => {
    const ids = raw.non_pool_units_blacklist?.non_pool_unit_ids;
    expect(Array.isArray(ids)).toBe(true);
    expect(ids!.length).toBeGreaterThan(0);
  });

  it('loader 采纳的正是基线自带的那份（证明改基线能生效）', () => {
    expect(loaded.ok).toBe(true);
    expect(loaded.baseline!.nonPoolUnitIds).toEqual(
      raw.non_pool_units_blacklist!.non_pool_unit_ids,
    );
  });

  it('与 data/non-pool-units.json 一一对应（禁止两份数据漂移）', () => {
    const fileIds = nonPoolUnitsFile().units.map((unit) => unit.id);
    expect(new Set(loaded.baseline!.nonPoolUnitIds)).toEqual(new Set(fileIds));
    expect(loaded.baseline!.nonPoolUnitIds).toHaveLength(fileIds.length);
  });

  it('黑名单 id 不与任何合法弈子 id 冲突', () => {
    const championIds = new Set((raw.champions ?? []).map((champion) => champion.id));
    for (const id of loaded.baseline!.nonPoolUnitIds) {
      expect(championIds.has(id)).toBe(false);
    }
  });

  it('override 能压过基线（设置页/测试需要）', () => {
    const result = loadBaseline(rawBaselineText(), { nonPoolUnitIds: ['only-this'] });
    expect(result.baseline!.nonPoolUnitIds).toEqual(['only-this']);
  });
});
