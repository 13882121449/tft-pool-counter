/**
 * 渲染进程全局类型声明。
 *
 * 渲染进程只能通过 `window.api`（preload 的 contextBridge 出口）访问主进程能力，
 * 这里把它的类型挂到 `Window` 上，避免各处 `as any`。
 * 类型契约唯一定义在 `src/shared/types/api.ts`。
 */

import type { TftPoolApi } from '../shared/types/api';

declare global {
  interface Window {
    api: TftPoolApi;
  }
}

export {};
