/**
 * 牌库快照 / 扫描状态 store（架构 §3.7）。
 *
 * 数据来源只有两个：`pool:snapshot` 推送与 `scan:status` 推送（见 `ipc-bridge`）。
 * 这里只存"原始数据"，筛选 / 排序 / 派生的逻辑放在纯函数 `selectVisibleRows`。
 */

import { create } from 'zustand';
import type { Cost, PoolSnapshot, RemainingResult } from '@shared/types/domain';
import type { ScanStatusPush } from '@shared/types/ipc';
import { errorText } from '../utils/format';

/** 列表排序方式。 */
export type SortMode = 'cost-asc' | 'remaining-asc';

/** 筛选条件（UI 态，可持久化到 config.ui）。 */
export interface RowFilters {
  search: string;
  costFilter: Cost[];
  traitFilter: string[];
  sortMode: SortMode;
}

/** 快照 store 状态。 */
export interface PoolState {
  snapshot: PoolSnapshot | null;
  status: ScanStatusPush | null;
  errors: string[];
  setSnapshot(snapshot: PoolSnapshot): void;
  setStatus(status: ScanStatusPush): void;
  pushError(error: unknown): void;
  clearErrors(): void;
  refreshStatus(): Promise<void>;
  /**
   * 拉取一次当前快照（首帧用）。
   *
   * 只在本地还没有快照时写入，避免"拉取结果覆盖掉刚好推来的更新快照"。
   * 失败静默：首帧拉取是尽力而为，后续推送会自然补齐。
   */
  refreshSnapshot(): Promise<void>;
}

/** 快照 store。 */
export const usePoolStore = create<PoolState>((set) => ({
  snapshot: null,
  status: null,
  errors: [],

  setSnapshot(snapshot): void {
    set({ snapshot, errors: snapshot.errors.length > 0 ? snapshot.errors.map(errorText) : [] });
  },

  setStatus(status): void {
    set({ status });
  },

  pushError(error): void {
    set((state) => ({ errors: [...state.errors.slice(-19), errorText(error)] }));
  },

  clearErrors(): void {
    set({ errors: [] });
  },

  async refreshStatus(): Promise<void> {
    const result = await window.api.getScanStatus();
    if (result.ok) {
      set({ status: result.value });
    }
  },

  async refreshSnapshot(): Promise<void> {
    const result = await window.api.getPoolSnapshot();
    if (!result.ok || result.value === null) {
      return;
    }
    // 已经被推送填过就先不覆盖：推送一定是更新的那一份
    set((state) => (state.snapshot !== null ? {} : { snapshot: result.value }));
  },
}));

/**
 * 依据筛选条件选出可见行（纯函数，便于单测/记忆化）。
 *
 * @param snapshot 快照。
 * @param filters 筛选条件。
 */
export function selectVisibleRows(
  snapshot: PoolSnapshot | null,
  filters: RowFilters,
): RemainingResult[] {
  if (snapshot === null) {
    return [];
  }
  const keyword = filters.search.trim().toLowerCase();
  const costSet = new Set<Cost>(filters.costFilter);
  const traitSet = new Set(filters.traitFilter);

  const rows = snapshot.rows.filter((row) => {
    if (costSet.size > 0 && !costSet.has(row.cost)) {
      return false;
    }
    return true;
  });

  // 羁绊筛选依赖基线（championId → traits）在 UI 侧不可得，故此处只按"是否有该羁绊标记"过滤；
  // 具体羁绊匹配交给 FilterRow 传入的 championId 白名单。
  const maybeTraitFiltered =
    traitSet.size === 0
      ? rows
      : rows.filter((row) => filters.traitFilter.includes(row.championId));

  const searched =
    keyword.length === 0
      ? maybeTraitFiltered
      : maybeTraitFiltered.filter((row) => row.championId.toLowerCase().includes(keyword));

  const sorted = [...searched];
  if (filters.sortMode === 'remaining-asc') {
    sorted.sort((a, b) => a.remaining - b.remaining || a.cost - b.cost);
  } else {
    sorted.sort((a, b) => a.cost - b.cost || a.championId.localeCompare(b.championId));
  }
  return sorted;
}
