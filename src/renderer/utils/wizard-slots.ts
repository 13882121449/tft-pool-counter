/**
 * 采集向导槽位键（渲染层镜像实现）。
 *
 * 为什么需要镜像：渲染层**绝不能** import `@vision/*`
 * （会把 sharp / 视觉链路打进浏览器 bundle）。但向导落盘的键必须与
 * `@vision/templates/capture-wizard#wizardSlotKey` 完全一致，
 * 因此这里保留一份纯函数镜像，两侧公式必须同步修改。
 *
 * 背景：board 与 bench 的 `slotIndex` 各自从 0 开始，
 * 而 `WizardAssignments` 是 `Record<number, string>`，
 * 直接用 slotIndex 会互相覆盖，故对非棋盘区域加偏移。
 */

/** 备战席槽位键偏移（与 `@vision` 侧保持一致）。 */
export const WIZARD_SLOT_OFFSET_BENCH = 1_000;

/** 商店槽位键偏移（与 `@vision` 侧保持一致）。 */
export const WIZARD_SLOT_OFFSET_SHOP = 2_000;

/**
 * 把 `(zone, slotIndex)` 映射成全局唯一数字键。
 *
 * @param zone 区域名（'board' | 'bench' | 'shop'）。
 * @param slotIndex 区域内的槽位索引。
 */
export function wizardSlotKey(zone: string, slotIndex: number): number {
  if (zone === 'bench') {
    return WIZARD_SLOT_OFFSET_BENCH + slotIndex;
  }
  if (zone === 'shop') {
    return WIZARD_SLOT_OFFSET_SHOP + slotIndex;
  }
  return slotIndex;
}
