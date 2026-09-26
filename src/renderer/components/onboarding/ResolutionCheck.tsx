/**
 * 分辨率自检（架构 §3.7 / RQ-17）。
 *
 * 判断当前是否处于「独占全屏」，并引导用户改用「无边框全屏」——
 * 这是让"HUD 稳定置顶 + 屏幕捕获不黑帧"最可靠的前提。
 */

import { useEffect, useState } from 'react';
import type { ResolutionCheckPayload } from '@shared/types/ipc';

/** 属性。 */
export interface ResolutionCheckProps {
  /** 是否显示「下一步」按钮（首启向导用）。 */
  onContinue?(): void;
}

/** 分辨率自检面板。 */
export function ResolutionCheck({ onContinue }: ResolutionCheckProps): JSX.Element {
  const [result, setResult] = useState<ResolutionCheckPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.systemInfo().then((res) => {
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setResult(res.value.resolution);
      } else {
        setError(res.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-semibold text-hud-text">分辨率 / 全屏模式自检</div>

      {error !== null ? <div className="text-2xs text-pool-out">{error}</div> : null}

      {result === null ? (
        <div className="text-2xs text-hud-dim">检测中…</div>
      ) : (
        <>
          <div className="text-2xs text-hud-dim">
            主显示器：{result.displayWidth} × {result.displayHeight}（缩放 {Math.round(result.scaleFactor * 100)}%）
          </div>
          <div className={result.exclusiveFullscreenLikely ? 'text-2xs text-pool-low' : 'text-2xs text-pool-plenty'}>
            {result.exclusiveFullscreenLikely
              ? '疑似「独占全屏」：悬浮窗可能被游戏覆盖、截屏可能黑帧。'
              : '当前为窗口化 / 无边框全屏，工作环境正常。'}
          </div>
          <div className="rounded bg-white/5 p-2 text-2xs leading-relaxed text-hud-text">
            {result.advice}
          </div>
          {result.matchesCalibration === false ? (
            <div className="text-2xs text-pool-low">
              当前分辨率与标定时不一致。归一化标定通常可自动适配，若识别异常请重新标定。
            </div>
          ) : null}
        </>
      )}

      {onContinue !== undefined ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="rounded bg-pool-enough/25 px-3 py-1 text-2xs text-pool-enough hover:bg-pool-enough/40"
          >
            下一步
          </button>
        </div>
      ) : null}
    </div>
  );
}
