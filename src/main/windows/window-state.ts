/**
 * 窗口状态持久化与贴边吸附。
 *
 * 状态**不单独存文件**，而是落在 `AppConfig.window`（唯一配置源）：
 * 用户重装/清配置后 HUD 会回到默认贴右边缘位置，符合直觉。
 *
 * 贴边吸附（PRD 5.1）：HUD 拖到屏幕边缘 16px 内时自动吸附，避免"差几个像素"
 * 的悬浮窗挡到游戏 UI。
 */

import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import type { WindowConfig } from '../../shared/types/config';
import { HUD_WINDOW_DEFAULTS } from './hud-window';

/** 贴边判定阈值（物理像素）。 */
export const SNAP_THRESHOLD = 16;

/** 屏幕边缘留白。 */
export const SNAP_MARGIN = 12;

/** 解析出的窗口矩形。 */
export interface ResolvedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算默认窗口位置：贴右边缘、垂直居中（首次启动）。
 *
 * @param width 窗口宽。
 * @param height 窗口高。
 */
export function defaultBounds(
  width: number = HUD_WINDOW_DEFAULTS.width,
  height: number = HUD_WINDOW_DEFAULTS.height,
): ResolvedBounds {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - width - SNAP_MARGIN,
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}

/**
 * 把保存的位置夹回可见区域（换显示器 / 改分辨率后窗口不会跑到屏幕外）。
 *
 * @param config 配置中的窗口设置。
 */
export function resolveBounds(config: WindowConfig): ResolvedBounds {
  const width = config.width > 0 ? config.width : HUD_WINDOW_DEFAULTS.width;
  const height = config.height > 0 ? config.height : HUD_WINDOW_DEFAULTS.height;

  if (config.x < 0 || config.y < 0) {
    return defaultBounds(width, height);
  }

  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    return (
      config.x + width > area.x &&
      config.x < area.x + area.width &&
      config.y + height > area.y &&
      config.y < area.y + area.height
    );
  });

  if (!visible) {
    return defaultBounds(width, height);
  }

  return { x: config.x, y: config.y, width, height };
}

/**
 * 计算贴边后的坐标。
 *
 * @param x 当前 x。
 * @param y 当前 y。
 * @param width 窗口宽。
 * @param height 窗口高。
 * @returns 吸附后的坐标与吸附到哪一侧。
 */
export function snapToEdge(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; edge: WindowConfig['snapEdge'] } {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  let nextX = x;
  let nextY = y;
  let edge: WindowConfig['snapEdge'] = 'none';

  const minX = area.x + SNAP_MARGIN;
  const maxX = area.x + area.width - width - SNAP_MARGIN;
  const minY = area.y + SNAP_MARGIN;
  const maxY = area.y + area.height - height - SNAP_MARGIN;

  if (Math.abs(x - minX) <= SNAP_THRESHOLD) {
    nextX = minX;
    edge = 'left';
  } else if (Math.abs(x - maxX) <= SNAP_THRESHOLD) {
    nextX = maxX;
    edge = 'right';
  }

  nextY = Math.min(maxY, Math.max(minY, y));
  nextX = Math.min(maxX, Math.max(minX, nextX));

  return { x: nextX, y: nextY, edge };
}

/**
 * 监听窗口移动结束事件并把结果写回配置（节流为"移动结束后一次"）。
 *
 * @param window 目标窗口。
 * @param onPersist 持久化回调（通常写 ConfigStore）。
 * @returns 取消监听函数。
 */
export function trackWindowState(
  window: BrowserWindow,
  onPersist: (patch: Partial<WindowConfig>) => void,
): () => void {
  let timer: NodeJS.Timeout | null = null;

  const handleMove = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (window.isDestroyed()) {
        return;
      }
      const bounds = window.getBounds();
      const snapped = snapToEdge(bounds.x, bounds.y, bounds.width, bounds.height);
      if (snapped.x !== bounds.x || snapped.y !== bounds.y) {
        window.setBounds({ ...bounds, x: snapped.x, y: snapped.y });
      }
      onPersist({
        x: snapped.x,
        y: snapped.y,
        width: bounds.width,
        height: bounds.height,
        snapEdge: snapped.edge,
      });
    }, 250);
  };

  window.on('moved', handleMove);
  window.on('resized', handleMove);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    window.off('moved', handleMove);
    window.off('resized', handleMove);
  };
}
