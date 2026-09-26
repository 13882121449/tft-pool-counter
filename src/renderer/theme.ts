/**
 * 三套主题 token（架构 §3.7 / ADR-07）。
 *
 * - Tailwind 负责 HUD 的高频重绘区（65 行列表），色值来自 `tailwind.config.ts`；
 * - 这里额外提供一套 MUI theme，仅供**弹层 / 表单 / 设置页**使用（ADR-07 的分工）。
 *
 * 主题切换靠 `document.documentElement.dataset.theme`，与 `globals.css` 呼应。
 */

import { createTheme, type Theme } from '@mui/material/styles';
import type { UiConfig } from '@shared/types/config';

/** 主题名。 */
export type ThemeName = UiConfig['theme'];

/** 主题中文名（设置页展示）。 */
export const THEME_LABELS: Record<ThemeName, string> = {
  dark: '深色（推荐）',
  light: '浅色',
  'high-contrast': '高对比',
};

/** 把主题名写到 `<html data-theme>`，驱动 CSS 变量切换。 */
export function applyTheme(name: ThemeName): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = name;
}

/**
 * 构造 MUI 主题（弹层 / 表单 / 设置页专用）。
 *
 * @param name 主题名。
 */
export function createAppTheme(name: ThemeName = 'dark'): Theme {
  const isLight = name === 'light';
  const isContrast = name === 'high-contrast';
  const background = isContrast ? '#000000' : isLight ? '#f8fafc' : '#12151c';
  const paper = isContrast ? '#000000' : isLight ? '#ffffff' : '#181b24';
  const text = isContrast ? '#ffffff' : isLight ? '#0f172a' : '#e2e8f0';

  return createTheme({
    palette: {
      mode: isLight ? 'light' : 'dark',
      background: { default: background, paper },
      text: { primary: text, secondary: isContrast ? '#e2e8f0' : isLight ? '#475569' : '#94a3b8' },
      primary: { main: '#3b82f6' },
      warning: { main: '#f97316' },
      error: { main: '#ef4444' },
      success: { main: '#22c55e' },
      divider: isContrast ? '#ffffff' : isLight ? 'rgba(15,23,42,0.12)' : 'rgba(148,163,184,0.22)',
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: "'Microsoft YaHei UI', 'PingFang SC', 'Segoe UI', system-ui, sans-serif",
      fontSize: 13,
    },
    components: {
      MuiButton: {
        defaultProps: { size: 'small', disableElevation: true },
        styleOverrides: { root: { textTransform: 'none' } },
      },
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true } },
    },
  });
}

/** 主题选项顺序（设置页渲染用）。 */
export const THEME_ORDER: ThemeName[] = ['dark', 'light', 'high-contrast'];
