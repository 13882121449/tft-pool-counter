/**
 * 商店格识别（PRD P1，默认关闭，`enableShopDetect: false`）。
 *
 * 重要语义约束（防止把商店里的棋子算进卡池消耗）：
 * - 商店中的棋子**仍在卡池里**，不计入 `observedCopies`；
 * - 商店格只用于两件事：① 辅助判断当前等级/阶段；② 提示"这张卡还在池里"，
 *   间接帮助用户判断剩余数是否被高估。
 *
 * 因此本模块产出的 `ShopSlot` 与 `ObservationRecord` **在类型上就是分开的**，
 * 引擎只消费 `observations`，从结构上杜绝"商店误计入消耗"。
 */

import type { Cost } from '../../shared/types/domain';
import type { ShopSlot } from '../../shared/types/scan';
import type { SlotSample } from './slot-extractor';

/** 商店格匹配结果（由匹配器回填）。 */
export interface ShopSlotMatch {
  slotIndex: number;
  championId: string | null;
  confidence: number;
  cost: Cost | null;
}

/**
 * 把商店格的匹配结果转成 IPC 契约类型。
 *
 * @param matches 匹配结果。
 * @param wispSlotIndex 小精灵占据的格位（必须排除，来自 board-geometry.json）。
 * @returns 商店格观测列表。
 */
export function toShopSlots(matches: ShopSlotMatch[], wispSlotIndex = 4): ShopSlot[] {
  return matches
    .filter((match) => match.slotIndex !== wispSlotIndex)
    .map((match) => ({
      slotIndex: match.slotIndex,
      championId: match.championId,
      confidence: match.confidence,
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

/**
 * 判断商店条是否"有内容"（用于阶段识别辅助）。
 *
 * @param samples 商店格样本。
 */
export function shopHasContent(samples: SlotSample[]): boolean {
  const nonBlank = samples.filter((sample) => !sample.blank);
  return nonBlank.length >= 3;
}

/**
 * 统计商店格数量（含空格），用于校验标定是否合理。
 *
 * @param samples 商店格样本。
 * @param expectedSlots 期望格数。
 */
export function validateShopGeometry(
  samples: SlotSample[],
  expectedSlots: number,
): { ok: boolean; reason?: string } {
  if (samples.length !== expectedSlots) {
    return {
      ok: false,
      reason: `商店格数量 ${samples.length} 与期望 ${expectedSlots} 不一致`,
    };
  }
  return { ok: true };
}
