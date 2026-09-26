/**
 * 阵容推荐面板（HUD 主视图之一：牌库 / 阵容）。
 *
 * 数据全部来自两个本地来源：引擎算出的牌库剩余数 + 基线的羁绊关系，
 * 不联网、不引入任何外部强度数据（与主程序合规红线一致）。
 *
 * 展示原则：
 * - 结论永远附带误差声明（覆盖率 / 基线未确认），不做确定性承诺；
 * - 评分只用于同快照内排序，UI 上标注「相对」，避免被误读成绝对强度；
 * - 每个成员直接给出「已有 / 还差几张 / 牌库剩余」，让玩家能自己复核。
 */

import { memo, useMemo } from 'react';
import { recommendLineups } from '@core/recommender';
import type {
  ChaseAdvice,
  ChaseVerdict,
  Feasibility,
  LineupMember,
  LineupRecommendation,
  MemberStatus,
} from '@shared/types/recommend';
import { ChampionAvatar } from '../common/ChampionAvatar';
import { useBaselineStore } from '../../store/use-baseline-store';
import { usePoolStore } from '../../store/use-pool-store';

/** 上阵人口：常规对局 8 人口成型。 */
const POPULATION = 8;

/** 展示的阵容条数。 */
const TOP_N = 3;

/** 成型难度展示样式。 */
const FEASIBILITY_VIEW: Record<Feasibility, { label: string; className: string }> = {
  easy: { label: '易成型', className: 'text-pool-plenty' },
  normal: { label: '可成型', className: 'text-pool-enough' },
  hard: { label: '需抢牌', className: 'text-pool-low' },
  blocked: { label: '无望', className: 'text-pool-out' },
};

/** 成员可得性展示样式。 */
const MEMBER_STATUS_VIEW: Record<MemberStatus, { label: string; className: string }> = {
  ready: { label: '', className: 'text-hud-dim' },
  contested: { label: '紧张', className: 'text-pool-low' },
  blocked: { label: '无货', className: 'text-pool-out' },
};

/** 追卡结论展示样式。 */
const CHASE_VIEW: Record<ChaseVerdict, { label: string; className: string }> = {
  'keep-chasing': { label: '可追', className: 'text-pool-plenty' },
  hold: { label: '观望', className: 'text-pool-enough' },
  stop: { label: '止损', className: 'text-pool-out' },
};

/** 阵容成员行。 */
const MemberRow = memo(function MemberRow({ member }: { member: LineupMember }): JSX.Element {
  const status = MEMBER_STATUS_VIEW[member.status];
  const tone = member.needed === 0 ? 'text-pool-plenty' : 'text-pool-enough';
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-[3px]"
      title={`${member.nameCn}｜目标 ${member.targetStar}★｜我已有 ${member.owned} 张，还差 ${member.needed} 张｜牌库剩余 ${member.poolRemaining}（悲观 ${member.poolPessimistic}）`}
    >
      <ChampionAvatar championId={member.championId} cost={member.cost} dim={member.status === 'blocked'} />
      <span className={`min-w-0 flex-1 truncate text-2xs ${member.core ? 'text-hud-text font-semibold' : 'text-hud-text'}`}>
        {member.nameCn}
      </span>
      <span className="shrink-0 text-2xs tabular-nums text-hud-dim">有{member.owned}</span>
      <span className={`shrink-0 text-2xs tabular-nums ${tone}`}>差{member.needed}</span>
      <span className="w-[38px] shrink-0 text-right text-2xs tabular-nums text-hud-dim">
        剩{member.poolRemaining}
      </span>
      {status.label.length > 0 ? (
        <span className={`w-[24px] shrink-0 text-2xs ${status.className}`}>{status.label}</span>
      ) : (
        <span className="w-[24px] shrink-0" />
      )}
    </div>
  );
});

/** 单条阵容卡片。 */
const LineupCard = memo(function LineupCard({
  lineup,
  rank,
}: {
  lineup: LineupRecommendation;
  rank: number;
}): JSX.Element {
  const feasibility = FEASIBILITY_VIEW[lineup.feasibility];
  const headline = lineup.traits
    .slice(0, 2)
    .map((trait) => `${trait.nameCn}${trait.count}`)
    .join(' · ');

  return (
    <div className="shrink-0 border-b border-hud-border">
      <div className="flex items-center gap-1.5 px-2 pt-1.5">
        <span className="shrink-0 text-2xs text-hud-dim">#{rank}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-hud-text" title={headline}>
          {headline}
        </span>
        <span className={`shrink-0 text-2xs ${feasibility.className}`}>{feasibility.label}</span>
        <span
          className="shrink-0 text-2xs tabular-nums text-hud-dim"
          title="综合评分：仅用于本次快照内的相对排序，不代表绝对强度"
        >
          {lineup.score.toFixed(1)}
        </span>
      </div>
      <div className="px-2 pb-1 text-2xs text-hud-dim">{lineup.summary}</div>
      {lineup.members.map((member) => (
        <MemberRow key={member.championId} member={member} />
      ))}
    </div>
  );
});

/** 追卡建议行。 */
const ChaseRow = memo(function ChaseRow({ advice }: { advice: ChaseAdvice }): JSX.Element {
  const view = CHASE_VIEW[advice.verdict];
  return (
    <div className="flex items-start gap-1.5 px-2 py-[3px]">
      <span className={`shrink-0 text-2xs ${view.className}`}>{view.label}</span>
      <span className="min-w-0 flex-1 text-2xs text-hud-text">
        {advice.nameCn}
        <span className="text-hud-dim">
          {' '}
          {advice.star}★ · {advice.reason}
        </span>
      </span>
    </div>
  );
});

/** 阵容推荐面板。 */
export const LineupPanel = memo(function LineupPanel(): JSX.Element {
  const snapshot = usePoolStore((state) => state.snapshot);
  const baseline = useBaselineStore((state) => state.baseline);

  const result = useMemo(() => {
    if (snapshot === null || baseline === null) {
      return null;
    }
    return recommendLineups({
      rows: snapshot.rows,
      champions: baseline.champions,
      starCopyCost: baseline.starCopyCost,
      population: POPULATION,
      topN: TOP_N,
      nonPoolUnitIds: baseline.nonPoolUnitIds,
      coverage: { scanned: snapshot.coverage.scanned, total: snapshot.coverage.total },
      baselineConfirmed: baseline.meta.confirmed,
    });
  }, [snapshot, baseline]);

  if (result === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-2xs text-hud-dim">
        完成一次扫描后，这里会给出基于当前牌库的阵容推荐
      </div>
    );
  }

  if (result.lineups.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-2xs text-hud-dim">
        暂无可推荐阵容（数据不足）
      </div>
    );
  }

  return (
    <div className="no-drag flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-hud-border px-2 py-1 text-2xs text-hud-dim">
        {result.disclaimer}
      </div>

      {result.lineups.map((lineup, index) => (
        <LineupCard key={lineup.id} lineup={lineup} rank={index + 1} />
      ))}

      {result.chase.length > 0 ? (
        <div className="shrink-0">
          <div className="px-2 pt-2 text-2xs font-semibold text-hud-text">
            追卡建议<span className="ml-1 font-normal text-hud-dim">（我已有的牌）</span>
          </div>
          {result.chase.map((advice) => (
            <ChaseRow key={advice.championId} advice={advice} />
          ))}
        </div>
      ) : null}
    </div>
  );
});
