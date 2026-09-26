/**
 * 拖拽移动 hook（架构 §3.7）。
 *
 * Electron 的透明无边框窗口靠 CSS `-webkit-app-region: drag` 实现原生拖拽；
 * 吸附与位置持久化由主进程 `window-state.ts` 在 `moved` 事件里完成。
 * 因此这里的职责只是"把拖拽热区的属性标准化"，避免每个标题栏各写一遍。
 */

import { useMemo } from 'react';

/** 拖拽热区的属性。 */
export interface DragHandleProps {
  className: string;
  title: string;
}

/**
 * 生成拖拽热区属性。
 *
 * @param label 悬停提示文案。
 */
export function useDragWindow(label = '按住拖动 HUD'): { dragHandleProps: DragHandleProps } {
  return useMemo(
    () => ({ dragHandleProps: { className: 'drag-region', title: label } }),
    [label],
  );
}
