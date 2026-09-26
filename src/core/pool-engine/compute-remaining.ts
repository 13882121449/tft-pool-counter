/**
 * 牌库引擎主入口（ADR-03）。
 *
 * 纯函数：输入 `(ledgers, baseline, config)`，输出 65 条 `RemainingResult`。
 * 不 import electron / node，100% 可单测。
 *
 * 流程：
 *   实例聚合 → 规则插件链 → 覆盖率 / 乐观悲观区间 / 置信度 / 标记 → 输出行
 */

import type {
  AppError,
  PlayerLedger,
  PoolBaseline,
  RemainingResult,
  Seat,
} from '../../shared/types/domain';
import type { EstimateConfig } from '../../shared/types/config';
import {
  DEFAULT_ESTIMATE_CONFIG,
  LOW_CONFIDENCE_THRESHOLD,
  STALE_TTL_MS,
} from '../../shared/constants';
import { indexChampions } from '../baseline/load-baseline';
import { aggregateInstances, ensureAggregate } from './instance-aggregator';
import { computeCoverage, pessimisticRemaining } from './coverage';
import { averageConfidence, confidenceOfChampion } from './confidence';
import { resolveFlags } from './flags';
import { RuleRegistry } from './rules/registry';
import type { ChampionAggregate, RuleContext } from './rules/types';
import { nonPoolFilterRule } from './rules/non-pool-filter.rule';
import { doubleSlotRule } from './rules/double-slot.rule';
import { eliminationRule } from './rules/elimination.rule';
import { buildPoolGroupMap, luxAvatarRule } from './rules/lux-avatar.rule';
import { duplicatorOverflowRule } from './rules/duplicator-overflow.rule';
import type { ZoneCols } from './slot-geometry';

/** 计算选项。 */
export interface ComputeRemainingOptions {
  /** 覆盖当前时间（默认取 ledgers 中最大的 lastScanAt）。 */
  now?: number;
  /** 上一次的快照行，用于填充 `prevRemaining`（UI 显示 ↑N / ↓N）。 */
  prevRows?: ReadonlyArray<RemainingResult>;
  /** 自定义规则链（默认内置 5 个插件）。 */
  registry?: RuleRegistry;
  /** 输出额外产出的错误/告警。 */
  errors?: AppError[];
  /**
   * 各区域列数（棋盘/备战席/商店）。
   *
   * 透传到 `RuleContext.zoneCols`，供 `double-slot` 做二维相邻判定（QA M1）。
   * 缺省时按游戏常量回退（7 / 8 / 5），对 Set 18 恒定棋盘仍然正确。
   */
  geometry?: ZoneCols;
}

/** 内置插件顺序：非池 → 双槽 → 淘汰 → 化身 → 超额。 */
export function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  registry.registerAll([
    nonPoolFilterRule,
    doubleSlotRule,
    eliminationRule,
    luxAvatarRule,
    duplicatorOverflowRule,
  ]);
  return registry;
}

/** 打包默认估算配置（补全可选字段，避免下游到处写 `??`）。 */
export function resolveEstimateConfig(config?: Partial<EstimateConfig>): EstimateConfig {
  return {
    perSeatByCost: { ...DEFAULT_ESTIMATE_CONFIG.perSeatByCost, ...(config?.perSeatByCost ?? {}) },
    lowCoverageThreshold:
      config?.lowCoverageThreshold ?? DEFAULT_ESTIMATE_CONFIG.lowCoverageThreshold,
    lowConfidenceThreshold:
      config?.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD,
    staleTtlMs: config?.staleTtlMs ?? STALE_TTL_MS,
  };
}

/** 推断"当前时间"：取所有台账中最新的 lastScanAt，保证纯函数可重复。 */
function inferNow(ledgers: ReadonlyArray<PlayerLedger>, fallback: number): number {
  let latest = 0;
  for (const ledger of ledgers) {
    if (ledger.lastScanAt > latest) {
      latest = ledger.lastScanAt;
    }
  }
  return latest > 0 ? latest : fallback;
}

/**
 * 计算全部弈子的剩余数。
 *
 * @param ledgers 全部玩家台账（含 UNKNOWN 暂存区）。
 * @param baseline 卡池基线。
 * @param config 估算配置。
 * @param options 计算选项。
 * @returns 按 `baseline.champions` 顺序排列的 65 条结果。
 */
export function computeRemaining(
  ledgers: ReadonlyArray<PlayerLedger>,
  baseline: PoolBaseline,
  config: Partial<EstimateConfig> = {},
  options: ComputeRemainingOptions = {},
): RemainingResult[] {
  const estimateConfig = resolveEstimateConfig(config);
  const championIndex = indexChampions(baseline);
  const coverage = computeCoverage(ledgers);
  const now = options.now ?? inferNow(ledgers, 0);
  const eliminatedSeats = ledgers
    .filter((ledger) => ledger.status === 'eliminated' && ledger.seat >= 0 && ledger.seat <= 7)
    .map((ledger) => ledger.seat as Seat);

  const aggregates = aggregateInstances(ledgers, baseline, { now, championIndex });

  const registry = options.registry ?? createDefaultRegistry();
  const ctx: RuleContext = {
    baseline,
    championIndex,
    aggregates,
    ledgers,
    coverage,
    config: estimateConfig,
    eliminatedSeats,
    now,
    errors: options.errors ?? [],
    zoneCols: options.geometry,
  };
  registry.runAll(ctx);

  const poolGroups = buildPoolGroupMap(baseline.champions);
  const rows: RemainingResult[] = [];
  const confidences: number[] = [];

  for (const champion of baseline.champions) {
    const aggregate = ensureAggregate(
      aggregates,
      champion,
      poolGroups.get(champion.id) ?? champion.id,
    );

    const remaining = Math.max(0, aggregate.poolTotal - aggregate.observedCopies);
    const overflow = Math.max(0, aggregate.observedCopies - aggregate.poolTotal);
    aggregate.remaining = remaining;
    aggregate.overflow = overflow;
    aggregate.remainingOptimistic = remaining;
    aggregate.remainingPessimistic = pessimisticRemaining(
      remaining,
      coverage,
      estimateConfig,
      champion.cost,
    );
    aggregate.confidence = confidenceOfChampion(aggregate.instances, coverage);
    confidences.push(aggregate.confidence);

    rows.push({
      championId: champion.id,
      cost: champion.cost,
      poolTotal: aggregate.poolTotal,
      observedCopies: aggregate.observedCopies,
      remaining,
      overflow,
      remainingOptimistic: aggregate.remainingOptimistic,
      remainingPessimistic: aggregate.remainingPessimistic,
      bySeat: [...aggregate.bySeat],
      seatHasAny: [...aggregate.seatHasAny],
      coveredSeats: [...coverage.seats],
      confidence: aggregate.confidence,
      flags: resolveFlags({ aggregate, coverage, config: estimateConfig, now }),
      locked: aggregate.locked,
      updatedAt: now,
    });
  }

  if (options.prevRows && options.prevRows.length > 0) {
    attachPrevRemaining(rows, options.prevRows);
  }

  // 平均置信度写入 ctx，供调用方构造快照元信息
  ctx.averageConfidence = averageConfidence(confidences);

  return rows;
}

/**
 * 把上一次快照的 remaining 填进新行（UI 用它显示 ↑N / ↓N）。
 *
 * @param rows 本次结果行（会被就地修改）。
 * @param prevRows 上一次结果行。
 */
export function attachPrevRemaining(
  rows: RemainingResult[],
  prevRows: ReadonlyArray<RemainingResult>,
): void {
  const prevById = new Map<string, number>();
  for (const row of prevRows) {
    prevById.set(row.championId, row.remaining);
  }
  for (const row of rows) {
    const prev = prevById.get(row.championId);
    if (prev !== undefined && prev !== row.remaining) {
      row.prevRemaining = prev;
    }
  }
}

/**
 * 计算单个弈子的聚合（供校正面板等局部场景使用）。
 *
 * @param ledgers 台账。
 * @param baseline 基线。
 * @param championId 弈子 id。
 * @returns 该弈子的聚合中间态。
 */
export function aggregateOfChampion(
  ledgers: ReadonlyArray<PlayerLedger>,
  baseline: PoolBaseline,
  championId: string,
): ChampionAggregate | null {
  const aggregates = aggregateInstances(ledgers, baseline, { now: 0 });
  return aggregates.get(championId) ?? null;
}
