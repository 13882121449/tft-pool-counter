/**
 * 弈子头像（架构 §3.7）。
 *
 * 版权合规：**不内置任何图鉴站素材**，因此这里用"费用色边框 + id 首字母"
 * 作为兜底视觉；用户自建模板后也不用于头像展示（模板只喂给识别引擎）。
 */

import { memo } from 'react';
import type { Cost } from '@shared/types/domain';
import { costBorderClass } from '../../utils/format';

/** 头像属性。 */
export interface ChampionAvatarProps {
  championId: string;
  cost: Cost;
  size?: number;
  /** 变暗（低置信 / 已抽完）。 */
  dim?: boolean;
}

/** 弈子头像（首字母兜底）。 */
export const ChampionAvatar = memo(function ChampionAvatar({
  championId,
  cost,
  size = 22,
  dim = false,
}: ChampionAvatarProps): JSX.Element {
  const initials = championId.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={[
        'inline-flex shrink-0 select-none items-center justify-center rounded border',
        costBorderClass(cost),
        'bg-slate-800/70 font-semibold text-hud-text',
        dim ? 'opacity-40' : '',
      ].join(' ')}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
    >
      {initials}
    </span>
  );
});
