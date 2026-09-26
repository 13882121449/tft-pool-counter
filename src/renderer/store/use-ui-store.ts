/**
 * UI 态 store（架构 §3.7）：窗口态、穿透、Mini、主题、筛选、各类弹层。
 *
 * 与 `use-config-store` 的分工：
 * - "需要跨重启保留"的偏好 → config（主进程落盘）；
 * - "本次会话/纯展示"的状态（弹层开关、搜索框） → 这里。
 */

import { create } from 'zustand';
import type { Cost, SeatOrUnknown } from '@shared/types/domain';
import type { SortMode } from './use-pool-store';

/** 设置页 tab。 */
export type SettingsTab =
  | 'general'
  | 'scan'
  | 'recognition'
  | 'template'
  | 'estimate'
  | 'compliance'
  | 'log';

/** HUD 主视图：牌库列表 / 阵容推荐。 */
export type HudView = 'pool' | 'lineup';

/** 校正目标。 */
export interface CorrectionTarget {
  championId: string;
  seat: SeatOrUnknown;
}

/** UI store 状态。 */
export interface UiState {
  tab: SettingsTab;
  mode: 'full' | 'mini';
  /** HUD 主视图。 */
  hudView: HudView;
  clickThrough: boolean;
  search: string;
  costFilter: Cost[];
  traitFilter: string[];
  sortMode: SortMode;
  showWatchlist: boolean;
  correction: CorrectionTarget | null;
  seatDetail: SeatOrUnknown | null;
  showOnboarding: boolean;
  toast: string | null;

  setTab(tab: SettingsTab): void;
  setMode(mode: 'full' | 'mini'): void;
  setHudView(view: HudView): void;
  setClickThrough(on: boolean): void;
  setSearch(value: string): void;
  toggleCost(cost: Cost): void;
  setTraitFilter(traits: string[]): void;
  setSortMode(mode: SortMode): void;
  toggleWatchlist(): void;
  openCorrection(target: CorrectionTarget): void;
  closeCorrection(): void;
  openSeatDetail(seat: SeatOrUnknown): void;
  closeSeatDetail(): void;
  setShowOnboarding(show: boolean): void;
  setToast(message: string | null): void;
}

/** UI store。 */
export const useUiStore = create<UiState>((set) => ({
  tab: 'general',
  mode: 'full',
  hudView: 'pool',
  clickThrough: false,
  search: '',
  costFilter: [],
  traitFilter: [],
  sortMode: 'cost-asc',
  showWatchlist: true,
  correction: null,
  seatDetail: null,
  showOnboarding: false,
  toast: null,

  setTab: (tab) => set({ tab }),
  setMode: (mode) => set({ mode }),
  setHudView: (hudView) => set({ hudView }),
  setClickThrough: (on) => set({ clickThrough: on }),
  setSearch: (search) => set({ search }),
  toggleCost: (cost) =>
    set((state) => ({
      costFilter: state.costFilter.includes(cost)
        ? state.costFilter.filter((item) => item !== cost)
        : [...state.costFilter, cost].sort((a, b) => a - b),
    })),
  setTraitFilter: (traits) => set({ traitFilter: traits }),
  setSortMode: (sortMode) => set({ sortMode }),
  toggleWatchlist: () => set((state) => ({ showWatchlist: !state.showWatchlist })),
  openCorrection: (correction) => set({ correction }),
  closeCorrection: () => set({ correction: null }),
  openSeatDetail: (seat) => set({ seatDetail: seat }),
  closeSeatDetail: () => set({ seatDetail: null }),
  setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  setToast: (toast) => set({ toast }),
}));
