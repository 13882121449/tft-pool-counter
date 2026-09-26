/** 归属调整 ±（架构 §3.7 / PRD 5.2）：对"某家持有某弈子几张"做增减。 */

import { memo } from 'react';
import type { SeatOrUnknown } from '@shared/types/domain';
import { seatLabel } from '../../utils/format';

/** 属性。 */
export interface OwnerAdjustProps {
  seat: SeatOrUnknown;
  copies: number;
  onDelta(delta: number): void;
}

/** 归属调整。 */
export const OwnerAdjust = memo(function OwnerAdjust({
  seat,
  copies,
  onDelta,
}: OwnerAdjustProps): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span className="w-[56px] shrink-0 text-2xs text-hud-dim">{seatLabel(seat)}</span>
      <button
        type="button"
        disabled={copies <= 0}
        onClick={() => onDelta(-1)}
        className="h-[20px] w-[20px] rounded bg-white/10 text-hud-text disabled:opacity-30 hover:enabled:bg-white/20"
        aria-label={`${seatLabel(seat)} 减一张`}
      >
        −
      </button>
      <span className="w-[26px] text-center text-2xs tabular-nums text-hud-text">{copies}</span>
      <button
        type="button"
        onClick={() => onDelta(1)}
        className="h-[20px] w-[20px] rounded bg-white/10 text-hud-text hover:bg-white/20"
        aria-label={`${seatLabel(seat)} 加一张`}
      >
        ＋
      </button>
    </div>
  );
});
