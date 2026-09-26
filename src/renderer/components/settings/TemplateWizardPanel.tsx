/**
 * 设置页 · 模板素材向导（架构 §3.7 / PRD Q6）。
 *
 * 版权合规：**不内置任何图鉴站素材**。全部模板由用户在自己的一局画面上
 * 「采集 → 逐格指派弈子 → 落盘」得到，仅用于本地识别。
 *
 * 流程：
 * 1. 点「采集当前画面」→ 主进程让识别进程按当前标定切出所有格子草稿（原始 RGBA）；
 * 2. 逐格展示缩略图，用户从基线弈子下拉里选 id；
 * 3. 点「保存到用户模板库」→ `template:append` 落盘并热重启识别进程；
 * 4. 支持 zip 导入 / 导出（跨机器迁移）。
 *
 * 槽位键：使用 `wizardSlotKey(zone, slotIndex)`，
 * 与主进程 `@vision/templates/capture-wizard` 完全一致（board 与 bench 的 slotIndex 会互相覆盖）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import type { Champion } from '@shared/types/domain';
import type { TemplateListPayload } from '@shared/types/ipc';
import type { WizardDraftPayload } from '@shared/types/vision';
import { NON_POOL_UNIT_IDS, useBaselineStore } from '../../store/use-baseline-store';
import { wizardSlotKey } from '../../utils/wizard-slots';

/** 草稿缩略图：把原始 RGBA 画到 canvas（不依赖任何解码库）。 */
function DraftThumb({ draft }: { draft: WizardDraftPayload }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return;
    }
    const expected = draft.width * draft.height * 4;
    const bytes = draft.bytes instanceof Uint8Array ? draft.bytes : new Uint8Array(0);
    if (bytes.length !== expected || draft.width <= 0 || draft.height <= 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    canvas.width = draft.width;
    canvas.height = draft.height;
    const image = new ImageData(new Uint8ClampedArray(bytes), draft.width, draft.height);
    ctx.putImageData(image, 0, 0);
  }, [draft]);

  return (
    <canvas
      ref={ref}
      width={draft.width || 40}
      height={draft.height || 40}
      className="h-[44px] w-[44px] rounded border border-hud-border bg-black/40"
    />
  );
}

/** 弈子下拉的选项列表（按费用、名称排序，剔除不可购买单位）。 */
function useChampionOptions(): Champion[] {
  const baseline = useBaselineStore((state) => state.baseline);
  return useMemo(() => {
    if (baseline === null) {
      return [];
    }
    return baseline.champions
      .filter((champion) => !NON_POOL_UNIT_IDS.has(champion.id))
      .slice()
      .sort((a, b) => a.cost - b.cost || a.nameCn.localeCompare(b.nameCn));
  }, [baseline]);
}

/** 模板素材向导面板。 */
export function TemplateWizardPanel(): JSX.Element {
  const champions = useChampionOptions();
  const [summary, setSummary] = useState<TemplateListPayload | null>(null);
  const [drafts, setDrafts] = useState<WizardDraftPayload[]>([]);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [zipPath, setZipPath] = useState('');
  const [outPath, setOutPath] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshSummary = useCallback(async (): Promise<void> => {
    const result = await window.api.listTemplates();
    if (result.ok) {
      setSummary(result.value);
    } else {
      setMessage(`读取模板库失败：${result.error.message}`);
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  const capture = async (): Promise<void> => {
    setBusy(true);
    const result = await window.api.captureTemplates({});
    setBusy(false);
    if (!result.ok) {
      setMessage(`采集失败：${result.error.message}`);
      return;
    }
    setDrafts(result.value.drafts);
    setAssignments({});
    const nonBlank = result.value.drafts.filter((draft) => !draft.blank).length;
    const errNote = result.value.errors.length > 0 ? `；告警：${result.value.errors.join('、')}` : '';
    setMessage(`已采集 ${result.value.drafts.length} 格（非空 ${nonBlank}）${errNote}`);
  };

  const assign = (draft: WizardDraftPayload, championId: string): void => {
    const key = wizardSlotKey(draft.zone, draft.slotIndex);
    setAssignments((current) => {
      const next = { ...current };
      if (championId.length === 0) {
        delete next[key];
      } else {
        next[key] = championId;
      }
      return next;
    });
  };

  const save = async (): Promise<void> => {
    const assignedCount = Object.keys(assignments).length;
    if (assignedCount === 0) {
      setMessage('请至少为一个格子选择弈子。');
      return;
    }
    setBusy(true);
    const result = await window.api.appendTemplates({ assignments, drafts });
    setBusy(false);
    if (!result.ok) {
      setMessage(`保存失败：${result.error.message}`);
      return;
    }
    const errNote = result.value.errors.length > 0 ? `；错误：${result.value.errors.join('、')}` : '';
    setMessage(`已写入 ${result.value.added} 个模板${errNote}`);
    await refreshSummary();
  };

  const importZip = async (): Promise<void> => {
    if (zipPath.trim().length === 0) {
      setMessage('请填写要导入的 zip 路径。');
      return;
    }
    setBusy(true);
    const result = await window.api.importTemplates({ zipPath: zipPath.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage(`导入失败：${result.error.message}`);
      return;
    }
    setMessage(`导入完成：新增 ${result.value.imported}，跳过 ${result.value.skipped}`);
    await refreshSummary();
  };

  const exportZip = async (): Promise<void> => {
    if (outPath.trim().length === 0) {
      setMessage('请填写导出 zip 路径。');
      return;
    }
    setBusy(true);
    const result = await window.api.exportTemplates({ outPath: outPath.trim() });
    setBusy(false);
    if (!result.ok) {
      setMessage(`导出失败：${result.error.message}`);
      return;
    }
    setMessage(`已导出 ${result.value.count} 个模板（${Math.round(result.value.bytes / 1024)} KB）→ ${result.value.path}`);
  };

  const assignedCount = Object.keys(assignments).length;

  return (
    <div className="flex flex-col gap-3">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold text-hud-text">模板库</h3>
        {summary === null ? (
          <div className="text-2xs text-hud-dim">读取中…</div>
        ) : (
          <div className="rounded bg-white/5 p-2 text-2xs leading-relaxed text-hud-text">
            <div>内置（只读）：{summary.bundled.count} 个</div>
            <div>用户自建：{summary.user.count} 个</div>
            <div>基线弈子：{summary.championCount} 个</div>
            <div className="text-hud-dim">用户模板目录：{summary.user.dir}</div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[13px] font-semibold text-hud-text">采集当前画面</h3>
        <div className="mb-2 text-2xs text-hud-dim">
          请先停在游戏内一局（建议训练模式）画面上，并确保已完成「标定」。
        </div>
        <div className="flex items-center gap-2">
          <Button variant="contained" disabled={busy} onClick={() => void capture()}>
            采集当前画面
          </Button>
          <Button variant="outlined" disabled={busy || assignedCount === 0} onClick={() => void save()}>
            保存到用户模板库（{assignedCount}）
          </Button>
        </div>
      </section>

      {drafts.length > 0 ? (
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-hud-text">逐格指派（共 {drafts.length} 格）</h3>
          <div className="grid max-h-[300px] grid-cols-2 gap-x-2 gap-y-1 overflow-auto pr-1">
            {drafts.map((draft) => {
              const key = wizardSlotKey(draft.zone, draft.slotIndex);
              const value = assignments[key] ?? '';
              return (
                <div
                  key={key}
                  className="flex items-center gap-1.5 rounded border border-hud-border/60 bg-white/5 px-1.5 py-1"
                >
                  <div className="flex w-[46px] shrink-0 flex-col items-center gap-0.5">
                    {draft.blank ? (
                      <div className="flex h-[44px] w-[44px] items-center justify-center rounded border border-hud-border bg-black/40 text-2xs text-hud-dim">
                        空
                      </div>
                    ) : (
                      <DraftThumb draft={draft} />
                    )}
                    <span className="text-2xs text-hud-dim">
                      {draft.zone === 'bench' ? '备' : draft.zone === 'shop' ? '店' : '棋'}
                      {draft.zone === 'board' ? `${draft.row},${draft.col}` : draft.slotIndex + 1}
                    </span>
                  </div>
                  <Select
                    value={value}
                    displayEmpty
                    disabled={draft.blank}
                    onChange={(event) => assign(draft, event.target.value as string)}
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    <MenuItem value="">
                      <span className="text-hud-dim">未指派</span>
                    </MenuItem>
                    {champions.map((champion) => (
                      <MenuItem key={champion.id} value={champion.id}>
                        {champion.nameCn}
                        <span className="ml-1 text-hud-dim">
                          {champion.id}·{champion.cost}费
                        </span>
                      </MenuItem>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="mb-1 text-[13px] font-semibold text-hud-text">导入 / 导出（zip）</h3>
        <div className="flex items-center gap-2">
          <TextField
            value={zipPath}
            onChange={(event) => setZipPath(event.target.value)}
            placeholder="导入：zip 路径，例如 D:\\templates.zip"
            fullWidth
          />
          <Button variant="outlined" disabled={busy} onClick={() => void importZip()}>
            导入
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <TextField
            value={outPath}
            onChange={(event) => setOutPath(event.target.value)}
            placeholder="导出：zip 路径，例如 D:\\templates.zip"
            fullWidth
          />
          <Button variant="outlined" disabled={busy} onClick={() => void exportZip()}>
            导出
          </Button>
        </div>
        <div className="mt-1 text-2xs text-hud-dim">
          导入 / 导出的 zip 仅包含模板图片与清单，不含任何游戏文件或截图原图。
        </div>
      </section>

      {message.length > 0 ? <div className="text-2xs text-pool-enough">{message}</div> : null}
    </div>
  );
}
