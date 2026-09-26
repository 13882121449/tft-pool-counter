/**
 * Vision Utility Process 入口（T03 完整版）。
 *
 * 设计要点（ADR-01 / §1.2）：
 * - 截图与识别**绝不**出现在主进程或渲染进程的同步路径上；
 * - 本进程崩溃不应导致主窗口退出，由主进程 VisionHost 负责重启；
 * - 与宿主通过 `process.on('message')` 通信，用 `requestId` / `scanId` 配对。
 *
 * 消息协议（常量集中在 `src/shared/ipc/channels.ts`）：
 * - 宿主 → worker：`config` / `calibrate` / `scan` / `captureTemplate` / `heartbeat`
 *                  / `frame:response`（回填 desktopCapturer 帧）
 * - worker → 宿主：`ready` / `capabilities` / `scan:result` / `error`
 *                  / `frame:request`（请求一帧压缩画面）
 *
 * 合规：全程只读屏幕像素；不读写任何进程内存、不注入、不模拟输入、不上传。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
  VisionCapabilities,
  VisionWorkerConfig,
  WizardDraftPayload,
} from '../shared/types/vision';
import type { AppError, PoolBaseline } from '../shared/types/domain';
import type { Calibration, ScanResult } from '../shared/types/scan';
import { createEmptyScanResult } from '../shared/types/scan';
import { loadBaseline } from '../core/baseline/load-baseline';
import { createCaptureManager, type CaptureManager } from './capture/capture-manager';
import type { FrameProvider } from './capture/desktop-capturer-fallback';
import { createBlacklistFilter, type BlacklistFilter } from './match/blacklist-filter';
import { currentMatcherBackend } from './match/opencv-matcher';
import {
  createFileTemplateStore,
  createMemoryTemplateStore,
  type ChampionMeta,
  type TemplateStore,
} from './match/template-store';
import { loadCostColorSpec, loadStarMarkerSpec } from './detect/spec-loader';
import {
  FALLBACK_COST_COLOR_SPEC,
  FALLBACK_STAR_MARKER_SPEC,
  type CostColorSpec,
  type StarMarkerSpecFile,
} from './detect/specs';
import { captureWizardSlots, type WizardSlotDraft } from './templates/capture-wizard';
import { runScanPipeline } from './pipeline';
import { encodePng } from './preprocess/scale';
import { buildGeometry } from './preprocess/geometry';
import type { RawImage } from './preprocess/raw-image';
import type { KnownBoardFingerprint } from './detect/player-detector';

/** 宿主 → Worker 的消息。 */
interface WorkerRequest {
  type: string;
  requestId?: string;
  scanId?: string;
  payload?: unknown;
}

/** Worker → 宿主的消息。 */
interface WorkerResponse {
  type: string;
  requestId?: string;
  scanId?: string;
  payload?: unknown;
}

/**
 * 跨进程契约（配置 / 能力 / 向导草稿）统一放在 `src/shared/types/vision.ts`，
 * 这里只做再导出，保证 `src/vision/index.ts` 的既有出口不破裂。
 */
export type {
  VisionWorkerConfig,
  WizardDraftPayload,
  VisionCapabilities,
  TemplateCapturePayload,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from '../shared/types/vision';

/** 解析数据目录（宿主可通过环境变量覆盖，打包后必须由宿主注入）。 */
function resolveDataDir(config: VisionWorkerConfig): string {
  if (config.dataDir) {
    return resolve(config.dataDir);
  }
  if (process.env.TFT_DATA_DIR) {
    return resolve(process.env.TFT_DATA_DIR);
  }
  return resolve(process.cwd(), 'data');
}

/** 向宿主发送消息。 */
function post(response: WorkerResponse): void {
  if (typeof process.send === 'function') {
    process.send(response);
  }
}

/** 把未知载荷转成字节（容忍 Buffer / Uint8Array / ArrayBuffer / 数字数组）。 */
export function toBytes(payload: unknown): Uint8Array | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload as number[]);
  }
  if (typeof payload === 'object' && 'bytes' in (payload as Record<string, unknown>)) {
    return toBytes((payload as Record<string, unknown>).bytes);
  }
  return null;
}

/**
 * 向导草稿 → 可传输载荷。
 *
 * 一律使用 **原始 RGBA**（64×64×4 ≈ 16KB）：主进程无需解码依赖即可还原，
 * 避免"worker 有 sharp、主进程没有"导致的模板落盘失败。
 */
export async function encodeDraft(draft: WizardSlotDraft): Promise<WizardDraftPayload> {
  return {
    zone: draft.zone,
    slotIndex: draft.slotIndex,
    row: draft.row,
    col: draft.col,
    blank: draft.blank,
    fingerprint: draft.fingerprint,
    width: draft.image.width,
    height: draft.image.height,
    encoding: 'raw',
    bytes: draft.image.data,
  };
}

/** Worker 运行时：持有捕获、模板、规格与标定状态。 */
export class VisionWorkerRuntime {
  private config: VisionWorkerConfig = {};

  private captureManager: CaptureManager | null = null;

  private templates: TemplateStore = createMemoryTemplateStore([]);

  private costSpec: CostColorSpec = FALLBACK_COST_COLOR_SPEC;

  private starSpec: StarMarkerSpecFile = FALLBACK_STAR_MARKER_SPEC;

  private blacklist: BlacklistFilter = createBlacklistFilter([]);

  private baseline: PoolBaseline | null = null;

  private champions: ChampionMeta[] = [];

  /** championId → 占用格数（teamSlots），供识别层合并多格实例（QA M2）。 */
  private teamSlots = new Map<string, number>();

  private calibration: Calibration | null = null;

  private prevFrame: RawImage | null = null;

  private knownFingerprints: KnownBoardFingerprint[] = [];

  private readonly pendingFrames = new Map<string, (bytes: Uint8Array | null) => void>();

  private frameSeq = 0;

  private lastErrors: AppError[] = [];

  private specsLoaded = false;

  private baselineLoaded = false;

  private templatesLoaded = false;

  /** 记录错误并同时上报宿主（最多保留 20 条，避免无限增长）。 */
  private reportError(error: AppError, requestId?: string): void {
    this.lastErrors = [...this.lastErrors.slice(-19), error];
    post({
      type: WORKER_MSG_ERROR,
      ...(requestId !== undefined ? { requestId } : {}),
      payload: error,
    });
  }

  /** 加载基线（模板费用索引、非池名单都依赖它）。 */
  private async ensureBaseline(dataDir: string): Promise<void> {
    if (this.baselineLoaded) {
      return;
    }
    this.baselineLoaded = true;
    try {
      const text = await readFile(resolve(dataDir, 'pool-baseline.json'), 'utf8');
      const result = loadBaseline(text);
      if (!result.ok || result.baseline === null) {
        for (const error of result.errors) {
          this.reportError(error);
        }
        return;
      }
      this.baseline = result.baseline;
      this.champions = result.baseline.champions.map((champion) => ({
        id: champion.id,
        cost: champion.cost,
      }));
      this.teamSlots = new Map(
        result.baseline.champions.map((champion) => [champion.id, champion.special?.teamSlots ?? 1]),
      );
      this.blacklist = createBlacklistFilter(result.baseline.nonPoolUnitIds);
      for (const warning of result.warnings) {
        this.lastErrors = [...this.lastErrors.slice(-19), warning];
      }
    } catch (error) {
      this.reportError(
        makeError('BASE_INVALID_JSON', {
          message: `读取卡池基线失败：${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  /** 加载识别规格（读不到会回退内置兜底并给出提示）。 */
  private async ensureSpecs(dataDir: string): Promise<void> {
    if (this.specsLoaded) {
      return;
    }
    this.specsLoaded = true;
    const cost = await loadCostColorSpec('cost-colors.json', dataDir);
    const star = await loadStarMarkerSpec('star-markers.json', dataDir);
    this.costSpec = cost.spec;
    this.starSpec = star.spec;
    if (cost.fallback && cost.reason) {
      this.reportError(makeError('VIS_LOW_CONFIDENCE', { message: cost.reason }));
    }
    if (star.fallback && star.reason) {
      this.reportError(makeError('VIS_LOW_CONFIDENCE', { message: star.reason }));
    }
  }

  /** 加载模板库。 */
  private async ensureTemplates(config: VisionWorkerConfig, dataDir: string): Promise<void> {
    if (this.templatesLoaded) {
      return;
    }
    this.templatesLoaded = true;
    const dir = config.templateDir ?? resolve(dataDir, 'templates');
    try {
      this.templates = await createFileTemplateStore(dir, this.champions);
    } catch (error) {
      this.reportError(
        makeError('VIS_TEMPLATE_EMPTY', {
          message: `模板目录不可读：${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  /**
   * 宿主帧提供者：向宿主请求一帧压缩画面（desktopCapturer 回退链路）。
   * 宿主未实现时按超时返回 null，回退后端会被能力探测自动跳过。
   */
  private createHostFrameProvider(): FrameProvider {
    const timeoutMs = this.config.frameRequestTimeoutMs ?? 800;
    return () =>
      new Promise<{ bytes: Uint8Array; scaleFactor?: number } | null>((resolveFrame) => {
        const requestId = `frame-${(this.frameSeq += 1)}`;
        const timer = setTimeout(() => {
          this.pendingFrames.delete(requestId);
          resolveFrame(null);
        }, Math.max(100, timeoutMs));
        this.pendingFrames.set(requestId, (bytes) => {
          clearTimeout(timer);
          this.pendingFrames.delete(requestId);
          resolveFrame(bytes === null ? null : { bytes });
        });
        post({ type: WORKER_MSG_FRAME_REQUEST, requestId, payload: null });
      });
  }

  /** 回填宿主帧（响应 `frame:request`）。 */
  handleFrameResponse(requestId: string | undefined, payload: unknown): void {
    if (requestId === undefined) {
      return;
    }
    const resolver = this.pendingFrames.get(requestId);
    if (resolver === undefined) {
      return;
    }
    resolver(toBytes(payload));
  }

  /** 确保捕获管理器已创建并完成能力探测。 */
  private async ensureCapture(): Promise<CaptureManager> {
    if (this.captureManager !== null) {
      return this.captureManager;
    }
    const enableFallback = this.config.enableFallbackFrameProvider === true;
    const manager = createCaptureManager({
      preferred: 'auto',
      enableFallback,
      frameProvider: enableFallback ? this.createHostFrameProvider() : null,
    });
    await manager.init();
    this.captureManager = manager;
    return manager;
  }

  /** 处理 `config`。 */
  async handleConfig(payload: unknown): Promise<void> {
    const config = (payload ?? {}) as VisionWorkerConfig;
    this.config = config;
    const dataDir = resolveDataDir(config);
    await this.ensureBaseline(dataDir);
    await this.ensureSpecs(dataDir);
    await this.ensureTemplates(config, dataDir);
    // 配置变更后重建捕获（后端开关可能变了）
    this.resetCapture();
  }

  /** 处理 `calibrate`。 */
  handleCalibrate(payload: unknown): { ok: boolean } {
    if (payload === null || typeof payload !== 'object') {
      return { ok: false };
    }
    this.calibration = payload as Calibration;
    return { ok: true };
  }

  /** 处理 `captureTemplate`：抓一帧并切出向导草稿。 */
  async handleCaptureTemplate(): Promise<{
    drafts: WizardDraftPayload[];
    size: number;
    errors: AppError[];
  }> {
    const errors: AppError[] = [];
    if (this.calibration === null) {
      errors.push(makeError('VIS_CALIBRATION_MISSING'));
      return { drafts: [], size: 0, errors };
    }
    const manager = await this.ensureCapture();
    const outcome = await manager.capture();
    errors.push(...outcome.errors);
    if (outcome.image === null) {
      return { drafts: [], size: 0, errors };
    }
    const geometry = buildGeometry(this.calibration, {
      width: outcome.image.width,
      height: outcome.image.height,
      scaleFactor: outcome.image.scaleFactor,
    });
    const capture = await captureWizardSlots(outcome.image, geometry, { includeShop: false });
    const drafts: WizardDraftPayload[] = [];
    for (const draft of capture.drafts) {
      drafts.push(await encodeDraft(draft));
    }
    return { drafts, size: capture.size, errors };
  }

  /** 处理 `scan`。 */
  async handleScan(request: WorkerRequest): Promise<ScanResult> {
    const scanId = request.scanId ?? `scan-${Date.now()}`;
    const now = Date.now();
    const dataDir = resolveDataDir(this.config);

    await this.ensureBaseline(dataDir);
    await this.ensureSpecs(dataDir);
    await this.ensureTemplates(this.config, dataDir);

    if (this.calibration === null) {
      return createEmptyScanResult(scanId, now, [makeError('VIS_CALIBRATION_MISSING')]);
    }

    const errors: AppError[] = [];
    if (this.templates.size() === 0) {
      errors.push(makeError('VIS_TEMPLATE_EMPTY'));
    }

    const manager = await this.ensureCapture();
    const options = (request.payload ?? {}) as {
      detectPlayer?: boolean;
      detectStage?: boolean;
      detectShop?: boolean;
    };

    const result = await runScanPipeline(
      {
        capture: manager,
        templates: this.templates,
        costSpec: this.costSpec,
        starSpec: this.starSpec,
        blacklist: this.blacklist,
        recognition: {
          matchThreshold: this.config.recognition?.matchThreshold ?? 0.72,
          coarseTopN: this.config.recognition?.coarseTopN ?? 5,
          enableShopDetect: this.config.recognition?.enableShopDetect ?? false,
        },
        timeoutMs: this.config.timeoutMs ?? SCAN_TIMEOUT_MS,
        prevFrame: () => this.prevFrame,
        onFrame: (frame) => {
          this.prevFrame = frame;
        },
        knownFingerprints: this.knownFingerprints,
        seatHint: null,
        teamSlots: this.teamSlots,
      },
      {
        scanId,
        trigger: 'scheduled',
        calibration: this.calibration,
        options: {
          detectPlayer: options.detectPlayer ?? true,
          detectStage: options.detectStage ?? true,
          detectShop: options.detectShop ?? false,
        },
      },
    );

    return { ...result, errors: [...errors, ...result.errors] };
  }

  /** 能力上报。 */
  async capabilities(): Promise<VisionCapabilities> {
    let nodeScreenshots = false;
    let backend = 'none';
    try {
      const manager = await this.ensureCapture();
      const status = manager.getStatus();
      backend = status.activeBackend ?? 'none';
      nodeScreenshots = status.backends.some(
        (item) => item.id === 'node-screenshots' && item.supported,
      );
    } catch {
      backend = 'none';
    }
    const pngCapable = (await encodePng({
      width: 1,
      height: 1,
      channels: 4,
      format: 'rgba',
      data: new Uint8Array(4),
      scaleFactor: 1,
      capturedAt: 0,
      source: 'probe',
    })) !== null;

    return {
      backend,
      platform: process.platform,
      pid: process.pid,
      nodeScreenshots,
      sharp: pngCapable,
      matcherBackend: await currentMatcherBackend(),
      templateCount: this.templates.size(),
      championCount: this.champions.length,
      calibrationReady: this.calibration !== null,
      errors: this.lastErrors,
    };
  }

  /** 重置捕获后端（配置变更 / 崩溃恢复时调用）。 */
  resetCapture(): void {
    this.captureManager?.dispose();
    this.captureManager = null;
  }

  /** 记录棋盘指纹（供 L2 玩家识别）。 */
  rememberSeat(seat: number, fingerprintValue: string): void {
    if (seat < 0 || seat > 7 || fingerprintValue.length === 0) {
      return;
    }
    this.knownFingerprints = [
      {
        seat: seat as KnownBoardFingerprint['seat'],
        fingerprint: fingerprintValue,
        lastSeenAt: Date.now(),
      },
      ...this.knownFingerprints,
    ].slice(0, 64);
  }

  /** 非池名单（宿主 / 设置页展示）。 */
  nonPoolIds(): string[] {
    return this.blacklist.ids();
  }

  /** 当前模板数量。 */
  templateCount(): number {
    return this.templates.size();
  }

  /** 当前基线（可能为 null）。 */
  currentBaseline(): PoolBaseline | null {
    return this.baseline;
  }
}

/** 单例运行时。 */
const runtime = new VisionWorkerRuntime();

/** 未捕获异常兜底：上报后由宿主决定是否重启，绝不静默退出。 */
process.on('uncaughtException', (error) => {
  post({
    type: WORKER_MSG_ERROR,
    payload: {
      code: 'SYS_WORKER_CRASH',
      message: error.message,
      at: Date.now(),
      fatal: false,
    },
  });
});

process.on('unhandledRejection', (reason) => {
  post({
    type: WORKER_MSG_ERROR,
    payload: {
      code: 'SYS_WORKER_CRASH',
      message: reason instanceof Error ? reason.message : String(reason),
      at: Date.now(),
      fatal: false,
    },
  });
});

/** 处理一条宿主消息；所有分支都不允许抛出。 */
async function handle(request: WorkerRequest): Promise<void> {
  const { type, requestId, payload } = request;
  const withRequestId = requestId !== undefined ? { requestId } : {};

  switch (type) {
    case WORKER_MSG_CONFIG: {
      await runtime.handleConfig(payload);
      post({
        type: WORKER_MSG_CAPABILITIES,
        ...withRequestId,
        payload: await runtime.capabilities(),
      });
      break;
    }
    case WORKER_MSG_CALIBRATE: {
      const result = runtime.handleCalibrate(payload);
      post({
        type: WORKER_MSG_CAPABILITIES,
        ...withRequestId,
        payload: { ...(await runtime.capabilities()), calibrateOk: result.ok },
      });
      break;
    }
    case WORKER_MSG_SCAN: {
      const result = await runtime.handleScan(request);
      post({
        type: WORKER_MSG_SCAN_RESULT,
        ...withRequestId,
        scanId: request.scanId ?? result.scanId,
        payload: result,
      });
      break;
    }
    case WORKER_MSG_CAPTURE_TEMPLATE: {
      const result = await runtime.handleCaptureTemplate();
      post({ type: WORKER_MSG_CAPTURE_TEMPLATE, ...withRequestId, payload: result });
      break;
    }
    case WORKER_MSG_FRAME_RESPONSE: {
      runtime.handleFrameResponse(requestId, payload);
      break;
    }
    case WORKER_MSG_HEARTBEAT: {
      post({ type: WORKER_MSG_HEARTBEAT, ...withRequestId, payload: { at: Date.now() } });
      break;
    }
    default:
      // 未知消息类型：忽略（保持进程存活）
      break;
  }
}

process.on('message', (message: WorkerRequest) => {
  if (!message || typeof message.type !== 'string') {
    return;
  }
  void handle(message).catch((error) => {
    post({
      type: WORKER_MSG_ERROR,
      payload: {
        code: 'SYS_WORKER_CRASH',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
        fatal: false,
      },
    });
  });
});

// 握手：告知宿主 worker 已就绪（完整能力在收到 config 后上报）
post({
  type: WORKER_MSG_READY,
  payload: {
    platform: process.platform,
    pid: process.pid,
    backend: 'pending-probe',
    version: '2',
  },
});
