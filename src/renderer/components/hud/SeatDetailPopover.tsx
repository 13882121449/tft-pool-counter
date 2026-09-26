/**
 * 各家明细弹层（架构 §3.7）。
 *
 * 数据来源：`snapshot.rows[*].bySeat[seat]` —— 引擎已经算好了"某家持有某弈子几张"，
 * 因此这里**不需要额外的 IPC**，也就不会与主进程口径打架。
 *
 * 提供的动作：
 * - 「清空该家」：重新巡查该家（清掉旧观测）；
 * - 「标记淘汰」：该家棋盘+备战席全部回池（very important：不标记会让数字永远偏低）。
 */

import { memo } from 'react';
import Popover from '@mui/material/Popover';
import type { PoolSnapshot } from '@shared/types/domain';
import { usePoolStore } from '../../store/use-pool-store';
import { useUiStore } from '../../store/use-ui-store';
import { seatLabel } from '../../utils/format';

/** 明细弹层属性。 */
export interface SeatDetailPopoverProps {
  nameOf(championId: string): string | undefined;
}

/** 各家明细弹层。 */
export const SeatDetailPopover = memo(function SeatDetailPopover({
  nameOf,
}: SeatDetailPopoverProps): JSX.Element {
  const seat = useUiStore((state) => state.seatDetail);
  const close = useUiStore((state) => state.closeSeatDetail);
  const setToast = useUiStore((state) => state.setToast);
  const snapshot: PoolSnapshot | null = usePoolStore((state) => state.snapshot);

  const open = seat !== null;

  const holdings =
    snapshot === null || seat === null
      ? []
      : snapshot.rows
          .map((row) => ({ row, copies: row.bySeat[seat] ?? 0 }))
          .filter((item) => item.copies > 0)
          .sort((a, b) => b.copies - a.copies);

  const act = async (kind: 'clear-seat' | 'mark-eliminated'): Promise<void> => {
    if (seat === null) {
      return;
    }
    const result = await window.api.applyCorrection({ kind, seat });
    if (result.ok) {
      setToast(kind === 'clear-seat' ? `${seatLabel(seat)} 已清空，等待重扫` : `${seatLabel(seat)} 已标记淘汰`);
    } else {
      setToast(`操作失败：${result.error.message}`);
    }
    close();
  };

  return (
    <Popover
      open={open}
      onClose={close}
      anchorReference="anchorPosition"
      anchorPosition={{ top: 120, left: 120 }}
      slotProps={{ paper: { sx: { p: 1.5, minWidth: 240, maxHeight: 380, overflow: 'auto' } } }}
    >
      <div className="text-[13px] font-semibold text-hud-text">
        {seat !== null ? `${seatLabel(seat)} · 明细` : '明细'}
      </div>
      <div className="mt-1 text-2xs text-hud-dim">
        {seat !== null && seat === 0 ? '这是你（本工具只读取像素，不代表真实牌库）' : '该家已观测到的持有张数'}
      </div>

      <div className="my-1 border-t border-hud-border" />

      {holdings.length === 0 ? (
        <div className="py-2 text-2xs text-hud-dim">尚未巡查到该家的任何棋子。</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {holdings.map(({ row, copies }) => (
            <div key={row.championId} className="flex items-center gap-2 text-2xs">
              <span className="min-w-0 flex-1 truncate text-hud-text">{nameOf(row.championId) ?? row.championId}</span>
              <span className="tabular-nums text-hud-dim">{copies} 张</span>
            </div>
          ))}
        </div>
      )}

      <div className="my-1 border-t border-hud-border" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void act('clear-seat')}
          className="rounded bg-white/10 px-2 py-0.5 text-2xs text-hud-text hover:bg-white/20"
          title="清空该家旧观测，下一次扫描重新写入"
        >
          清空该家（重扫）
        </button>
        <button
          type="button"
          onClick={() => void act('mark-eliminated')}
          className="rounded bg-pool-out/25 px-2 py-0.5 text-2xs text-pool-out hover:bg-pool-out/40"
          title="该家已被淘汰：其棋盘与备战席的棋子全部回到卡池"
        >
          标记淘汰
        </button>
      </div>
    </Popover>
  );
});
