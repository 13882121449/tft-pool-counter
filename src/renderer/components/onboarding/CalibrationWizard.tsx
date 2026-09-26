/**
 * 棋盘标定向导（架构 §3.7 / A3 风险缓解）。
 *
 * 为什么用"比例表单"而不是"截图拖框"：
 * - 截图拖框需要把**游戏画面**喂进渲染进程，涉及像素跨进程搬运与合规边界；
 * - 归一化比例（0..1）与分辨率/DPI 无关，一次标定长期可用；
 * - 提供棋盘 4×7、备战席 8 槽的推荐默认值，用户只需微调边界。
 *
 * 标定结果保存到主进程（`calibration.json`），并立即下发给识别 worker。
 */

import { useCallback, useEffect, useState } from 'react';
import type { Calibration, CalibrationRect } from '@shared/types/scan';

/** 属性。 */
export interface CalibrationWizardProps {
  onSaved?(): void;
}

/** 比例输入行。 */
interface RectFieldsProps {
  title: string;
  rect: CalibrationRect;
  onChange(patch: Partial<CalibrationRect>): void;
}

/** 一组比例数值输入。 */
function RectFields({ title, rect, onChange }: RectFieldsProps): JSX.Element {
  const fields: Array<{ key: keyof CalibrationRect; label: string }> = [
    { key: 'x', label: 'x' },
    { key: 'y', label: 'y' },
    { key: 'w', label: '宽' },
    { key: 'h', label: '高' },
  ];
  return (
    <div className="mb-2">
      <div className="mb-1 text-2xs text-hud-dim">{title}（归一化 0~1）</div>
      <div className="flex items-center gap-1">
        {fields.map((field) => (
          <label key={field.key} className="flex items-center gap-0.5 text-2xs text-hud-dim">
            {field.label}
            <input
              type="number"
              step="0.001"
              min={0}
              max={1}
              value={Number(rect[field.key]).toFixed(3)}
              onChange={(event) => onChange({ [field.key]: clamp01(Number(event.target.value)) })}
              className="w-[64px] rounded border border-hud-border bg-black/20 px-1 py-0.5 text-2xs text-hud-text outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** 夹取到 [0,1]。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** 推荐默认标定（4×7 棋盘 / 8 备战席）。 */
function defaultCalibration(screenW: number, screenH: number, scaleFactor: number): Calibration {
  return {
    board: { x: 0.28, y: 0.34, w: 0.44, h: 0.26 },
    boardCols: 7,
    boardRows: 4,
    bench: { x: 0.22, y: 0.72, w: 0.56, h: 0.09 },
    benchSlots: 8,
    shopSlots: 5,
    screenW,
    screenH,
    scaleFactor,
  };
}

/** 标定向导。 */
export function CalibrationWizard({ onSaved }: CalibrationWizardProps): JSX.Element {
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void window.api.getCalibration().then(async (existing) => {
      if (cancelled) {
        return;
      }
      if (existing.ok && existing.value !== null) {
        setCalibration(existing.value);
        return;
      }
      const info = await window.api.systemInfo();
      if (cancelled) {
        return;
      }
      if (info.ok) {
        setCalibration(
          defaultCalibration(info.value.resolution.displayWidth, info.value.resolution.displayHeight, info.value.resolution.scaleFactor),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRect = useCallback(
    (which: 'board' | 'bench', patch: Partial<CalibrationRect>): void => {
      setCalibration((current) =>
        current === null ? current : { ...current, [which]: { ...current[which], ...patch } },
      );
    },
    [],
  );

  const save = useCallback(async (): Promise<void> => {
    if (calibration === null) {
      return;
    }
    const result = await window.api.saveCalibration(calibration);
    if (result.ok) {
      setMessage('标定已保存并下发给识别进程。');
      onSaved?.();
    } else {
      setMessage(`保存失败：${result.error.message}`);
    }
  }, [calibration, onSaved]);

  if (calibration === null) {
    return <div className="text-2xs text-hud-dim">读取标定 / 屏幕信息中…</div>;
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 text-[13px] font-semibold text-hud-text">棋盘 / 备战席标定</div>
      <div className="mb-2 text-2xs text-hud-dim">
        已按 4 行 × 7 列棋盘、8 格备战席填入推荐值。若识别异常，请对照游戏画面微调边界比例。
      </div>

      <RectFields title="棋盘区域" rect={calibration.board} onChange={(patch) => updateRect('board', patch)} />
      <div className="mb-2 flex items-center gap-2 text-2xs text-hud-dim">
        <label className="flex items-center gap-0.5">
          行
          <input
            type="number"
            min={1}
            max={10}
            value={calibration.boardRows}
            onChange={(event) =>
              setCalibration({ ...calibration, boardRows: Math.max(1, Math.floor(Number(event.target.value) || 1)) })
            }
            className="w-[48px] rounded border border-hud-border bg-black/20 px-1 py-0.5 text-2xs text-hud-text outline-none"
          />
        </label>
        <label className="flex items-center gap-0.5">
          列
          <input
            type="number"
            min={1}
            max={12}
            value={calibration.boardCols}
            onChange={(event) =>
              setCalibration({ ...calibration, boardCols: Math.max(1, Math.floor(Number(event.target.value) || 1)) })
            }
            className="w-[48px] rounded border border-hud-border bg-black/20 px-1 py-0.5 text-2xs text-hud-text outline-none"
          />
        </label>
      </div>

      <RectFields title="备战席区域" rect={calibration.bench} onChange={(patch) => updateRect('bench', patch)} />
      <div className="mb-2 flex items-center gap-2 text-2xs text-hud-dim">
        <label className="flex items-center gap-0.5">
          槽位数
          <input
            type="number"
            min={1}
            max={12}
            value={calibration.benchSlots}
            onChange={(event) =>
              setCalibration({ ...calibration, benchSlots: Math.max(1, Math.floor(Number(event.target.value) || 1)) })
            }
            className="w-[48px] rounded border border-hud-border bg-black/20 px-1 py-0.5 text-2xs text-hud-text outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setCalibration(defaultCalibration(calibration.screenW, calibration.screenH, calibration.scaleFactor))
          }
          className="rounded bg-white/10 px-2 py-0.5 text-2xs text-hud-text hover:bg-white/20"
        >
          恢复推荐值
        </button>
      </div>

      <div className="mb-2 text-2xs text-hud-dim">
        基准屏幕：{calibration.screenW} × {calibration.screenH}（缩放 {Math.round(calibration.scaleFactor * 100)}%）
      </div>

      {message.length > 0 ? <div className="mb-1 text-2xs text-pool-enough">{message}</div> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          className="rounded bg-pool-enough/25 px-3 py-1 text-2xs text-pool-enough hover:bg-pool-enough/40"
        >
          保存标定
        </button>
      </div>
    </div>
  );
}
