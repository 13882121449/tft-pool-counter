/**
 * 实例聚合：把 8 家台账里的 `UnitInstance` 汇总成每个弈子的中间态。
 *
 * 关键点：
 * - **按 instanceId 去重**，而不是按格子 —— 远古巨龙占 2 格但只有 1 个实例（E8）；
 * - **人工校正优先**：某家某弈子被人工设定后，自动扫描的实例不重复计入该家；
 * - 被淘汰的玩家台账已在 ledger 层清空，这里再兜底跳过。
 */

import type {
  Champion,
  Cost,
  PlayerLedger,
  PoolBaseline,
  UnitInstance,
} from '../../shared/types/domain';
import type { ChampionAggregate } from './rules/types';
import { recomputeAggregate } from './rules/types';
import { indexChampions } from '../baseline/load-baseline';
import { buildPoolGroupMap } from './rules/lux-avatar.rule';

/** 聚合入参。 */
export interface AggregateOptions {
  /** 当前时间（epoch ms），用于 latestSeenAt 兜底。 */
  now: number;
  /** 可选：复用已构建的索引，避免重复建表。 */
  championIndex?: Map<string, Champion>;
}

/** 创建空的聚合对象。 */
export function createAggregate(champion: Champion, poolGroupId: string): ChampionAggregate {
  return {
    championId: champion.id,
    cost: champion.cost,
    poolTotal: champion.poolTotal,
    bySeat: new Array<number>(8).fill(0),
    seatHasAny: new Array<boolean>(8).fill(false),
    instances: [],
    observedCopies: 0,
    remaining: champion.poolTotal,
    overflow: 0,
    remainingOptimistic: champion.poolTotal,
    remainingPessimistic: champion.poolTotal,
    confidence: 1,
    flags: [],
    locked: false,
    manualOverride: false,
    latestSeenAt: 0,
    poolGroupId,
    manualOverrideBySeat: new Array<number | null>(8).fill(null),
  };
}

/**
 * 为一个"基线中不存在的 id"创建聚合。
 *
 * 这类聚合随后会被 `non-pool-filter` 规则剔除并记一条 `ENG_UNKNOWN_CHAMPION`，
 * 因此 poolTotal 置 0、费用档按 1 费处理即可（不会进最终输出行）。
 *
 * @param championId 未知 id。
 */
function createUnknownAggregate(championId: string): ChampionAggregate {
  return createAggregate(
    {
      id: championId,
      nameEn: championId,
      nameCn: championId,
      cost: 1 as Cost,
      traits: [],
      traitsCn: [],
      poolTotal: 0,
      confirmed: false,
    },
    championId,
  );
}

/**
 * 收集全部参与计数的实例（已按 instanceId 去重，已剔除淘汰玩家）。
 *
 * @param ledgers 全部台账。
 */
export function collectInstances(
  ledgers: ReadonlyArray<PlayerLedger>,
): Map<string, UnitInstance> {
  const unique = new Map<string, UnitInstance>();
  for (const ledger of ledgers) {
    // 已淘汰：其棋子已回池，不参与消耗统计
    if (ledger.status === 'eliminated') {
      continue;
    }
    for (const instance of Object.values(ledger.slots ?? {})) {
      if (!instance) {
        continue;
      }
      unique.set(instance.instanceId, instance);
    }
  }
  return unique;
}

/**
 * 聚合全部实例。
 *
 * @param ledgers 全部台账（含 UNKNOWN 暂存区）。
 * @param baseline 卡池基线。
 * @param options 聚合选项。
 * @returns championId → 聚合中间态（含基线中不存在的 id，供规则层剔除）。
 */
export function aggregateInstances(
  ledgers: ReadonlyArray<PlayerLedger>,
  baseline: PoolBaseline,
  options: AggregateOptions,
): Map<string, ChampionAggregate> {
  const championIndex = options.championIndex ?? indexChampions(baseline);
  const poolGroups = buildPoolGroupMap(baseline.champions);
  const instances = collectInstances(ledgers);

  const aggregates = new Map<string, ChampionAggregate>();
  const getOrCreate = (championId: string): ChampionAggregate => {
    const existing = aggregates.get(championId);
    if (existing) {
      return existing;
    }
    const champion = championIndex.get(championId);
    const created = champion
      ? createAggregate(champion, poolGroups.get(championId) ?? championId)
      : createUnknownAggregate(championId);
    aggregates.set(championId, created);
    return created;
  };

  // 第一遍：登记人工校正覆盖值（必须先于实例统计，避免自动+自动双计）
  for (const instance of instances.values()) {
    if (instance.source !== 'manual') {
      continue;
    }
    if (instance.seat < 0 || instance.seat > 7) {
      continue;
    }
    const aggregate = getOrCreate(instance.championId);
    aggregate.manualOverrideBySeat[instance.seat] = instance.copies;
  }

  // 第二遍：登记实例
  for (const instance of instances.values()) {
    const aggregate = getOrCreate(instance.championId);
    aggregate.instances.push(instance);
  }

  // 第三遍：统一重算
  for (const aggregate of aggregates.values()) {
    recomputeAggregate(aggregate);
  }

  return aggregates;
}

/**
 * 取某个弈子的聚合（不存在时返回按基线构造的空聚合）。
 *
 * @param aggregates 聚合表。
 * @param champion 弈子定义。
 * @param poolGroupId 共享池分组。
 */
export function ensureAggregate(
  aggregates: Map<string, ChampionAggregate>,
  champion: Champion,
  poolGroupId: string,
): ChampionAggregate {
  const existing = aggregates.get(champion.id);
  if (existing) {
    return existing;
  }
  const created = createAggregate(champion, poolGroupId);
  aggregates.set(champion.id, created);
  return created;
}
