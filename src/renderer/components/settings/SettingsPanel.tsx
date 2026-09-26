/**
 * 设置页根组件（架构 §3.7）。
 *
 * 负责 7 个面板的切换（常规 / 扫描 / 识别 / 素材 / 估算 / 合规 / 日志），
 * 并展示顶部「估算」合规声明与基线的「待实测」状态。
 *
 * 数据全部来自 store（config / baseline / pool），本组件不含业务逻辑。
 */

import { useBaselineStore } from '../../store/use-baseline-store';
import { useConfigStore } from '../../store/use-config-store';
import { useUiStore, type SettingsTab } from '../../store/use-ui-store';
import { CompliancePanel } from './CompliancePanel';
import { EstimatePanel } from './EstimatePanel';
import { GeneralPanel } from './GeneralPanel';
import { LogPanel } from './LogPanel';
import { RecognitionPanel } from './RecognitionPanel';
import { ScanPanel } from './ScanPanel';
import { TemplateWizardPanel } from './TemplateWizardPanel';

/** tab 定义（顺序即展示顺序）。 */
const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'scan', label: '扫描' },
  { id: 'recognition', label: '识别' },
  { id: 'template', label: '素材' },
  { id: 'estimate', label: '估算' },
  { id: 'compliance', label: '合规' },
  { id: 'log', label: '日志' },
];

/** 当前 tab 的内容。 */
function TabContent({ tab }: { tab: SettingsTab }): JSX.Element {
  switch (tab) {
    case 'scan':
      return <ScanPanel />;
    case 'recognition':
      return <RecognitionPanel />;
    case 'template':
      return <TemplateWizardPanel />;
    case 'estimate':
      return <EstimatePanel />;
    case 'compliance':
      return <CompliancePanel />;
    case 'log':
      return <LogPanel />;
    case 'general':
    default:
      return <GeneralPanel />;
  }
}

/** 设置页根。 */
export function SettingsPanel(): JSX.Element {
  const tab = useUiStore((state) => state.tab);
  const setTab = useUiStore((state) => state.setTab);
  const baseline = useBaselineStore((state) => state.baseline);
  const acknowledged = useConfigStore((state) => state.config.compliance.acknowledged);

  return (
    <div className="flex h-full flex-col bg-hud-panel text-hud-text">
      <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-hud-border px-3">
        <span className="text-[14px] font-semibold">设置</span>
        <span className="rounded bg-pool-enough/20 px-1 text-2xs text-pool-enough" title="本工具只读屏幕像素，数字为估算">
          估算
        </span>
        {baseline !== null ? (
          <span className="text-2xs text-hud-dim">
            Set {baseline.meta.setNumber} · {baseline.meta.patch}
            {baseline.meta.confirmed ? '' : '（卡池待实测）'}
          </span>
        ) : null}
        {!acknowledged ? <span className="text-2xs text-pool-low">尚未完成合规确认</span> : null}
      </header>

      <nav className="flex shrink-0 items-center gap-1 border-b border-hud-border px-2 py-1">
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded px-2 py-1 text-2xs transition-colors ${
                active ? 'bg-pool-enough/25 text-pool-enough' : 'text-hud-dim hover:bg-white/10 hover:text-hud-text'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <TabContent tab={tab} />
      </main>
    </div>
  );
}
