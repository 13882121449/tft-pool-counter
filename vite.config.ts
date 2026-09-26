import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 渲染进程构建配置（Vite）。
 * 三个入口分别对应 HUD 悬浮窗 / 设置窗口 / 常驻把手窗口。
 *
 * 路径别名必须与 tsconfig.base.json、scripts/build.mjs（esbuild）、
 * vitest.config.ts、.eslintrc.cjs 五处保持一致。
 */
const PROJECT_ROOT = resolve(__dirname);

/** 五处同步的路径别名（唯一定义处，其他配置从这里派生或手工保持一致）。 */
export const PATH_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['@shared', resolve(PROJECT_ROOT, 'src/shared')],
  ['@core', resolve(PROJECT_ROOT, 'src/core')],
  ['@vision', resolve(PROJECT_ROOT, 'src/vision')],
  ['@main', resolve(PROJECT_ROOT, 'src/main')],
  ['@renderer', resolve(PROJECT_ROOT, 'src/renderer')],
];

export default defineConfig({
  root: resolve(PROJECT_ROOT, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: PATH_ALIASES.map(([find, replacement]) => ({ find, replacement })),
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  build: {
    outDir: resolve(PROJECT_ROOT, 'dist/renderer'),
    // 必须显式设为 false：outDir（dist/renderer）在 vite root（src/renderer）之外，
    // 清空行为默认本就关闭。开启它需要批量删除上一轮产物（worker chunk + sourcemap
    // 轻松上百个文件），在受限环境里会被安全删除守卫拦下、直接导致构建失败；
    // 而产物是内容哈希命名 + index.html 只指向新文件，残留旧 chunk 不影响运行。
    // 需要绝对干净的产物时，手动删除 dist/renderer 后再构建即可。
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        hud: resolve(PROJECT_ROOT, 'src/renderer/hud.html'),
        settings: resolve(PROJECT_ROOT, 'src/renderer/settings.html'),
        handle: resolve(PROJECT_ROOT, 'src/renderer/handle.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  css: {
    postcss: resolve(PROJECT_ROOT, 'postcss.config.js'),
  },
});
