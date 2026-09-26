/**
 * HUD 悬浮窗挂载入口（T05）。
 *
 * 组装完整的 HUD 组件树：
 * 标题栏 / 赛季徽标 / 状态条 / 巡查进度 / 追卡 / 筛选 / 弈子列表 / 底部条，
 * 以及弹层（各家明细、手动校正）与首启引导（合规 → 分辨率 → 标定）。
 *
 * 性能约束（ADR-07）：65 行高频重绘区全部走 Tailwind 原子类 + 虚拟滚动 + memo；
 * MUI 仅用于弹层，且在 `ThemeProvider` 内使用。
 */

import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import './styles/globals.css';
import { SUPPORTED_SET_NUMBER } from '@shared/constants';
import { BottomBar } from './components/hud/BottomBar';
import { ChampionList } from './components/hud/ChampionList';
import { CoverageBar } from './components/hud/CoverageBar';
import { FilterRow } from './components/hud/FilterRow';
import { LineupPanel } from './components/hud/LineupPanel';
import { MiniMode } from './components/hud/MiniMode';
import { SeatDetailPopover } from './components/hud/SeatDetailPopover';
import { SeasonBadge } from './components/hud/SeasonBadge';
import { StatusBar } from './components/hud/StatusBar';
import { TitleBar } from './components/hud/TitleBar';
import { ViewTabs } from './components/hud/ViewTabs';
import { WatchlistPanel } from './components/hud/WatchlistPanel';
import { CorrectionDialog } from './components/correction/CorrectionDialog';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { useUndoStack } from './hooks/use-undo-stack';
import { initIpcBridge } from './store/ipc-bridge';
import { useBaselineStore } from './store/use-baseline-store';
import { useConfigStore } from './store/use-config-store';
import { selectVisibleRows, usePoolStore } from './store/use-pool-store';
import { useUiStore } from './store/use-ui-store';
import { applyTheme, createAppTheme } from './theme';

/** 兜底低置信阈值（与 shared/constants 的 LOW_CONFIDENCE_THRESHOLD 对齐）。 */
const DEFAULT_LOW_CONFIDENCE = 0.6;

/** 轻量 toast（会话内提示，2.6s 自动消失）。 */
function Toast(): JSX.Element | null {
  const toast = useUiStore((state) => state.toast);
  const setToast = useUiStore((state) => state.setToast);

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast, setToast]);

  if (toast === null) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute bottom-[26px] left-2 right-2 rounded bg-black/85 px-2 py-1 text-center text-2xs text-hud-text shadow">
      {toast}
    </div>
  );
}

/** HUD 应用。 */
function HudApp(): JSX.Element {
  const themeName = useConfigStore((state) => state.config.ui.theme);
  const config = useConfigStore((state) => state.config);
  const theme = useMemo(() => createAppTheme(themeName), [themeName]);
  const mode = useUiStore((state) => state.mode);
  const hudView = useUiStore((state) => state.hudView);
  const showWatchlist = useUiStore((state) => state.showWatchlist);
  const search = useUiStore((state) => state.search);
  const costFilter = useUiStore((state) => state.costFilter);
  const traitFilter = useUiStore((state) => state.traitFilter);
  const sortMode = useUiStore((state) => state.sortMode);
  const baseline = useBaselineStore((state) => state.baseline);
  const snapshot = usePoolStore((state) => state.snapshot);

  useUndoStack();

  useEffect(() => {
    applyTheme(themeName);
  }, [themeName]);

  // 基线（中文名 / 羁绊）只需在 HUD 内拉一次
  useEffect(() => {
    void useBaselineStore.getState().load();
  }, []);

  const { nameOf, traitOptions, resolveTrait, watchSet } = useMemo(() => {
    const nameMap = new Map<string, string>();
    const traitMap = new Map<string, string[]>();
    for (const champion of baseline?.champions ?? []) {
      nameMap.set(champion.id, champion.nameCn || champion.nameEn || champion.id);
      for (const trait of champion.traits) {
        const list = traitMap.get(trait) ?? [];
        list.push(champion.id);
        traitMap.set(trait, list);
      }
    }
    return {
      nameOf: (id: string): string | undefined => nameMap.get(id),
      traitOptions: Array.from(traitMap.keys()).sort((a, b) => a.localeCompare(b)),
      resolveTrait: (trait: string): string[] => traitMap.get(trait) ?? [],
      watchSet: new Set(config.ui.watchlist),
    };
  }, [baseline, config.ui.watchlist]);

  const rows = useMemo(
    () => selectVisibleRows(snapshot, { search, costFilter, traitFilter, sortMode }),
    [snapshot, search, costFilter, traitFilter, sortMode],
  );

  const watchRows = useMemo(() => {
    if (snapshot === null) {
      return [];
    }
    return snapshot.rows.filter((row) => watchSet.has(row.championId));
  }, [snapshot, watchSet]);

  const openSettings = (): void => {
    void window.api.windowAction({ action: 'open-settings' });
  };

  const lowConfidenceThreshold = config.estimate.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE;
  const meta = baseline?.meta;

  return (
    <ThemeProvider theme={theme}>
      <div className="hud-root relative flex h-full flex-col overflow-hidden">
        <TitleBar onOpenSettings={openSettings} />
        <SeasonBadge
          setNumber={meta?.setNumber ?? SUPPORTED_SET_NUMBER}
          patch={meta?.patch ?? ''}
          confirmed={meta?.confirmed ?? false}
        />

        {mode === 'mini' ? (
          <MiniMode rows={rows} nameOf={nameOf} onOpenSettings={openSettings} />
        ) : (
          <>
            <StatusBar />
            <CoverageBar />
            <ViewTabs />
            {hudView === 'lineup' ? (
              <LineupPanel />
            ) : (
              <>
                {showWatchlist ? <WatchlistPanel rows={watchRows} nameOf={nameOf} /> : null}
                <FilterRow traits={traitOptions} resolveTrait={resolveTrait} />
                <ChampionList
                  rows={rows}
                  nameOf={nameOf}
                  lowConfidenceThreshold={lowConfidenceThreshold}
                  watchlist={watchSet}
                />
              </>
            )}
            <BottomBar />
          </>
        )}

        <SeatDetailPopover nameOf={nameOf} />
        <CorrectionDialog />
        <Toast />
        <OnboardingFlow />
      </div>
    </ThemeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
    initIpcBridge();
  }

  createRoot(container).render(
    <StrictMode>
      <HudApp />
    </StrictMode>,
  );
}
