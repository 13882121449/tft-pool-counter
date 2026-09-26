import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置。
 *
 * 说明：
 * - HUD 的高频重绘表行（65 行，每 1.5s 全量刷新）全部使用 Tailwind 原子类，
 *   MUI/emotion 只用于弹层与设置页，避免运行时 CSS-in-JS 的样式计算开销。
 * - 剩余数四档色 token 集中定义在 `theme.extend.colors.pool`，UI 层禁止再写死色值。
 */
const config = {
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
    './src/renderer/index.html',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        /** 剩余数四档色（绿 → 黄 → 橙 → 红）。 */
        pool: {
          plenty: '#22c55e',
          enough: '#eab308',
          low: '#f97316',
          out: '#ef4444',
          unknown: '#94a3b8',
        },
        /** HUD 面板底色（配合 Electron 透明窗口使用 rgba）。 */
        hud: {
          bg: 'rgba(12, 14, 20, 0.82)',
          panel: 'rgba(24, 27, 36, 0.92)',
          border: 'rgba(148, 163, 184, 0.22)',
          text: '#e2e8f0',
          dim: '#94a3b8',
        },
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
      spacing: {
        row: '26px',
      },
      zIndex: {
        hud: '2147483647',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
