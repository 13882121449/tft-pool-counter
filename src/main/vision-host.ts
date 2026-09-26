/**
 * Vision Utility Process 宿主（架构 §3.6 / ADR-01 / §1.2）。
 *
 * 职责：
 * 1. `utilityProcess.fork` 拉起 `dist/vision/worker.js`，与主进程**彻底解耦**
 *    （截图/识别绝不占用主进程事件循环，worker 崩溃不拖垮 UI）；
 * 2. `requestId` / `scanId` 请求-响应配对 + 超时保护；
 * 3. 心跳探活 + 崩溃自动重启（指数退避）；
 * 4. 回填 `frame:request`（desktopCapturer 回退链路的帧转发）。
 *
 * 合规：本模块只做进程编排与消息转发；不读取游戏进程内存、不注入、不模拟输入。
 * 所有像素处理都发生在 worker 进程内，且从不落盘、从不上传。
 */

import { utilityProcess } from 'electron';
import type { AppError } from '../shared/types/domain';
import type { Calibration, ScanResult } from '../shared/types/scan';
import { createEmptyScanResult } from '../shared/types/scan';
import {
  WORKER_MSG_CALIBRATE,
  WORKER_MSG_CAPABILITIES,
  WORKER_MSG_CAPTURE_TEMPLATE,
  WORKER_MSG_CONFIG,
  WORKER_MSG_ERROR,
  WORKER_MSG_FRAME_REQUEST,
  WORKER_MSG_FRAME_RESPONSE,
  WORKER_MSG_HEARTBEAT,
  WORKER_MSG_READY,
  WORKER_MSG_SCAN,
  WORKER_MSG_SCAN_RESULT,
} from '../shared/ipc/channels';
import { makeError } from '../shared/ipc/error-codes';
import { SCAN_TIMEOUT_MS } from '../shared/constants';
import type {
  TemplateCapturePayload,
  VisionCapabilities,
  VisionWorkerConfig,
  WorkerResponseMessage,
} from '../shared/types/vision';
import { logger } from './system/logger';

/** utilityProcess 句柄类型（避免直接依赖 Electron 命名空间导出）。 */
type UtilityProcessHandle = ReturnType<typeof utilityProcess.fork>;

/** 待配对请求的种类。 */
type PendingKind = 'scan' | 'config' | 'calibrate' | 'captureTemplate' | 'capabilities' | 'heartbeat';

/** 待配对请求。 */
interface PendingRequest {
  kind: PendingKind;
  resolve: (value: unknown) => void;
  reject: (error: AppError) => void;
  timer: NodeJS.Timeout;
}

/** 帧提供者：向宿主请求一帧压缩画面（worker 侧 desktopCapturer 回退链路）。 */
export type HostFrameProvider = (requestId: string) => Promise<Uint8Array | null> | Uint8Array | null;

/** VisionHost 构造参数。 */
export interface VisionHostOptions {
  /** worker 产物绝对路径（`dist/vision/worker.js`）。 */
  workerPath: string;
  /** 数据目录（注入 TFT_DATA_DIR，保证打包后 worker 也读得到 data/*.json）。 */
  dataDir: string;
  /** 用户模板目录。 */
  templateDir?: string;
  /** 识别配置。 */
  recognition?: VisionWorkerConfig['recognition'];
  /** 单次扫描超时（默认 SCAN_TIMEOUT_MS）。 */
  timeoutMs?: number;
  /** 是否启用 desktopCapturer 回退帧提供者。 */
  enableFallbackFrameProvider?: boolean;
  /** 帧提供者实现（未提供时 worker 侧探测会超时并自动跳过该后端）。 */
  frameProvider?: HostFrameProvider | null;
  /** 能力上报回调（设置页 / 自检面板）。 */
  onCapabilities?: (capabilities: VisionCapabilities) => void;
  /** 错误上报回调（转发到 UI 状态条）。 */
  onError?: (error: AppError) => void;
  /** 首次重启延迟（ms），默认 1000，失败后指数退避至 8000。 */
  restartDelayMs?: number;
}

/**
 * Vision worker 宿主。
 */
export class VisionHost {
  private child: UtilityProcessHandle | null = null;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly options: VisionHostOptions;

  private latestCapabilities: VisionCapabilities | null = null;

  private desiredCalibration: Calibration | null = null;

  private sentCalibration: Calibration | null = null;

  private sequence = 0;

  private restartDelay: number;

  private disposed = false;

  private restartTimer: NodeJS.Timeout | null = null;

  private ready = false;

  constructor(options: VisionHostOptions) {
    this.options = options;
    this.restartDelay = options.restartDelayMs ?? 1_000;
  }

  /** worker 是否已就绪（握手完成）。 */
  isReady(): boolean {
    return this.ready && this.child !== null;
  }

  /** 最近一次能力上报。 */
  capabilities(): VisionCapabilities | null {
    return this.latestCapabilities;
  }

  /** 启动（幂等）。 */
  start(): void {
    if (this.disposed || this.child !== null) {
      return;
    }
    this.spawn();
  }

  /**
   * 停止并释放 worker。
   *
   * @param exitCode 终止信号。
   */
  stop(): void {
    this.disposed = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.rejectAll(makeError('SYS_WORKER_CRASH', { message: '识别进程已停止' }));
    this.killChild();
    this.ready = false;
  }

  /** `stop` 的语义别名。 */
  dispose(): void {
    this.stop();
  }

  /**
   * 重启 worker（用于模板库变更后强制重新加载模板）。
   *
   * 不置 `disposed`，因此 'exit' 事件会走自动重启路径，指数退避也保持有效。
   */
  restart(): void {
    if (this.disposed) {
      return;
    }
    logger.info('[vision-host] 主动重启 worker');
    this.killChild();
  }

  /**
   * 下发运行期配置（worker 就绪后必须发一次）。
   *
   * @param config 配置。
   */
  configure(config: VisionWorkerConfig): void {
    const payload: VisionWorkerConfig = {
      dataDir: this.options.dataDir,
      ...(this.options.templateDir !== undefined ? { templateDir: this.options.templateDir } : {}),
      recognition: { ...(this.options.recognition ?? {}), ...(config.recognition ?? {}) },
      timeoutMs: config.timeoutMs ?? this.options.timeoutMs ?? SCAN_TIMEOUT_MS,
      enableFallbackFrameProvider:
        config.enableFallbackFrameProvider ?? this.options.enableFallbackFrameProvider ?? false,
      ...(config.frameRequestTimeoutMs !== undefined
        ? { frameRequestTimeoutMs: config.frameRequestTimeoutMs }
        : {}),
      ...(config.templateDir !== undefined ? { templateDir: config.templateDir } : {}),
    };
    if (!this.isReady()) {
      return;
    }
    void this.request(WORKER_MSG_CONFIG, payload, {
      kind: 'config',
      timeoutMs: (this.options.timeoutMs ?? SCAN_TIMEOUT_MS) + 4_000,
    }).catch((error) => this.options.onError?.(error));
  }

  /**
   * 记录期望标定；worker 就绪后自动下发（worker 重启后无需上层重新标定）。
   *
   * @param calibration 标定信息。
   */
  setCalibration(calibration: Calibration): void {
    this.desiredCalibration = calibration;
    if (this.isReady() && this.sentCalibration !== calibration) {
      void this.sendCalibration();
    }
  }

  /** 是否已下发过当前标定。 */
  private calibrationDirty(): boolean {
    return this.desiredCalibration !== null && this.sentCalibration !== this.desiredCalibration;
  }

  /** 把期望标定发给 worker。 */
  private async sendCalibration(): Promise<void> {
    const calibration = this.desiredCalibration;
    if (calibration === null || !this.isReady()) {
      return;
    }
    await this.request(WORKER_MSG_CALIBRATE, calibration, {
      kind: 'calibrate',
      timeoutMs: 3_000,
    });
    this.sentCalibration = calibration;
  }

  /**
   * 执行一次扫描（永不 reject：失败时返回带错误的空结果，便于调度器统一处理失败退避）。
   *
   * @param options 扫描选项。
   * @param scanId 扫描 id。
   */
  async scan(
    options: { detectPlayer: boolean; detectStage: boolean; detectShop: boolean },
    scanId: string,
  ): Promise<ScanResult> {
    const now = Date.now();
    if (!this.isReady()) {
      return createEmptyScanResult(scanId, now, [
        makeError('SYS_WORKER_CRASH', { message: '识别进程尚未就绪' }),
      ]);
    }
    try {
      if (this.calibrationDirty()) {
        await this.sendCalibration();
      }
      const payload = await this.request(
        WORKER_MSG_SCAN,
        options,
        { kind: 'scan', scanId, timeoutMs: (this.options.timeoutMs ?? SCAN_TIMEOUT_MS) + 800 },
      );
      return payload as ScanResult;
    } catch (error) {
      const appError =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as AppError)
          : makeError('SYS_IPC_TIMEOUT', { message: String(error) });
      return createEmptyScanResult(scanId, now, [appError]);
    }
  }

  /**
   * 请求抓帧并切出模板采集草稿。
   *
   * @returns 草稿列表与错误；worker 不可用时返回空结果。
   */
  async captureTemplate(): Promise<TemplateCapturePayload> {
    if (!this.isReady()) {
      return {
        drafts: [],
        size: 0,
        errors: [makeError('SYS_WORKER_CRASH', { message: '识别进程尚未就绪' })],
      };
    }
    try {
      const payload = await this.request(WORKER_MSG_CAPTURE_TEMPLATE, null, {
        kind: 'captureTemplate',
        timeoutMs: (this.options.timeoutMs ?? SCAN_TIMEOUT_MS) + 4_000,
      });
      return payload as TemplateCapturePayload;
    } catch (error) {
      return {
        drafts: [],
        size: 0,
        errors: [
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as AppError)
            : makeError('SYS_IPC_TIMEOUT', { message: String(error) }),
        ],
      };
    }
  }

  /**
   * 心跳探活：返回往返耗时（ms）；超时或未就绪返回 null。
   *
   * @param timeoutMs 心跳超时，默认 1500。
   */
  async ping(timeoutMs = 1_500): Promise<number | null> {
    if (!this.isReady()) {
      return null;
    }
    const started = Date.now();
    try {
      await this.request(WORKER_MSG_HEARTBEAT, null, { kind: 'heartbeat', timeoutMs });
      return Date.now() - started;
    } catch {
      return null;
    }
  }

  /** 主动请求一次能力上报。 */
  async refreshCapabilities(): Promise<VisionCapabilities | null> {
    if (!this.isReady()) {
      return this.latestCapabilities;
    }
    try {
      const payload = await this.request(WORKER_MSG_CAPABILITIES, null, {
        kind: 'capabilities',
        timeoutMs: 3_000,
      });
      this.recordCapabilities(payload);
      return this.latestCapabilities;
    } catch {
      return this.latestCapabilities;
    }
  }

  /** 记录能力快照并回调。 */
  private recordCapabilities(payload: unknown): void {
    if (payload !== null && typeof payload === 'object') {
      this.latestCapabilities = payload as VisionCapabilities;
      this.options.onCapabilities?.(this.latestCapabilities);
    }
  }

  /** 拉起 worker 进程。 */
  private spawn(): void {
    try {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
          env[key] = value;
        }
      }
      env.TFT_DATA_DIR = this.options.dataDir;

      const child = utilityProcess.fork(this.options.workerPath, [], {
        serviceName: 'tft-vision',
        env,
        stdio: 'pipe',
      });
      this.child = child;
      this.ready = false;

      child.on('message', (message: WorkerResponseMessage) => this.handleMessage(message));
      child.on('exit', (code: number) => this.handleExit(code));
      child.stdout?.on('data', (chunk: Buffer) => {
        logger.debug(`[vision] ${chunk.toString().trimEnd()}`);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        logger.warn(`[vision] ${chunk.toString().trimEnd()}`);
      });

      logger.info('[vision-host] worker 已拉起', { pid: child.pid, workerPath: this.options.workerPath });
    } catch (error) {
      const appError = makeError('SYS_WORKER_CRASH', {
        message: `无法启动识别进程：${error instanceof Error ? error.message : String(error)}`,
      });
      this.options.onError?.(appError);
      logger.error('[vision-host] fork 失败', appError);
      this.scheduleRestart();
    }
  }

  /** 处理 worker 消息。 */
  private handleMessage(message: WorkerResponseMessage): void {
    if (!message || typeof message.type !== 'string') {
      return;
    }
    switch (message.type) {
      case WORKER_MSG_READY: {
        this.ready = true;
        this.restartDelay = this.options.restartDelayMs ?? 1_000;
        this.sentCalibration = null;
        logger.info('[vision-host] worker 就绪', message.payload);
        // 就绪后立刻下发配置 + 期望标定
        this.configure({});
        if (this.desiredCalibration !== null) {
          void this.sendCalibration();
        }
        break;
      }
      case WORKER_MSG_CAPABILITIES: {
        this.recordCapabilities(message.payload);
        this.resolvePending(message.requestId, message.payload);
        break;
      }
      case WORKER_MSG_SCAN_RESULT: {
        this.resolvePending(message.requestId ?? message.scanId, message.payload);
        break;
      }
      case WORKER_MSG_CAPTURE_TEMPLATE: {
        this.resolvePending(message.requestId, message.payload);
        break;
      }
      case WORKER_MSG_HEARTBEAT: {
        this.resolvePending(message.requestId, message.payload);
        break;
      }
      case WORKER_MSG_ERROR: {
        const error = message.payload as AppError;
        if (message.requestId !== undefined) {
          this.rejectPending(message.requestId, error);
        }
        this.options.onError?.(error);
        logger.warn('[vision-host] worker 上报错误', error);
        break;
      }
      case WORKER_MSG_FRAME_REQUEST: {
        void this.serveFrame(message.requestId);
        break;
      }
      default:
        break;
    }
  }

  /** 响应 worker 的帧请求（desktopCapturer 回退链路）。 */
  private async serveFrame(requestId: string | undefined): Promise<void> {
    const provider = this.options.frameProvider ?? null;
    if (requestId === undefined || provider === null) {
      return;
    }
    try {
      const bytes = await provider(requestId);
      this.post({
        type: WORKER_MSG_FRAME_RESPONSE,
        requestId,
        payload: bytes,
      });
    } catch {
      this.post({ type: WORKER_MSG_FRAME_RESPONSE, requestId, payload: null });
    }
  }

  /** 处理 worker 退出（崩溃 → 自动重启）。 */
  private handleExit(code: number): void {
    this.ready = false;
    this.child = null;
    this.sentCalibration = null;
    this.rejectAll(
      makeError('SYS_WORKER_CRASH', { message: `识别进程退出（code=${code}），正在自动重启` }),
    );
    if (this.disposed) {
      return;
    }
    logger.warn('[vision-host] worker 退出，准备重启', { code });
    this.scheduleRestart();
  }

  /** 指数退避重启。 */
  private scheduleRestart(): void {
    if (this.disposed || this.restartTimer !== null) {
      return;
    }
    const delay = this.restartDelay;
    this.restartDelay = Math.min(8_000, Math.round(this.restartDelay * 2));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.disposed) {
        this.spawn();
      }
    }, delay);
  }

  /** 杀掉当前 worker（不触发重启）。 */
  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (child === null) {
      return;
    }
    try {
      child.kill();
    } catch {
      // 进程可能已经退出
    }
  }

  /** 发送一条请求并等待配对响应。 */
  private request(
    type: string,
    payload: unknown,
    meta: { kind: PendingKind; scanId?: string; timeoutMs: number },
  ): Promise<unknown> {
    const requestId = `req-${(this.sequence += 1)}`;
    return new Promise<unknown>((resolve, reject) => {
      if (!this.isReady() && meta.kind !== 'capabilities') {
        reject(makeError('SYS_WORKER_CRASH', { message: '识别进程尚未就绪' }));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(makeError('SYS_IPC_TIMEOUT', { message: `识别进程响应超时（${meta.kind}）` }));
      }, Math.max(200, meta.timeoutMs));
      const entry: PendingRequest = { kind: meta.kind, resolve, reject, timer };
      this.pending.set(requestId, entry);
      if (meta.scanId !== undefined) {
        this.pending.set(meta.scanId, entry);
      }
      this.post({
        type,
        requestId,
        ...(meta.scanId !== undefined ? { scanId: meta.scanId } : {}),
        payload,
      });
    });
  }

  /** 发送消息（进程不可用时静默忽略）。 */
  private post(message: WorkerResponseMessage & { type: string }): void {
    const child = this.child;
    if (child === null) {
      return;
    }
    try {
      child.postMessage(message);
    } catch (error) {
      logger.warn('[vision-host] postMessage 失败', error);
    }
  }

  /** 配对成功。 */
  private resolvePending(requestId: string | undefined, payload: unknown): void {
    if (requestId === undefined) {
      return;
    }
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(payload);
  }

  /** 配对失败。 */
  private rejectPending(requestId: string, error: AppError): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.reject(error);
  }

  /** 拒绝所有在途请求（进程退出时）。 */
  private rejectAll(error: AppError): void {
    for (const [key, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(key);
      entry.reject(error);
    }
  }
}
