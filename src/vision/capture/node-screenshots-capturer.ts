/**
 * 主选捕获后端：`node-screenshots`（Rust / Windows Graphics Capture，直出 BGRA Buffer）。
 *
 * 为什么主选它（ADR-01）：
 * - 直出原始像素，省掉 PNG 编解码，CPU 占用远低于 desktopCapturer；
 * - 走 WGC，不会因为游戏窗口在后台而拿到黑帧（desktopCapturer 常见坑）。
 *
 * 已知坑：Windows 上 `toRaw()` 返回 **BGRA** 顺序，必须转成 RGBA；
 * 而且 Pixel 尺寸 = 逻辑像素 × scaleFactor，几何计算必须按物理像素对齐。
 *
 * 依赖缺失/平台不支持时：`isSupported()` 返回 false，由 CaptureManager 跳过。
 */

import { makeError } from '../../shared/ipc/error-codes';
import type { AppError } from '../../shared/types/domain';
import { pickExport, pickCallable, tryImport } from '../native/optional-modules';
import {
  bgraToRgbaInPlace,
  computeFrameStats,
  createRawImage,
  isUsableFrame,
  type RawImage,
} from '../preprocess/raw-image';
import {
  BLACK_FRAME_MAX_LUMA,
  MIN_USABLE_VARIANCE,
  PROBE_FRAME_COUNT,
  type CapabilityProbeResult,
  type CaptureTarget,
  type Capturer,
} from './types';

/** `node-screenshots` 的 Monitor 实例（只声明本项目用到的方法）。 */
interface NativeMonitor {
  id(): number;
  name(): string;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  scaleFactor(): number;
  isPrimary(): boolean;
  captureImage(): Promise<NativeImage>;
}

/** `node-screenshots` 的 Window 实例。 */
interface NativeWindow {
  id(): number;
  pid(): number;
  appName(): string;
  title(): string;
  width(): number;
  height(): number;
  isMinimized(): boolean;
  captureImage(): Promise<NativeImage>;
}

/** `node-screenshots` 的 Image 实例。 */
interface NativeImage {
  readonly width: number;
  readonly height: number;
  toRaw(): Promise<Buffer>;
  toPng(): Promise<Buffer>;
}

/** `node-screenshots` 模块形态。 */
interface NativeModule {
  Monitor?: { all(): NativeMonitor[]; fromPoint?(x: number, y: number): NativeMonitor | null };
  Window?: { all(): NativeWindow[] };
}

/** 捕获后端实现。 */
export class NodeScreenshotsCapturer implements Capturer {
  readonly id = 'node-screenshots' as const;

  private moduleCache: NativeModule | null = null;

  private loaded = false;

  private lastError: string | null = null;

  /** 上一次探测得到的屏幕缩放系数（供几何层使用）。 */
  private lastScaleFactor = 1;

  /**
   * 尝试加载 node-screenshots 模块。
   *
   * @returns 模块对象或 null（不抛异常）。
   */
  private async loadModule(): Promise<NativeModule | null> {
    if (this.loaded) {
      return this.moduleCache;
    }
    this.loaded = true;

    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') {
      this.lastError = `平台 ${process.platform} 不支持 node-screenshots`;
      return null;
    }

    const result = await tryImport<unknown>('node-screenshots');
    if (!result.ok || result.module === null) {
      this.lastError = result.reason ?? 'node-screenshots 未安装';
      return null;
    }

    const monitor = pickExport<NativeModule['Monitor']>(result.module, 'Monitor');
    if (monitor === undefined || monitor === null || typeof monitor.all !== 'function') {
      // 兼容 `export =` 形态：模块本身可能直接带 Monitor
      const fallback = pickCallable<NativeModule>(result.module);
      if (fallback !== null && fallback.Monitor) {
        this.moduleCache = fallback;
        return this.moduleCache;
      }
      this.lastError = 'node-screenshots 导出结构不符合预期（缺少 Monitor）';
      return null;
    }

    this.moduleCache = {
      Monitor: monitor,
      Window: pickExport<NativeModule['Window']>(result.module, 'Window') ?? undefined,
    };
    return this.moduleCache;
  }

  /**
   * 选择要捕获的显示器。
   *
   * @param target 捕获目标（可选 displayId）。
   */
  private selectMonitor(mod: NativeModule, target?: CaptureTarget): NativeMonitor | null {
    const all = mod.Monitor?.all() ?? [];
    if (all.length === 0) {
      return null;
    }
    if (target?.displayId !== undefined) {
      const matched = all.find((monitor) => monitor.id() === target.displayId);
      if (matched) {
        return matched;
      }
    }
    return all.find((monitor) => monitor.isPrimary()) ?? all[0] ?? null;
  }

  /** @inheritdoc */
  async isSupported(): Promise<boolean> {
    const mod = await this.loadModule();
    if (mod === null) {
      return false;
    }
    try {
      return (mod.Monitor?.all() ?? []).length > 0;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @inheritdoc */
  async probe(frames: number = PROBE_FRAME_COUNT): Promise<CapabilityProbeResult> {
    const startedAt = Date.now();
    const result: CapabilityProbeResult = {
      ok: false,
      frames: 0,
      usableFrames: 0,
      avgVariance: 0,
      avgLuma: 0,
      elapsedMs: 0,
    };

    if (!(await this.isSupported())) {
      result.reason = this.lastError ?? 'node-screenshots 后端不可用';
      result.elapsedMs = Date.now() - startedAt;
      return result;
    }

    const total = Math.max(1, Math.floor(frames));
    let varianceSum = 0;
    let lumaSum = 0;

    for (let i = 0; i < total; i += 1) {
      const { image, error } = await this.capture();
      result.frames += 1;
      if (image === null) {
        result.reason = error?.message ?? '捕获失败';
        result.elapsedMs = Date.now() - startedAt;
        return result;
      }
      const stats = computeFrameStats(image, 4, BLACK_FRAME_MAX_LUMA);
      varianceSum += stats.variance;
      lumaSum += stats.meanLuma;
      if (isUsableFrame(image, MIN_USABLE_VARIANCE, BLACK_FRAME_MAX_LUMA)) {
        result.usableFrames += 1;
      }
    }

    result.avgVariance = result.frames > 0 ? varianceSum / result.frames : 0;
    result.avgLuma = result.frames > 0 ? lumaSum / result.frames : 0;
    result.ok = result.usableFrames >= total;
    if (!result.ok) {
      result.reason =
        result.avgLuma <= BLACK_FRAME_MAX_LUMA
          ? '连续捕获到纯黑帧（疑似独占全屏），请在游戏内改为「无边框全屏」'
          : '捕获画面内容过于单一，识别可能不稳定';
    }
    result.elapsedMs = Date.now() - startedAt;
    return result;
  }

  /**
   * 把原生 Image 转成统一 RawImage（BGRA → RGBA）。
   *
   * @param nativeImage 原生图像。
   * @param scaleFactor 缩放系数。
   */
  private async toRawImage(nativeImage: NativeImage, scaleFactor: number): Promise<RawImage> {
    const buffer = await nativeImage.toRaw();
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const image = createRawImage({
      width: nativeImage.width,
      height: nativeImage.height,
      data: bytes,
      channels: 4,
      format: 'bgra',
      scaleFactor,
      source: 'node-screenshots',
    });
    return bgraToRgbaInPlace(image);
  }

  /** @inheritdoc */
  async capture(
    target?: CaptureTarget,
  ): Promise<{ image: RawImage | null; error: AppError | null }> {
    const mod = await this.loadModule();
    if (mod === null) {
      return {
        image: null,
        error: makeError('CAP_BACKEND_UNAVAILABLE', {
          message: this.lastError ?? 'node-screenshots 后端不可用',
        }),
      };
    }

    try {
      // 窗口优先：能避开把本工具自己的 HUD 也拍进去（ADR-01 已知坑 4）
      if (target?.windowName) {
        const windows = mod.Window?.all() ?? [];
        const needle = target.windowName.toLowerCase();
        const matched = windows.find(
          (win) =>
            !win.isMinimized() &&
            (win.appName().toLowerCase().includes(needle) ||
              win.title().toLowerCase().includes(needle)),
        );
        if (matched) {
          const nativeImage = await matched.captureImage();
          const image = await this.toRawImage(nativeImage, this.lastScaleFactor);
          return { image, error: null };
        }
      }

      const monitor = this.selectMonitor(mod, target);
      if (monitor === null) {
        return {
          image: null,
          error: makeError('CAP_BACKEND_UNAVAILABLE', { message: '未找到可用显示器' }),
        };
      }

      const scaleFactor = monitor.scaleFactor() || 1;
      this.lastScaleFactor = scaleFactor;
      const nativeImage = await monitor.captureImage();
      const image = await this.toRawImage(nativeImage, scaleFactor);
      return { image, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      return {
        image: null,
        error: makeError('CAP_TIMEOUT', {
          message: `node-screenshots 捕获失败：${message}`,
        }),
      };
    }
  }

  /** 最近一次错误原因（供设置页展示）。 */
  getLastError(): string | null {
    return this.lastError;
  }

  /** @inheritdoc */
  dispose(): void {
    this.moduleCache = null;
    this.loaded = false;
  }
}

/**
 * 工厂函数：创建 node-screenshots 主选后端。
 */
export function createNodeScreenshotsCapturer(): Capturer {
  return new NodeScreenshotsCapturer();
}
