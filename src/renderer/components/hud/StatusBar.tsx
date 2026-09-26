/** HUD 状态条（架构 §3.7）：扫描状态圆点 + 上次刷新 + 阶段 + 耗时。 */

import { memo } from 'react';
import type { Stage } from '@shared/types/domain';
import { usePoolStore } from '../../store/use-pool-store';
import { formatDuration, formatRelativeTime, stageLabel } from '../../utils/format';

/** 状态条。 */
export const StatusBar = memo(function StatusBar(): JSX.Element {
  const status = usePoolStore((state) => state.status);
  const scanning = status?.scanning ?? false;
  const failStreak = status?.failStreak ?? 0;
  const stage = (status?.stage ?? 'unknown') as Stage;

  const dotClass = scanning
    ? 'bg-pool-enough animate-pulse-dot'
    : failStreak > 0
      ? 'bg-pool-out'
      : 'bg-pool-plenty';

  return (
    <div className="flex h-[18px] shrink-0 items-center gap-2 px-2 text-2xs text-hud-dim">
      <span className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${dotClass}`} />
      <span className="truncate">{scanning ? '扫描中…' : formatRelativeTime(status?.lastScanAt ?? 0)}</span>
      <span>· {stageLabel(stage)}</span>
      <span className="ml-auto shrink-0">{formatDuration(status?.durationMs ?? 0)}</span>
      {failStreak > 0 ? <span className="shrink-0 text-pool-out">失败×{failStreak}</span> : null}
    </div>
  );
});
