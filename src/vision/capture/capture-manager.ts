/**
 * 捕获策略层（ADR-01）：**能力探测 → 选定主后端 → 失败自动降级**。
 *
 * 判定流程：
 * 1. 依次询问各后端 `isSupported()`（依赖是否装好、平台是否支持）；
 * 2. 对可用后端做**连拍 3 帧、均非纯黑**的能力探测；
 * 3. 选第一个探测通过的后端为 active；全都不通过则 active = null 且返回
 *    带中文原因的错误（UI 据此提示用户切「无边框全屏」）；
 * 4. 运行期连续失败超过阈值 → 自动切到下一个后端，并把 `degraded` 置 true。
 *
 * 所有失败都**返回错误对象而不是抛异常**，保证调度器永远不会因为截屏失败而崩。
 */

import { makeError } from '../../shared/ipc/error-codes';
import type { AppError } from '../../shared/types/domain';
import type { RawImage } from '../preprocess/raw-image';
import { createDesktopCapturerFallback, type FrameProvider } from './desktop-capturer-fallback';
import { createNodeScreenshotsCapturer, NodeScreenshotsCapturer } from './node-screenshots-capturer';
import {
  PROBE_FRAME_COUNT,
  type CapabilityProbeResult,
  type CaptureBackendId,
  type CaptureTarget,
  type Capturer,
} from './types';

/** 运行期连续失败多少次触发降级。 */
export const DEGRADE_AFTER_FAILURES = 3;

/** 捕获管理器配置。 */
export interface CaptureManagerOptions {
  /** 首选后端；'auto' = 按 backends 数组顺序自动挑。 */
  preferred?: 'auto' | CaptureBackendId;
  /** 能力探测连拍帧数，默认 3。 */
  probeFrames?: number;
  /** 运行期连续失败阈值，默认 3。 */
  degradeAfterFailures?: number;
  /** 只捕获指定窗口（避开自己的 HUD）。 */
  windowName?: string;
  /** 是否在 init 时执行能力探测（单测里可关掉）。 */
  runProbe?: boolean;
}

/** 单个后端的状态。 */
export interface BackendStatus {
  id: CaptureBackendId;
  supported: boolean;
  probeOk: boolean;
  avgVariance: number;
  avgLuma: number;
  elapsedMs: number;
  reason?: string;
}

/** 管理器整体状态（推送给设置页/日志）。 */
export interface CaptureManagerStatus {
  activeBackend: CaptureBackendId | null;
  /** 是否处于降级态（用了非首选后端，或全后端不可用）。 */
  degraded: boolean;
  /** 最近一次探测结果。 */
  backends: BackendStatus[];
  probedAt: number;
  consecutiveFailures: number;
}

/** 一次捕获的结果。 */
export interface CaptureOutcome {
  image: RawImage | null;
  backend: CaptureBackendId | null;
  degraded: boolean;
  errors: AppError[];
}

/** 捕获策略层。 */
export class CaptureManager {
  private readonly backends: Capturer[];

  private readonly options: Required<Omit<CaptureManagerOptions, 'windowName'>> & {
    windowName?: string;
  };

  private activeIndex = -1;

  private active: Capturer | null = null;

  private status: CaptureManagerStatus = {
    activeBackend: null,
    degraded: false,
    backends: [],
    probedAt: 0,
    consecutiveFailures: 0,
  };

  /**
   * @param backends 候选后端列表（按优先级排序）。
   * @param options 配置。
   */
  constructor(backends: Capturer[], options: CaptureManagerOptions = {}) {
    this.backends = backends;
    this.options = {
      preferred: options.preferred ?? 'auto',
      probeFrames: options.probeFrames ?? PROBE_FRAME_COUNT,
      degradeAfterFailures: options.degradeAfterFailures ?? DEGRADE_AFTER_FAILURES,
      runProbe: options.runProbe ?? true,
      windowName: options.windowName,
    };
  }

  /**
   * 初始化：能力探测 + 选定后端。
   *
   * @returns 状态快照。永不抛异常。
   */
  async init(): Promise<CaptureManagerStatus> {
    const statuses: BackendStatus[] = [];
    this.active = null;
    this.activeIndex = -1;

    // 若指定了首选后端，把它排到最前
    const ordered = this.orderBackends();

    for (let index = 0; index < ordered.length; index += 1) {
      const backend = ordered[index];
      if (backend === undefined) {
        continue;
      }

      const supported = await this.safeIsSupported(backend);
      if (!supported) {
        statuses.push({
          id: backend.id,
          supported: false,
          probeOk: false,
          avgVariance: 0,
          avgLuma: 0,
          elapsedMs: 0,
          reason: '依赖缺失或平台不支持',
        });
        continue;
      }

      const probe: CapabilityProbeResult = this.options.runProbe
        ? await backend.probe(this.options.probeFrames)
        : {
            ok: true,
            frames: 0,
            usableFrames: 0,
            avgVariance: 0,
            avgLuma: 0,
            elapsedMs: 0,
          };

      statuses.push({
        id: backend.id,
        supported: true,
        probeOk: probe.ok,
        avgVariance: probe.avgVariance,
        avgLuma: probe.avgLuma,
        elapsedMs: probe.elapsedMs,
        reason: probe.reason,
      });

      if (probe.ok && this.active === null) {
        this.active = backend;
        this.activeIndex = index;
      }
    }

    this.status = {
      activeBackend: this.active?.id ?? null,
      // 降级态 = 用的不是首选后端，或干脆没有可用后端
      degraded: this.active === null || this.activeIndex > 0,
      backends: statuses,
      probedAt: Date.now(),
      consecutiveFailures: 0,
    };
    return this.status;
  }

  /**
   * 按首选顺序排列后端。
   */
  private orderBackends(): Capturer[] {
    const preferred = this.options.preferred;
    if (preferred === 'auto') {
      return [...this.backends];
    }
    const head = this.backends.filter((backend) => backend.id === preferred);
    const tail = this.backends.filter((backend) => backend.id !== preferred);
    return [...head, ...tail];
  }

  /**
   * 安全调用 `isSupported()`（把异常吞掉视为不支持）。
   *
   * @param backend 后端。
   */
  private async safeIsSupported(backend: Capturer): Promise<boolean> {
    try {
      return await backend.isSupported();
    } catch {
      return false;
    }
  }

  /**
   * 切换到下一个候选后端（降级）。
   *
   * @returns 是否切换成功。
   */
  private async degradeToNext(): Promise<boolean> {
    const ordered = this.orderBackends();
    for (let index = this.activeIndex + 1; index < ordered.length; index += 1) {
      const candidate = ordered[index];
      if (candidate === undefined) {
        continue;
      }
      if (!(await this.safeIsSupported(candidate))) {
        continue;
      }
      this.active = candidate;
      this.activeIndex = index;
      this.status = {
        ...this.status,
        activeBackend: candidate.id,
        degraded: true,
        consecutiveFailures: 0,
      };
      return true;
    }
    this.active = null;
    this.status = {
      ...this.status,
      activeBackend: null,
      degraded: true,
      consecutiveFailures: 0,
    };
    return false;
  }

  /**
   * 抓取一帧；失败自动降级重试一次。
   *
   * @param target 捕获目标（缺省用构造时的 windowName）。
   */
  async capture(target?: CaptureTarget): Promise<CaptureOutcome> {
    const errors: AppError[] = [];
    const effectiveTarget: CaptureTarget = {
      ...(this.options.windowName !== undefined ? { windowName: this.options.windowName } : {}),
      ...(target ?? {}),
    };

    if (this.active === null) {
      await this.init();
    }

    if (this.active === null) {
      errors.push(
        makeError('CAP_BACKEND_UNAVAILABLE', {
          message: '没有可用的屏幕捕获后端（请确认已安装依赖且游戏为无边框全屏）',
        }),
      );
      return { image: null, backend: null, degraded: true, errors };
    }

    const first = await this.active.capture(effectiveTarget);
    if (first.image !== null) {
      this.status = { ...this.status, consecutiveFailures: 0 };
      return {
        image: first.image,
        backend: this.active.id,
        degraded: this.status.degraded,
        errors,
      };
    }

    if (first.error !== null) {
      errors.push(first.error);
    }
    const failures = this.status.consecutiveFailures + 1;
    this.status = { ...this.status, consecutiveFailures: failures };

    if (failures < this.options.degradeAfterFailures) {
      return {
        image: null,
        backend: this.active.id,
        degraded: this.status.degraded,
        errors,
      };
    }

    // 连续失败达到阈值 → 降级到下一个后端并立即重试一次
    const switched = await this.degradeToNext();
    if (!switched) {
      errors.push(
        makeError('CAP_BACKEND_UNAVAILABLE', { message: '所有捕获后端均失败，已停止自动扫描' }),
      );
      return { image: null, backend: null, degraded: true, errors };
    }

    const retry = await this.active?.capture(effectiveTarget);
    if (retry && retry.image !== null && this.active !== null) {
      this.status = { ...this.status, consecutiveFailures: 0 };
      return {
        image: retry.image,
        backend: this.active.id,
        degraded: true,
        errors,
      };
    }
    if (retry?.error) {
      errors.push(retry.error);
    }
    return { image: null, backend: this.active?.id ?? null, degraded: true, errors };
  }

  /** 当前状态快照。 */
  getStatus(): CaptureManagerStatus {
    return { ...this.status, backends: [...this.status.backends] };
  }

  /** 当前生效的后端 id。 */
  getActiveBackend(): CaptureBackendId | null {
    return this.active?.id ?? null;
  }

  /** 单个后端的最近错误（设置页展示用）。 */
  getBackendErrors(): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const backend of this.backends) {
      if (backend instanceof NodeScreenshotsCapturer) {
        result[backend.id] = backend.getLastError();
      }
    }
    return result;
  }

  /** 释放全部后端。 */
  dispose(): void {
    for (const backend of this.backends) {
      try {
        backend.dispose();
      } catch {
        // 释放失败不影响退出
      }
    }
    this.active = null;
    this.activeIndex = -1;
  }
}

/** 创建默认捕获管理器的选项。 */
export interface CreateCaptureManagerOptions extends CaptureManagerOptions {
  /** 主进程注入的 desktopCapturer 帧提供者。 */
  frameProvider?: FrameProvider | null;
  /** 是否启用 desktopCapturer 回退（默认启用）。 */
  enableFallback?: boolean;
}

/**
 * 工厂函数：按 ADR-01 优先级组装默认捕获管理器。
 *
 * 顺序：node-screenshots（主选） → desktopCapturer（回退）。
 * 任一依赖缺失都会在 `init()` 的探测阶段被自动跳过。
 *
 * @param options 选项。
 */
export function createCaptureManager(options: CreateCaptureManagerOptions = {}): CaptureManager {
  const backends: Capturer[] = [createNodeScreenshotsCapturer()];
  if (options.enableFallback !== false) {
    backends.push(createDesktopCapturerFallback(options.frameProvider ?? null));
  }
  return new CaptureManager(backends, options);
}
