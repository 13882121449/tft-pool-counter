/**
 * 首启引导编排（架构 §3.7）。
 *
 * 顺序（PRD 第 7 章 / RQ-17）：
 * 1. **合规门禁**（强制）：确认"只读屏幕像素"的能力边界；
 * 2. **分辨率 / 全屏自检**：引导改用「无边框全屏」；
 * 3. **棋盘标定**：确定棋盘 4×7 与备战席 8 槽的归一化边界。
 *
 * 决策依据：
 * - 未确认合规 → 显示门禁（不可跳过）；
 * - 已确认但尚无标定 → 走分辨率 + 标定向导；
 * - 均已具备 → 不显示（返回 null）。
 */

import { useCallback, useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import { useConfigStore } from '../../store/use-config-store';
import { CalibrationWizard } from './CalibrationWizard';
import { ComplianceGate } from './ComplianceGate';
import { ResolutionCheck } from './ResolutionCheck';

/** 引导步骤。 */
type Step = 'compliance' | 'resolution' | 'calibration' | 'done';

/** 首启引导。 */
export function OnboardingFlow(): JSX.Element | null {
  const loaded = useConfigStore((state) => state.loaded);
  const acknowledged = useConfigStore((state) => state.config.compliance.acknowledged);
  const [step, setStep] = useState<Step>('compliance');

  // 配置加载完成后决定起点；若合规状态变化（刚确认）也重新判定。
  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (!acknowledged) {
      setStep('compliance');
      return;
    }
    let cancelled = false;
    void window.api.getCalibration().then((result) => {
      if (cancelled) {
        return;
      }
      const hasCalibration = result.ok && result.value !== null;
      setStep(hasCalibration ? 'done' : 'resolution');
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, acknowledged]);

  const onAcknowledged = useCallback((): void => {
    // 门禁用的是裸 IPC（不经 store），这里主动刷新镜像，确保下游看到 acknowledged=true。
    void useConfigStore.getState().load();
    setStep('resolution');
  }, []);

  if (!loaded || step === 'done') {
    return null;
  }

  if (step === 'compliance') {
    return <ComplianceGate onAcknowledged={onAcknowledged} mandatory />;
  }

  if (step === 'resolution') {
    return (
      <Dialog open maxWidth="sm" fullWidth onClose={() => setStep('done')}>
        <DialogTitle sx={{ fontSize: 15 }}>环境自检（1/2）</DialogTitle>
        <DialogContent>
          <ResolutionCheck onContinue={() => setStep('calibration')} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={() => setStep('done')}>
      <DialogTitle sx={{ fontSize: 15 }}>棋盘标定（2/2）</DialogTitle>
      <DialogContent>
        <CalibrationWizard onSaved={() => setStep('done')} />
        <div className="mt-2 flex justify-end">
          <Button color="inherit" onClick={() => setStep('done')}>
            稍后再说（可在设置页 → 识别 重新标定）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
