/**
 * 去重 / 合并器（ADR-04 —— 本项目最关键的坑）。
 *
 * 台账模型是**以槽位为键的幂等覆盖**，不是事件日志的累加。
 * 同一玩家被反复扫描时，绝不能把每次观测累加起来，否则剩余数会暴跌到负数。
 *
 * 五条核心规则：
 * 1. 同 slotKey + 指纹相近（汉明距离 ≤ 阈值）→ 判定同一实例，只更新 lastSeenAt / confidence；
 * 2. 同 slotKey + 指纹差异大 或 星级变化 → 判定换牌/升星，**替换**（旧记录进 history）；
 * 3. 槽位被识别为**空**且旧记录超过 TTL → 移除（卖出 / 被淘汰，回池）；
 *    未超 TTL 则保留并标 `unstable`，防抖动/特效遮挡导致误删；
 * 4. 同帧相邻槽位且同 championId + star（远古巨龙）→ 合并为**一个实例**，只计 1 张；
 * 5. 槽位被 `locked` → 自动扫描完全不写入，只更新 `autoSuggest`。
 *
 * 本模块全部为纯函数：不修改入参，返回新台账与变更明细。
 */

import type {
  Champion,
  PlayerLedger,
  SeatOrUnknown,
  SlotKey,
  Star,
  UnitInstance,
  Zone,
} from '../../shared/types/domain';
import { makeSlotKey, type ObservationRecord } from '../../shared/types/scan';
import { isSimilarFingerprint, normalizeFingerprint } from '../../shared/math/hash';
import { SAME_FINGERPRINT_THRESHOLD, STALE_TTL_MS } from '../../shared/constants';
import { colsForZone, isOrthogonallyAdjacent, type ZoneCols } from './slot-geometry';

/** 去重配置。 */
export interface DedupConfig {
  /** pHash 汉明距离阈值，≤ 此值判定为同一实例。 */
  fingerprintSameThreshold: number;
  /** stale TTL（ms）：空槽超过此时间才移除。 */
  staleTtlMs: number;
}

/** 默认去重配置。 */
export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  fingerprintSameThreshold: SAME_FINGERPRINT_THRESHOLD,
  staleTtlMs: STALE_TTL_MS,
};

/** 去重依赖（纯数据，方便单测注入更小的数据集）。 */
export interface DedupDeps {
  /** championId → Champion（用于读取 teamSlots 等特殊机制）。 */
  championIndex: Map<string, Champion>;
  /** 非池单位黑名单（E5）。 */
  nonPoolUnitIds?: ReadonlySet<string>;
  /** 星级 → 消耗张数。 */
  copiesOfStar: (star: Star) => number;
  /** 棋盘列数（默认 7）：把线性 slotIndex 还原为水平/垂直相邻判定。 */
  boardCols?: number;
  /** 备战席格数（默认 8）。 */
  benchCols?: number;
  /** 商店格数（默认 5）。 */
  shopCols?: number;
}

/** 被同帧合并掉的槽位记录。 */
export interface MergedAwaySlot {
  championId: string;
  keptSlotIndex: number;
  droppedSlotIndex: number;
  zone: Zone;
}

/** 合并产出。 */
export interface MergeOutcome {
  /** 合并后的新台账（原台账不被修改）。 */
  ledger: PlayerLedger;
  /** 新增的实例 id。 */
  added: string[];
  /** 更新（同一实例刷新 lastSeenAt / confidence）的实例 id。 */
  updated: string[];
  /** 被替换（换牌/升星）的**新**实例 id。 */
  replaced: string[];
  /** 因卖出/淘汰被移除的实例 id。 */
  removed: string[];
  /** 因锁定而跳过写入的槽位键。 */
  lockedSkipped: SlotKey[];
  /** 因黑名单/未知 id 被过滤掉的观测的 championId。 */
  filtered: string[];
  /** 同帧相邻槽位合并记录。 */
  merged: MergedAwaySlot[];
  /** 被判定为空但未超 TTL、保留并标 unstable 的实例 id。 */
  unstable: string[];
  /** 被覆盖/移除的**旧实例**（供撤销与复盘写入 history）。 */
  displaced: UnitInstance[];
}

/** 生成确定性实例 id：同一 (seat, zone, slotIndex, firstSeenAt) 永远同一 id。 */
export function makeInstanceId(
  seat: SeatOrUnknown,
  zone: Zone,
  slotIndex: number,
  firstSeenAt: number,
): string {
  return `u_${seat}-${zone}-${slotIndex}-${firstSeenAt}`;
}

/**
 * 由 `slotSpan` 推算被覆盖的格位（**仅用于没有 `mergedSlotIndices` 的旧数据**）。
 *
 * 与"按二维几何相邻"的口径一致：优先沿**水平**方向延伸（TFT 双格单位横向摆放），
 * 遇到行末越界再转**竖向**；每一步都用 `isOrthogonallyAdjacent` 校验，
 * 不再是单纯的 `slotIndex + offset` 线性相邻（QA N1）。
 *
 * @param zone 区域。
 * @param slotIndex 起始槽位。
 * @param span 占用格数。
 * @param cols 各区域列数。
 */
function coveredCellsFallback(
  zone: Zone,
  slotIndex: number,
  span: number,
  cols: ZoneCols,
): number[] {
  const cells: number[] = [];
  const zoneCols = colsForZone(zone, cols);
  let prev = slotIndex;
  for (let offset = 1; offset < span; offset += 1) {
    const horizontal = prev + 1;
    const vertical = prev + zoneCols;
    if (isOrthogonallyAdjacent(prev, horizontal, zoneCols)) {
      cells.push(horizontal);
      prev = horizontal;
    } else if (isOrthogonallyAdjacent(prev, vertical, zoneCols)) {
      cells.push(vertical);
      prev = vertical;
    } else {
      break;
    }
  }
  return cells;
}

/**
 * 判断观测是否应当被丢弃（黑名单 / 未知弈子 / 空槽）。
 *
 * @param observation 观测。
 * @param deps 去重依赖。
 */
function isDiscarded(observation: ObservationRecord, deps: DedupDeps): boolean {
  if (observation.championId === null) {
    // 空槽是合法观测（用于卖出回池判定），不算被丢弃
    return false;
  }
  if (observation.isBlacklisted) {
    return true;
  }
  if (deps.nonPoolUnitIds?.has(observation.championId)) {
    return true;
  }
  if (!deps.championIndex.has(observation.championId)) {
    return true;
  }
  return false;
}

/**
 * 同帧相邻槽位合并（规则 4，远古巨龙 E8）。
 *
 * 只有当弈子声明 `teamSlots > 1`、且两个槽位**水平/垂直相邻**（二维几何，
 * 见 `slot-geometry`；**不是**线性索引相邻）、championId 与 star 都相同时，
 * 才合并为一个实例，并把所占格数写进 `slotSpan`。
 *
 * 合并是"逐段生长"的：已合并的实例可继续吞并其末端格的相邻格，
 * 直到达到 `teamSlots` 上限为止（避免把 3 只巨龙误并成 1 只）。
 *
 * @param observations 已过滤的观测。
 * @param deps 去重依赖。
 * @returns `{ kept, merged }`。
 */
export function mergeAdjacentSlots(
  observations: ReadonlyArray<ObservationRecord>,
  deps: DedupDeps,
): { kept: ObservationRecord[]; merged: MergedAwaySlot[] } {
  // 先做浅拷贝：合并会改写 slotSpan，绝不能污染调用方的观测对象
  const working: ObservationRecord[] = observations.map((observation) => ({ ...observation }));
  const byZone = new Map<Zone, ObservationRecord[]>();
  for (const observation of working) {
    if (observation.championId === null) {
      continue;
    }
    const bucket = byZone.get(observation.zone);
    if (bucket) {
      bucket.push(observation);
    } else {
      byZone.set(observation.zone, [observation]);
    }
  }

  const cols = { board: deps.boardCols, bench: deps.benchCols, shop: deps.shopCols };
  const dropped = new Set<ObservationRecord>();
  const merged: MergedAwaySlot[] = [];

  for (const bucket of byZone.values()) {
    const sorted = [...bucket].sort((a, b) => a.slotIndex - b.slotIndex);
    let current: ObservationRecord | null = null;
    for (const next of sorted) {
      if (current === null) {
        current = next;
        continue;
      }
      const championId = current.championId;
      const teamSlots =
        championId === null ? 1 : deps.championIndex.get(championId)?.special?.teamSlots ?? 1;
      const currentSpan = current.slotSpan ?? 1;
      const nextSpan = next.slotSpan ?? 1;
      // current 覆盖的**末端格**与 next 必须二维相邻（水平/垂直）
      const endSlot = current.slotIndex + currentSpan - 1;
      const canMerge =
        teamSlots > 1 &&
        championId !== null &&
        championId === next.championId &&
        current.star === next.star &&
        currentSpan + nextSpan <= teamSlots &&
        isOrthogonallyAdjacent(endSlot, next.slotIndex, colsForZone(current.zone, cols));
      if (!canMerge) {
        current = next;
        continue;
      }
      // 合并：current 扩展覆盖 next，next 丢弃
      current.slotSpan = currentSpan + nextSpan;
      dropped.add(next);
      merged.push({
        championId,
        keptSlotIndex: current.slotIndex,
        droppedSlotIndex: next.slotIndex,
        zone: current.zone,
      });
    }
  }

  const kept = working.filter((observation) => !dropped.has(observation));
  return { kept, merged };
}

/**
 * 把一次扫描的观测合并进单个玩家的台账。
 *
 * @param ledger 当前台账（不会被修改）。
 * @param observations 本次扫描观测（同属一个 seat）。
 * @param now 当前时间（epoch ms）。
 * @param config 去重配置。
 * @param deps 去重依赖。
 */
export function mergeObservations(
  ledger: PlayerLedger,
  observations: ReadonlyArray<ObservationRecord>,
  now: number,
  config: DedupConfig,
  deps: DedupDeps,
): MergeOutcome {
  const seat = ledger.seat;
  const slots: Record<SlotKey, UnitInstance> = { ...(ledger.slots ?? {}) };
  const outcome: MergeOutcome = {
    ledger: { ...ledger, slots },
    added: [],
    updated: [],
    replaced: [],
    removed: [],
    lockedSkipped: [],
    filtered: [],
    merged: [],
    unstable: [],
    displaced: [],
  };

  // ---- 步骤 1：过滤黑名单 / 未知 id ----
  const valid: ObservationRecord[] = [];
  for (const observation of observations) {
    if (isDiscarded(observation, deps)) {
      outcome.filtered.push(observation.championId ?? '<empty>');
      continue;
    }
    valid.push(observation);
  }

  // ---- 步骤 2：同帧相邻槽位合并 ----
  const { kept, merged } = mergeAdjacentSlots(valid, deps);
  outcome.merged = merged;

  // ---- 步骤 3：被合并掉的槽位 —— 删除其上的旧实例，避免重复计数 ----
  for (const item of merged) {
    const key = makeSlotKey(seat, item.zone, item.droppedSlotIndex);
    const existing = slots[key];
    if (existing) {
      delete slots[key];
      outcome.removed.push(existing.instanceId);
      outcome.displaced.push(existing);
    }
  }

  // ---- 步骤 3b：多格实例的残留清理 ----
  //
  // 场景：上一帧只看到多格弈子（如远古巨龙）的其中一格，把它写成了**单格实例**；
  // 本帧视觉层已判决这是一只占多格的同一实例。若不清理旧槽位，台账里会同时存在
  // 「span=2 的实例」与「span=1 的残留」，按张数统计时重复计数（巨龙只消耗 1 张）。
  //
  // 两条路径：
  // (a) 视觉层给了 `mergedSlotIndices`（精确格位，可为竖排）→ 按精确格位清理；
  // (b) 只给了 `slotSpan > 1`（无方向信息）→ 用 `coveredCellsFallback` 推算覆盖格
  //     （水平优先、行末转竖向，每步都做二维相邻校验，不是线性加偏移）。
  //
  // 路径 (b) 额外收敛：只清理**同弈子、同星级、且自身为单格**的残留实例。
  // 真正相邻的另一只多格弈子其 span 必然 > 1，因此不会被误删。
  const geometry = { board: deps.boardCols, bench: deps.benchCols, shop: deps.shopCols };

  for (const observation of kept) {
    const championId = observation.championId;
    if (championId === null) {
      continue;
    }

    const span = observation.slotSpan ?? 1;
    const fromPrecise = observation.mergedSlotIndices !== undefined;
    const teamSlots = deps.championIndex.get(championId)?.special?.teamSlots ?? 1;
    const coveredSlots =
      observation.mergedSlotIndices ??
      (span > 1 && teamSlots > 1
        ? coveredCellsFallback(observation.zone, observation.slotIndex, span, geometry)
        : undefined);

    if (coveredSlots === undefined) {
      continue;
    }

    for (const coveredIndex of coveredSlots) {
      const key = makeSlotKey(seat, observation.zone, coveredIndex);
      const existing = slots[key];
      if (existing === undefined) {
        continue;
      }
      if (
        !fromPrecise &&
        (existing.championId !== championId ||
          existing.star !== observation.star ||
          (existing.slotSpan ?? 1) !== 1)
      ) {
        continue;
      }
      delete slots[key];
      outcome.removed.push(existing.instanceId);
      outcome.displaced.push(existing);
    }
  }

  // ---- 步骤 4：写槽位（有棋子）----
  for (const observation of kept) {
    if (observation.championId === null) {
      continue;
    }
    const key = makeSlotKey(seat, observation.zone, observation.slotIndex);
    const existing = slots[key];

    if (existing?.locked) {
      // 规则 5：锁定槽位只记录系统建议，绝不覆盖用户值
      slots[key] = { ...existing, autoSuggest: observation.star ? deps.copiesOfStar(observation.star) : 0 };
      outcome.lockedSkipped.push(key);
      continue;
    }

    if (existing) {
      const sameInstance =
        existing.championId === observation.championId &&
        existing.star === observation.star &&
        isSimilarFingerprint(
          normalizeFingerprint(existing.fingerprint),
          normalizeFingerprint(observation.fingerprint),
          config.fingerprintSameThreshold,
        );

      if (sameInstance) {
        // 规则 1：同一实例 —— 只刷新 lastSeenAt / confidence，绝不新增
        slots[key] = {
          ...existing,
          lastSeenAt: now,
          confidence: Math.max(existing.confidence, observation.confidence),
          slotSpan: observation.slotSpan ?? existing.slotSpan,
          unstable: false,
        };
        outcome.updated.push(existing.instanceId);
        continue;
      }

      // 规则 2：换牌 / 升星 —— 替换，旧记录由调用方写入 history
      const firstSeenAt = now;
      const instance: UnitInstance = {
        instanceId: makeInstanceId(seat, observation.zone, observation.slotIndex, firstSeenAt),
        championId: observation.championId,
        star: observation.star,
        copies: deps.copiesOfStar(observation.star),
        seat,
        zone: observation.zone,
        slotIndex: observation.slotIndex,
        slotSpan: observation.slotSpan ?? 1,
        confidence: observation.confidence,
        fingerprint: normalizeFingerprint(observation.fingerprint),
        firstSeenAt,
        lastSeenAt: now,
        source: 'auto',
        locked: false,
        unstable: false,
      };
      slots[key] = instance;
      outcome.replaced.push(instance.instanceId);
      outcome.displaced.push(existing);
      continue;
    }

    // 新槽位
    const instance: UnitInstance = {
      instanceId: makeInstanceId(seat, observation.zone, observation.slotIndex, now),
      championId: observation.championId,
      star: observation.star,
      copies: deps.copiesOfStar(observation.star),
      seat,
      zone: observation.zone,
      slotIndex: observation.slotIndex,
      slotSpan: observation.slotSpan ?? 1,
      confidence: observation.confidence,
      fingerprint: normalizeFingerprint(observation.fingerprint),
      firstSeenAt: now,
      lastSeenAt: now,
      source: 'auto',
      locked: false,
      unstable: false,
    };
    slots[key] = instance;
    outcome.added.push(instance.instanceId);
  }

  // ---- 步骤 5：空槽处理（规则 3）----
  for (const observation of valid) {
    if (observation.championId !== null) {
      continue;
    }
    const key = makeSlotKey(seat, observation.zone, observation.slotIndex);
    const existing = slots[key];
    if (!existing) {
      continue;
    }
    if (existing.locked) {
      outcome.lockedSkipped.push(key);
      continue;
    }
    if (now - existing.lastSeenAt > config.staleTtlMs) {
      delete slots[key];
      outcome.removed.push(existing.instanceId);
      outcome.displaced.push(existing);
    } else {
      slots[key] = { ...existing, unstable: true };
      outcome.unstable.push(existing.instanceId);
    }
  }

  outcome.ledger = { ...outcome.ledger, slots };
  return outcome;
}

/**
 * 只清理"本帧被观测到"的过期槽位。
 *
 * 注意：绝不能扫描全表清理 —— 用户正在看第 3 家时，其它 7 家的
 * lastSeenAt 自然是很久以前的，全表清理会把辛苦积累的台账清空。
 *
 * @param ledger 台账。
 * @param observedSlotKeys 本帧被观测到的槽位键集合。
 * @param now 当前时间。
 * @param ttlMs stale TTL。
 */
export function sweepStale(
  ledger: PlayerLedger,
  observedSlotKeys: ReadonlySet<SlotKey>,
  now: number,
  ttlMs: number = STALE_TTL_MS,
): { ledger: PlayerLedger; removed: string[] } {
  const slots: Record<SlotKey, UnitInstance> = { ...(ledger.slots ?? {}) };
  const removed: string[] = [];
  for (const key of observedSlotKeys) {
    const existing = slots[key];
    if (existing && !existing.locked && now - existing.lastSeenAt > ttlMs) {
      delete slots[key];
      removed.push(existing.instanceId);
    }
  }
  return { ledger: { ...ledger, slots }, removed };
}

/**
 * 清理全部过期槽位（显式调用，例如选秀结束后恢复全量扫描）。
 *
 * @param ledger 台账。
 * @param now 当前时间。
 * @param ttlMs stale TTL。
 */
export function sweepAllStale(
  ledger: PlayerLedger,
  now: number,
  ttlMs: number = STALE_TTL_MS,
): { ledger: PlayerLedger; removed: string[] } {
  const slots: Record<SlotKey, UnitInstance> = { ...(ledger.slots ?? {}) };
  const removed: string[] = [];
  for (const [key, instance] of Object.entries(slots)) {
    if (instance && !instance.locked && now - instance.lastSeenAt > ttlMs) {
      delete slots[key];
      removed.push(instance.instanceId);
    }
  }
  return { ledger: { ...ledger, slots }, removed };
}
