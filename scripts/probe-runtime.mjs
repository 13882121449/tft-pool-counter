/**
 * 运行时端到端探针（开发/验收工具，不参与产品构建）。
 *
 * 用 Chrome DevTools Protocol 连上正在运行的 HUD 渲染进程，直接调用
 * `window.api.*`，验证：
 *   1. preload 的 contextBridge 暴露是否真的生效；
 *   2. 主进程 handler（如 `pool:get-snapshot`）是否真的注册并返回 65 行；
 *   3. 快照内容是否符合"首帧 = 全部池总数、巡查 0/8"（PRD §5.1）；
 *   4. DOM 是否真的渲染出 HUD（标题/合规"估算"文案/巡查进度）。
 *
 * 这是本机唯一可自动化的 GUI 验证手段 —— 沙箱里没有可见桌面，但进程与
 * 渲染进程是真实运行的，CDP 因此能给出"真机证据"而非静态推断。
 *
 * 启动方式（Windows 沙箱下必须带这两个 GPU 标志，否则 Chromium 的 GPU 进程
 * 起不来会直接 FATAL: GPU process isn't usable. Goodbye.）：
 *
 *   ./node_modules/.bin/electron . --disable-gpu --disable-gpu-sandbox --remote-debugging-port=9222
 *   node scripts/probe-runtime.mjs 9222
 *
 * 注意：`--no-sandbox` 会让 Electron 更早起不来，不要加。
 */

const PORT = Number(process.argv[2] ?? 9222);

/** 拉取 CDP 目标列表。 */
async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);
  return response.json();
}

/** 在指定目标上执行一个返回 JSON 的异步表达式。 */
function evaluate(target, expression, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP evaluate 超时'));
    }, timeoutMs);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve(message.result?.result?.value ?? message.result);
    });
    socket.addEventListener('error', (error) => {
      clearTimeout(timer);
      reject(new Error(String(error.message ?? error)));
    });
  });
}

const targets = await listTargets();
const pages = targets.filter((t) => t.type === 'page');
console.log('[probe] 页面目标:', pages.map((p) => p.url.split('/').pop()).join(', '));

const hud = pages.find((p) => p.url.includes('hud'));
if (!hud) {
  console.error('[probe] 未找到 HUD 页面');
  process.exit(2);
}

const snapshotProbe = `(async () => {
  const hasApi = typeof window.api?.getPoolSnapshot === 'function';
  try {
    const result = await window.api.getPoolSnapshot();
    return JSON.stringify({
      hasApi,
      ok: result.ok,
      rows: result.value ? result.value.rows.length : null,
      scanned: result.value ? result.value.coverage.scanned : null,
      total: result.value ? result.value.coverage.total : null,
      setNumber: result.value ? result.value.meta.setNumber : null,
      firstRow: result.value ? { id: result.value.rows[0].championId, pool: result.value.rows[0].poolTotal, remaining: result.value.rows[0].remaining } : null,
      allFull: result.value ? result.value.rows.every((r) => r.remaining === r.poolTotal) : null,
    });
  } catch (error) {
    return JSON.stringify({ hasApi, threw: String(error) });
  }
})()`;

const snapshotResult = await evaluate(hud, snapshotProbe);
console.log('[probe] getPoolSnapshot →', snapshotResult);

const statusProbe = `(async () => (await window.api.getScanStatus()).ok)()`;
console.log('[probe] getScanStatus ok →', await evaluate(hud, statusProbe));

const domProbe = `JSON.stringify({ title: document.title, hasRoot: Boolean(document.querySelector('#root')), keyCount: document.querySelectorAll('[data-champion-row]').length, bodyText: document.body.innerText.slice(0, 120) })`;
console.log('[probe] DOM →', await evaluate(hud, domProbe));
