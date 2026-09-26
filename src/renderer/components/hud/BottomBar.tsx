/** HUD 底部条（架构 §3.7）：平均置信度 / 耗时 / 错误提示 / 校正入口说明。 */

import { memo } from 'react';
import { usePoolStore } from '../../store/use-pool-store';
import { formatDuration } from '../../utils/format';

/** 底部条。 */
export const BottomBar = memo(function BottomBar(): JSX.Element {
  const snapshot = usePoolStore((state) => state.snapshot);
  const errors = usePoolStore((state) => state.errors);

  const avgConfidence = snapshot?.meta.avgConfidence ?? 0;
  const duration = snapshot?.meta.lastScanDurationMs ?? 0;
  const latestError = errors.length > 0 ? errors[errors.length - 1] : '';

  return (
    <div className="flex h-[22px] shrink-0 items-center gap-2 border-t border-hud-border px-2 text-2xs text-hud-dim">
      <span title="所有识别结果的平均置信度；偏低时建议手动校正">
        置信 {Math.round(avgConfidence * 100)}%
      </span>
      <span>· {formatDuration(duration)}</span>
      <span className="no-drag shrink-0" title="低置信行会显示「?」，点该行右侧 ✎ 可校正；Ctrl+Z 撤销">
        ✎ 校正 / Ctrl+Z
      </span>
      {latestError.length > 0 ? (
        <span className="ml-auto truncate text-pool-low" title={latestError}>
          {latestError}
        </span>
      ) : null}
    </div>
  );
});
