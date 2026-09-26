/**
 * 暴露给渲染进程 `window.api` 的类型声明。
 *
 * 契约唯一定义在 `src/shared/types/api.ts`，这里只把它挂到全局 `Window` 上，
 * 与 `src/renderer/env.d.ts` 使用同一份类型，杜绝两处漂移。
 */

import type { TftPoolApi } from '../shared/types/api';

declare global {
  interface Window {
    api: TftPoolApi;
  }
}

export {};
