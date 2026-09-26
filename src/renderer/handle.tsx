/**
 * 常驻把手窗口（10×10）挂载入口。
 *
 * 作用（ADR-07）：HUD 进入点击穿透后，整块区域都点不到，
 * 需要一个常驻可点的小窗口让用户能"点回来"，避免锁死。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** 把手：一个半透明圆点，点击即请求退出穿透态。 */
function Handle(): JSX.Element {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onClick={() => {
        window.api?.windowAction({ action: 'set-click-through', value: false });
      }}
      title="点击恢复 HUD 可交互"
    >
      <div className="h-[8px] w-[8px] rounded-full bg-pool-plenty/80 shadow" />
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Handle />
    </StrictMode>,
  );
}
