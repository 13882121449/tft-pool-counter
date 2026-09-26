#!/usr/bin/env node
/**
 * 开发模式启动器：并发运行
 *   1. esbuild watch（main / preload / vision-worker）
 *   2. Vite dev server（渲染进程，HMR）
 *   3. Electron（等前两者就绪后启动，自动重启）
 *
 * 用法：npm run dev
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const VITE_URL = `http://localhost:${VITE_PORT}`;

/** @type {Array<import('node:child_process').ChildProcess>} */
const children = [];
let shuttingDown = false;

/**
 * 启动一个子进程并接管输出前缀。
 * @param {string} name 显示名。
 * @param {string} command 可执行命令。
 * @param {string[]} args 参数。
 * @param {NodeJS.ProcessEnv} env 环境变量。
 */
function startProcess(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });

  const prefix = `[${name}] `;
  const pipe = (stream, target) => {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => target.write(prefix + line + '\n'));
  };
  if (child.stdout) pipe(child.stdout, process.stdout);
  if (child.stderr) pipe(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`${prefix}退出 (code=${code}, signal=${signal})`);
  });

  children.push(child);
  return child;
}

/** 轮询等待 Vite dev server 就绪。 */
async function waitForVite(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(VITE_URL, { method: 'GET' });
      if (response.ok || response.status === 404) {
        return true;
      }
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 简单等待若干毫秒。 */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('[dev] 启动 esbuild watch …');
  startProcess('esbuild', process.execPath, [resolve(PROJECT_ROOT, 'scripts/build.mjs'), '--watch']);

  console.log('[dev] 启动 Vite dev server …');
  startProcess('vite', process.execPath, [
    resolve(PROJECT_ROOT, 'node_modules/vite/bin/vite.js'),
    '--config',
    resolve(PROJECT_ROOT, 'vite.config.ts'),
    '--port',
    String(VITE_PORT),
  ]);

  console.log('[dev] 等待 Vite 就绪 …');
  const ready = await waitForVite();
  if (!ready) {
    console.warn('[dev] Vite 未能就绪，仍尝试启动 Electron（渲染页可能加载失败）');
  } else {
    console.log(`[dev] Vite 就绪：${VITE_URL}`);
  }

  // 给 esbuild 一点时间产出首份 main bundle
  await delay(1_200);

  console.log('[dev] 启动 Electron …');
  const electronBin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const electronPath = resolve(PROJECT_ROOT, 'node_modules/.bin', electronBin);
  startProcess(
    'electron',
    electronPath,
    [resolve(PROJECT_ROOT, 'dist/main/index.js')],
    { VITE_DEV_SERVER_URL: VITE_URL },
  );

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[dev] 正在关闭所有子进程 …');
    for (const child of children) {
      try {
        child.kill('SIGTERM');
      } catch {
        // 进程可能已退出
      }
    }
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[dev] 启动失败：', error);
  process.exit(1);
});
