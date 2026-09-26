/**
 * 规则插件契约与引擎中间态（ADR-03）。
 *
 * 新增一种特殊机制 = 新增一个文件 + 注册到 registry，主流程不动。
 */

import type {
  AppError,
  Champion,
  Cost,
  Coverage,
  PlayerLedger,
  PoolBaseline,
  PoolFlag,
  Seat,
  UnitInstance,
} from '../../../shared/types/domain';
import type { EstimateConfig } from '../../../shared/types/config';
import type { ZoneCols } from '../slot-geometry';

/**
 * 单个弈子在引擎中的聚合中间态。
 *
 * 规则插件直接改写这个对象，最后由 `compute-remaining` 落成 `RemainingResult`。
 */
export interface ChampionAggregate {
  championId: string;
  cost: Cost;
  poolTotal: number;
  /** length 8，各家持有张数（UNKNOWN 暂存区不计入，见 observedCopies）。 */
  bySeat: number[];
  /** length 8，8 点点阵。 */
  seatHasAny: boolean[];
  /** 参与计数的实例（已按 instanceId 去重）。 */
  instances: UnitInstance[];
  /** 已观测消耗 = Σ bySeat + UNKNOWN 暂存区持有量。 */
  observedCopies: number;
  /** max(0, poolTotal - observedCopies)。 */
  remaining: number;
  /** max(0, observedCopies - poolTotal)。 */
  overflow: number;
  remainingOptimistic: number;
  remainingPessimistic: number;
  confidence: number;
  flags: PoolFlag[];
  locked: boolean;
  manualOverride: boolean;
  /** 最后一次被观测到的时间（epoch ms），用于 STALE 判定。 */
  latestSeenAt: number;
  /**
   * 共享卡池分组 id。默认等于 championId；
   * 拉克丝全形态会映射到同一个分组（化身机制）。
   */
  poolGroupId: string;
  /**
   * 人工校正覆盖值（length 8，null = 该家无人工覆盖）。
   *
   * 手动校正是一等公民：某家某弈子一旦被人工设定，
   * 自动扫描看到的实例**不重复计入**该家，避免"人工 + 自动"双重计数。
   */
  manualOverrideBySeat: Array<number | null>;
}

/** 规则插件执行上下文。 */
export interface RuleContext {
  baseline: PoolBaseline;
  /** championId → Champion。 */
  championIndex: Map<string, Champion>;
  /** championId → 聚合中间态。 */
  aggregates: Map<string, ChampionAggregate>;
  ledgers: ReadonlyArray<PlayerLedger>;
  coverage: Coverage;
  config: EstimateConfig;
  /** 已被淘汰的座位（其持有量必须归零回池）。 */
  eliminatedSeats: ReadonlyArray<Seat>;
  now: number;
  /** 插件产出的错误/告警（不抛异常，统一收集）。 */
  errors: AppError[];
  /**
   * 各区域列数（把线性 slotIndex 还原为二维相邻判定）。
   *
   * 缺省按游戏常量回退（棋盘 7 / 备战席 8 / 商店 5）。
   * 供 `double-slot` 等需要几何相邻判定的插件使用（QA M1）。
   */
  zoneCols?: ZoneCols;
  /** 由 computeRemaining 在计算完各行置信度后回填，供快照元信息使用。 */
  averageConfidence?: number;
}

/** 牌库规则插件接口。 */
export interface PoolRulePlugin {
  /** 稳定 id，用于注册去重与日志。 */
  id: string;
  /** 执行顺序，小的先跑。 */
  order: number;
  /**
   * 就地修改 ctx.aggregates。
   *
   * 约定：插件不得抛异常；异常应转成 ctx.errors 中的一条 AppError。
   */
  apply(ctx: RuleContext): void;
}

/**
 * 重新根据 instances 计算 observedCopies / bySeat / seatHasAny。
 *
 * 规则插件修改实例集合后必须调用它，保证三个字段始终一致。
 *
 * @param aggregate 待重算的聚合对象。
 */
export function recomputeAggregate(aggregate: ChampionAggregate): void {
  const bySeat = new Array<number>(8).fill(0);
  const seatHasAny = new Array<boolean>(8).fill(false);
  let unknownCopies = 0;
  let latest = 0;

  for (const instance of aggregate.instances) {
    const seat = instance.seat;
    if (seat >= 0 && seat <= 7) {
      const override = aggregate.manualOverrideBySeat[seat];
      if (override === null || override === undefined) {
        bySeat[seat] = (bySeat[seat] ?? 0) + instance.copies;
        seatHasAny[seat] = true;
      }
      // 该家存在人工覆盖：自动实例不重复计入，稍后用覆盖值统一回填
    } else {
      // UNKNOWN 暂存区：确实被观测到了，但不归属任何一家
      unknownCopies += instance.copies;
    }
    if (instance.lastSeenAt > latest) {
      latest = instance.lastSeenAt;
    }
  }

  // 回填人工校正值
  for (let seat = 0; seat < 8; seat += 1) {
    const override = aggregate.manualOverrideBySeat[seat];
    if (override !== null && override !== undefined) {
      bySeat[seat] = Math.max(0, override);
      seatHasAny[seat] = bySeat[seat] > 0;
    }
  }

  aggregate.bySeat = bySeat;
  aggregate.seatHasAny = seatHasAny;
  aggregate.observedCopies = bySeat.reduce((sum, value) => sum + value, 0) + unknownCopies;
  aggregate.locked = aggregate.instances.some((instance) => instance.locked);
  aggregate.manualOverride =
    aggregate.instances.some((instance) => instance.source === 'manual') ||
    aggregate.manualOverrideBySeat.some((value) => value !== null && value !== undefined);
  if (latest > 0) {
    aggregate.latestSeenAt = latest;
  }
}

/**
 * 根据实例的星级换算张数，重新计算聚合。
 *
 * @param aggregate 聚合对象。
 * @param baseline 卡池基线（提供 starCopyCost）。
 */
export function refreshCopies(aggregate: ChampionAggregate, baseline: PoolBaseline): void {
  for (const instance of aggregate.instances) {
    instance.copies = baseline.starCopyCost[instance.star] ?? 1;
  }
  recomputeAggregate(aggregate);
}
