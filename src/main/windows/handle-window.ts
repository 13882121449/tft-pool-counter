/**
 * 常驻把手窗口（10×10，ADR-07）。
 *
 * 存在的唯一理由：**HUD 开启点击穿透后就点不到了**，需要一个"永远点得到"的
 * 小把手把穿透关掉、把 HUD 收成迷你态、或打开设置页。
 *
 * 设计约束：
 * - 尺寸固定 10×10（贴在 HUD 上沿中点），不抢游戏操作区；
 * - 永远 `setIgnoreMouseEvents(false)`（这是它的存在意义）；
 * - 半透明+圆形，视觉上只是一个"小圆点"，不干扰游戏。
 */

import { BrowserWindow, screen } from 'electron';
import { preloadPath } from '../store/paths';
import { resolveRendererUrl } from './renderer-url';

/** 把手窗口尺寸（物理像素）。 */
export const HANDLE_WINDOW_SIZE = 10;

/** 把手相对 HUD 上沿的水平偏移（居中）。 */
export const HANDLE_OFFSET_X = 4;

/** 把手相对 HUD 上沿的垂直偏移。 */
export const HANDLE_OFFSET_Y = -2;

/** 已创建的把手窗口。 */
let handleWindow: BrowserWindow | null = null;

/**
 * 计算把手位置（吸附在 HUD 左上角附近，保证跟随 HUD 移动）。
 *
 * @param hudX HUD 的 x。
 * @param hudY HUD 的 y。
 */
export function handleBounds(hudX: number, hudY: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const area = screen.getDisplayNearestPoint({ x: hudX, y: hudY }).workArea;
  const x = Math.min(
    area.x + area.width - HANDLE_WINDOW_SIZE,
    Math.max(area.x, hudX + HANDLE_OFFSET_X),
  );
  const y = Math.min(
    area.y + area.height - HANDLE_WINDOW_SIZE,
    Math.max(area.y, hudY + HANDLE_OFFSET_Y),
  );
  return { x, y, width: HANDLE_WINDOW_SIZE, height: HANDLE_WINDOW_SIZE };
}

/**
 * 创建把手窗口。
 *
 * @param hudX HUD 的 x。
 * @param hudY HUD 的 y。
 * @param devServerUrl Vite dev server 地址。
 */
export function createHandleWindow(
  hudX: number,
  hudY: number,
  devServerUrl: string,
): BrowserWindow {
  if (handleWindow !== null && !handleWindow.isDestroyed()) {
    return handleWindow;
  }

  const bounds = handleBounds(hudX, hudY);
  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  // 把手必须始终可点击：明确关闭鼠标穿透
  window.setIgnoreMouseEvents(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.showInactive();
    }
  });

  window.on('closed', () => {
    handleWindow = null;
  });

  void window.loadURL(resolveRendererUrl('handle.html', devServerUrl));
  handleWindow = window;
  return window;
}

/** 当前把手窗口。 */
export function getHandleWindow(): BrowserWindow | null {
  return handleWindow !== null && !handleWindow.isDestroyed() ? handleWindow : null;
}

/**
 * 让把手跟随 HUD 移动。
 *
 * @param hudX HUD 的 x。
 * @param hudY HUD 的 y。
 */
export function moveHandleTo(hudX: number, hudY: number): void {
  const window = getHandleWindow();
  if (window === null) {
    return;
  }
  window.setBounds(handleBounds(hudX, hudY));
}

/**
 * 显示/隐藏把手。
 *
 * @param visible 是否可见。
 */
export function setHandleVisible(visible: boolean): void {
  const window = getHandleWindow();
  if (window === null) {
    return;
  }
  if (visible) {
    window.showInactive();
  } else {
    window.hide();
  }
}

/** 销毁把手窗口。 */
export function disposeHandleWindow(): void {
  if (handleWindow !== null && !handleWindow.isDestroyed()) {
    handleWindow.destroy();
  }
  handleWindow = null;
}
