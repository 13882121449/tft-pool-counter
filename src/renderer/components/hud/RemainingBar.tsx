/** 剩余数进度条（架构 §3.7）：宽度 = remaining / poolTotal。 */

import { memo } from 'react';
import { toneBarClass, type RemainingTone } from '../../utils/format';

/** 进度条属性。 */
export interface RemainingBarProps {
  remaining: number;
  poolTotal: number;
  tone: RemainingTone;
}

/** 剩余数进度条。 */
export const RemainingBar = memo(function RemainingBar({
  remaining,
  poolTotal,
  tone,
}: RemainingBarProps): JSX.Element {
  const ratio = poolTotal > 0 ? Math.max(0, Math.min(1, remaining / poolTotal)) : 0;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded bg-white/10" role="presentation">
      <div className={`h-full ${toneBarClass(tone)}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
});
