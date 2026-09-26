/**
 * 窗口域 IPC（架构 §8.3）。
 *
 * 通道：`window:action`（移动/关闭/穿透/Mini 切换）/ `window:bounds` / `window:state`
 */

import { ipcMain } from 'electron';
import type { WindowConfig } from '../../shared/types/config';
import type { WindowActionRequest } from '../../shared/types/ipc';
import { CH_WINDOW_ACTION, CH_WINDOW_BOUNDS, CH_WINDOW_STATE } from '../../shared/ipc/channels';
import type { AppServices } from './context';
import { wrap } from './wrap';

/** HUD 窗口矩形（可结构化克隆）。 */
export interface WindowBoundsSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 注册窗口域 handler。
 *
 * @param services 服务集合。
 */
export function registerWindowHandlers(services: AppServices): void {
  ipcMain.handle(CH_WINDOW_ACTION, (_event, request: WindowActionRequest) =>
    wrap<WindowBoundsSnapshot | null>(() => {
      services.windows.handleAction(request);
      const hud = services.windows.hud();
      return hud !== null ? hud.getBounds() : null;
    }),
  );

  ipcMain.handle(CH_WINDOW_BOUNDS, () =>
    wrap<WindowBoundsSnapshot | null>(() => {
      const hud = services.windows.hud();
      return hud !== null ? hud.getBounds() : null;
    }),
  );

  ipcMain.handle(CH_WINDOW_STATE, () => wrap<WindowConfig>(() => services.config.get().window));
}
