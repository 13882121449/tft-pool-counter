/**
 * 阵容推荐模块单测。
 *
 * 全部使用**小型受控基线**（9 个弈子 / 3 条羁绊），而不是真实 65 人基线 ——
 * 目的是把算法逻辑与真实数据解耦：真实数据一变（换赛季）测试不会跟着碎，
 * 而算法回归会立刻被抓到。
 *
 * 真实基线数据的完整性由 `tests/unit/baseline/*` 负责。
 */

import { describe, expect, it } from 'vitest';
import type { Champion, Cost, RemainingResult } from '../../../src/shared/types/domain';
import {
  buildTraitIndex,
  computeAvailability,
  pickTargetStar,
  recommendLineups,
} from '../../../src/core/recommender';

const STAR_COPY_COST = { 1: 1, 2: 3, 3: 9, 4: 9 } as const;

/** 构造一个弈子定义。 */
function champ(
  id: string,
  cost: Cost,
  poolTotal: number,
  traits: string[],
  traitsCn = traits.map((trait) => `${trait}中文`),
): Champion {
  return {
    id,
    nameEn: id.toUpperCase(),
    nameCn: `${id}中文`,
    cost,
    traits,
    traitsCn,
    poolTotal,
    confirmed: false,
  };
}

/**
 * 受控基线：
 * - Alpha：a1(1费,30) / a2(2费,25) / a3(3费,18) / a4(4费,10)
 * - Beta ：b1(1费,30) / b2(2费,25) / b3(3费,18)
 * - Gamma：c1(3费,18) / a2（与 Alpha 重叠）
 */
const CHAMPIONS: Champion[] = [
  champ('a1', 1, 30, ['Alpha']),
  champ('a2', 2, 25, ['Alpha', 'Gamma']),
  champ('a3', 3, 18, ['Alpha']),
  champ('a4', 4, 10, ['Alpha']),
  champ('b1', 1, 30, ['Beta']),
  champ('b2', 2, 25, ['Beta']),
  champ('b3', 3, 18, ['Beta']),
  champ('c1', 3, 18, ['Gamma']),
];

/** 构造一条 RemainingResult。 */
function makeRow(
  championId: string,
  cost: Cost,
  poolTotal: number,
  options: {
    bySeat?: number[];
    remaining?: number;
    pessimistic?: number;
  } = {},
): RemainingResult {
  const bySeat = options.bySeat ?? [0, 0, 0, 0, 0, 0, 0, 0];
  const observed = bySeat.reduce((sum, value) => sum + value, 0);
  const remaining = options.remaining ?? Math.max(0, poolTotal - observed);
  const pessimistic = options.pessimistic ?? remaining;
  return {
    championId,
    cost,
    poolTotal,
    observedCopies: observed,
    remaining,
    overflow: 0,
    remainingOptimistic: remaining,
    remainingPessimistic: pessimistic,
    bySeat,
    seatHasAny: bySeat.map((value) => value > 0),
    coveredSeats: [0, 1, 2, 3, 4, 5, 6, 7],
    confidence: 1,
    flags: [],
    locked: false,
    updatedAt: 0,
  };
}

/** 构造一批「池满、我一张没有」的行。 */
function fullPoolRows(): RemainingResult[] {
  return CHAMPIONS.map((champion) => makeRow(champion.id, champion.cost, champion.poolTotal));
}

describe('buildTraitIndex', () => {
  it('把 traits 反转成 trait → 成员，并补齐中文名', () => {
    const index = buildTraitIndex(CHAMPIONS);
    expect(index.get('Alpha')?.members.map((m) => m.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(index.get('Alpha')?.nameCn).toBe('Alpha中文');
    expect(index.get('Gamma')?.members.map((m) => m.id).sort()).toEqual(['a2', 'c1']);
  });

  it('成员按费用降序排列', () => {
    const index = buildTraitIndex(CHAMPIONS);
    expect(index.get('Alpha')?.members.map((m) => m.cost)).toEqual([4, 3, 2, 1]);
  });

  it('排除非池单位', () => {
    const index = buildTraitIndex(CHAMPIONS, new Set(['a1']));
    expect(index.get('Alpha')?.members.map((m) => m.id)).not.toContain('a1');
  });

  it('个别弈子译名缺失时，用同羁绊其他弈子的译名补齐', () => {
    const withMissing: Champion[] = [
      champ('x1', 1, 30, ['Zeta'], [null as unknown as string]),
      champ('x2', 2, 25, ['Zeta'], ['泽塔']),
    ];
    expect(buildTraitIndex(withMissing).get('Zeta')?.nameCn).toBe('泽塔');
  });
});

describe('computeAvailability', () => {
  it('用悲观剩余算 ratio，并统计对手家数', () => {
    const rows = [
      makeRow('a1', 1, 30, { bySeat: [3, 2, 0, 0, 0, 0, 0, 0], pessimistic: 15 }),
    ];
    const availability = computeAvailability(rows, 0);
    const entry = availability.get('a1');
    expect(entry?.owned).toBe(3);
    expect(entry?.ratio).toBeCloseTo(15 / 30, 5);
    // 座位 1 有 2 张 → 1 家对手（我自己不算竞争）
    expect(entry?.rivalSeats).toBe(1);
  });

  it('池总数为 0 时不产生 NaN', () => {
    const rows = [makeRow('a1', 1, 0, { pessimistic: 0 })];
    expect(computeAvailability(rows, 0).get('a1')?.ratio).toBe(0);
  });
});

describe('pickTargetStar', () => {
  it('默认追 2★，不冒进推荐 4/5 费追 3★', () => {
    expect(pickTargetStar(4, 0, STAR_COPY_COST)).toBe(2);
    expect(pickTargetStar(5, 3, STAR_COPY_COST)).toBe(2);
  });

  it('低费高投入时继续追 3★', () => {
    expect(pickTargetStar(1, 5, STAR_COPY_COST)).toBe(3);
    expect(pickTargetStar(2, 8, STAR_COPY_COST)).toBe(3);
  });

  it('已达 3★ 保持 3★，不受费用限制', () => {
    expect(pickTargetStar(5, 9, STAR_COPY_COST)).toBe(3);
  });
});

describe('recommendLineups —— 基本产出', () => {
  it('池满且我什么都没有时，仍能给出推荐且判为 easy', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    expect(result.lineups.length).toBeGreaterThan(0);
    const top = result.lineups[0];
    expect(top?.feasibility).toBe('easy');
    expect(top?.members.length).toBe(4);
    // 阵容内不应有重复成员
    const ids = top?.members.map((m) => m.championId) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('推荐结果按评分降序，且不含 NaN 分数', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    const scores = result.lineups.map((lineup) => lineup.score);
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true);
    }
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('summary 与 missingCopies 自洽', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    for (const lineup of result.lineups) {
      const sum = lineup.members.reduce((acc, member) => acc + member.needed, 0);
      expect(lineup.missingCopies).toBe(sum);
      expect(lineup.summary).toContain(`还差 ${sum} 张`);
    }
  });
});

describe('recommendLineups —— 我已有的牌主导推荐', () => {
  it('我持有的弈子排进推荐，且 2★ 后 needed 归零', () => {
    const rows = fullPoolRows().map((row) =>
      row.championId === 'a1'
        ? makeRow('a1', 1, 30, { bySeat: [3, 0, 0, 0, 0, 0, 0, 0] })
        : row,
    );
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    const withMine = result.lineups.find((lineup) =>
      lineup.members.some((member) => member.championId === 'a1'),
    );
    expect(withMine).toBeDefined();
    const a1 = withMine?.members.find((member) => member.championId === 'a1');
    expect(a1?.owned).toBe(3);
    expect(a1?.targetStar).toBe(2);
    // 已 3 张 = 2★，无需再买
    expect(a1?.needed).toBe(0);
    expect(a1?.status).toBe('ready');
  });

  it('以我已有为核心的阵容排在前面（有种子时会产出一条 seedTrait=null 的线）', () => {
    const rows = fullPoolRows().map((row) =>
      row.championId === 'b3'
        ? makeRow('b3', 3, 18, { bySeat: [3, 0, 0, 0, 0, 0, 0, 0] })
        : row,
    );
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    // 已有牌必须出现在至少一条推荐里，否则这个功能对我毫无意义
    expect(
      result.lineups.some((lineup) =>
        lineup.members.some((member) => member.championId === 'b3'),
      ),
    ).toBe(true);
  });

  it('我一张牌都没有时不产出 seedTrait=null 的线（避免退化成全局最优 8 张）', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    // 全局最优线仅在 ownedPool 非空时产出，此处所有成员 owned 都应为 0
    for (const lineup of result.lineups) {
      for (const member of lineup.members) {
        expect(member.owned).toBe(0);
      }
    }
  });
});

describe('recommendLineups —— 牌库被抢空', () => {
  it('成员剩余为 0 且我需要它时判为 blocked', () => {
    const rows = fullPoolRows().map((row) =>
      row.championId === 'a1'
        ? makeRow('a1', 1, 30, { remaining: 0, pessimistic: 0 })
        : row,
    );
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    for (const lineup of result.lineups) {
      const a1 = lineup.members.find((member) => member.championId === 'a1');
      if (a1 !== undefined) {
        expect(a1.status).toBe('blocked');
      }
    }
  });

  it('悲观口径优先于乐观口径（乐观有货但悲观为空 → 仍判 blocked）', () => {
    const rows = fullPoolRows().map((row) =>
      row.championId === 'a1'
        ? makeRow('a1', 1, 30, { remaining: 12, pessimistic: 0 })
        : row,
    );
    const availability = computeAvailability(rows, 0);
    expect(availability.get('a1')?.remaining).toBe(12);
    expect(availability.get('a1')?.ratio).toBe(0);

    // 同一条输入进推荐，a1 一旦被选进阵容就必须判 blocked（不能因为「乐观有 12 张」而放行）
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    for (const lineup of result.lineups) {
      const a1 = lineup.members.find((member) => member.championId === 'a1');
      if (a1 !== undefined) {
        expect(a1.status).toBe('blocked');
        expect(a1.poolRemaining).toBe(12);
      }
    }
  });

  it('核心成员买不齐时 feasibility 不为 easy', () => {
    const rows = fullPoolRows().map((row) => {
      if (['a1', 'a2', 'a3', 'a4'].includes(row.championId)) {
        return makeRow(row.championId, row.cost, row.poolTotal, {
          remaining: 0,
          pessimistic: 0,
        });
      }
      return row;
    });
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
    });
    const alphaLine = result.lineups.find((lineup) =>
      lineup.traits.some((trait) => trait.trait === 'Alpha' && trait.count >= 3),
    );
    if (alphaLine !== undefined) {
      expect(alphaLine.feasibility).not.toBe('easy');
    }
  });
});

describe('recommendLineups —— 追星建议', () => {
  it('牌库已空 → stop', () => {
    const rows = [
      makeRow('a1', 1, 30, { bySeat: [2, 0, 0, 0, 0, 0, 0, 0], remaining: 0, pessimistic: 0 }),
    ];
    const result = recommendLineups({
      rows,
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
    });
    const advice = result.chase.find((item) => item.championId === 'a1');
    expect(advice?.verdict).toBe('stop');
    expect(advice?.star).toBe(1);
    expect(advice?.neededToNextStar).toBe(1);
  });

  it('剩余不足还差张数 → hold', () => {
    const rows = [
      makeRow('a3', 3, 18, { bySeat: [1, 0, 0, 0, 0, 0, 0, 0], remaining: 1, pessimistic: 1 }),
    ];
    const result = recommendLineups({ rows, champions: CHAMPIONS, starCopyCost: STAR_COPY_COST });
    // 1 张 → 上 2★ 需 3 张，还差 2 张，但牌库只剩 1 张
    expect(result.chase.find((item) => item.championId === 'a3')?.verdict).toBe('hold');
  });

  it('剩余充足 → keep-chasing', () => {
    const rows = [
      makeRow('a3', 3, 18, { bySeat: [1, 0, 0, 0, 0, 0, 0, 0], remaining: 15, pessimistic: 15 }),
    ];
    const result = recommendLineups({ rows, champions: CHAMPIONS, starCopyCost: STAR_COPY_COST });
    expect(result.chase.find((item) => item.championId === 'a3')?.verdict).toBe('keep-chasing');
  });

  it('不给我没有的牌出建议', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
    });
    expect(result.chase).toHaveLength(0);
  });

  it('已 3★ 的牌提示无需继续投入', () => {
    const rows = [
      makeRow('a1', 1, 30, { bySeat: [9, 0, 0, 0, 0, 0, 0, 0], remaining: 20, pessimistic: 20 }),
    ];
    const result = recommendLineups({ rows, champions: CHAMPIONS, starCopyCost: STAR_COPY_COST });
    const advice = result.chase.find((item) => item.championId === 'a1');
    expect(advice?.star).toBe(3);
    expect(advice?.neededToNextStar).toBe(0);
  });
});

describe('recommendLineups —— 参数与声明', () => {
  it('排除非池单位', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      population: 4,
      nonPoolUnitIds: ['a1'],
    });
    const allMembers = result.lineups.flatMap((lineup) =>
      lineup.members.map((member) => member.championId),
    );
    expect(allMembers).not.toContain('a1');
  });

  it('覆盖率不足时 disclaimer 说明偏乐观', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      coverage: { scanned: 3, total: 8 },
    });
    expect(result.disclaimer).toContain('3/8');
    expect(result.disclaimer).toContain('偏乐观');
  });

  it('基线未确认时 disclaimer 追加提示', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      baselineConfirmed: false,
    });
    expect(result.disclaimer).toContain('尚未实测确认');
  });

  it('参数原样回传，便于复现', () => {
    const result = recommendLineups({
      rows: fullPoolRows(),
      champions: CHAMPIONS,
      starCopyCost: STAR_COPY_COST,
      mySeat: 2,
      population: 6,
      topN: 2,
    });
    expect(result.params).toEqual({ population: 6, mySeat: 2, topN: 2 });
    expect(result.lineups.length).toBeLessThanOrEqual(2);
  });

  it('同一输入重复调用结果稳定（除时间戳外）', () => {
    const run = (): unknown => {
      const result = recommendLineups({
        rows: fullPoolRows(),
        champions: CHAMPIONS,
        starCopyCost: STAR_COPY_COST,
        population: 4,
      });
      const { generatedAt, ...rest } = result;
      expect(generatedAt).toBeGreaterThan(0);
      return rest;
    };
    expect(run()).toEqual(run());
  });

  it('空输入不抛异常', () => {
    const result = recommendLineups({
      rows: [],
      champions: [],
      starCopyCost: STAR_COPY_COST,
    });
    expect(result.lineups).toHaveLength(0);
    expect(result.chase).toHaveLength(0);
  });
});
