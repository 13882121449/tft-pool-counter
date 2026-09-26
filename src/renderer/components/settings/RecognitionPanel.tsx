/** 设置页 · 识别（架构 §3.7 / ADR-02）：阈值、后端、模板集与能力自检。 */

import { useEffect, useState } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import type { RecognitionConfig } from '@shared/types/config';
import type { VisionCapabilities } from '@shared/types/vision';
import { useConfigStore } from '../../store/use-config-store';
import { useBaselineStore } from '../../store/use-baseline-store';

/** 识别面板。 */
export function RecognitionPanel(): JSX.Element {
  const config = useConfigStore((state) => state.config);
  const patch = useConfigStore((state) => state.patch);
  const baseline = useBaselineStore((state) => state.baseline);
  const [capabilities, setCapabilities] = useState<VisionCapabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.systemInfo().then((result) => {
      if (!cancelled && result.ok) {
        setCapabilities(result.value.capabilities);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchRecognition = (partial: Partial<RecognitionConfig>): void => {
    void patch({ recognition: { ...config.recognition, ...partial } });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-[110px] shrink-0 text-2xs text-hud-dim">匹配阈值</span>
        <Slider
          value={config.recognition.matchThreshold}
          min={0.3}
          max={0.99}
          step={0.01}
          onChangeCommitted={(_event, value) => patchRecognition({ matchThreshold: value as number })}
          sx={{ maxWidth: 220 }}
        />
        <span className="text-2xs tabular-nums text-hud-dim">{config.recognition.matchThreshold.toFixed(2)}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[110px] shrink-0 text-2xs text-hud-dim">粗筛 Top-N</span>
        <TextField
          type="number"
          value={config.recognition.coarseTopN}
          onChange={(event) =>
            patchRecognition({ coarseTopN: Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1))) })
          }
          sx={{ width: 100 }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[110px] shrink-0 text-2xs text-hud-dim">同实例指纹阈值</span>
        <TextField
          type="number"
          value={config.recognition.fingerprintSameThreshold}
          onChange={(event) =>
            patchRecognition({
              fingerprintSameThreshold: Math.max(0, Math.min(32, Math.floor(Number(event.target.value) || 0))),
            })
          }
          sx={{ width: 100 }}
        />
        <span className="text-2xs text-hud-dim">汉明距离 ≤ 此值视为同一实例（去重关键参数）</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[110px] shrink-0 text-2xs text-hud-dim">捕获后端</span>
        <Select
          value={config.recognition.backend}
          onChange={(event) => patchRecognition({ backend: event.target.value as RecognitionConfig['backend'] })}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="auto">自动（推荐，失败自动降级）</MenuItem>
          <MenuItem value="node-screenshots">node-screenshots（WGC）</MenuItem>
          <MenuItem value="desktopCapturer">desktopCapturer（回退）</MenuItem>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[110px] shrink-0 text-2xs text-hud-dim">模板集 ID</span>
        <TextField
          defaultValue={config.recognition.templateSetId}
          onBlur={(event) => patchRecognition({ templateSetId: event.target.value })}
          sx={{ width: 200 }}
        />
      </div>

      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={config.recognition.enableShopDetect}
            onChange={(event) => patchRecognition({ enableShopDetect: event.target.checked })}
          />
        }
        label={<span className="text-2xs text-hud-text">检测商店格（P1，仅展示，不计入卡池消耗）</span>}
      />

      <div className="rounded bg-white/5 p-2 text-2xs leading-relaxed text-hud-text">
        <div className="mb-1 font-semibold">
          当前能力（来自识别进程）{capabilities === null ? '：尚未就绪' : ''}
        </div>
        {capabilities !== null ? (
          <ul className="ml-4 list-disc">
            <li>截图后端：{capabilities.backend}</li>
            <li>匹配后端：{capabilities.matcherBackend === 'opencv' ? 'OpenCV NCC' : '内置 NCC'}</li>
            <li>
              node-screenshots：{capabilities.nodeScreenshots ? '可用' : '不可用（已降级）'}｜sharp：
              {capabilities.sharp ? '可用' : '不可用'}
            </li>
            <li>模板数量：{capabilities.templateCount}｜基线弈子：{capabilities.championCount}</li>
            <li>标定：{capabilities.calibrationReady ? '已就绪' : '未完成'}</li>
          </ul>
        ) : null}
        {baseline !== null ? (
          <div className="mt-1 text-hud-dim">
            基线：Set {baseline.meta.setNumber} · {baseline.meta.patch}
            {baseline.meta.confirmed ? '' : '（待实测）'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
