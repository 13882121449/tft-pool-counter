/**
 * 双槽位弈子规则（E8 / 远古巨龙）。
 *
 * 远古巨龙 `teamSlots = 2` 占 2 个上阵格，但只消耗池中 1 张。
 * 若按格子计数，每只巨龙会多算 1 张 → 系统性高估消耗。
 *
 * 处理：把同一家、同一区域、同星级、**水平/垂直相邻**的实例聚成一个逻辑实例，
 * 每个逻辑实例只按 `starCopyCost[star]` 计一次。
 * 不相邻的同款弈子视为多只，各自独立计数（避免把 2 只巨龙误并成 1 只）。
 *
 * "相邻"必须是**二维几何相邻**（见 `slot-geometry`），而不是线性索引相邻，
 * 否则 7 列棋盘上的 `row1col6(13)` 与 `row2col0(14)` 会被误并（QA M1）。
 */

import type { UnitInstance } from '../../../shared/types/domain';
import type { PoolRulePlugin, RuleContext } from './types';
import { recomputeAggregate } from './types';
import { colsForZone, isOrthogonallyAdjacent } from '../slot-geometry';

/** 一个聚类（= 一个逻辑实例）。 */
interface SlotCluster {
  star: UnitInstance['star'];
  startSlot: number;
  /** 末端覆盖格 + 1（沿用"半开区间"约定：覆盖格为 `[startSlot, endSlot)`）。 */
  endSlot: number;
  representative: UnitInstance;
}

/**
 * 把同 seat/zone/star 且**二维相邻**的实例聚成簇。
 *
 * 已合并的簇可继续吞并其末端格的相邻格，直到达到 `teamSlots` 上限。
 *
 * @param instances 同一 seat+zone 的实例（需已按 slotIndex 升序）。
 * @param teamSlots 该弈子占用格数（>1 才需要聚类）。
 * @param cols 该区域的列数（几何相邻判定用）。
 */
function clusterAdjacent(
  instances: ReadonlyArray<UnitInstance>,
  teamSlots: number,
  cols: number,
): SlotCluster[] {
  if (teamSlots <= 1) {
    return instances.map((instance) => ({
      star: instance.star,
      startSlot: instance.slotIndex,
      endSlot: instance.slotIndex + Math.max(1, instance.slotSpan),
      representative: instance,
    }));
  }

  const clusters: SlotCluster[] = [];
  for (const instance of instances) {
    const span = Math.max(1, instance.slotSpan);
    const last = clusters[clusters.length - 1];
    if (last) {
      const covered = last.endSlot - last.startSlot; // 已覆盖格数
      const lastCell = last.endSlot - 1; // 末端覆盖格
      if (
        last.star === instance.star &&
        covered + span <= teamSlots &&
        isOrthogonallyAdjacent(lastCell, instance.slotIndex, cols)
      ) {
        last.endSlot = instance.slotIndex + span;
        continue;
      }
    }
    clusters.push({
      star: instance.star,
      startSlot: instance.slotIndex,
      endSlot: instance.slotIndex + span,
      representative: instance,
    });
  }
  return clusters;
}

/** 构造双槽位规则。 */
export function createDoubleSlotRule(): PoolRulePlugin {
  return {
    id: 'double-slot',
    order: 20,
    apply(ctx: RuleContext): void {
      for (const aggregate of ctx.aggregates.values()) {
        const champion = ctx.championIndex.get(aggregate.championId);
        const teamSlots = champion?.special?.teamSlots ?? 1;
        if (teamSlots <= 1) {
          continue;
        }

        const groups = new Map<string, UnitInstance[]>();
        for (const instance of aggregate.instances) {
          const key = `${instance.seat}|${instance.zone}|${instance.star}`;
          const bucket = groups.get(key);
          if (bucket) {
            bucket.push(instance);
          } else {
            groups.set(key, [instance]);
          }
        }

        const merged: UnitInstance[] = [];
        for (const bucket of groups.values()) {
          const sorted = [...bucket].sort((a, b) => a.slotIndex - b.slotIndex);
          const zone = sorted[0]?.zone ?? 'board';
          const cols = colsForZone(zone, ctx.zoneCols);
          for (const cluster of clusterAdjacent(sorted, teamSlots, cols)) {
            merged.push(cluster.representative);
          }
        }

        if (merged.length !== aggregate.instances.length) {
          aggregate.instances = merged;
          recomputeAggregate(aggregate);
        }
      }
    },
  };
}

/** 默认实例。 */
export const doubleSlotRule: PoolRulePlugin = createDoubleSlotRule();
