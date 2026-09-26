/**
 * preload：通过 contextBridge 暴露类型安全的 IPC API（**唯一的 IPC 出口**）。
 *
 * 合规：不向渲染进程暴露任何 node 能力或原生模块，只暴露一组与业务语义绑定的方法；
 * 渲染进程无法通过这里发起任意文件读写 / 进程操作。
 *
 * 类型契约见 `src/shared/types/api.ts`（main / preload / renderer 三方共享）。
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  CH_BASELINE_GET,
  CH_BASELINE_RELOAD,
  CH_BASELINE_VALIDATE,
  CH_CALIBRATION_GET,
  CH_CALIBRATION_SET,
  CH_CONFIG_GET,
  CH_CONFIG_RESET,
  CH_CONFIG_SET,
  CH_CORRECTION_APPLY,
  CH_CORRECTION_MOVE,
  CH_CORRECTION_OPEN,
  CH_CORRECTION_UNDO,
  CH_LOG_EXPORT,
  CH_LOG_TAIL,
  CH_POOL_GET_SNAPSHOT,
  CH_POOL_SNAPSHOT,
  CH_SCAN_ONCE,
  CH_SCAN_PAUSE,
  CH_SCAN_RESUME,
  CH_SCAN_STATUS,
  CH_SYSTEM_ERROR,
  CH_SYSTEM_INFO,
  CH_SYSTEM_QUIT,
  CH_TEMPLATE_APPEND,
  CH_TEMPLATE_CAPTURE,
  CH_TEMPLATE_EXPORT,
  CH_TEMPLATE_IMPORT,
  CH_TEMPLATE_LIST,
  CH_WINDOW_ACTION,
  CH_WINDOW_BOUNDS,
  CH_WINDOW_STATE,
} from '../shared/ipc/channels';
import type { TftPoolApi, Unsubscribe } from '../shared/types/api';

/**
 * 建立订阅并返回取消订阅函数。
 *
 * @param channel 通道名。
 * @param callback 收到消息时的回调。
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: TftPoolApi = {
  // 扫描
  scanOnce: () => ipcRenderer.invoke(CH_SCAN_ONCE),
  pauseScan: () => ipcRenderer.invoke(CH_SCAN_PAUSE),
  resumeScan: () => ipcRenderer.invoke(CH_SCAN_RESUME),
  getScanStatus: () => ipcRenderer.invoke(CH_SCAN_STATUS),
  getPoolSnapshot: () => ipcRenderer.invoke(CH_POOL_GET_SNAPSHOT),

  // 推送订阅
  onPoolSnapshot: (callback) => subscribe(CH_POOL_SNAPSHOT, callback),
  onScanStatus: (callback) => subscribe(CH_SCAN_STATUS, callback),
  onSystemError: (callback) => subscribe(CH_SYSTEM_ERROR, callback),

  // 配置
  getConfig: () => ipcRenderer.invoke(CH_CONFIG_GET),
  setConfig: (patch) => ipcRenderer.invoke(CH_CONFIG_SET, patch),
  resetConfig: () => ipcRenderer.invoke(CH_CONFIG_RESET),

  // 基线
  getBaseline: () => ipcRenderer.invoke(CH_BASELINE_GET),
  reloadBaseline: () => ipcRenderer.invoke(CH_BASELINE_RELOAD),
  validateBaseline: () => ipcRenderer.invoke(CH_BASELINE_VALIDATE),

  // 校正
  openCorrection: (request) => ipcRenderer.invoke(CH_CORRECTION_OPEN, request),
  applyCorrection: (cmd) => ipcRenderer.invoke(CH_CORRECTION_APPLY, cmd),
  moveInstance: (payload) => ipcRenderer.invoke(CH_CORRECTION_MOVE, payload),
  undoCorrection: () => ipcRenderer.invoke(CH_CORRECTION_UNDO),

  // 模板
  listTemplates: () => ipcRenderer.invoke(CH_TEMPLATE_LIST),
  captureTemplates: (payload) => ipcRenderer.invoke(CH_TEMPLATE_CAPTURE, payload),
  appendTemplates: (payload) => ipcRenderer.invoke(CH_TEMPLATE_APPEND, payload),
  importTemplates: (payload) => ipcRenderer.invoke(CH_TEMPLATE_IMPORT, payload),
  exportTemplates: (payload) => ipcRenderer.invoke(CH_TEMPLATE_EXPORT, payload),

  // 日志 / 系统
  tailLog: (payload) => ipcRenderer.invoke(CH_LOG_TAIL, payload),
  exportLog: (payload) => ipcRenderer.invoke(CH_LOG_EXPORT, payload),
  systemInfo: () => ipcRenderer.invoke(CH_SYSTEM_INFO),
  quit: () => ipcRenderer.invoke(CH_SYSTEM_QUIT),

  // 窗口
  windowAction: (request) => ipcRenderer.invoke(CH_WINDOW_ACTION, request),
  getWindowBounds: () => ipcRenderer.invoke(CH_WINDOW_BOUNDS),
  getWindowState: () => ipcRenderer.invoke(CH_WINDOW_STATE),

  // 标定
  getCalibration: () => ipcRenderer.invoke(CH_CALIBRATION_GET),
  saveCalibration: (calibration) => ipcRenderer.invoke(CH_CALIBRATION_SET, calibration),
};

contextBridge.exposeInMainWorld('api', api);
