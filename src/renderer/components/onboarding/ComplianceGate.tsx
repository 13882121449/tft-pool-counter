/**
 * 合规门禁（架构 §3.7 / PRD 第 7 章）。
 *
 * 首次启动**强制**阅读并确认"本工具做了什么 / 没做什么"，这是产品的诚信底线，
 * 也是把"只读屏幕像素"这一约束固化到用户预期里的关键一步。
 */

import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { Tooltip } from '../common/Tooltip';

/** 合规条目（与 docs/COMPLIANCE-CHECKLIST.md 一一对应）。 */
const ALLOWED = [
  '只读取屏幕像素（截图后本地分析，截图不落盘、不上传）',
  '所有识别与推算 100% 在本机完成，离线可用',
  '卡池数值完全来自可编辑的 data/pool-baseline.json，不写死在代码里',
  '提供人工校正、锁定、撤销，随时可覆盖自动结果',
];

const FORBIDDEN = [
  '绝不读取游戏进程内存、绝不注入 DLL、绝不 hook 游戏',
  '绝不模拟鼠标 / 键盘输入，绝不自动操作游戏',
  '绝不上传任何截图、窗口标题或可识别身份的信息',
  '绝不解包、修改或拦截游戏网络流量',
];

/** 合规门禁属性。 */
export interface ComplianceGateProps {
  /** 已确认后的回调。 */
  onAcknowledged(): void;
  /** 是否强制（首启 true，不可关闭）。 */
  mandatory?: boolean;
}

/** 合规门禁。 */
export function ComplianceGate({ onAcknowledged, mandatory = true }: ComplianceGateProps): JSX.Element {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    await window.api.setConfig({
      compliance: { acknowledged: true, acknowledgedAt: new Date().toISOString() },
    });
    setBusy(false);
    onAcknowledged();
  };

  return (
    <Dialog open maxWidth="sm" fullWidth disableEscapeKeyDown={mandatory} onClose={() => undefined}>
      <DialogTitle sx={{ fontSize: 15 }}>使用前请确认：本工具「做什么 / 不做什么」</DialogTitle>
      <DialogContent>
        <p className="mb-2 text-2xs text-hud-dim">
          本工具是一个**只读屏幕的估算器**：它根据你在屏幕上「看得到的信息」推算卡池剩余，
          数值永远是估算，不代表游戏真实牌库。
        </p>

        <div className="mb-2">
          <div className="mb-1 text-[13px] font-semibold text-pool-plenty">会做的事</div>
          <ul className="ml-4 list-disc text-2xs text-hud-text">
            {ALLOWED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-[13px] font-semibold text-pool-out">绝不会做的事</div>
          <ul className="ml-4 list-disc text-2xs text-hud-text">
            {FORBIDDEN.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
          }
          label={<span className="text-2xs text-hud-text">我已阅读并理解以上说明</span>}
        />
      </DialogContent>
      <DialogActions>
        <Tooltip title="必须确认后才能使用（可在设置页 → 合规 中再次查看）">
          <span>
            <Button variant="contained" disabled={!checked || busy} onClick={() => void confirm()}>
              同意并继续
            </Button>
          </span>
        </Tooltip>
        <Button color="inherit" onClick={() => void window.api.quit()}>
          退出
        </Button>
      </DialogActions>
    </Dialog>
  );
}
