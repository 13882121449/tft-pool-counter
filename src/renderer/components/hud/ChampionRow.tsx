/** 单行弈子（架构 §3.7）：memo 化，保证 65 行高频重绘下只更新变化行。 */

import { memo } from 'react';
import type { RemainingResult } from '@shared/types/domain';
import { ChampionAvatar } from '../common/ChampionAvatar';
import { RemainingBar } from './RemainingBar';
import { useUiStore } from '../../store/use-ui-store';
import { distanceToThreeStar, formatRemaining, remainingTone, toneTextClass } from '../../utils/format';

/** 单行属性。 */
export interface ChampionRowProps {
  row: RemainingResult;
  /** 中文名（来自基线，缺失时回退 id）。 */
  name?: string;
  /** 低置信阈值。 */
  lowConfidenceThreshold: number;
  /** 是否在关注区。 */
  watch?: boolean;
}

/** 单行弈子。 */
export const ChampionRow = memo(function ChampionRow({
  row,
  name,
  lowConfidenceThreshold,
  watch = false,
}: ChampionRowProps): JSX.Element {
  const openCorrection = useUiStore((state) => state.openCorrection);
  const tone = remainingTone(row);
  const lowConfidence = row.confidence < lowConfidenceThreshold || row.flags.includes('LOW_CONFIDENCE');
  const out = row.remaining <= 0;
  const pessimistic = row.remainingPessimistic < row.remaining ? row.remainingPessimistic : null;

  return (
    <div
      className="flex h-row items-center gap-1.5 px-2 transition-colors hover:bg-white/5"
      title={`${name ?? row.championId}｜剩余 ${row.remaining}/${row.poolTotal}｜置信 ${Math.round(
        row.confidence * 100,
      )}%${row.flags.length > 0 ? `｜标记：${row.flags.join(', ')}` : ''}`}
    >
      <ChampionAvatar championId={row.championId} cost={row.cost} dim={out} />

      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-1 text-2xs">
          <span className={`truncate ${out ? 'text-hud-dim' : 'text-hud-text'}`}>{name ?? row.championId}</span>
          {row.locked ? <span className="shrink-0 text-pool-enough" title="已锁定：自动扫描不改写该弈子">锁定</span> : null}
          {row.overflow > 0 ? (
            <span className="shrink-0 text-pool-low" title="已观测张数超过卡池总量，疑似英雄复制器">
              +{row.overflow}
            </span>
          ) : null}
          {watch ? (
            <span className="shrink-0 text-pool-enough" title="距离合成 3★ 还差几张">
              差{distanceToThreeStar(row)}张
            </span>
          ) : null}
          {pessimistic !== null && pessimistic !== 0 ? (
            <span className="shrink-0 text-pool-unknown" title="悲观区间（按未巡查家估算）">
              悲观{pessimistic}
            </span>
          ) : null}
        </div>
        <RemainingBar remaining={row.remaining} poolTotal={row.poolTotal} tone={tone} />
      </div>

      <span className={`w-[36px] shrink-0 text-right text-[13px] font-semibold tabular-nums ${toneTextClass(tone)}`}>
        {formatRemaining(row, lowConfidence)}
      </span>

      <button
        type="button"
        className="no-drag shrink-0 rounded px-1 text-2xs text-hud-dim hover:bg-white/10 hover:text-hud-text"
        title="手动校正该弈子"
        onClick={() => openCorrection({ championId: row.championId, seat: 0 })}
      >
        校正
      </button>
    </div>
  );
});
