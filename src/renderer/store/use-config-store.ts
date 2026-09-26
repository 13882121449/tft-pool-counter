/**
 * 配置镜像 store（架构 §3.7）。
 *
 * 渲染层对配置**只读**为主：任何修改都通过 `window.api.setConfig` 交给主进程，
 * 主进程落盘后再把结果回写到这里（单一数据源，避免两边各改一半）。
 */

import { create } from 'zustand';
import type { AppConfig } from '@shared/types/config';
import { DEFAULT_APP_CONFIG } from '@shared/constants';

/** 配置 store 状态。 */
export interface ConfigState {
  config: AppConfig;
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
  patch(patch: Partial<AppConfig>): Promise<void>;
  reset(): Promise<void>;
}

/** 配置镜像 store。 */
export const useConfigStore = create<ConfigState>((set) => ({
  config: DEFAULT_APP_CONFIG,
  loaded: false,
  error: null,

  async load(): Promise<void> {
    const result = await window.api.getConfig();
    if (result.ok) {
      set({ config: result.value, loaded: true, error: null });
    } else {
      set({ error: result.error.message, loaded: true });
    }
  },

  async patch(patch: Partial<AppConfig>): Promise<void> {
    const result = await window.api.setConfig(patch);
    if (result.ok) {
      set({ config: result.value, error: null });
    } else {
      set({ error: result.error.message });
    }
  },

  async reset(): Promise<void> {
    const result = await window.api.resetConfig();
    if (result.ok) {
      set({ config: result.value, error: null });
    } else {
      set({ error: result.error.message });
    }
  },
}));
