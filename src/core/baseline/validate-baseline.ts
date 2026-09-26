/**
 * 卡池基线校验（架构 §9 T02-1）。
 *
 * 两道校验：
 * 1. **JSON Schema**（ajv）—— 结构完整性；
 * 2. **业务校验** —— id 唯一、池总数与 `poolSizeByCost` 一致、赛季号匹配等。
 *
 * 纯函数：不读文件系统，schema 由调用方注入（默认取仓库内置的
 * `data/pool-baseline.schema.json`）。
 */

import { default as Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { AppError, Champion, Cost, PoolBaseline } from '../../shared/types/domain';
import { SUPPORTED_SET_NUMBER } from '../../shared/constants';
import { makeError } from '../../shared/ipc/error-codes';
import rawSchema from '../../../data/pool-baseline.schema.json';

/** 校验选项。 */
export interface ValidateOptions {
  /** 自定义 JSON Schema（默认内置）。 */
  schema?: object;
  /** 期望的赛季号，不匹配则报 BASE_SET_MISMATCH。 */
  supportedSetNumber?: number;
  /** 赛季号不匹配时是否判定为致命错误。默认 true。 */
  strictSet?: boolean;
  /** 非池单位 id 列表（默认从 data/non-pool-units.json 派生）。 */
  nonPoolUnitIds?: string[];
  now?: number;
}

/** 校验结果。 */
export interface ValidationOutcome {
  ok: boolean;
  errors: AppError[];
  warnings: AppError[];
}

/** 内置的默认 schema。 */
const DEFAULT_SCHEMA: object = rawSchema as unknown as object;

/**
 * 创建 ajv 校验函数。
 *
 * @param schema JSON Schema。
 */
export function createSchemaValidator(schema: object = DEFAULT_SCHEMA): ValidateFunction {
  // strict:false —— 基线文件允许携带额外描述字段（sources / notes 等）
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

/**
 * 对**原始 snake_case** 基线对象做结构 + 业务校验。
 *
 * @param raw 原始对象。
 * @param options 校验选项。
 */
export function validateBaseline(raw: unknown, options: ValidateOptions = {}): ValidationOutcome {
  const now = options.now ?? 0;
  const errors: AppError[] = [];
  const warnings: AppError[] = [];

  if (raw === null || typeof raw !== 'object') {
    errors.push(
      makeError('BASE_INVALID_JSON', { detail: { type: typeof raw }, at: now, fatal: true }),
    );
    return { ok: false, errors, warnings };
  }

  // ---- 1. JSON Schema ----
  const validate = createSchemaValidator(options.schema ?? DEFAULT_SCHEMA);
  if (!validate(raw)) {
    errors.push(
      makeError('BASE_SCHEMA_FAIL', {
        message: `卡池基线结构校验失败：${(validate.errors ?? [])
          .slice(0, 5)
          .map((item: ErrorObject) => `${item.instancePath || '/'} ${item.message ?? ''}`)
          .join('; ')}`,
        detail: validate.errors ?? [],
        at: now,
        fatal: true,
      }),
    );
    return { ok: false, errors, warnings };
  }

  const typed = raw as RawBaseline;

  // ---- 2. 赛季号 ----
  const expectedSet = options.supportedSetNumber ?? SUPPORTED_SET_NUMBER;
  if (typed.meta?.set_number !== expectedSet) {
    const error = makeError('BASE_SET_MISMATCH', {
      message: `当前模式卡池基线未配置：期望 Set ${expectedSet}，实际 Set ${typed.meta?.set_number}`,
      detail: { expectedSet, actualSet: typed.meta?.set_number },
      at: now,
      fatal: options.strictSet ?? true,
    });
    if (options.strictSet ?? true) {
      errors.push(error);
    } else {
      warnings.push({ ...error, fatal: false });
    }
  }

  // ---- 3. 基线未实测确认 ----
  if (typed.meta?.CONFIRMED !== true) {
    warnings.push(
      makeError('BASE_UNCONFIRMED', {
        message: `卡池基线尚未实测确认（patch ${typed.meta?.patch ?? '未知'}），数值仅供参考`,
        detail: { confidence: typed.meta?.confidence },
        at: now,
      }),
    );
  }

  // ---- 4. id 唯一 ----
  const seen = new Set<string>();
  for (const champion of typed.champions ?? []) {
    if (seen.has(champion.id)) {
      errors.push(
        makeError('BASE_SCHEMA_FAIL', {
          message: `champion id 重复：${champion.id}`,
          detail: { championId: champion.id },
          at: now,
          fatal: true,
        }),
      );
    }
    seen.add(champion.id);
  }

  // ---- 5. pool_total 与 pool_size_by_cost 一致性 ----
  for (const champion of typed.champions ?? []) {
    const expected = typed.pool_size_by_cost?.[String(champion.cost)]?.copies_per_champion;
    if (typeof expected === 'number' && champion.pool_total !== expected) {
      warnings.push(
        makeError('BASE_SCHEMA_FAIL', {
          message: `${champion.id} 的 pool_total=${champion.pool_total} 与 ${champion.cost} 费档 ${expected} 不一致，以 champion.pool_total 为准`,
          detail: { championId: champion.id, cost: champion.cost, expected },
          at: now,
        }),
      );
    }
  }

  // ---- 6. 各费用档声明数量 vs 实际数量 ----
  const actualCount: Record<string, number> = {};
  for (const champion of typed.champions ?? []) {
    actualCount[String(champion.cost)] = (actualCount[String(champion.cost)] ?? 0) + 1;
  }
  for (const [cost, entry] of Object.entries(typed.pool_size_by_cost ?? {})) {
    const actual = actualCount[cost] ?? 0;
    if (entry?.distinct_champions !== undefined && actual !== entry.distinct_champions) {
      warnings.push(
        makeError('BASE_SCHEMA_FAIL', {
          message: `${cost} 费档声明 ${entry.distinct_champions} 个弈子，实际 ${actual} 个`,
          detail: { cost, declared: entry.distinct_champions, actual },
          at: now,
        }),
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 基线文件的原始（snake_case）形状 —— 仅用于校验与转换，不对外暴露。 */
export interface RawBaseline {
  meta: {
    schema_version: string;
    set_number: number;
    set_name_cn?: string | null;
    set_name_en?: string | null;
    patch: string;
    generated_at?: string | null;
    CONFIRMED?: boolean;
    confidence?: Record<string, string>;
    unverified_note?: string;
  };
  pool_size_by_cost: Record<string, { copies_per_champion: number; distinct_champions: number; tier_total?: number; CONFIRMED?: boolean }>;
  star_copy_cost: Record<string, number>;
  champions: Array<{
    id: string;
    name_en: string;
    name_cn?: string | null;
    cost: Cost;
    traits?: string[];
    traits_cn?: Array<string | null>;
    pool_total: number;
    CONFIRMED?: boolean;
    special?: {
      team_slots?: number;
      pool_copies_consumed?: number;
      riftbeast_trait_contribution?: number;
      note?: string;
    };
  }>;
  /**
   * 非池单位黑名单。
   *
   * `items` 是给人看的中文描述（按机制分组），**不参与过滤**；
   * `non_pool_unit_ids` 才是识别与引擎实际使用的 id 列表。
   * 早期版本的基线只带了 `items`，导致这份黑名单形同虚设（永远回退到
   * data/non-pool-units.json）—— QA I2。此处显式声明两个字段，
   * 并由 loader 按「嵌套 ids → 顶层 ids → 内置兜底」的优先级读取。
   */
  non_pool_units_blacklist?: { items?: string[]; non_pool_unit_ids?: string[] };
  non_pool_unit_ids?: string[];
  /** 真实文件为 { patch, CONFIRMED, confidence, levels: {等级: [5 个概率]} }。 */
  shop_odds_by_level?: {
    patch?: string;
    CONFIRMED?: boolean;
    confidence?: string;
    levels?: Record<string, number[]>;
  };
}

/** 校验并转换后的类型守卫辅助：把原始数组转成 Champion 列表的形状。 */
export type RawChampion = RawBaseline['champions'][number];

/**
 * 轻量检查：给定对象是否"看起来像"原始基线。
 *
 * @param value 任意值。
 */
export function looksLikeRawBaseline(value: unknown): value is RawBaseline {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<RawBaseline>;
  return (
    typeof candidate.meta === 'object' &&
    candidate.meta !== null &&
    Array.isArray(candidate.champions) &&
    typeof candidate.pool_size_by_cost === 'object'
  );
}

/** 保证 Champion 数组的运行时非空（供类型收窄）。 */
export function isChampionList(value: unknown): value is Champion[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null);
}

/** 供外部复用的 PoolBaseline 类型再导出（避免多处 import）。 */
export type ValidatedBaseline = PoolBaseline;
