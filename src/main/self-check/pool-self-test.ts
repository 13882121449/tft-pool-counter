/**
 * 卡池自检（PRD Q1 / 架构风险 R5）。
 *
 * 基线 `CONFIRMED: false` 意味着"数字待实测"。本自检让用户在一局里
 * 交叉验证每个费用档的**每弈子张数 × 弈子数 = 该档池总量**是否自洽，
 * 从而把"基线可能错"的成本从「给出错误数字」降为「给出带警示的估算」。
 *
 * 全部计算都在本地完成，不联网、不上报。
 */

import type { Cost, PoolBaseline } from '../../shared/types/domain';
import type {
  PoolSelfTestPayload,
  TierSelfTestPayload,
} from '../../shared/types/ipc';

/**
 * 运行卡池自检。
 *
 * @param baseline 卡池基线。
 */
export function runPoolSelfTest(baseline: PoolBaseline): PoolSelfTestPayload {
  const tiers: TierSelfTestPayload[] = [];
  const notes: string[] = [];

  for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
    const entry = baseline.poolSizeByCost[cost];
    const champions = baseline.champions.filter((champion) => champion.cost === cost);
    const summedPoolTotal = champions.reduce((sum, champion) => sum + champion.poolTotal, 0);
    const copiesPerChampion = entry?.copiesPerChampion ?? 0;
    const distinctChampions = entry?.distinctChampions ?? 0;
    const tierTotal = entry?.tierTotal ?? copiesPerChampion * distinctChampions;

    const distinctOk = distinctChampions === champions.length;
    const totalOk = tierTotal === 0 || tierTotal === summedPoolTotal;
    if (!distinctOk) {
      notes.push(
        `${cost} 费档：基线声明 ${distinctChampions} 个弈子，实际列出 ${champions.length} 个`,
      );
    }
    if (!totalOk) {
      notes.push(
        `${cost} 费档：声明池总量 ${tierTotal}，按每弈子 ${copiesPerChampion} 张汇总得 ${summedPoolTotal}`,
      );
    }

    tiers.push({
      cost,
      copiesPerChampion,
      distinctChampions,
      summedPoolTotal,
      tierTotal,
      ok: distinctOk && totalOk,
    });
  }

  if (!baseline.meta.confirmed) {
    notes.push('卡池基线 CONFIRMED = false：数值待实测确认，UI 会持续显示「估算 / 待实测」标记。');
  }

  return { ok: tiers.every((tier) => tier.ok), tiers, notes };
}
