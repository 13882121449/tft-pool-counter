/**
 * 设置页 · 估算（架构 §3.7 / PRD Q7）。
 *
 * 两块内容：
 * 1. **悲观区间参数**：每个未巡查家、每个费用档保守估计持有几张（Q7），
 *    这是"覆盖率不足时数字还诚不诚实"的关键；
 * 2. **卡池基数预设核对**：把 data/pool-baseline.json 的每档张数摊出来，
 *    并提供 22/20/17/10/9 预设做快速对照（可一键填入"参考"并触发基线重载提示）。
 *
 * 注意：卡池基数的**权威来源永远是** `data/pool-baseline.json`（禁止硬编码），
 * 本面板不会偷偷改写它，只帮助用户核对。
 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { Cost } from '@shared/types/domain';
import type { BaselineValidateResult } from '@shared/types/ipc';
import { useConfigStore } from '../../store/use-config-store';
import { useBaselineStore } from '../../store/use-baseline-store';

/** 卡池基数参考预设（每张 1 费弈子的份数档位）。 */
const POOL_PRESETS = [22, 20, 17, 10, 9];

/** 费用档列表。 */
const COSTS: Cost[] = [1, 2, 3, 4, 5];

/** 估算面板。 */
export function EstimatePanel(): JSX.Element {
  const config = useConfigStore((state) => state.config);
  const patch = useConfigStore((state) => state.patch);
  const baseline = useBaselineStore((state) => state.baseline);
  const loadBaseline = useBaselineStore((state) => state.load);

  const [preset, setPreset] = useState<number | null>(null);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (baseline === null) {
      return;
    }
    const firstTier = baseline.poolSizeByCost[1]?.copiesPerChampion ?? 0;
    setPreset(POOL_PRESETS.includes(firstTier) ? firstTier : null);
  }, [baseline]);

  const patchEstimate = (partial: Partial<typeof config.estimate>): void => {
    void patch({ estimate: { ...config.estimate, ...partial } });
  };

  const setPerSeat = (cost: Cost, value: number): void => {
    patchEstimate({
      perSeatByCost: { ...config.estimate.perSeatByCost, [cost]: Math.max(0, Math.floor(value)) },
    });
  };

  const reloadBaseline = async (): Promise<void> => {
    const result: BaselineValidateResult | null = await window.api.reloadBaseline().then((r) => (r.ok ? r.value : null));
    await loadBaseline();
    if (result === null) {
      setMessage('重载失败：请检查 data/pool-baseline.json 是否为合法 JSON。');
      return;
    }
    setMessage(result.ok ? '基线已重载。' : `基线校验失败：${result.errors[0]?.message ?? '未知原因'}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-hud-text">悲观区间参数（每个未巡查家 × 每个费用档）</h3>
        <div className="flex flex-wrap gap-2">
          {COSTS.map((cost) => (
            <label key={cost} className="flex items-center gap-1 text-2xs text-hud-dim">
              {cost} 费
              <TextField
                type="number"
                value={config.estimate.perSeatByCost[cost] ?? 1}
                onChange={(event) => setPerSeat(cost, Number(event.target.value))}
                sx={{ width: 72 }}
              />
            </label>
          ))}
        </div>
        <div className="mt-2 text-2xs text-hud-dim">
          保守估计越大，悲观区间越紧（数字越"不敢说满"）。默认全档 1 张。
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="w-[130px] text-2xs text-hud-dim">低覆盖率阈值</span>
          <TextField
            type="number"
            value={config.estimate.lowCoverageThreshold ?? 5}
            onChange={(event) => patchEstimate({ lowCoverageThreshold: Math.max(0, Math.min(8, Number(event.target.value))) })}
            sx={{ width: 100 }}
          />
          <span className="text-2xs text-hud-dim">巡查家数低于此值时打「低覆盖」标记</span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="w-[130px] text-2xs text-hud-dim">陈旧 TTL</span>
          <TextField
            type="number"
            value={config.estimate.staleTtlMs ?? 8000}
            onChange={(event) => patchEstimate({ staleTtlMs: Math.max(500, Number(event.target.value)) })}
            sx={{ width: 120 }}
          />
          <span className="text-2xs text-hud-dim">ms：某弈子超过此时长未被看到则打「陈旧」标记</span>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-hud-text">卡池基数核对（权威来源：data/pool-baseline.json）</h3>

        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-2xs text-hud-dim">参考预设：</span>
          {POOL_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreset(value)}
              className={`rounded px-2 py-0.5 text-2xs transition-colors ${
                preset === value ? 'bg-pool-enough/30 text-pool-enough' : 'bg-white/10 text-hud-dim hover:bg-white/20'
              }`}
              title="仅用于对照：告诉你「当前基线看起来像哪一档预设」"
            >
              {value}
            </button>
          ))}
        </div>

        {baseline === null ? (
          <div className="text-2xs text-hud-dim">基线尚未加载。</div>
        ) : (
          <table className="w-full max-w-[420px] border-collapse text-2xs text-hud-text">
            <thead>
              <tr className="text-hud-dim">
                <th className="border-b border-hud-border py-1 text-left">费用</th>
                <th className="border-b border-hud-border py-1 text-right">每弈子张数</th>
                <th className="border-b border-hud-border py-1 text-right">弈子数</th>
                <th className="border-b border-hud-border py-1 text-right">该档总量</th>
              </tr>
            </thead>
            <tbody>
              {COSTS.map((cost) => {
                const entry = baseline.poolSizeByCost[cost];
                const total = (entry?.copiesPerChampion ?? 0) * (entry?.distinctChampions ?? 0);
                return (
                  <tr key={cost}>
                    <td className="border-b border-hud-border/50 py-1">{cost} 费</td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">
                      {entry?.copiesPerChampion ?? 0}
                    </td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">
                      {entry?.distinctChampions ?? 0}
                    </td>
                    <td className="border-b border-hud-border/50 py-1 text-right tabular-nums">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {baseline !== null && !baseline.meta.confirmed ? (
          <div className="mt-2 text-2xs text-pool-low">
            基线标记为「未实测确认」。建议在训练模式跑一局，用实际抽卡结果核对上表。
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <Button variant="outlined" onClick={() => void reloadBaseline()}>
            重载基线
          </Button>
          <span className="text-2xs text-hud-dim">
            如需修改数值：直接编辑 data/pool-baseline.json（按费用档批量改，或单弈子覆写），再点重载。
          </span>
        </div>

        {message.length > 0 ? <div className="mt-1 text-2xs text-pool-enough">{message}</div> : null}
      </section>
    </div>
  );
}
