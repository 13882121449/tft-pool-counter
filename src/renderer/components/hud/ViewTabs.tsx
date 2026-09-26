/** HUD 主视图切换：牌库列表 / 阵容推荐。 */

import { memo } from 'react';
import { useUiStore, type HudView } from '../../store/use-ui-store';

const TABS: ReadonlyArray<{ key: HudView; label: string; title: string }> = [
  { key: 'pool', label: '牌库', title: '各弈子的剩余张数' },
  { key: 'lineup', label: '阵容', title: '基于我已有的牌与全场剩余牌库，推荐还能凑出来的阵容' },
];

/** 视图切换条。 */
export const ViewTabs = memo(function ViewTabs(): JSX.Element {
  const hudView = useUiStore((state) => state.hudView);
  const setHudView = useUiStore((state) => state.setHudView);

  return (
    <div className="no-drag flex h-[24px] shrink-0 items-stretch border-b border-hud-border">
      {TABS.map((tab) => {
        const active = hudView === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            title={tab.title}
            onClick={() => setHudView(tab.key)}
            className={`flex-1 border-b-2 text-2xs transition-colors ${
              active
                ? 'border-pool-plenty text-hud-text'
                : 'border-transparent text-hud-dim hover:text-hud-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
});
