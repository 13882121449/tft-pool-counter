/**
 * 设置页 · 合规（架构 §3.7 / PRD 第 7 章）。
 *
 * 本面板是**只读的能力边界说明 + 自检信息汇总**：
 * - 明确列出「会做 / 绝不会做」，让用户随时可回看（诚信底线）；
 * - 汇总分辨率自检、识别能力、卡池自检结果（来自 `system:info`）。
 */

import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import type { SystemInfoPayload } from '@shared/types/ipc';
import { useConfigStore } from '../../store/use-config-store';

/** 会做的事（与 docs/COMPLIANCE-CHECKLIST.md 对应）。 */
const ALLOWED = [
  '只读取屏幕像素：截图后在本机离线分析，截图不落盘、不上传',
  '所有识别与推算 100% 本地完成，断网可用',
  '卡池数值来自可编辑的 data/pool-baseline.json，不写死在代码里',
  '提供人工校正 / 锁定 / 撤销，自动结果随时可被覆盖',
];

/** 绝不会做的事。 */
const FORBIDDEN = [
  '绝不读取游戏进程内存、绝不注入 DLL、绝不 hook 游戏',
  '绝不模拟鼠标 / 键盘输入，绝不自动操作游戏',
  '绝不上传任何截图、窗口标题或可识别身份的信息',
  '绝不解包、修改或拦截游戏网络流量',
];

/** 小节标题。 */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[13px] font-semibold text-hud-text">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

/** 合规面板。 */
export function CompliancePanel(): JSX.Element {
  const compliance = useConfigStore((state) => state.config.compliance);
  const [info, setInfo] = useState<SystemInfoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void window.api.systemInfo().then((result) => {
      if (result.ok) {
        setInfo(result.value);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolution = info?.resolution ?? null;
  const selfTest = info?.poolSelfTest ?? null;

  return (
    <div>
      <Section title="本工具「做什么」">
        <ul className="ml-4 list-disc text-2xs leading-relaxed text-hud-text">
          {ALLOWED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title="本工具「绝不会做什么」">
        <ul className="ml-4 list-disc text-2xs leading-relaxed text-hud-text">
          {FORBIDDEN.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title="确认状态">
        <div className="text-2xs text-hud-dim">
          {compliance.acknowledged
            ? `已确认（${compliance.acknowledgedAt ?? '时间未知'}）`
            : '尚未确认：请在引导页确认后使用。'}
        </div>
      </Section>

      <Section title="运行环境自检">
        {error !== null ? <div className="text-2xs text-pool-out">{error}</div> : null}
        {info === null ? (
          <div className="text-2xs text-hud-dim">读取中…</div>
        ) : (
          <div className="rounded bg-white/5 p-2 text-2xs leading-relaxed text-hud-text">
            <div>
              版本 {info.version}｜{info.platform}/{info.arch}｜后端 {info.capabilities?.backend ?? '未知'}
            </div>
            {resolution !== null ? (
              <>
                <div>
                  分辨率 {resolution.displayWidth}×{resolution.displayHeight}（缩放{' '}
                  {Math.round(resolution.scaleFactor * 100)}%）
                </div>
                <div className={resolution.exclusiveFullscreenLikely ? 'text-pool-low' : 'text-pool-plenty'}>
                  {resolution.exclusiveFullscreenLikely
                    ? '疑似「独占全屏」：请改为「无边框全屏」。'
                    : '窗口化 / 无边框全屏，环境正常。'}
                </div>
                <div className="text-hud-dim">{resolution.advice}</div>
              </>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="卡池自检（可在训练模式交叉验证）">
        {selfTest === null ? (
          <div className="text-2xs text-hud-dim">基线未加载或自检不可用。</div>
        ) : (
          <div className="text-2xs text-hud-text">
            <div className={selfTest.ok ? 'text-pool-plenty' : 'text-pool-low'}>
              {selfTest.ok ? '各费用档自洽' : '存在不一致，请核对 data/pool-baseline.json'}
            </div>
            <table className="mt-1 w-full max-w-[360px] border-collapse text-2xs">
              <thead>
                <tr className="text-hud-dim">
                  <th className="border-b border-hud-border py-1 text-left">费用</th>
                  <th className="border-b border-hud-border py-1 text-right">每弈子</th>
                  <th className="border-b border-hud-border py-1 text-right">弈子数</th>
                  <th className="border-b border-hud-border py-1 text-right">档内总量</th>
                </tr>
              </thead>
              <tbody>
                {selfTest.tiers.map((tier) => (
                  <tr key={tier.cost}>
                    <td className="border-b border-hud-border/50 py-1">{tier.cost} 费</td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">
                      {tier.copiesPerChampion}
                    </td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">
                      {tier.distinctChampions}
                    </td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">{tier.tierTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selfTest.notes.length > 0 ? (
              <ul className="ml-4 mt-1 list-disc text-hud-dim">
                {selfTest.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Section>

      <div className="flex items-center gap-2">
        <Button variant="outlined" onClick={refresh}>
          重新自检
        </Button>
        <span className="text-2xs text-hud-dim">
          完整清单见 docs/COMPLIANCE-CHECKLIST.md；禁用 API 清单见 src/shared/forbidden-apis.md。
        </span>
      </div>
    </div>
  );
}
