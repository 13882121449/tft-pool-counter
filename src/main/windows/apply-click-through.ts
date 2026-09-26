/**
 * 点击穿透联动（ADR-07）。
 *
 * 穿透是"双刃剑"：开启后鼠标事件全部穿透到游戏，HUD 变成一个纯显示器，
 * 但用户也就**再也点不到 HUD**了（连"关闭穿透"的按钮都点不到）。
 * 因此必须由常驻把手窗口兜底：
 *
 *   穿透 ON  → 把手显示（唯一可点区域）、HUD 不可点
 *   穿透 OFF → 把手隐藏、HUD 可点
 *
 * 本文件只负责"把两个窗口的状态同步好"，持久化由 WindowManager 负责。
 */

import type { BrowserWindow } from 'electron';
import { moveHandleTo, setHandleVisible } from './handle-window';
import { setClickThrough as setHudClickThrough } from './hud-window';

/**
 * 应用穿透状态到 HUD 与把手窗口。
 *
 * @param hud HUD 窗口（可能为 null）。
 * @param on true = 开启穿透。
 */
export function applyClickThroughLinkage(hud: BrowserWindow | null, on: boolean): void {
  if (hud !== null && !hud.isDestroyed()) {
    setHudClickThrough(hud, on);
    if (on) {
      // 把把手对齐到 HUD 左上角，确保用户"看得见、点得到"
      const bounds = hud.getBounds();
      moveHandleTo(bounds.x, bounds.y);
    }
  }
  // 穿透开启时把手必须可见（这是唯一逃生口）；关闭后可隐藏减少干扰
  setHandleVisible(on);
}

/**
 * 计算开启穿透后把手的期望位置（供窗口创建时使用）。
 *
 * @param hudX HUD x。
 * @param hudY HUD y。
 */
export function handleAnchor(hudX: number, hudY: number): { x: number; y: number } {
  return { x: hudX, y: hudY };
}
