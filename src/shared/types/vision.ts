/**
 * 视觉层 ↔ 主进程的跨进程契约（架构 §3.5 / §1.2）。
 *
 * 为什么这些类型放在 `src/shared` 而不是 `src/vision/worker-entry.ts`：
 * 主进程需要这些类型，但**绝不能** `import` `worker-entry.ts`
 * —— 该模块在被导入的那一刻就会 `process.on('message')`、注册异常兜底并握手，
 * 在 main 进程里 import 会产生"幽灵 worker"副作用。
 * 因此把纯数据契约抽到 shared，双方各自 import 这里。
 */

import type { AppError } from './domain';
import type { ScanResult } from './scan';

/** 宿主 → Worker 的请求消息。 */
export interface WorkerRequestMessage {
  type: string;
  requestId?: string;
  scanId?: string;
  payload?: unknown;
}

/** Worker → 宿主的响应消息。 */
export interface WorkerResponseMessage {
  type: string;
  requestId?: string;
  scanId?: string;
  payload?: unknown;
}

/** 运行期配置（由宿主在 worker 就绪后下发）。 */
export interface VisionWorkerConfig {
  /** 数据目录（含 pool-baseline.json / cost-colors.json / star-markers.json）。 */
  dataDir?: string;
  /** 用户模板目录。 */
  templateDir?: string;
  /** 识别配置。 */
  recognition?: {
    matchThreshold?: number;
    coarseTopN?: number;
    enableShopDetect?: boolean;
  };
  /** 单次扫描超时（ms）。 */
  timeoutMs?: number;
  /**
   * 是否启用 desktopCapturer 回退帧提供者。
   * 默认 false：宿主未实现 `frame:request` 处理时，开启只会白白等待超时。
   */
  enableFallbackFrameProvider?: boolean;
  /** 帧请求超时（ms），默认 800。 */
  frameRequestTimeoutMs?: number;
}

/** 向导草稿的传输形态（PNG 或原始 RGBA）。 */
export interface WizardDraftPayload {
  zone: string;
  slotIndex: number;
  row: number;
  col: number;
  blank: boolean;
  fingerprint: string;
  width: number;
  height: number;
  encoding: 'png' | 'raw';
  bytes: Uint8Array;
}

/** Worker 能力上报（设置页「当前后端」与自检面板的数据源）。 */
export interface VisionCapabilities {
  backend: string;
  platform: string;
  pid: number;
  nodeScreenshots: boolean;
  sharp: boolean;
  matcherBackend: 'opencv' | 'ncc';
  templateCount: number;
  championCount: number;
  calibrationReady: boolean;
  errors: AppError[];
}

/** `captureTemplate` 的响应载荷。 */
export interface TemplateCapturePayload {
  drafts: WizardDraftPayload[];
  size: number;
  errors: AppError[];
}

/** `ready` 握手载荷。 */
export interface WorkerReadyPayload {
  platform: string;
  pid: number;
  backend: string;
  version: string;
}

/** `heartbeat` 载荷。 */
export interface WorkerHeartbeatPayload {
  at: number;
}

/** 扫描结果载荷（即 ScanResult，单独命名以便阅读）。 */
export type WorkerScanResultPayload = ScanResult;
