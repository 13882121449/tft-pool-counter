/**
 * 设置页 · 日志（架构 §3.7）。
 *
 * 只读展示最近日志（`log:tail`），并支持导出到用户指定路径（`log:export`）。
 * 日志内容不含截图 / 进程内存 / 身份信息，仅结构化事件与错误。
 */

import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

/** 默认读取行数。 */
const DEFAULT_LINES = 300;

/** 日志面板。 */
export function LogPanel(): JSX.Element {
  const [lines, setLines] = useState<string[]>([]);
  const [outPath, setOutPath] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.api.tailLog({ lines: DEFAULT_LINES });
    if (result.ok) {
      setLines(result.value);
      setMessage('');
    } else {
      setMessage(`读取日志失败：${result.error.message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doExport = async (): Promise<void> => {
    if (outPath.trim().length === 0) {
      setMessage('请填写导出路径。');
      return;
    }
    setBusy(true);
    const result = await window.api.exportLog({ outPath: outPath.trim() });
    setBusy(false);
    if (result.ok) {
      setMessage(`已导出：${result.value}`);
    } else {
      setMessage(`导出失败：${result.error.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outlined" onClick={() => void refresh()}>
          刷新
        </Button>
        <span className="text-2xs text-hud-dim">最近 {DEFAULT_LINES} 行</span>
      </div>

      <pre className="max-h-[360px] min-h-[180px] overflow-auto whitespace-pre-wrap rounded border border-hud-border bg-black/30 p-2 text-2xs leading-relaxed text-hud-text">
        {lines.length === 0 ? '（暂无日志）' : lines.join('\n')}
      </pre>

      <div className="flex items-center gap-2">
        <TextField
          value={outPath}
          onChange={(event) => setOutPath(event.target.value)}
          placeholder="导出路径，例如 D:\\tft-log.txt"
          fullWidth
        />
        <Button variant="contained" disabled={busy} onClick={() => void doExport()}>
          导出日志
        </Button>
      </div>

      {message.length > 0 ? <div className="text-2xs text-hud-dim">{message}</div> : null}
    </div>
  );
}
