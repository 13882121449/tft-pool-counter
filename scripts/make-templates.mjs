#!/usr/bin/env node
/**
 * 模板生成器入口。
 *
 * 实现放在 `src/vision/templates/generate-cli.ts`（TS，复用项目内的 pHash /
 * 归一化 / 序列化实现，**不复制算法**）。本脚本只做两件事：
 * 1. 用 esbuild 把该 TS 入口打成一次性 CJS 产物（临时目录，不污染 dist/）；
 * 2. 用当前 node 运行它，并把退出码透传给调用方。
 *
 * 用法：
 *   node scripts/make-templates.mjs                                   # 65 张占位模板 → data/templates
 *   node scripts/make-templates.mjs --out data/templates --clean
 *   node scripts/make-templates.mjs --from shot.png --champion ahri    # 用自己截的图建真实模板
 */

import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

/** 与 build.mjs / tsconfig.base.json 保持一致的路径别名。 */
const ALIAS = {
  '@shared': resolve(PROJECT_ROOT, 'src/shared'),
  '@core': resolve(PROJECT_ROOT, 'src/core'),
  '@vision': resolve(PROJECT_ROOT, 'src/vision'),
  '@main': resolve(PROJECT_ROOT, 'src/main'),
};

async function main() {
  const outDir = join(tmpdir(), `tft-make-templates-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, 'generate-cli.cjs');

  const result = await build({
    entryPoints: [resolve(PROJECT_ROOT, 'src/vision/templates/generate-cli.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    alias: ALIAS,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.base.json'),
    // 原生/可选依赖保持外置，由运行时从项目 node_modules 解析
    external: ['sharp', 'node-screenshots', '@techstark/opencv-js', 'jszip'],
    packages: 'external',
    logLevel: 'warning',
    metafile: false,
  });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error('[make-templates] 打包失败：', error.text);
    }
    process.exit(1);
  }

  // 让打包产物在项目根目录下解析 node_modules
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');

  const previousCwd = process.cwd();
  process.chdir(PROJECT_ROOT);
  try {
    const mod = await import(pathToFileURL(bundlePath).href);
    const code = await mod.main(process.argv.slice(2));
    process.exitCode = code;
  } finally {
    process.chdir(previousCwd);
    try {
      rmSync(outDir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响主流程
    }
  }
}

main().catch((error) => {
  console.error('[make-templates] 失败：', error);
  process.exit(1);
});
