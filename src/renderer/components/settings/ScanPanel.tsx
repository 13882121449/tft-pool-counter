/** 设置页 · 扫描（架构 §3.7 / §5.4）：频率、阶段策略、失败告警。 */

import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { useConfigStore } from '../../store/use-config-store';
import { usePoolStore } from '../../store/use-pool-store';
import { formatDuration, formatRelativeTime, stageLabel } from '../../utils/format';
import type { Stage } from '@shared/types/domain';

/** 数值字段。 */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[110px] shrink-0 pt-1.5 text-2xs text-hud-dim">{label}</span>
      <TextField
        type="number"
        value={value}
        sx={{ width: 130 }}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)));
          }
        }}
        slotProps={{ htmlInput: { min, max, step } }}
      />
      <span className="pt-1.5 text-2xs text-hud-dim">{hint}</span>
    </div>
  );
}

/** 扫描面板。 */
export function ScanPanel(): JSX.Element {
  const config = useConfigStore((state) => state.config);
  const patch = useConfigStore((state) => state.patch);
  const status = usePoolStore((state) => state.status);

  const patchScan = (partial: Partial<typeof config.scan>): void => {
    void patch({ scan: { ...config.scan, ...partial } });
  };

  return (
    <div className="flex flex-col gap-2">
      <NumberField
        label="备战阶段间隔"
        hint="ms（棋盘变化频繁，建议 1000~2000）"
        value={config.scan.intervalPrepMs}
        min={500}
        max={30000}
        step={100}
        onChange={(value) => patchScan({ intervalPrepMs: value })}
      />
      <NumberField
        label="战斗阶段间隔"
        hint="ms（0 = 战斗阶段完全暂停）"
        value={config.scan.intervalCombatMs}
        min={0}
        max={60000}
        step={500}
        onChange={(value) => patchScan({ intervalCombatMs: value })}
      />
      <NumberField
        label="探测间隔"
        hint="ms（未检测到棋盘时的低频探测）"
        value={config.scan.probeIntervalMs}
        min={1000}
        max={120000}
        step={500}
        onChange={(value) => patchScan({ probeIntervalMs: value })}
      />
      <NumberField
        label="失败告警阈值"
        hint="次（连续失败达到后状态条亮红灯）"
        value={config.scan.failStreakToAlarm}
        min={1}
        max={50}
        step={1}
        onChange={(value) => patchScan({ failStreakToAlarm: value })}
      />

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={config.scan.pauseOnCarousel}
            onChange={(event) => patchScan({ pauseOnCarousel: event.target.checked })}
          />
        }
        label={<span className="text-2xs text-hud-text">选秀阶段暂停扫描（避免把选秀界面误当棋盘）</span>}
      />
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={config.scan.pauseOnBlur}
            onChange={(event) => patchScan({ pauseOnBlur: event.target.checked })}
          />
        }
        label={<span className="text-2xs text-hud-text">窗口失焦时降频（以"是否检测到棋盘"为判据，不枚举进程）</span>}
      />

      <div className="mt-2 rounded bg-white/5 p-2 text-2xs text-hud-text">
        当前状态：{status?.scanning === true ? '扫描中' : '空闲'}｜阶段：
        {stageLabel((status?.stage ?? 'unknown') as Stage)}｜上次：
        {formatRelativeTime(status?.lastScanAt ?? 0)}｜耗时：{formatDuration(status?.durationMs ?? 0)}｜后端：
        {status?.backend ?? '未知'}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="contained" onClick={() => void window.api.scanOnce()}>
          立即扫描一次
        </Button>
        <Button variant="outlined" onClick={() => void window.api.pauseScan()}>
          暂停
        </Button>
        <Button variant="outlined" onClick={() => void window.api.resumeScan()}>
          恢复
        </Button>
      </div>
    </div>
  );
}
