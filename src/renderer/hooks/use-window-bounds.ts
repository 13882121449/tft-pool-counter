/**
 * 窗口尺寸 / 模式持久化 hook（架构 §3.7）。
 *
 * 尺寸与缩放由主进程 `window-state` 负责落盘；这里提供：
 * - `useWindowBounds()`：读 HUD 当前矩形（用于布局自适应）；
 * - `useWindowMode()`：完整 / 迷你模式切换（写 `window:action` + 配置）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useConfigStore } from '../store/use-config-store';
import { useUiStore } from '../store/use-ui-store';

/** HUD 矩形。 */
export interface WindowBoundsState {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 读取 HUD 矩形。
 */
export function useWindowBounds(): { bounds: WindowBoundsState | null; refresh(): void } {
  const [bounds, setBounds] = useState<WindowBoundsState | null>(null);

  const refresh = useCallback((): void => {
    void window.api.getWindowBounds().then((result) => {
      if (result.ok && result.value !== null) {
        setBounds(result.value);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { bounds, refresh };
}

/**
 * 完整 / 迷你模式切换。
 */
export function useWindowMode(): {
  mode: 'full' | 'mini';
  setMode(mode: 'full' | 'mini'): void;
  toggle(): void;
} {
  const mode = useUiStore((state) => state.mode);
  const setModeInStore = useUiStore((state) => state.setMode);

  const setMode = useCallback(
    (next: 'full' | 'mini'): void => {
      setModeInStore(next);
      void window.api.windowAction({ action: 'set-mode', value: next });
      const current = useConfigStore.getState().config;
      void useConfigStore.getState().patch({ window: { ...current.window, mode: next } });
    },
    [setModeInStore],
  );

  const toggle = useCallback((): void => {
    setMode(useUiStore.getState().mode === 'full' ? 'mini' : 'full');
  }, [setMode]);

  return { mode, setMode, toggle };
}
