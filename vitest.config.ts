import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest 配置。
 *
 * 与 Vite 共享别名解析；`src/core` 为纯函数层，要求行覆盖率 ≥ 90%。
 */
const PROJECT_ROOT = resolve(__dirname);

export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(PROJECT_ROOT, 'src/shared') },
      { find: '@core', replacement: resolve(PROJECT_ROOT, 'src/core') },
      { find: '@vision', replacement: resolve(PROJECT_ROOT, 'src/vision') },
      { find: '@main', replacement: resolve(PROJECT_ROOT, 'src/main') },
      { find: '@renderer', replacement: resolve(PROJECT_ROOT, 'src/renderer') },
    ],
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // 纯函数层单测不处理任何 CSS：关掉 PostCSS/Tailwind 管线，
    // 既避免与渲染进程构建配置耦合，也省掉一次无谓的依赖加载。
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: resolve(PROJECT_ROOT, 'coverage'),
      // 只统计纯函数核心层（T02 验收标准要求 src/core ≥ 90%）
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/index.ts', 'src/**/*.d.ts'],
      thresholds: {
        'src/core/**': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
