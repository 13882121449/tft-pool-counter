/**
 * 三窗口编排（架构 §3.6 / ADR-07）。
 *
 * 管理 HUD（透明置顶）/ Settings（单例有边框）/ Handle（10×10 常驻点）三个窗口，
 * 并把窗口状态（位置/尺寸/缩放/不透明度/穿透/模式）统一写回 `AppConfig.window`：
 * **配置是唯一状态源**，因此重启后窗口状态必然一致。
 */

import type { BrowserWindow } from 'electron';
import type { WindowConfig } from '../../shared/types/config';
import type { WindowActionRequest } from '../../shared/types/ipc';
import type { ConfigStore } from '../store/config-store';
import { logger } from '../system/logger';
import { applyClickThroughLinkage } from './apply-click-through';
import {
  createHandleWindow,
  disposeHandleWindow,
  getHandleWindow,
  moveHandleTo,
  setHandleVisible,
} from './handle-window';
import { HUD_WINDOW_DEFAULTS, applyScale, createHudWindow, setOpacity } from './hud-window';
import { closeSettingsWindow, getSettingsWindow, openSettingsWindow } from './settings-window';
import { resolveBounds, trackWindowState } from './window-state';

/** Mini 模式尺寸。 */
export const MINI_WINDOW_SIZE = { width: 240, height: 132 } as const;

/**
 * 三窗口管理器。
 */
export class WindowManager {
  private hudWindow: BrowserWindow | null = null;

  private detachState: (() => void) | null = null;

  /**
   * @param config 配置存储（窗口状态的唯一来源）。
   * @param devServerUrl Vite dev server 地址（开发态）。
   */
  constructor(
    private readonly config: ConfigStore,
    private readonly devServerUrl: string = '',
  ) {}

  /**
   * 创建 HUD + Handle 窗口并接线。
   *
   * @returns HUD 窗口。
   */
  createAll(): BrowserWindow {
    const windowConfig = this.config.get().window;
    const bounds = resolveBounds(windowConfig);

    const hud = createHudWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      devServerUrl: this.devServerUrl,
      clickThrough: windowConfig.clickThrough,
      opacity: windowConfig.opacity,
    });
    this.hudWindow = hud;

    applyScale(hud, windowConfig.scale);
    if (windowConfig.mode === 'mini') {
      this.sizeHud(hud, 'mini');
    }

    hud.on('closed', () => {
      this.detachState?.();
      this.detachState = null;
      this.hudWindow = null;
    });
    hud.on('move', () => {
      if (hud.isDestroyed()) {
        return;
      }
      const next = hud.getBounds();
      moveHandleTo(next.x, next.y);
    });

    createHandleWindow(bounds.x, bounds.y, this.devServerUrl);
    applyClickThroughLinkage(hud, windowConfig.clickThrough);

    this.detachState = trackWindowState(hud, (patch) => {
      this.config.set({
        window: { ...this.config.get().window, ...patch },
      });
    });

    logger.info('[windows] 三窗口已创建', { bounds, mode: windowConfig.mode });
    return hud;
  }

  /** HUD 窗口。 */
  hud(): BrowserWindow | null {
    return this.hudWindow !== null && !this.hudWindow.isDestroyed() ? this.hudWindow : null;
  }

  /** 把手窗口。 */
  handle(): BrowserWindow | null {
    return getHandleWindow();
  }

  /** 设置窗口。 */
  settings(): BrowserWindow | null {
    return getSettingsWindow();
  }

  /** 打开（或聚焦）设置窗口。 */
  openSettings(): BrowserWindow {
    return openSettingsWindow(this.devServerUrl);
  }

  /** 全部存活窗口（推送广播用）。 */
  allWindows(): BrowserWindow[] {
    return [this.hudWindow, getHandleWindow(), getSettingsWindow()].filter(
      (window): window is BrowserWindow => window !== null && !window.isDestroyed(),
    );
  }

  /**
   * 显隐 HUD（热键 / 托盘）。
   *
   * @returns 切换后的可见性。
   */
  toggleVisible(): boolean {
    const hud = this.hud();
    if (hud === null) {
      return false;
    }
    const nextVisible = !hud.isVisible();
    if (nextVisible) {
      hud.showInactive();
      if (this.config.get().window.clickThrough) {
        const bounds = hud.getBounds();
        moveHandleTo(bounds.x, bounds.y);
        setHandleVisible(true);
      }
    } else {
      hud.hide();
      setHandleVisible(false);
    }
    return nextVisible;
  }

  /**
   * 设置点击穿透并持久化。
   *
   * @param on 是否开启穿透。
   */
  setClickThrough(on: boolean): void {
    applyClickThroughLinkage(this.hud(), on);
    this.config.set({ window: { ...this.config.get().window, clickThrough: on } });
  }

  /**
   * 切换完整 / 迷你模式。
   *
   * @param mode 目标模式。
   */
  setMode(mode: WindowConfig['mode']): void {
    const hud = this.hud();
    if (hud !== null) {
      this.sizeHud(hud, mode);
    }
    this.config.set({ window: { ...this.config.get().window, mode } });
  }

  /**
   * 应用一批窗口配置并派发持久化（设置页保存时调用）。
   *
   * @param patch 窗口配置片段。
   */
  applyConfigPatch(patch: Partial<WindowConfig>): void {
    const next: WindowConfig = { ...this.config.get().window, ...patch };
    this.applyWindowConfig(next);
    this.config.set({ window: next });
  }

  /**
   * **只**把窗口配置应用到窗口，不落盘。
   *
   * 供 `config.set()` 的副作用路径调用，避免"配置写入 → 再写一次配置"的写放大。
   *
   * @param next 目标窗口配置。
   */
  applyWindowConfig(next: WindowConfig): void {
    const hud = this.hud();
    if (hud === null) {
      return;
    }
    setOpacity(hud, next.opacity);
    applyScale(hud, next.scale);
    this.sizeHud(hud, next.mode);
    applyClickThroughLinkage(hud, next.clickThrough);
  }

  /**
   * 处理渲染进程发来的窗口动作（IPC）。
   *
   * @param request 动作请求。
   */
  handleAction(request: WindowActionRequest): void {
    switch (request.action) {
      case 'minimize': {
        this.hud()?.minimize();
        break;
      }
      case 'close': {
        this.hud()?.close();
        break;
      }
      case 'toggle-visible': {
        this.toggleVisible();
        break;
      }
      case 'set-click-through': {
        this.setClickThrough(request.value === true);
        break;
      }
      case 'set-mode': {
        this.setMode(request.value === 'mini' ? 'mini' : 'full');
        break;
      }
      case 'open-settings': {
        this.openSettings();
        break;
      }
      default:
        break;
    }
  }

  /** 按模式调整 HUD 尺寸（保持右下角贴边观感）。 */
  private sizeHud(hud: BrowserWindow, mode: WindowConfig['mode']): void {
    if (hud.isDestroyed()) {
      return;
    }
    const bounds = hud.getBounds();
    const size =
      mode === 'mini'
        ? MINI_WINDOW_SIZE
        : { width: this.config.get().window.width || HUD_WINDOW_DEFAULTS.width, height: this.config.get().window.height || HUD_WINDOW_DEFAULTS.height };
    hud.setBounds({ x: bounds.x, y: bounds.y, width: size.width, height: size.height });
  }

  /** 释放所有窗口。 */
  dispose(): void {
    this.detachState?.();
    this.detachState = null;
    disposeHandleWindow();
    closeSettingsWindow();
    const hud = this.hudWindow;
    this.hudWindow = null;
    if (hud !== null && !hud.isDestroyed()) {
      hud.destroy();
    }
  }
}
