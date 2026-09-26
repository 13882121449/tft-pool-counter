/** 巡查进度条（架构 §3.7）：巡查 x/8 + 8 点点阵 + 缺失家列表。 */

import { memo } from 'react';
import type { Seat } from '@shared/types/domain';
import { usePoolStore } from '../../store/use-pool-store';
import { useUiStore } from '../../store/use-ui-store';
import { PlayerDots } from './PlayerDots';

/** 巡查进度条。 */
export const CoverageBar = memo(function CoverageBar(): JSX.Element {
  const snapshot = usePoolStore((state) => state.snapshot);
  const openSeatDetail = useUiStore((state) => state.openSeatDetail);

  const scanned = snapshot?.coverage.scanned ?? 0;
  const missing = snapshot?.coverage.missing ?? [];
  const low = scanned < 5;

  return (
    <div className="flex h-[20px] shrink-0 items-center gap-2 border-b border-hud-border px-2 text-2xs">
      <span className={low ? 'text-pool-low' : 'text-hud-dim'} title="已巡查的家数（覆盖率不足时悲观区间会拉开）">
        巡查 {scanned}/8
      </span>
      <PlayerDots
        snapshot={snapshot}
        onSelect={(seat: Seat) => openSeatDetail(seat)}
      />
      {low ? (
        <span className="ml-auto text-pool-low" title={`尚未巡查：${missing.map((seat) => seat + 1).join('、') || '无'}`}>
          未巡查 {missing.length} 家
        </span>
      ) : null}
    </div>
  );
});
