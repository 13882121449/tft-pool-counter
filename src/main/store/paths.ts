/**
 * 主进程路径解析（唯一出处，禁止在别处拼路径）。
 *
 * 关键区分（ADR-08 打包注意事项）：
 * - **只读资源**（`data/*.json`、模板）开发态在项目 `data/`，
 *   打包后在 `process.resourcesPath/data`（由 electron-builder `extraResources` 拷贝）；
 * - **可写数据**（配置、对局台账、用户自建模板）一律在 `app.getPath('userData')`。
 *
 * 绝不把可写数据写进 asar（asar 只读）。
 */

import { join, resolve } from 'node:path';
import { app } from 'electron';

/** 项目数据目录（只读 JSON 资源）。可用 `TFT_DATA_DIR` 覆盖（测试/特殊部署）。 */
export function dataDir(): string {
  const override = process.env.TFT_DATA_DIR;
  if (override && override.length > 0) {
    return resolve(override);
  }
  if (app.isPackaged) {
    return join(process.resourcesPath, 'data');
  }
  return join(app.getAppPath(), 'data');
}

/** 用户数据根目录。 */
export function userDataDir(): string {
  return app.getPath('userData');
}

/** 开箱即用的模板目录（只读，随包分发）。 */
export function bundledTemplatesDir(): string {
  return join(dataDir(), 'templates');
}

/** 用户自建模板目录（可写）。 */
export function userTemplatesDir(): string {
  return join(userDataDir(), 'assets', 'templates');
}

/** 配置文件路径。 */
export function configFilePath(): string {
  return join(userDataDir(), 'config.json');
}

/** 对局台账落盘路径（默认关闭，`advanced.saveSession` 打开时才写）。 */
export function sessionFilePath(): string {
  return join(userDataDir(), 'session.json');
}

/** 棋盘标定文件路径（归一化比例，跨分辨率复用）。 */
export function calibrationFilePath(): string {
  return join(userDataDir(), 'calibration.json');
}

/** 日志文件路径。 */
export function logFilePath(): string {
  return join(userDataDir(), 'logs', 'main.log');
}

/** preload 脚本路径（与 scripts/build.mjs 的产物一致）。 */
export function preloadPath(): string {
  return join(__dirname, '..', 'preload', 'index.js');
}

/** Vision worker 产物路径。 */
export function visionWorkerPath(): string {
  return join(__dirname, '..', 'vision', 'worker.js');
}

/** 渲染进程 HTML 入口路径（开发态由 Vite dev server 提供，见 `resolveRendererUrl`）。 */
export function rendererHtmlPath(htmlName: string): string {
  return join(__dirname, '..', 'renderer', htmlName);
}
