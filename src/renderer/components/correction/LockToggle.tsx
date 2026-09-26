/** 锁定开关（架构 §3.7 / PRD 5.2）：锁定后自动扫描完全不写入该弈子。 */

import { memo } from 'react';

/** 属性。 */
export interface LockToggleProps {
  locked: boolean;
  onChange(locked: boolean): void;
}

/** 锁定开关。 */
export const LockToggle = memo(function LockToggle({
  locked,
  onChange,
}: LockToggleProps): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-hud-dim">
      <input
        type="checkbox"
        checked={locked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-[13px] w-[13px] accent-pool-enough"
      />
      锁定（自动扫描不改写该弈子；只在自动识别明显错误时使用）
    </label>
  );
});
