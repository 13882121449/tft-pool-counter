/** 赛季徽标（架构 §3.7）：S18 · patch + 永久「估算」声明 + 「待实测」警示。 */

import { memo } from 'react';
import { Tooltip } from '../common/Tooltip';

/** 徽标属性。 */
export interface SeasonBadgeProps {
  setNumber: number;
  patch: string;
  /** 卡池基线是否已实测确认。 */
  confirmed: boolean;
}

/** 赛季徽标。 */
export const SeasonBadge = memo(function SeasonBadge({
  setNumber,
  patch,
  confirmed,
}: SeasonBadgeProps): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1 px-2 text-2xs">
      <span className="rounded bg-white/10 px-1 text-hud-text">
        S{setNumber}
        {patch.length > 0 ? ` · ${patch}` : ''}
      </span>
      <Tooltip title="本工具只读取屏幕像素，所有数字均为「基于可见信息的估算」，不等于游戏内真实牌库。">
        <span className="cursor-help rounded bg-pool-enough/20 px-1 text-pool-enough">估算</span>
      </Tooltip>
      {!confirmed ? (
        <Tooltip title="卡池基线尚未实测确认，数值仅供参考。可在设置页运行「卡池自检」在一局内交叉验证。">
          <span className="cursor-help rounded bg-pool-low/20 px-1 text-pool-low">待实测</span>
        </Tooltip>
      ) : null}
    </div>
  );
});
