/**
 * 捕获层对外出口。
 *
 * ⚠️ 合规约束：`node-screenshots` / `desktopCapturer` 只允许在
 * `src/vision/capture/**` 内出现，且必须经由 `CaptureManager` 使用（ADR-01）。
 */

export {
  PROBE_FRAME_COUNT,
  BLACK_FRAME_MAX_LUMA,
  MIN_USABLE_VARIANCE,
  type Capturer,
  type CaptureBackendId,
  type CaptureTarget,
  type CapabilityProbeResult,
} from './types';
export {
  createCaptureManager,
  CaptureManager,
  DEGRADE_AFTER_FAILURES,
  type BackendStatus,
  type CaptureManagerStatus,
  type CaptureOutcome,
  type CaptureManagerOptions,
  type CreateCaptureManagerOptions,
} from './capture-manager';
export { createNodeScreenshotsCapturer, NodeScreenshotsCapturer } from './node-screenshots-capturer';
export {
  createDesktopCapturerFallback,
  DesktopCapturerFallback,
  type FrameProvider,
} from './desktop-capturer-fallback';
