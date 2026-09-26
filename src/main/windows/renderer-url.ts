/**
 * 渲染进程入口 URL 解析（开发态走 Vite dev server，生产态走 file://）。
 *
 * 统一在这里处理，避免每个窗口各自拼字符串导致开发态热更新失效
 * 或生产态路径写错（asar 内相对路径是最常见的打包事故来源）。
 */

import { pathToFileURL } from 'node:url';
import { rendererHtmlPath } from '../store/paths';

/**
 * 开发态 dev server 地址（由 `scripts/dev.mjs` 注入环境变量）。
 *
 * @returns dev server URL，未设置时返回空串。
 */
export function devServerUrl(): string {
  return process.env.VITE_DEV_SERVER_URL ?? '';
}

/**
 * 解析渲染进程 HTML 的可加载 URL。
 *
 * @param htmlName HTML 文件名，如 'hud.html'。
 * @param serverUrl 显式指定的 dev server 地址（缺省读环境变量）。
 * @returns 可直接交给 `loadURL` 的 URL 字符串。
 */
export function resolveRendererUrl(htmlName: string, serverUrl = devServerUrl()): string {
  if (serverUrl.length > 0) {
    return `${serverUrl.replace(/\/$/, '')}/${htmlName}`;
  }
  return pathToFileURL(rendererHtmlPath(htmlName)).toString();
}
