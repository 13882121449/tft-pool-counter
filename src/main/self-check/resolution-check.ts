/**
 * 分辨率 / DPI 自检（RQ-17 / 架构风险 A5）。
 *
 * 为什么必须做：S18 是首个虚幻引擎赛季，若用户以**独占全屏**运行，
 * Windows 会隐藏任务栏，悬浮窗可能被覆盖、屏幕捕获可能拿到纯黑帧。
 * 我们提供一个**启发式判据**（workArea == bounds 通常意味着独占全屏），
 * 并在首启引导与设置页提示用户改用「无边框全屏」。
 *
 * 注意：这里**不枚举任何进程、不读窗口标题**（合规 X1–X3），
 * 只读显示器自身的几何信息。
 */

import { screen } from 'electron';
import type { ResolutionCheckPayload } from '../../shared/types/ipc';
import type { Calibration } from '../../shared/types/scan';

/**
 * 运行分辨率自检。
 *
 * @param calibration 当前标定（null = 尚未标定）。
 */
export function runResolutionCheck(calibration: Calibration | null): ResolutionCheckPayload {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea, scaleFactor } = display;

  // 任务栏被隐藏（workArea 覆盖整屏）→ 高度疑似独占全屏
  const fullscreenLikely =
    workArea.width >= bounds.width && workArea.height >= bounds.height;

  let matchesCalibration: boolean | null = null;
  if (calibration !== null) {
    matchesCalibration =
      calibration.screenW === bounds.width && calibration.screenH === bounds.height;
  }

  return {
    ok: !fullscreenLikely,
    exclusiveFullscreenLikely: fullscreenLikely,
    displayWidth: bounds.width,
    displayHeight: bounds.height,
    scaleFactor,
    workArea: { ...workArea },
    matchesCalibration,
    advice: fullscreenLikely
      ? '检测到当前可能是「独占全屏」（任务栏被隐藏）。独占全屏下悬浮窗可能被游戏覆盖、屏幕捕获可能拿到黑帧，建议在游戏内切换为「无边框全屏 / 窗口化全屏」。'
      : '当前为窗口化 / 无边框全屏，悬浮窗与屏幕捕获均可正常工作。',
  };
}
