/** 筛选行（架构 §3.7）：费用 chips + 羁绊下拉 + 搜索 + 排序切换。 */

import { memo } from 'react';
import type { ChangeEvent } from 'react';
import type { Cost } from '@shared/types/domain';
import { useUiStore } from '../../store/use-ui-store';
import { usePoolStore } from '../../store/use-pool-store';

/** 全部费用档。 */
const COSTS: Cost[] = [1, 2, 3, 4, 5];

/** 费用 chip 文案。 */
const COST_LABEL: Record<Cost, string> = { 1: '1费', 2: '2费', 3: '3费', 4: '4费', 5: '5费' };

/** 费用 chip 选中色。 */
const COST_ACTIVE: Record<Cost, string> = {
  1: 'bg-slate-500/40 text-white',
  2: 'bg-emerald-500/30 text-emerald-200',
  3: 'bg-sky-500/30 text-sky-200',
  4: 'bg-fuchsia-500/30 text-fuchsia-200',
  5: 'bg-amber-400/30 text-amber-100',
};

/** 筛选行属性。 */
export interface FilterRowProps {
  /** 可选羁绊（来自基线，可能为空）。 */
  traits: string[];
  /**
   * 把羁绊名解析为「拥有该羁绊的 championId 列表」。
   *
   * 为什么需要：`selectVisibleRows` 约定 `traitFilter` 是 championId 白名单
   * （见 `use-pool-store`），因此选羁绊后必须先展开成 id 列表再写入。
   * 缺省时退化为「原样写入」（仅用于没有基线映射的兜底场景）。
   */
  resolveTrait?(trait: string): string[];
}

/** 筛选行。 */
export const FilterRow = memo(function FilterRow({ traits, resolveTrait }: FilterRowProps): JSX.Element {
  const search = useUiStore((state) => state.search);
  const costFilter = useUiStore((state) => state.costFilter);
  const traitFilter = useUiStore((state) => state.traitFilter);
  const sortMode = useUiStore((state) => state.sortMode);
  const toggleCost = useUiStore((state) => state.toggleCost);
  const setSearch = useUiStore((state) => state.setSearch);
  const setTraitFilter = useUiStore((state) => state.setTraitFilter);
  const setSortMode = useUiStore((state) => state.setSortMode);
  const showWatchlist = useUiStore((state) => state.showWatchlist);
  const toggleWatchlist = useUiStore((state) => state.toggleWatchlist);
  const status = usePoolStore((state) => state.status);

  const onTraitChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    if (value.length === 0) {
      setTraitFilter([]);
      return;
    }
    setTraitFilter(resolveTrait !== undefined ? resolveTrait(value) : [value]);
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-hud-border px-2 py-1">
      <div className="flex items-center gap-1">
        {COSTS.map((cost) => {
          const active = costFilter.includes(cost);
          return (
            <button
              key={cost}
              type="button"
              onClick={() => toggleCost(cost)}
              className={`no-drag rounded px-1.5 py-0.5 text-2xs transition-colors ${
                active ? COST_ACTIVE[cost] : 'bg-white/5 text-hud-dim hover:bg-white/10'
              }`}
            >
              {COST_LABEL[cost]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => toggleWatchlist()}
          className={`no-drag ml-auto rounded px-1.5 py-0.5 text-2xs transition-colors ${
            showWatchlist ? 'bg-pool-enough/25 text-pool-enough' : 'bg-white/5 text-hud-dim hover:bg-white/10'
          }`}
          title="显示 / 隐藏「我的追卡」"
        >
          追卡
        </button>
      </div>

      <div className="flex items-center gap-1">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索弈子 id…"
          className="no-drag min-w-0 flex-1 rounded border border-hud-border bg-black/20 px-1.5 py-0.5 text-2xs text-hud-text outline-none placeholder:text-hud-dim/70 focus:border-pool-enough"
        />
        <select
          value={traitFilter[0] ?? ''}
          onChange={onTraitChange}
          className="no-drag max-w-[92px] rounded border border-hud-border bg-black/20 px-1 py-0.5 text-2xs text-hud-text outline-none"
          title="按羁绊筛选"
        >
          <option value="">全部羁绊</option>
          {traits.map((trait) => (
            <option key={trait} value={trait}>
              {trait}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortMode(sortMode === 'cost-asc' ? 'remaining-asc' : 'cost-asc')}
          className="no-drag shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-2xs text-hud-dim hover:bg-white/10"
          title="切换排序方式"
        >
          {sortMode === 'cost-asc' ? '按费用' : '按剩余'}
        </button>
      </div>

      <div className="flex items-center gap-1 text-2xs text-hud-dim">
        <span className="truncate">
          {status?.backend !== undefined && status.backend.length > 0 && status.backend !== 'unknown'
            ? `后端：${status.backend}`
            : '后端：等待探测'}
        </span>
      </div>
    </div>
  );
});
