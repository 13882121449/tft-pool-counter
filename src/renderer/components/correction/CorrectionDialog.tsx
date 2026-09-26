/**
 * 校正弹层（架构 §3.7 / PRD 5.2）。
 *
 * 目标：**≤ 2 次点击完成校正**。因此：
 * - 打开即加载 `correction:open` 载荷（各家持有 + 当前锁定态）；
 * - 主操作是"设为 N 张"（带 ± 步进），一次确认即可；
 * - 也支持对某一家做 ±1 的快速调整；
 * - 锁定后自动扫描不再改写（显示「锁定」标记）。
 */

import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import type { CorrectionPayload } from '@shared/types/ipc';
import type { SeatOrUnknown } from '@shared/types/domain';
import { SEAT_INDICES, seatLabel } from '../../utils/format';
import { useUiStore } from '../../store/use-ui-store';
import { LockToggle } from './LockToggle';
import { OwnerAdjust } from './OwnerAdjust';

/** 校正弹层。 */
export function CorrectionDialog(): JSX.Element | null {
  const target = useUiStore((state) => state.correction);
  const close = useUiStore((state) => state.closeCorrection);
  const setToast = useUiStore((state) => state.setToast);

  const [payload, setPayload] = useState<CorrectionPayload | null>(null);
  const [value, setValue] = useState(0);
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target === null) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    void window.api.openCorrection(target).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok && result.value !== null) {
        setPayload(result.value);
        setValue(result.value.observedCopies);
        setLocked(result.value.locked);
      } else {
        setPayload(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (target === null) {
    return null;
  }

  const adjust = async (delta: number): Promise<void> => {
    setBusy(true);
    const result = await window.api.applyCorrection({
      kind: 'adjust-copies',
      championId: target.championId,
      seat: target.seat,
      delta,
    });
    setBusy(false);
    if (result.ok) {
      const next = await window.api.openCorrection(target);
      if (next.ok && next.value !== null) {
        setPayload(next.value);
        setValue(next.value.observedCopies);
      } else {
        setValue((current) => Math.max(0, current + delta));
      }
    } else {
      setToast(`校正失败：${result.error.message}`);
    }
  };

  const commit = async (): Promise<void> => {
    setBusy(true);
    const result = await window.api.applyCorrection({
      kind: 'set-copies',
      championId: target.championId,
      seat: target.seat,
      value,
      lock: locked,
    });
    setBusy(false);
    if (result.ok) {
      setToast(`${target.championId} 已设为 ${value} 张${locked ? '（已锁定）' : ''}`);
      close();
    } else {
      setToast(`校正失败：${result.error.message}`);
    }
  };

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 14, pb: 0.5 }}>
        校正：{target.championId}
        <span className="ml-2 text-2xs font-normal text-hud-dim">
          当前座位：{seatLabel(target.seat)}
        </span>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {payload === null ? (
          <div className="text-2xs text-hud-dim">加载中…（尚未产生快照时无法校正）</div>
        ) : (
          <>
            <div className="mb-2 text-2xs text-hud-dim">
              卡池总量 {payload.poolTotal}｜已观测 {payload.observedCopies}｜剩余 {payload.remaining}
            </div>

            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xs text-hud-dim">设为</span>
              <button
                type="button"
                onClick={() => setValue((current) => Math.max(0, current - 1))}
                className="h-[22px] w-[22px] rounded bg-white/10 text-hud-text hover:bg-white/20"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={value}
                onChange={(event) => setValue(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                className="w-[64px] rounded border border-hud-border bg-black/20 px-1.5 py-0.5 text-center text-2xs text-hud-text outline-none"
              />
              <button
                type="button"
                onClick={() => setValue((current) => current + 1)}
                className="h-[22px] w-[22px] rounded bg-white/10 text-hud-text hover:bg-white/20"
              >
                ＋
              </button>
              <span className="text-2xs text-hud-dim">张</span>
            </div>

            <div className="mb-2">
              <LockToggle locked={locked} onChange={setLocked} />
            </div>

            <div className="mb-1 text-2xs text-hud-dim">按家微调（点击 ± 立即生效）</div>
            <div className="flex flex-col gap-1">
              {SEAT_INDICES.map((seat) => (
                <OwnerAdjust
                  key={seat}
                  seat={seat as SeatOrUnknown}
                  copies={payload.bySeat[seat] ?? 0}
                  onDelta={(delta) => void adjust(delta)}
                />
              ))}
            </div>

            {payload.candidates.length > 0 ? (
              <div className="mt-2 border-t border-hud-border pt-1 text-2xs text-hud-dim">
                识别候选：{payload.candidates.slice(0, 5).map((item) => `${item.championId}(${Math.round(item.score * 100)}%)`).join('、')}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={close} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={() => void commit()} disabled={busy || payload === null}>
          确认校正
        </Button>
      </DialogActions>
    </Dialog>
  );
}
