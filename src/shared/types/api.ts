/**
 * 渲染进程可见的桥接 API 类型（**唯一契约**）。
 *
 * `src/preload/index.ts` 实现它，`src/preload/api.d.ts` 与 `src/renderer/env.d.ts`
 * 都从这里引入，避免"两处手写 TftPoolApi 逐渐漂移"的经典事故。
 *
 * 约束：本文件只描述"方法名 + 参数 + 返回值"，不含任何 electron / node 依赖，
 * 因此 main / preload / renderer 三方都能安全 import。
 */

import type { AppConfig, WindowConfig } from './config';
import type { PoolBaseline, PoolSnapshot, SeatOrUnknown } from './domain';
import type { Calibration } from './scan';
import type {
  BaselineValidateResult,
  CorrectionCmd,
  CorrectionPayload,
  IpcResponse,
  ScanStatusPush,
  SystemInfoPayload,
  TemplateAppendRequest,
  TemplateAppendResult,
  TemplateCaptureRequest,
  TemplateCaptureResult,
  TemplateExportRequest,
  TemplateExportResult,
  TemplateImportRequest,
  TemplateImportResult,
  TemplateListPayload,
  WindowActionRequest,
  WindowBounds,
} from './ipc';

/** 取消订阅函数。 */
export type Unsubscribe = () => void;

/** 挂在 `window.api` 上的 API。 */
export interface TftPoolApi {
  /** 手动触发一次扫描。 */
  scanOnce(): Promise<IpcResponse<ScanStatusPush>>;
  /** 暂停定时扫描。 */
  pauseScan(): Promise<IpcResponse<ScanStatusPush>>;
  /** 恢复定时扫描。 */
  resumeScan(): Promise<IpcResponse<ScanStatusPush>>;
  /** 查询当前扫描状态。 */
  getScanStatus(): Promise<IpcResponse<ScanStatusPush>>;
  /**
   * 拉取当前牌库快照（幂等，只读）。
   *
   * 用于渲染进程挂载时补齐首帧：推送通道是"变化才发"，
   * 挂载时机可能晚于主进程的首次推送。基线未就绪时返回 null。
   */
  getPoolSnapshot(): Promise<IpcResponse<PoolSnapshot | null>>;

  /** 订阅牌库快照推送。 */
  onPoolSnapshot(callback: (snapshot: PoolSnapshot) => void): Unsubscribe;
  /** 订阅扫描状态推送。 */
  onScanStatus(callback: (status: ScanStatusPush) => void): Unsubscribe;
  /** 订阅系统错误推送。 */
  onSystemError(callback: (error: unknown) => void): Unsubscribe;

  /** 读取配置。 */
  getConfig(): Promise<IpcResponse<AppConfig>>;
  /** 局部更新配置。 */
  setConfig(patch: Partial<AppConfig>): Promise<IpcResponse<AppConfig>>;
  /** 恢复默认配置。 */
  resetConfig(): Promise<IpcResponse<AppConfig>>;

  /** 读取当前卡池基线。 */
  getBaseline(): Promise<IpcResponse<PoolBaseline | null>>;
  /** 重新加载并校验基线。 */
  reloadBaseline(): Promise<IpcResponse<BaselineValidateResult>>;
  /** 只校验基线（不改变当前状态）。 */
  validateBaseline(): Promise<IpcResponse<BaselineValidateResult>>;

  /** 打开校正面板所需的载荷。 */
  openCorrection(request: {
    championId: string;
    seat: SeatOrUnknown;
  }): Promise<IpcResponse<CorrectionPayload | null>>;
  /** 应用一条校正指令。 */
  applyCorrection(cmd: CorrectionCmd): Promise<IpcResponse<PoolSnapshot | null>>;
  /** 把 UNKNOWN 暂存区实例搬到某家。 */
  moveInstance(payload: {
    instanceId: string;
    toSeat: SeatOrUnknown;
  }): Promise<IpcResponse<PoolSnapshot | null>>;
  /** 撤销最近一次校正。 */
  undoCorrection(): Promise<IpcResponse<PoolSnapshot | null>>;

  /** 模板库总览。 */
  listTemplates(): Promise<IpcResponse<TemplateListPayload>>;
  /** 采集当前画面（素材向导）。 */
  captureTemplates(payload?: TemplateCaptureRequest): Promise<IpcResponse<TemplateCaptureResult>>;
  /** 采集向导落盘。 */
  appendTemplates(payload: TemplateAppendRequest): Promise<IpcResponse<TemplateAppendResult>>;
  /** 从 zip 导入模板。 */
  importTemplates(payload: TemplateImportRequest): Promise<IpcResponse<TemplateImportResult>>;
  /** 导出模板为 zip。 */
  exportTemplates(payload: TemplateExportRequest): Promise<IpcResponse<TemplateExportResult>>;

  /** 读取最近日志。 */
  tailLog(payload?: { lines?: number }): Promise<IpcResponse<string[]>>;
  /** 导出日志到指定路径。 */
  exportLog(payload: { outPath: string }): Promise<IpcResponse<string>>;
  /** 系统信息（含分辨率自检与卡池自检）。 */
  systemInfo(): Promise<IpcResponse<SystemInfoPayload>>;
  /** 退出应用。 */
  quit(): Promise<IpcResponse<boolean>>;

  /** 窗口动作（最小化/关闭/显隐/穿透/模式）。 */
  windowAction(request: WindowActionRequest): Promise<IpcResponse<WindowBounds | null>>;
  /** 读取 HUD 矩形。 */
  getWindowBounds(): Promise<IpcResponse<WindowBounds | null>>;
  /** 读取窗口配置。 */
  getWindowState(): Promise<IpcResponse<WindowConfig>>;

  /** 读取标定。 */
  getCalibration(): Promise<IpcResponse<Calibration | null>>;
  /** 保存标定。 */
  saveCalibration(calibration: Calibration): Promise<IpcResponse<Calibration>>;
}
