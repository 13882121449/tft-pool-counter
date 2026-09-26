/**
 * 弈子列表（架构 §3.7）：虚拟滚动。
 *
 * 65 行 × 每 1.5s 全量刷新，必须用虚拟滚动 + memo 单行，
 * 否则每帧都会重排整棵列表（架构 §6 的性能预算）。
 */

import { memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RemainingResult } from '@shared/types/domain';
import { ChampionRow } from './ChampionRow';

/** 行高（与 tailwind spacing.row 保持一致）。 */
const ROW_HEIGHT = 26;

/** 列表属性。 */
export interface ChampionListProps {
  rows: RemainingResult[];
  nameOf(championId: string): string | undefined;
  lowConfidenceThreshold: number;
  watchlist: ReadonlySet<string>;
}

/** 虚拟滚动列表。 */
export const ChampionList = memo(function ChampionList({
  rows,
  nameOf,
  lowConfidenceThreshold,
  watchlist,
}: ChampionListProps): JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
      {rows.length === 0 ? (
        <div className="flex h-full items-center justify-center p-3 text-center text-2xs text-hud-dim">
          没有匹配的弈子（试试清空费用/羁绊筛选，或等待首次扫描）
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            return (
              <div
                key={row.championId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualItem.size,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <ChampionRow
                  row={row}
                  {...(nameOf(row.championId) !== undefined ? { name: nameOf(row.championId) } : {})}
                  lowConfidenceThreshold={lowConfidenceThreshold}
                  watch={watchlist.has(row.championId)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
