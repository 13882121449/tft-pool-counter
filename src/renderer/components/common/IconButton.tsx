/** 极简图标按钮（HUD 标题栏专用：命中区大、样式轻、带 Tooltip）。 */

import { memo, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

/** 图标按钮属性。 */
export interface IconButtonProps {
  title: string;
  onClick(): void;
  children: ReactNode;
  /** 激活态（高亮）。 */
  active?: boolean;
  /** 危险操作（悬停变红）。 */
  danger?: boolean;
}

/** 图标按钮。 */
export const IconButton = memo(function IconButton({
  title,
  onClick,
  children,
  active = false,
  danger = false,
}: IconButtonProps): JSX.Element {
  return (
    <Tooltip title={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className={[
          'no-drag inline-flex h-[20px] w-[20px] items-center justify-center rounded',
          'text-hud-dim transition-colors hover:bg-white/10 hover:text-hud-text',
          active ? 'text-pool-plenty' : '',
          danger ? 'hover:!text-pool-out' : '',
        ].join(' ')}
      >
        {children}
      </button>
    </Tooltip>
  );
});
