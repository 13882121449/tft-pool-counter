/**
 * 多格实例（远古巨龙，`teamSlots > 1`）在**识别阶段**的合并与 `slotSpan` 标注。
 *
 * 架构 §4.2 的 `ObservationRecord.slotSpan` 语义为"本观测代表一个占多格的实例"。
 * 识别层在完成裁决（拿到 `championId`）后，即可依据 `teamSlots` + **二维相邻**
 * 关系把同一只巨龙占据的多格观测并成一条（`slotSpan = 2`），让引擎按「实例」
 * 而非「格子」计数（QA M2：该契约此前未接线，`slotSpan` 分支恒为死代码）。
 *
 * 与引擎的关系：识别层是**主产出**，`dedup.mergeAdjacentSlots` 是同一几何判定的
 * **第二道保险**，`rules/double-slot.rule` 是第三道。三者共用 `@core` 的
 * `slot-geometry`，口径不会漂移（不会出现"识别层并了、引擎又并一次"的双计，
 * 因为并掉的那一格观测已从数组里移除）。
 */

import {
  colsForZone,
  isOrthogonallyAdjacent,
  type ZoneCols,
} from '../../core/pool-engine/slot-geometry';
import type { ObservationRecord } from '../../shared/types/scan';

/** 一次多格合并记录（供调试 / 统计）。 */
export interface MultiCellMerge {
  championId: string;
  keptSlotIndex: number;
  droppedSlotIndex: number;
}

/** 合并产出。 */
export interface MultiCellOutcome {
  /** 合并后的观测（新数组；原始观测不被引用修改） */
  observations: ObservationRecord[];
  /** 被合并掉的观测记录。 */
  merged: MultiCellMerge[];
}

/** 分桶结构：同一 (zone, championId, star) 的候选观测。 */
interface CellBucket {
  championId: string;
  maxSlots: number;
  items: ObservationRecord[];
}

/** 被保留观测的合并信息（供写回 slotSpan / mergedSlotIndices）。 */
interface MultiCellMergeInfo {
  span: number;
  mergedSlots: number[];
}

/**
 * 依 `teamSlots` 与几何相邻关系合并同一实例的多格观测，并写入 `slotSpan`。
 *
 * 输入数组与其元素**不被修改**：需要打标时复制观测对象。
 *
 * @param observations 已裁决的观测（含 board/bench）。
 * @param cols 各区域列数（把线性 slotIndex 还原为二维坐标）。
 * @param teamSlots championId → 占用格数（缺省 1，即不参与合并）。
 * @returns `{ observations, merged }`。
 */
export function applyMultiCellHints(
  observations: ReadonlyArray<ObservationRecord>,
  cols: ZoneCols,
  teamSlots: ReadonlyMap<string, number>,
): MultiCellOutcome {
  const merged: MultiCellMerge[] = [];
  if (teamSlots.size === 0) {
    return { observations: [...observations], merged };
  }

  // 只有 teamSlots > 1 的弈子才可能占多格，按 (zone, championId, star) 分桶
  const buckets = new Map<string, CellBucket>();
  for (const observation of observations) {
    const championId = observation.championId;
    if (championId === null) {
      continue;
    }
    const maxSlots = teamSlots.get(championId) ?? 1;
    if (maxSlots <= 1) {
      continue;
    }
    const key = `${observation.zone}|${championId}|${observation.star}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.items.push(observation);
    } else {
      buckets.set(key, { championId, maxSlots, items: [observation] });
    }
  }

  const dropped = new Set<ObservationRecord>();
  const keptInfo = new Map<ObservationRecord, MultiCellMergeInfo>();

  for (const bucket of buckets.values()) {
    const sorted = [...bucket.items].sort((a, b) => a.slotIndex - b.slotIndex);
    let current: ObservationRecord | null = null;
    let span = 1;
    let mergedSlots: number[] = [];
    for (const next of sorted) {
      if (current === null) {
        current = next;
        span = 1;
        mergedSlots = [];
        continue;
      }
      const endCell = current.slotIndex + span - 1;
      const zoneCols = colsForZone(current.zone, cols);
      if (span + 1 <= bucket.maxSlots && isOrthogonallyAdjacent(endCell, next.slotIndex, zoneCols)) {
        span += 1;
        mergedSlots.push(next.slotIndex);
        dropped.add(next);
        merged.push({
          championId: bucket.championId,
          keptSlotIndex: current.slotIndex,
          droppedSlotIndex: next.slotIndex,
        });
      } else {
        keptInfo.set(current, { span, mergedSlots });
        current = next;
        span = 1;
        mergedSlots = [];
      }
    }
    if (current !== null) {
      keptInfo.set(current, { span, mergedSlots });
    }
  }

  const result: ObservationRecord[] = [];
  for (const observation of observations) {
    if (dropped.has(observation)) {
      continue;
    }
    const info = keptInfo.get(observation);
    if (info !== undefined && info.span > 1) {
      result.push({
        ...observation,
        slotSpan: info.span,
        mergedSlotIndices: [...info.mergedSlots],
      });
    } else {
      result.push(observation);
    }
  }
  return { observations: result, merged };
}
