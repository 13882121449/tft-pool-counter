/**
 * 回退捕获后端：Electron `desktopCapturer`（ADR-01 第 2 档）。
 *
 * 为什么做成"注入式 FrameProvider"而不是直接 import electron：
 * 1. 视觉流水线跑在 **Utility Process** 里，`desktopCapturer` 只在主进程可用，
 *    直接 import 会拿到 undefined（运行期必挂）；
 * 2. 架构要求"不可用的后端做成能力探测返回 false 自动跳过"，注入式设计让
 *    依赖缺失时本后端天然判定为不可用，代码与类型检查都不受影响；
 * 3. 主进程只负责把**压缩帧（PNG）**传过来，解码与像素运算全部留在本进程，
 *    避免主进程被重像素计算卡住（T04 硬约束：扫描不能卡主线程）。
 *
 * 合规：仍然只使用 Electron 公开的屏幕捕获接口，不涉及任何进程内存读写。
 */

import { makeError } from '../../shared/ipc/error-codes';
import type { AppError } from '../../shared/types/domain';
import { decodeCompressedImage } from '../preprocess/scale';
import {
  computeFrameStats,
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

/**
 * 压缩帧提供者：由主进程注入（内部走 `desktopCapturer.getSources` +
 * `nativeImage.toPNG()`）。返回 null 表示主进程侧当前不可用。
 */
export type FrameProvider = (
  target?: CaptureTarget,
) => Promise<{ bytes: Uint8Array; scaleFactor?: number } | null>;

/** 回退后端实现。 */
export class DesktopCapturerFallback implements Capturer {
  readonly id = 'desktopCapturer' as const;

  private readonly provider: FrameProvider | null;

  private lastError: string | null = null;

  private decoderReady = false;

  /**
   * @param provider 压缩帧提供者；传 null 表示该后端不可用（会被自动跳过）。
   */
  constructor(provider: FrameProvider | null = null) {
    this.provider = provider;
  }

  /** @inheritdoc */
  async isSupported(): Promise<boolean> {
    if (this.provider === null) {
      this.lastError = '主进程未注入 desktopCapturer 帧提供者';
      return false;
    }
    // 依赖 sharp 解码 PNG；sharp 不可用时本后端同样跳过
    const { loadSharp } = await import('../preprocess/scale');
    const sharp = await loadSharp();
    if (sharp === null) {
      this.lastError = '缺少 sharp，无法解码 desktopCapturer 的压缩帧';
      return false;
    }
    this.decoderReady = true;
    return true;
  }

  /** 抓取并解码一帧。 */
  private async fetchFrame(
    target?: CaptureTarget,
  ): Promise<{ image: RawImage | null; error: AppError | null }> {
    if (this.provider === null) {
      return {
        image: null,
        error: makeError('CAP_BACKEND_UNAVAILABLE', { message: 'desktopCapturer 不可用' }),
      };
    }
    try {
      const payload = await this.provider(target);
      if (payload === null) {
        return {
          image: null,
          error: makeError('CAP_BACKEND_UNAVAILABLE', { message: '主进程未返回捕获帧' }),
        };
      }
      const image = await decodeCompressedImage(payload.bytes, 'desktopCapturer');
      if (image === null) {
        return {
          image: null,
          error: makeError('CAP_BLACK_FRAME', {
            message: 'desktopCapturer 帧解码失败（sharp 不可用或格式不支持）',
          }),
        };
      }
      return {
        image: { ...image, scaleFactor: payload.scaleFactor ?? image.scaleFactor },
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      return { image: null, error: makeError('CAP_TIMEOUT', { message }) };
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
      result.reason = this.lastError ?? 'desktopCapturer 后端不可用';
      result.elapsedMs = Date.now() - startedAt;
      return result;
    }

    const total = Math.max(1, Math.floor(frames));
    let varianceSum = 0;
    let lumaSum = 0;

    for (let i = 0; i < total; i += 1) {
      const { image, error } = await this.fetchFrame();
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
      result.reason = 'desktopCapturer 连续捕获到纯黑帧，请改用「无边框全屏」';
    }
    result.elapsedMs = Date.now() - startedAt;
    return result;
  }

  /** @inheritdoc */
  capture(
    target?: CaptureTarget,
  ): Promise<{ image: RawImage | null; error: AppError | null }> {
    if (!this.decoderReady) {
      void this.isSupported();
    }
    return this.fetchFrame(target);
  }

  /** 最近一次错误原因。 */
  getLastError(): string | null {
    return this.lastError;
  }

  /** @inheritdoc */
  dispose(): void {
    this.decoderReady = false;
  }
}

/**
 * 工厂函数：创建 desktopCapturer 回退后端。
 *
 * @param provider 主进程注入的压缩帧提供者；缺省 = 后端不可用（自动跳过）。
 */
export function createDesktopCapturerFallback(provider: FrameProvider | null = null): Capturer {
  return new DesktopCapturerFallback(provider);
}
