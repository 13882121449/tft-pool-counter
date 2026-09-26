/**
 * 卡池基线镜像 store（架构 §3.7 的补充）。
 *
 * 渲染层需要基线的两样东西：中文名（显示）与羁绊列表（筛选）。
 * 基线来自主进程（唯一数据源），这里只做只读镜像，**不缓存到磁盘**。
 */

import { create } from 'zustand';
import type { PoolBaseline } from '@shared/types/domain';
import { DEFAULT_NON_POOL_UNIT_IDS } from '@core/baseline/load-baseline';

/** 基线 store 状态。 */
export interface BaselineState {
  baseline: PoolBaseline | null;
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
}

/** 基线镜像 store。 */
export const useBaselineStore = create<BaselineState>((set) => ({
  baseline: null,
  loaded: false,
  error: null,

  async load(): Promise<void> {
    const result = await window.api.getBaseline();
    if (result.ok) {
      set({ baseline: result.value, loaded: true, error: null });
    } else {
      set({ error: result.error.message, loaded: true });
    }
  },
}));

/** 非池单位 id 集合（用于 UI 过滤展示，避免让用户看到"不可购买"的占位单位）。 */
export const NON_POOL_UNIT_IDS: ReadonlySet<string> = new Set(DEFAULT_NON_POOL_UNIT_IDS);
