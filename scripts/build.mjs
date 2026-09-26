#!/usr/bin/env node
/**
 * esbuild 构建脚本：打包 main / preload / vision-worker 三个 node 侧目标。
 *
 * 为什么不用 Vite 打包这三个：
 * - 它们不需要 HMR；
 * - esbuild 单文件 bundle 更快更透明；
 * - 天然支持 `platform: 'node'` + `external: ['electron', 所有 node_modules]`，
 *   避开 Vite 打包 Electron 主进程时常见的 external 坑（ADR-08）。
 *
 * 用法：
 *   node scripts/build.mjs            # 单次构建
 *   node scripts/build.mjs --watch    # watch 模式（dev 用）
 */

import { build, context } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

/** 路径别名（与 tsconfig.base.json / vite.config.ts / vitest.config.ts 同步）。 */
const ALIAS = {
  '@shared': resolve(PROJECT_ROOT, 'src/shared'),
  '@core': resolve(PROJECT_ROOT, 'src/core'),
  '@vision': resolve(PROJECT_ROOT, 'src/vision'),
  '@main': resolve(PROJECT_ROOT, 'src/main'),
};

const IS_WATCH = process.argv.includes('--watch');

/** 三个构建目标。 */
const TARGETS = [
  {
    name: 'main',
    entry: resolve(PROJECT_ROOT, 'src/main/index.ts'),
    outfile: resolve(PROJECT_ROOT, 'dist/main/index.js'),
  },
  {
    name: 'preload',
    entry: resolve(PROJECT_ROOT, 'src/preload/index.ts'),
    outfile: resolve(PROJECT_ROOT, 'dist/preload/index.js'),
  },
  {
    name: 'vision-worker',
    entry: resolve(PROJECT_ROOT, 'src/vision/worker-entry.ts'),
    outfile: resolve(PROJECT_ROOT, 'dist/vision/worker.js'),
  },
];

/**
 * 生成单个目标的 esbuild 配置。
 * @param {typeof TARGETS[number]} target 目标描述。
 * @returns {import('esbuild').BuildOptions}
 */
function makeOptions(target) {
  return {
    entryPoints: [target.entry],
    outfile: target.outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    // 双保险：既显式给 esbuild 一份 alias，也让它读 tsconfig.base.json 的 paths
    alias: ALIAS,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.base.json'),
    // node_modules 与 electron 全部外置，交给运行时解析（避免打包 native 模块失败）
    external: ['electron'],
    packages: 'external',
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': process.env.NODE_ENV
        ? JSON.stringify(process.env.NODE_ENV)
        : '"production"',
    },
  };
}

/** 打印构建结果摘要。 */
function report(target, result) {
  const warnings = result.warnings ?? [];
  console.log(`[build] ${target.name} → ${target.outfile} (warnings: ${warnings.length})`);
}

async function main() {
  const available = TARGETS.filter((target) => existsSync(target.entry));
  const missing = TARGETS.filter((target) => !existsSync(target.entry));
  for (const target of missing) {
    console.warn(`[build] 跳过 ${target.name}：入口不存在 ${target.entry}`);
  }

  if (!IS_WATCH) {
    for (const target of available) {
      const result = await build(makeOptions(target));
      report(target, result);
    }
    console.log('[build] 完成');
    return;
  }

  const contexts = [];
  for (const target of available) {
    const ctx = await context(makeOptions(target));
    await ctx.watch();
    contexts.push(ctx);
    console.log(`[build] watching ${target.name} …`);
  }

  const shutdown = async () => {
    for (const ctx of contexts) {
      await ctx.dispose();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[build] 失败：', error);
  process.exit(1);
});
