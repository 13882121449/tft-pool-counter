/**
 * QA 审计专用测试构造器（严过关 / QA）。
 *
 * 与 `tests/helpers/goldens.ts` 的区别：
 * - goldens.ts 走「ScanResult → applyScan」的黑盒路径；
 * - 本文件直接构造 `PlayerLedger[]`，用于精确命中引擎边界
 *   （星级换算 / 溢出 / 淘汰 / 覆盖率 / 属性测试）。
 *
 * 只依赖 src 的纯类型与常量，不引入任何新依赖。
 */

import type {
  Cost,
  PlayerLedger,
  PoolBaseline,
  SeatOrUnknown,
  Star,
  UnitInstance,
  Zone,
} from '../../src/shared/types/domain';
import { UNKNOWN_SEAT } from '../../src/shared/types/domain';
import { createLedgerState } from '../../src/core/ledger/ledger-store';
import { copiesOf } from '../../src/core/pool-engine/star-copies';
import { makeSlotKey } from '../../src/shared/types/scan';

/** 统一时间基准，避免 STALE 标记干扰断言。 */
export const QA_NOW = 1_700_000_000_000;

/** 实例构造规格。 */
export interface InstSpec {
  championId: string;
  /**
   * 座位号。
   *
   * 类型放宽为 `SeatOrUnknown | number`：调用方常从 `[0,1,2,3].map(...)`
   * 之类的数字数组里直接取座位，强制断言会污染测试可读性；
   * 这里统一在构造时收窄为 `SeatOrUnknown`，语义不变。
   */
  seat: SeatOrUnknown | number;
  star?: Star;
  /** 覆盖张数（默认按 `starCopyCost` 换算）。 */
  copies?: number;
  slotIndex?: number;
  zone?: Zone;
  slotSpan?: number;
  confidence?: number;
  source?: UnitInstance['source'];
  locked?: boolean;
  lastSeenAt?: number;
}

let autoSlot = 0;

/**
 * 构造一个 `UnitInstance`。
 *
 * @param spec 实例规格。
 * @param baseline 卡池基线（提供星级换算表）。
 * @param now 时间基准。
 */
export function inst(spec: InstSpec, baseline: PoolBaseline, now = QA_NOW): UnitInstance {
  const star: Star = spec.star ?? 1;
  const seat = spec.seat as SeatOrUnknown;
  const zone: Zone = spec.zone ?? 'board';
  const slotIndex = spec.slotIndex ?? (autoSlot += 1);
  return {
    instanceId: `qa_${seat}-${zone}-${slotIndex}-${now}-${autoSlot}`,
    championId: spec.championId,
    star,
    copies: spec.copies ?? copiesOf(star, baseline),
    seat,
    zone,
    slotIndex,
    slotSpan: spec.slotSpan ?? 1,
    confidence: spec.confidence ?? 0.95,
    fingerprint: '0'.repeat(16),
    firstSeenAt: now,
    lastSeenAt: spec.lastSeenAt ?? now,
    source: spec.source ?? 'auto',
    locked: spec.locked ?? false,
  };
}

/** ledgersOf 选项。 */
export interface LedgersOfOptions {
  now?: number;
  /** 标记为已巡查的座位（默认：所有放入了实例的座位）。 */
  scannedSeats?: ReadonlyArray<number>;
  /** 标记为已淘汰的座位。 */
  eliminatedSeats?: ReadonlyArray<number>;
  /**
   * 淘汰座位是否清空其槽位（模拟 `markEliminated` 的真实语义）。
   * 默认 true；置 false 可用于验证引擎层的兜底过滤。
   */
  dropEliminatedSlots?: boolean;
  /** 额外标记为已巡查但无实例的座位。 */
  extraScannedSeats?: ReadonlyArray<number>;
}

/**
 * 由实例列表构造 9 个台账（8 家 + UNKNOWN 暂存区）。
 *
 * @param instances 实例列表。
 * @param options 选项。
 */
export function ledgersOf(
  instances: ReadonlyArray<UnitInstance>,
  options: LedgersOfOptions = {},
): PlayerLedger[] {
  const now = options.now ?? QA_NOW;
  const base = createLedgerState(now);
  const ledgers: PlayerLedger[] = base.ledgers.map((ledger) => ({
    ...ledger,
    slots: {} as Record<string, UnitInstance>,
    lastScanAt: 0,
  }));

  const eliminated = new Set<number>(options.eliminatedSeats ?? []);
  const dropSlots = options.dropEliminatedSlots ?? true;

  for (const instance of instances) {
    const ledger = ledgers.find((item) => item.seat === instance.seat);
    if (!ledger) {
      continue;
    }
    if (eliminated.has(instance.seat) && dropSlots) {
      continue;
    }
    ledger.slots[makeSlotKey(instance.seat, instance.zone, instance.slotIndex)] = instance;
  }

  const scanned = new Set<number>(
    options.scannedSeats ?? instances.map((instance) => instance.seat),
  );
  for (const seat of options.extraScannedSeats ?? []) {
    scanned.add(seat);
  }

  for (const ledger of ledgers) {
    if (eliminated.has(ledger.seat)) {
      ledger.status = 'eliminated';
      ledger.scanCount = 1;
      ledger.lastScanAt = now;
    } else if (scanned.has(ledger.seat)) {
      ledger.status = 'scanned';
      ledger.scanCount = 1;
      ledger.lastScanAt = now;
    } else {
      ledger.status = 'unscanned';
      ledger.scanCount = 0;
      ledger.lastScanAt = 0;
    }
  }

  return ledgers;
}

/** 取某一行结果。 */
export function rowOf<T extends { championId: string }>(rows: ReadonlyArray<T>, championId: string): T {
  const found = rows.find((row) => row.championId === championId);
  if (!found) {
    throw new Error(`结果中找不到弈子 ${championId}`);
  }
  return found;
}

/** 取基线中指定费用档的第一个弈子。 */
export function firstChampionOfCost(baseline: PoolBaseline, cost: Cost) {
  const found = baseline.champions.find((champion) => champion.cost === cost);
  if (!found) {
    throw new Error(`基线中没有 ${cost} 费弈子`);
  }
  return found;
}

/** 确定性伪随机数发生器（LCG），保证属性测试可复现。 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** 导出 UNKNOWN 座位常量，便于测试书写。 */
export { UNKNOWN_SEAT };
