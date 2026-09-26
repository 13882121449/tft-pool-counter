/** 设置页 · 常规（架构 §3.7）：主题、排序、追卡、窗口、热键、高级。 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import type { UiConfig } from '@shared/types/config';
import { useConfigStore } from '../../store/use-config-store';
import { THEME_LABELS, THEME_ORDER } from '../../theme';

/** 小节标题。 */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[13px] font-semibold text-hud-text">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** 常规面板。 */
export function GeneralPanel(): JSX.Element {
  const config = useConfigStore((state) => state.config);
  const patch = useConfigStore((state) => state.patch);
  const reset = useConfigStore((state) => state.reset);

  const [watchText, setWatchText] = useState(config.ui.watchlist.join(', '));
  useEffect(() => {
    setWatchText(config.ui.watchlist.join(', '));
  }, [config.ui.watchlist]);

  const commitWatchlist = (): void => {
    const list = watchText
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    void patch({ ui: { ...config.ui, watchlist: Array.from(new Set(list)) } });
  };

  return (
    <div>
      <Section title="外观">
        <div className="flex items-center gap-2">
          <span className="w-[80px] text-2xs text-hud-dim">主题</span>
          <Select
            value={config.ui.theme}
            onChange={(event) => void patch({ ui: { ...config.ui, theme: event.target.value as UiConfig['theme'] } })}
            sx={{ minWidth: 160 }}
          >
            {THEME_ORDER.map((name) => (
              <MenuItem key={name} value={name}>
                {THEME_LABELS[name]}
              </MenuItem>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-[80px] text-2xs text-hud-dim">默认排序</span>
          <Select
            value={config.ui.sortMode}
            onChange={(event) => void patch({ ui: { ...config.ui, sortMode: event.target.value as UiConfig['sortMode'] } })}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="cost-asc">按费用</MenuItem>
            <MenuItem value="remaining-asc">按剩余（少→多）</MenuItem>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-[80px] shrink-0 text-2xs text-hud-dim">不透明度</span>
          <Slider
            value={config.window.opacity}
            min={0.4}
            max={1}
            step={0.02}
            onChangeCommitted={(_event, value) =>
              void patch({ window: { ...config.window, opacity: value as number } })
            }
            sx={{ maxWidth: 220 }}
          />
          <span className="text-2xs tabular-nums text-hud-dim">{Math.round(config.window.opacity * 100)}%</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-[80px] shrink-0 text-2xs text-hud-dim">界面缩放</span>
          <Slider
            value={config.window.scale}
            min={0.8}
            max={1.5}
            step={0.05}
            onChangeCommitted={(_event, value) =>
              void patch({ window: { ...config.window, scale: value as number } })
            }
            sx={{ maxWidth: 220 }}
          />
          <span className="text-2xs tabular-nums text-hud-dim">{config.window.scale.toFixed(2)}×</span>
        </div>

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={config.compliance.acknowledged}
              disabled
              onChange={() => undefined}
            />
          }
          label={<span className="text-2xs text-hud-dim">永久显示「估算」字样（合规要求，不可关闭）</span>}
        />
      </Section>

      <Section title="我的追卡（英文 id，逗号分隔）">
        <TextField
          value={watchText}
          onChange={(event) => setWatchText(event.target.value)}
          onBlur={commitWatchlist}
          placeholder="ahri, lux, veigar"
          fullWidth
          helperText="追卡会显示在 HUD 顶部与列表标记中；本工具仅作提示，不会自动操作游戏。"
        />
      </Section>

      <Section title="热键">
        <div className="flex items-center gap-2">
          <span className="w-[80px] text-2xs text-hud-dim">显隐 HUD</span>
          <TextField
            defaultValue={config.hotkeys.toggleVisible}
            onBlur={(event) => void patch({ hotkeys: { ...config.hotkeys, toggleVisible: event.target.value } })}
            sx={{ width: 180 }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-[80px] text-2xs text-hud-dim">暂停/恢复</span>
          <TextField
            defaultValue={config.hotkeys.togglePause}
            onBlur={(event) => void patch({ hotkeys: { ...config.hotkeys, togglePause: event.target.value } })}
            sx={{ width: 180 }}
          />
        </div>
        <div className="text-2xs text-hud-dim">修改后立即生效；若被其它软件占用会记入日志。</div>
      </Section>

      <Section title="高级">
        <div className="flex items-center gap-2">
          <span className="w-[80px] text-2xs text-hud-dim">日志级别</span>
          <Select
            value={config.advanced.logLevel}
            onChange={(event) =>
              void patch({
                advanced: {
                  ...config.advanced,
                  logLevel: event.target.value as typeof config.advanced.logLevel,
                },
              })
            }
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="error">error</MenuItem>
            <MenuItem value="warn">warn</MenuItem>
            <MenuItem value="info">info</MenuItem>
            <MenuItem value="debug">debug</MenuItem>
          </Select>
        </div>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={config.advanced.saveSession}
              onChange={(event) =>
                void patch({
                  advanced: { ...config.advanced, saveSession: event.target.checked },
                })
              }
            />
          }
          label={<span className="text-2xs text-hud-text">保存对局台账（仅结构化数据，绝不含截图/进程信息）</span>}
        />
        <div>
          <Button variant="outlined" color="warning" onClick={() => void reset()}>
            恢复默认配置（保留合规确认与标定）
          </Button>
        </div>
      </Section>
    </div>
  );
}
