/**
 * 设置窗口（单例，ADR-07）。
 *
 * 与 HUD 的差别：
 * - 常规窗口（有边框、可缩放、出现在任务栏），因为里面全是表单控件；
 * - **单例**：重复点击托盘/把手只聚焦已有窗口，绝不叠出好几个设置页；
 * - 关闭时只是隐藏（`hide()`），下次打开更快，也保留未提交的表单状态。
 */

import { BrowserWindow, screen } from 'electron';
import { preloadPath } from '../store/paths';
import { resolveRendererUrl } from './renderer-url';

/** 设置窗口默认尺寸。 */
export const SETTINGS_WINDOW_DEFAULTS = {
  width: 920,
  height: 700,
  minWidth: 720,
  minHeight: 520,
} as const;

/** 已创建的设置窗口（单例）。 */
let settingsWindow: BrowserWindow | null = null;

/**
 * 计算设置窗口位置（主显示器居中）。
 */
export function settingsBounds(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + Math.round((area.width - SETTINGS_WINDOW_DEFAULTS.width) / 2),
    y: area.y + Math.round((area.height - SETTINGS_WINDOW_DEFAULTS.height) / 2),
  };
}

/**
 * 打开（或聚焦）设置窗口。
 *
 * @param devServerUrl Vite dev server 地址（开发态）。
 * @param onClosed 窗口关闭后的回调（用于清理引用）。
 * @returns 设置窗口实例。
 */
export function openSettingsWindow(
  devServerUrl: string,
  onClosed?: () => void,
): BrowserWindow {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const bounds = settingsBounds();
  const window = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: SETTINGS_WINDOW_DEFAULTS.width,
    height: SETTINGS_WINDOW_DEFAULTS.height,
    minWidth: SETTINGS_WINDOW_DEFAULTS.minWidth,
    minHeight: SETTINGS_WINDOW_DEFAULTS.minHeight,
    title: 'TFT 牌库剩余计数器 · 设置',
    backgroundColor: '#12151c',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  window.on('closed', () => {
    settingsWindow = null;
    onClosed?.();
  });

  void window.loadURL(resolveRendererUrl('settings.html', devServerUrl));
  settingsWindow = window;
  return window;
}

/** 当前设置窗口（可能为 null）。 */
export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow !== null && !settingsWindow.isDestroyed() ? settingsWindow : null;
}

/**
 * 关闭设置窗口（真正销毁，用于"退出应用"路径）。
 */
export function closeSettingsWindow(): void {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.destroy();
  }
  settingsWindow = null;
}

/**
 * 探测设置窗口是否已存在（供 IPC 判断是否需要推送）。
 */
export function hasSettingsWindow(): boolean {
  return getSettingsWindow() !== null;
}
