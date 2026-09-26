/**
 * HUD 悬浮窗创建与基础行为（ADR-07）。
 *
 * 关键窗口属性：
 * - `transparent + frame:false + skipTaskbar + hasShadow:false` → 真正的悬浮窗观感；
 * - `setAlwaysOnTop(true, 'screen-saver')` → 尽可能压过全屏游戏；
 * - 通过 preload 暴露的 IPC API 与渲染进程通信（`nodeIntegration: false`）。
 *
 * 合规：窗口层不涉及任何游戏进程交互；"能不能盖住游戏"只取决于系统 Z 序，
 * 我们不会去做任何 hook / 注入来强行置顶。
 */

import { BrowserWindow } from 'electron';
import { preloadPath } from '../store/paths';
import { resolveRendererUrl } from './renderer-url';

/** HUD 窗口默认尺寸（PRD 5.1 线框：340×640）。 */
export const HUD_WINDOW_DEFAULTS = {
  width: 340,
  height: 640,
  minWidth: 220,
  minHeight: 240,
} as const;

/** 创建 HUD 窗口的参数。 */
export interface CreateHudWindowOptions {
  x: number;
  y: number;
  devServerUrl: string;
  width?: number;
  height?: number;
  /** 是否开启点击穿透（穿透态由 Handle 窗口兜底恢复）。 */
  clickThrough?: boolean;
  opacity?: number;
}

/**
 * 创建 HUD 悬浮窗。
 *
 * @param options 窗口参数。
 * @returns 已创建并开始加载入口的 BrowserWindow。
 */
export function createHudWindow(options: CreateHudWindowOptions): BrowserWindow {
  const width = options.width ?? HUD_WINDOW_DEFAULTS.width;
  const height = options.height ?? HUD_WINDOW_DEFAULTS.height;

  const window = new BrowserWindow({
    x: options.x,
    y: options.y,
    width,
    height,
    minWidth: HUD_WINDOW_DEFAULTS.minWidth,
    minHeight: HUD_WINDOW_DEFAULTS.minHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setOpacity(clampOpacity(options.opacity ?? 0.92));
  window.setIgnoreMouseEvents(Boolean(options.clickThrough), { forward: true });

  // 合规：不在窗口内打开任何外部链接
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  void window.loadURL(resolveRendererUrl('hud.html', options.devServerUrl));
  return window;
}

/** 把不透明度夹到系统可接受区间。 */
function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.92;
  }
  return Math.min(1, Math.max(0.4, value));
}

/**
 * 切换点击穿透。
 *
 * @param window 目标窗口。
 * @param on true = 穿透（鼠标事件穿透到下层游戏）。
 */
export function setClickThrough(window: BrowserWindow, on: boolean): void {
  if (window.isDestroyed()) {
    return;
  }
  window.setIgnoreMouseEvents(on, { forward: true });
}

/**
 * 设置窗口不透明度。
 *
 * @param window 目标窗口。
 * @param opacity 0.4 ~ 1。
 */
export function setOpacity(window: BrowserWindow, opacity: number): void {
  if (window.isDestroyed()) {
    return;
  }
  window.setOpacity(clampOpacity(opacity));
}

/**
 * 应用缩放（用户偏好）。
 *
 * @param window 目标窗口。
 * @param scale 0.8 ~ 1.5。
 */
export function applyScale(window: BrowserWindow, scale: number): void {
  if (window.isDestroyed()) {
    return;
  }
  const factor = Math.min(1.5, Math.max(0.8, Number.isFinite(scale) ? scale : 1));
  window.webContents.setZoomFactor(factor);
}
