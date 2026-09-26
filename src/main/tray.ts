/**
 * 系统托盘（架构 §3.6）。
 *
 * 提供"即使 HUD 收成迷你态 / 被隐藏也能操作"的入口：
 * 显隐、暂停、打开设置、立即扫描、退出。
 *
 * 图标：使用内联的 1×1 透明 PNG 放大到 16×16 —— 目的是**不引入二进制资源**
 * 也能拿到一个合法 `nativeImage`（`Tray` 在某些平台不接受空图）。
 * 正式图标由 T05 的 `scripts/make-icons.mjs` 生成并通过 electron-builder 打入。
 */

import { Menu, Tray, app, nativeImage } from 'electron';
import type { AppServices } from './ipc/context';
import { logger } from './system/logger';

/** 1×1 透明 PNG（base64），仅用于生成合法图标占位。 */
const TRANSPARENT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let tray: Tray | null = null;

/**
 * 创建托盘（幂等）。
 *
 * @param services 服务集合。
 * @returns 托盘实例；创建失败返回 null（不致命）。
 */
export function createTray(services: AppServices): Tray | null {
  if (tray !== null) {
    return tray;
  }
  try {
    const image = nativeImage
      .createFromDataURL(`data:image/png;base64,${TRANSPARENT_PNG}`)
      .resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('TFT 牌库剩余计数器（估算）');
    tray.on('click', () => {
      services.windows.toggleVisible();
    });
    refreshTrayMenu(services);
    return tray;
  } catch (error) {
    logger.warn('[tray] 创建失败（将仅依赖热键/设置页）', error);
    return null;
  }
}

/**
 * 刷新托盘菜单（暂停状态变化后调用）。
 *
 * @param services 服务集合。
 */
export function refreshTrayMenu(services: AppServices): void {
  if (tray === null) {
    return;
  }
  const paused = services.scheduler.isPaused();
  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏 HUD',
      click: () => services.windows.toggleVisible(),
    },
    {
      label: paused ? '恢复扫描' : '暂停扫描',
      click: () => {
        if (services.scheduler.isPaused()) {
          services.scheduler.resume();
        } else {
          services.scheduler.pause();
        }
        refreshTrayMenu(services);
      },
    },
    {
      label: '立即扫描一次',
      click: () => {
        void services.scheduler.triggerManual();
      },
    },
    { type: 'separator' },
    {
      label: '设置…',
      click: () => services.windows.openSettings(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

/** 销毁托盘。 */
export function disposeTray(): void {
  if (tray !== null) {
    tray.destroy();
    tray = null;
  }
}
