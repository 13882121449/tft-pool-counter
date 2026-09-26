/**
 * 撤销栈 hook（架构 §3.7）：Ctrl+Z 撤销最近一次人工校正。
 *
 * 撤销本身由主进程的 reducer 保证语义正确（整体回滚"变更前"台账快照），
 * 这里只负责键盘绑定。
 */

import { useEffect } from 'react';

/**
 * 绑定 Ctrl+Z / Cmd+Z 到"撤销最近一次校正"。
 */
export function useUndoStack(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key.toLowerCase() !== 'z') {
        return;
      }
      event.preventDefault();
      void window.api.undoCorrection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
