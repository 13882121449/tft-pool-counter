/**
 * 屏幕捕获后端的统一契约（ADR-01 双后端 + 能力探测 + 自动降级）。
 *
 * 合规声明：本目录是项目内**唯一**允许出现截屏 API 的地方
 * （`.eslintrc.cjs` 对此有静态强制）。所有截屏都通过操作系统公开接口
 * （Windows Graphics Capture / Electron desktopCapturer）获取屏幕像素，
 * 不读取任何进程内存、不注入、不模拟输入、不上传。
 */

import type { AppError } from '../../shared/types/domain';
import type { RawImage } from '../preprocess/raw-image';

/** 后端标识（与 `ScanMetrics.backend` 对齐）。 */
export type CaptureBackendId = 'node-screenshots' | 'desktopCapturer';

/** 捕获目标。 */
export interface CaptureTarget {
  /** 捕获哪块显示器；缺省 = 主显示器。 */
  displayId?: number;
  /** 只捕获指定标题/进程名的窗口（可选，能避开把 HUD 自己也拍进去）。 */
  windowName?: string;
}

/** 能力探测结果。 */
export interface CapabilityProbeResult {
  /** 是否可用（连续 N 帧均非纯黑/非纯色）。 */
  ok: boolean;
  /** 实际连拍帧数。 */
  frames: number;
  /** 通过"有内容"判定的帧数。 */
  usableFrames: number;
  /** 平均亮度方差。 */
  avgVariance: number;
  /** 平均亮度。 */
  avgLuma: number;
  /** 失败原因（中文，可直接显示给用户）。 */
  reason?: string;
  /** 探测耗时（ms）。 */
  elapsedMs: number;
}

/** 一个可插拔的捕获后端。 */
export interface Capturer {
  /** 后端标识。 */
  readonly id: CaptureBackendId;
  /** 后端是否"在环境上可用"（依赖已安装 + 平台支持）。不抛异常。 */
  isSupported(): Promise<boolean>;
  /** 能力探测：连拍 N 帧验证非纯黑（ADR-01 已知坑 2）。 */
  probe(frames?: number): Promise<CapabilityProbeResult>;
  /** 抓取一帧。失败返回 null 并给出错误，绝不抛异常。 */
  capture(target?: CaptureTarget): Promise<{ image: RawImage | null; error: AppError | null }>;
  /** 释放资源。 */
  dispose(): void;
}

/** 能力探测默认连拍帧数（ADR-01：连拍 3 帧非纯黑）。 */
export const PROBE_FRAME_COUNT = 3;

/** 判定"纯黑帧"的亮度上限。 */
export const BLACK_FRAME_MAX_LUMA = 8;

/** 判定"有内容"的最小亮度方差。 */
export const MIN_USABLE_VARIANCE = 4;
