/**
 * 卡池基线加载与归一化（架构 §9 T02-1）。
 *
 * 职责：把 `data/pool-baseline.json`（snake_case 原始形状）转换成运行时
 * `PoolBaseline`（camelCase），补全默认值，并产出校验错误/告警。
 *
 * 纯函数：入参是已解析好的对象或 JSON 字符串，不碰文件系统
 * （文件读取由 main 进程负责，core 保持零依赖可单测）。
 */

import {
  UNKNOWN_SEAT,
  type AppError,
  type Champion,
  type ChampionSpecial,
  type Cost,
  type PoolBaseline,
  type PoolSizeByCostEntry,
  type Star,
} from '../../shared/types/domain';
import { STAR_COPY_COST, SUPPORTED_SET_NUMBER } from '../../shared/constants';
import { makeError } from '../../shared/ipc/error-codes';
import nonPoolUnits from '../../../data/non-pool-units.json';
import { validateBaseline, type RawBaseline, type ValidateOptions } from './validate-baseline';

/** 加载结果。 */
export interface LoadBaselineResult {
  ok: boolean;
  baseline: PoolBaseline | null;
  errors: AppError[];
  warnings: AppError[];
}

/**
 * 默认非池单位 id（来自 data/non-pool-units.json，数据驱动，不硬编码）。
 */
export const DEFAULT_NON_POOL_UNIT_IDS: string[] = (nonPoolUnits.units ?? []).map(
  (unit: { id: string }) => unit.id,
);

/**
 * 把原始 special 字段转成 camelCase。
 *
 * @param raw 原始 special 对象。
 */
function normalizeSpecial(raw: RawBaseline['champions'][number]['special']): ChampionSpecial | undefined {
  if (!raw) {
    return undefined;
  }
  const special: ChampionSpecial = {};
  if (typeof raw.team_slots === 'number') {
    special.teamSlots = raw.team_slots;
  }
  if (typeof raw.pool_copies_consumed === 'number') {
    special.poolCopiesConsumed = raw.pool_copies_consumed;
  }
  if (typeof raw.riftbeast_trait_contribution === 'number') {
    special.riftbeastTraitContribution = raw.riftbeast_trait_contribution;
  }
  if (raw.note) {
    // 化身拉克丝在基线的 special 里只有 note 字段
    special.sharedPoolNote = raw.note;
    special.note = raw.note;
  }
  return Object.keys(special).length > 0 ? special : undefined;
}

/**
 * 归一化单个弈子。
 *
 * @param raw 原始弈子对象。
 */
export function normalizeChampion(raw: RawBaseline['champions'][number]): Champion {
  const traits = raw.traits ?? [];
  const traitsCn = raw.traits_cn ?? traits.map(() => null);
  return {
    id: raw.id,
    nameEn: raw.name_en,
    nameCn: raw.name_cn ?? raw.name_en,
    cost: raw.cost,
    traits,
    traitsCn: traits.length === traitsCn.length ? traitsCn : traits.map(() => null),
    poolTotal: raw.pool_total,
    special: normalizeSpecial(raw.special),
    confirmed: raw.CONFIRMED === true,
  };
}

/**
 * 归一化 poolSizeByCost。
 *
 * @param raw 原始对象。
 */
export function normalizePoolSizeByCost(
  raw: RawBaseline['pool_size_by_cost'],
): Record<Cost, PoolSizeByCostEntry> {
  const result = {} as Record<Cost, PoolSizeByCostEntry>;
  for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
    const entry = raw[String(cost)];
    result[cost] = {
      copiesPerChampion: entry?.copies_per_champion ?? 0,
      distinctChampions: entry?.distinct_champions ?? 0,
      tierTotal: entry?.tier_total,
      confirmed: entry?.CONFIRMED === true,
    };
  }
  return result;
}

/**
 * 归一化星级换算表。
 *
 * @param raw 原始对象。
 */
export function normalizeStarCopyCost(raw: RawBaseline['star_copy_cost']): Record<Star, number> {
  const result = { ...STAR_COPY_COST };
  for (const star of [1, 2, 3, 4] as Star[]) {
    const value = raw?.[String(star)];
    if (typeof value === 'number' && value > 0) {
      result[star] = value;
    }
  }
  return result;
}

/**
 * 归一化 shopOddsByLevel。
 *
 * 真实文件把各等级概率放在 `levels` 子对象里
 * （形如 `{ patch, CONFIRMED, confidence, levels: { "1": [...], ... } }`），
 * 这里统一摊平成 `Record<等级, 概率数组>`。
 *
 * @param raw 原始对象。
 */
function normalizeShopOdds(
  raw: RawBaseline['shop_odds_by_level'],
): Record<number, number[]> | undefined {
  if (!raw) {
    return undefined;
  }
  const source = raw.levels ?? {};
  const result: Record<number, number[]> = {};
  for (const [level, odds] of Object.entries(source)) {
    const numericLevel = Number(level);
    if (Number.isInteger(numericLevel) && Array.isArray(odds)) {
      result[numericLevel] = odds;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 解析非池单位黑名单。
 *
 * 优先级（前两者任一命中即视为"基线自带黑名单已接线"）：
 *   1. 调用方显式注入 `options.nonPoolUnitIds`（设置页/测试覆写）；
 *   2. 基线 `non_pool_units_blacklist.non_pool_unit_ids`（推荐位置，与描述性 items 同处）；
 *   3. 基线顶层 `non_pool_unit_ids`（兼容旧数据形状）；
 *   4. `data/non-pool-units.json` 内置兜底。
 *
 * QA I2：早期基线只写了描述性的 `items`，而 loader 读的是不存在的
 * `non_pool_unit_ids` → 基线内的黑名单从未生效。这里补上第 2 条并保留
 * 第 3 条兼容，使"基线自带的黑名单"真正可用（RQ-08：基线是唯一数据源）。
 *
 * @param typed 原始基线。
 * @param override 调用方注入的黑名单。
 */
export function resolveNonPoolUnitIds(
  typed: RawBaseline,
  override?: string[],
): string[] {
  if (Array.isArray(override) && override.length > 0) {
    return override;
  }
  const nested = typed.non_pool_units_blacklist?.non_pool_unit_ids;
  if (Array.isArray(nested) && nested.length > 0) {
    return nested;
  }
  const topLevel = typed.non_pool_unit_ids;
  if (Array.isArray(topLevel) && topLevel.length > 0) {
    return topLevel;
  }
  return DEFAULT_NON_POOL_UNIT_IDS;
}

/**
 * 加载并归一化基线。
 *
 * @param input 已解析的对象或 JSON 字符串。
 * @param options 校验选项。
 */
export function loadBaseline(
  input: unknown | string,
  options: ValidateOptions = {},
): LoadBaselineResult {
  const now = options.now ?? 0;
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        ok: false,
        baseline: null,
        errors: [
          makeError('BASE_INVALID_JSON', {
            message: `卡池基线不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
            at: now,
            fatal: true,
          }),
        ],
        warnings: [],
      };
    }
  }

  const validation = validateBaseline(raw, options);
  if (!validation.ok) {
    return {
      ok: false,
      baseline: null,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const typed = raw as RawBaseline;
  const champions: Champion[] = (typed.champions ?? []).map(normalizeChampion);

  const baseline: PoolBaseline = {
    meta: {
      schemaVersion: typed.meta?.schema_version ?? '1.0',
      setNumber: typed.meta?.set_number ?? SUPPORTED_SET_NUMBER,
      setNameCn: typed.meta?.set_name_cn ?? '',
      setNameEn: typed.meta?.set_name_en ?? undefined,
      patch: typed.meta?.patch ?? '',
      confirmed: typed.meta?.CONFIRMED === true,
      confidence: typed.meta?.confidence ?? {},
      unverifiedNote: typed.meta?.unverified_note,
      generatedAt: typed.meta?.generated_at ?? undefined,
    },
    poolSizeByCost: normalizePoolSizeByCost(typed.pool_size_by_cost ?? {}),
    starCopyCost: normalizeStarCopyCost(typed.star_copy_cost ?? {}),
    champions,
    nonPoolUnitIds: resolveNonPoolUnitIds(typed, options.nonPoolUnitIds),
    shopOddsByLevel: normalizeShopOdds(typed.shop_odds_by_level),
  };

  return {
    ok: true,
    baseline,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

/**
 * 严格加载：失败直接抛错（应用启动时使用，配置错误属于致命问题）。
 *
 * @param input 已解析的对象或 JSON 字符串。
 * @param options 校验选项。
 */
export function loadBaselineOrThrow(input: unknown | string, options: ValidateOptions = {}): PoolBaseline {
  const result = loadBaseline(input, options);
  if (!result.ok || result.baseline === null) {
    const first = result.errors[0];
    throw new Error(`[baseline] ${first?.code ?? 'BASE_INVALID_JSON'}: ${first?.message ?? '加载失败'}`);
  }
  return result.baseline;
}

/**
 * 建立 championId → Champion 索引。
 *
 * @param baseline 卡池基线。
 */
export function indexChampions(baseline: PoolBaseline): Map<string, Champion> {
  const map = new Map<string, Champion>();
  for (const champion of baseline.champions) {
    map.set(champion.id, champion);
  }
  return map;
}

/**
 * 取单个弈子。
 *
 * @param baseline 卡池基线。
 * @param championId 弈子 id。
 */
export function getChampion(baseline: PoolBaseline, championId: string): Champion | undefined {
  return indexChampions(baseline).get(championId);
}

/** 便于测试：UNKNOWN 座位常量再导出。 */
export { UNKNOWN_SEAT };
