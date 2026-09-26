/** 我的追卡（架构 §3.7）：折叠面板，显示关注弈子的剩余与"距离 3★"。 */

import { memo } from 'react';
import type { RemainingResult } from '@shared/types/domain';
import { ChampionAvatar } from '../common/ChampionAvatar';
import { distanceToThreeStar, remainingTone, toneTextClass } from '../../utils/format';

/** 追卡面板属性。 */
export interface WatchlistPanelProps {
  rows: RemainingResult[];
  nameOf(championId: string): string | undefined;
}

/** 追卡面板。 */
export const WatchlistPanel = memo(function WatchlistPanel({
  rows,
  nameOf,
}: WatchlistPanelProps): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="shrink-0 border-b border-hud-border px-2 py-1 text-2xs text-hud-dim">
        还没有追卡。可在此处配置关注弈子（设置页 → 常规 → 追卡）。本工具只做提示，不提供自动操作。
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-hud-border px-2 py-1">
      <div className="mb-0.5 text-2xs text-hud-dim">我的追卡</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => {
          const tone = remainingTone(row);
          return (
            <div key={row.championId} className="flex items-center gap-1.5 text-2xs">
              <ChampionAvatar championId={row.championId} cost={row.cost} size={16} dim={row.remaining <= 0} />
              <span className="min-w-0 flex-1 truncate text-hud-text">{nameOf(row.championId) ?? row.championId}</span>
              <span className={toneTextClass(tone)}>剩 {row.remaining}</span>
              <span className="text-pool-unknown">差 {distanceToThreeStar(row)} 张 3★</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
