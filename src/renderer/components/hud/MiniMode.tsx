/** 迷你模式（架构 §3.7）：只看最重要的几行，尽量不挡游戏操作区。 */

import { memo } from 'react';
import type { RemainingResult } from '@shared/types/domain';
import { ChampionAvatar } from '../common/ChampionAvatar';
import { usePoolStore } from '../../store/use-pool-store';
import { formatDuration, remainingTone, toneTextClass } from '../../utils/format';

/** 迷你模式属性。 */
export interface MiniModeProps {
  rows: RemainingResult[];
  nameOf(championId: string): string | undefined;
  onOpenSettings(): void;
}

/** 迷你模式。 */
export const MiniMode = memo(function MiniMode({
  rows,
  nameOf,
  onOpenSettings,
}: MiniModeProps): JSX.Element {
  const status = usePoolStore((state) => state.status);
  const snapshot = usePoolStore((state) => state.snapshot);
  const top = rows.slice(0, 5);
  const scanning = status?.scanning ?? false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-2 py-1">
      <div className="flex items-center gap-1 text-2xs text-hud-dim">
        <span className={`inline-block h-[6px] w-[6px] rounded-full ${scanning ? 'bg-pool-enough animate-pulse-dot' : 'bg-pool-plenty'}`} />
        <span>巡查 {snapshot?.coverage.scanned ?? 0}/8</span>
        <span className="ml-auto">{formatDuration(status?.durationMs ?? 0)}</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="no-drag rounded px-1 text-hud-dim hover:bg-white/10 hover:text-hud-text"
        >
          设置
        </button>
      </div>

      {top.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-2xs text-hud-dim">等待首次扫描…</div>
      ) : (
        top.map((row) => {
          const tone = remainingTone(row);
          return (
            <div key={row.championId} className="flex items-center gap-1.5 text-2xs">
              <ChampionAvatar championId={row.championId} cost={row.cost} size={16} dim={row.remaining <= 0} />
              <span className="min-w-0 flex-1 truncate text-hud-text">{nameOf(row.championId) ?? row.championId}</span>
              <span className={`tabular-nums ${toneTextClass(tone)}`}>{row.remaining}</span>
            </div>
          );
        })
      )}
    </div>
  );
});
