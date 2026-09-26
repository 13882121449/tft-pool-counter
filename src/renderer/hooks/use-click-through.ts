/**
 * 点击穿透同步 hook（架构 §3.7 / ADR-07）。
 *
 * 穿透状态的"真相"在主进程（HUD + 把手联动）；这里维护一个镜像并在切换时：
 * 1. 立即更新本地 UI（按钮态）；
 * 2. 发 `window:action` 让主进程真正设置穿透；
 * 3. 写回配置（下次启动保持）。
 */

import { useCallback, useEffect } from 'react';
import { useConfigStore } from '../store/use-config-store';
import { useUiStore } from '../store/use-ui-store';

/** 穿透 hook 返回值。 */
export interface UseClickThroughResult {
  clickThrough: boolean;
  toggle(next?: boolean): void;
}

/**
 * 点击穿透状态与切换。
 */
export function useClickThrough(): UseClickThroughResult {
  const clickThrough = useUiStore((state) => state.clickThrough);
  const setClickThrough = useUiStore((state) => state.setClickThrough);

  // 配置加载完成后同步一次初始值
  useEffect(() => {
    const configured = useConfigStore.getState().config.window.clickThrough;
    setClickThrough(configured);
  }, [setClickThrough]);

  const toggle = useCallback(
    (next?: boolean): void => {
      const desired = next ?? !useUiStore.getState().clickThrough;
      setClickThrough(desired);
      void window.api.windowAction({ action: 'set-click-through', value: desired });
      const current = useConfigStore.getState().config;
      void useConfigStore.getState().patch({
        window: { ...current.window, clickThrough: desired },
      });
    },
    [setClickThrough],
  );

  return { clickThrough, toggle };
}
