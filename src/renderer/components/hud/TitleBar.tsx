/** HUD 标题栏（架构 §3.7）：30px 拖拽热区 + 按钮组。 */

import { memo } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import SettingsIcon from '@mui/icons-material/Settings';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { IconButton } from '../common/IconButton';
import { useClickThrough } from '../../hooks/use-click-through';
import { useDragWindow } from '../../hooks/use-drag-window';
import { useWindowMode } from '../../hooks/use-window-bounds';

/** 标题栏属性。 */
export interface TitleBarProps {
  onOpenSettings(): void;
}

/** HUD 标题栏。 */
export const TitleBar = memo(function TitleBar({ onOpenSettings }: TitleBarProps): JSX.Element {
  const { dragHandleProps } = useDragWindow();
  const { clickThrough, toggle } = useClickThrough();
  const { mode, toggle: toggleMode } = useWindowMode();

  return (
    <div
      className={`${dragHandleProps.className} flex h-[30px] shrink-0 items-center gap-1 border-b border-hud-border px-2`}
      title={dragHandleProps.title}
    >
      <span className="truncate text-[12px] font-semibold text-hud-text">TFT 牌库剩余</span>
      <span className="rounded bg-white/10 px-1 text-2xs text-pool-unknown">估算</span>

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          title={clickThrough ? '关闭点击穿透' : '开启点击穿透（鼠标交给游戏）'}
          active={clickThrough}
          onClick={() => toggle()}
        >
          {clickThrough ? <VisibilityOffIcon fontSize="inherit" /> : <VisibilityIcon fontSize="inherit" />}
        </IconButton>
        <IconButton title={mode === 'mini' ? '展开为完整视图' : '收起为迷你视图'} onClick={toggleMode}>
          {mode === 'mini' ? <OpenInFullIcon fontSize="inherit" /> : <MinimizeIcon fontSize="inherit" />}
        </IconButton>
        <IconButton title="设置" onClick={onOpenSettings}>
          <SettingsIcon fontSize="inherit" />
        </IconButton>
        <IconButton title="退出" danger onClick={() => void window.api.quit()}>
          <CloseIcon fontSize="inherit" />
        </IconButton>
      </div>
    </div>
  );
});
