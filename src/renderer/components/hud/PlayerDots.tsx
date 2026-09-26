/** 8 点点阵（架构 §3.7）：每点代表一家，颜色反映"已巡查 / 有观测 / 未知"。 */

import { memo } from 'react';
import type { PoolSnapshot, Seat } from '@shared/types/domain';
import { SEAT_INDICES, seatLabel, seatHasAnyList } from '../../utils/format';

/** 点阵属性。 */
export interface PlayerDotsProps {
  snapshot: PoolSnapshot | null;
  onSelect?(seat: Seat): void;
}

/** 8 点点阵。 */
export const PlayerDots = memo(function PlayerDots({
  snapshot,
  onSelect,
}: PlayerDotsProps): JSX.Element {
  const hasAny = seatHasAnyList(snapshot);
  const covered = new Set<number>(snapshot?.coverage.seats ?? []);

  return (
    <div className="flex items-center gap-[3px]">
      {SEAT_INDICES.map((seat) => {
        const color = covered.has(seat)
          ? 'bg-pool-plenty'
          : hasAny[seat]
            ? 'bg-pool-enough'
            : 'bg-white/20';
        return (
          <button
            key={seat}
            type="button"
            title={`${seatLabel(seat)}（点击查看明细）`}
            aria-label={seatLabel(seat)}
            onClick={() => onSelect?.(seat)}
            className={`no-drag h-[7px] w-[7px] rounded-full transition-colors hover:ring-1 hover:ring-white/40 ${color}`}
          />
        );
      })}
    </div>
  );
});
