/**
 * 设置窗口挂载入口（T05）。
 *
 * 组装：MUI ThemeProvider（只用于设置页/弹层/表单，ADR-07）+ SettingsPanel。
 * 主题名来自 config，切换时同步写入 `<html data-theme>` 以驱动 CSS 变量。
 */

import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import './styles/globals.css';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { initIpcBridge } from './store/ipc-bridge';
import { useBaselineStore } from './store/use-baseline-store';
import { useConfigStore } from './store/use-config-store';
import { applyTheme, createAppTheme } from './theme';

/** 设置页应用。 */
function SettingsApp(): JSX.Element {
  const themeName = useConfigStore((state) => state.config.ui.theme);
  const theme = useMemo(() => createAppTheme(themeName), [themeName]);

  useEffect(() => {
    applyTheme(themeName);
  }, [themeName]);

  return (
    <ThemeProvider theme={theme}>
      <SettingsPanel />
    </ThemeProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  // 订阅主进程推送并预热配置 / 状态 / 基线（推送是"变化才发"，首屏需主动拉一次）
  if (typeof window !== 'undefined' && typeof window.api !== 'undefined') {
    initIpcBridge();
    void useBaselineStore.getState().load();
  }

  createRoot(container).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>,
  );
}
