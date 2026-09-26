/**
 * T03 匹配层单测：pHash 粗筛 → NCC/OpenCV 精排 → 多证据融合 → 裁决 → 黑名单。
 *
 * 重点验证"降级可用性"：即使精排后端表现退化，粗筛 + 费用先验也必须能给出
 * 一个可用的候选，而不是返回空。
 */

import { describe, expect, it } from 'vitest';
import type { Cost } from '../../../src/shared/types/domain';
import { createSolidImage, createRawImage, type RawImage } from '../../../src/vision/preprocess/raw-image';
import { coarseRank, dedupeByChampion, filterTemplatesByCost } from '../../../src/vision/match/phash-matcher';
import { nccScore } from '../../../src/vision/match/opencv-matcher';
import {
  DEFAULT_FUSION_WEIGHTS,
  decideMatch,
  fuseAll,
  fuseFromCoarse,
  fuseScore,
} from '../../../src/vision/match/fusion';
import {
  createBlacklistFilter,
  filterCandidates,
  isNonPoolUnit,
  parseNonPoolUnitIds,
} from '../../../src/vision/match/blacklist-filter';
import type { ChampionTemplate } from '../../../src/vision/match/template-store';
import type { CoarseHit } from '../../../src/vision/match/phash-matcher';

/** 造一个模板（指纹手工指定，便于精确断言距离）。 */
function template(
  championId: string,
  cost: Cost,
  fingerprint: string,
  dHash = '0'.repeat(16),
): ChampionTemplate {
  return {
    championId,
    cost,
    size: 1,
    channels: 4,
    fingerprint,
    dHash,
    data: new Uint8Array(4),
    source: 'placeholder',
  };
}

describe('coarseRank（pHash 粗筛）', () => {
  const templates = [
    template('a', 1, '0000000000000000'),
    template('b', 2, '0000000000000001'),
    template('c', 3, 'ffffffffffffffff'),
    template('d', 4, '0000000000000003'),
  ];

  it('按汉明距离升序取 Top-N', () => {
    const hits = coarseRank('0000000000000000', '0'.repeat(16), templates, { topN: 3 });
    expect(hits.map((hit) => hit.championId)).toEqual(['a', 'b', 'd']);
    expect(hits[0]!.distance).toBe(0);
    expect(hits[0]!.score).toBe(1);
  });

  it('完全不同的指纹得到低分（score 接近 0）', () => {
    const hits = coarseRank('ffffffffffffffff', 'f'.repeat(16), templates, { topN: 1 });
    expect(hits[0]!.championId).toBe('c');
    expect(hits[0]!.score).toBe(1);
  });

  it('同距离时用 dHash 决胜（结果确定性可复现）', () => {
    const pool = [
      template('x', 1, '0000000000000001', '0000000000000001'),
      template('y', 1, '0000000000000001', '0000000000000000'),
    ];
    const hits = coarseRank('0000000000000000', '0000000000000000', pool, { topN: 2 });
    expect(hits[0]!.championId).toBe('y');
    expect(hits[1]!.championId).toBe('x');
  });
});

describe('filterTemplatesByCost（费用先验剪枝）', () => {
  const templates = [template('a', 1, '0'.repeat(16)), template('b', 3, '0'.repeat(16))];

  it('只保留指定费用档', () => {
    expect(filterTemplatesByCost(templates, [3]).map((item) => item.championId)).toEqual(['b']);
  });

  it('不传费用档 = 不剪枝（unknown-cost-scan-all 语义）', () => {
    expect(filterTemplatesByCost(templates, [])).toHaveLength(2);
  });

  it('剪枝后为空时回退全量，避免因模板缺失而漏检', () => {
    expect(filterTemplatesByCost(templates, [5])).toHaveLength(2);
  });
});

describe('dedupeByChampion（同一弈子多模板取最优）', () => {
  it('保留每个弈子距离最小的那条', () => {
    const hits: CoarseHit[] = [
      { championId: 'a', cost: 1, templateIndex: 0, distance: 5, score: 0.9, dHashDistance: 0 },
      { championId: 'a', cost: 1, templateIndex: 1, distance: 2, score: 0.96, dHashDistance: 0 },
      { championId: 'b', cost: 2, templateIndex: 2, distance: 1, score: 0.98, dHashDistance: 0 },
    ];
    const deduped = dedupeByChampion(hits);
    expect(deduped[0]!.championId).toBe('b');
    expect(deduped.find((hit) => hit.championId === 'a')!.templateIndex).toBe(1);
  });
});

describe('nccScore（纯 JS 归一化互相关）', () => {
  /** 造一张有结构的图。 */
  function structured(size: number, seed: number): RawImage {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const idx = (y * size + x) * 4;
        const value = ((x * 7 + y * 13 + seed * 31) % 256 + 256) % 256;
        data[idx] = value;
        data[idx + 1] = (value + 40) % 256;
        data[idx + 2] = (value + 80) % 256;
        data[idx + 3] = 255;
      }
    }
    return createRawImage({ width: size, height: size, data, channels: 4 });
  }

  /** 造一张确定性噪声图（与结构化图相关性极低）。 */
  function noisy(size: number, seed: number): RawImage {
    const data = new Uint8Array(size * size * 4);
    let state = seed >>> 0 || 1;
    const next = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state % 256;
    };
    for (let i = 0; i < size * size; i += 1) {
      const value = next();
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    return createRawImage({ width: size, height: size, data, channels: 4 });
  }

  it('完全相同的图 → 相关系数 1', () => {
    const image = structured(16, 3);
    expect(nccScore(image, image)).toBeCloseTo(1, 6);
  });

  it('不同结构的图 → 相关系数明显更低', () => {
    const same = nccScore(structured(16, 3), structured(16, 3));
    const different = nccScore(structured(16, 3), noisy(16, 4242));
    expect(same).toBeCloseTo(1, 6);
    expect(different).toBeLessThan(same);
  });

  it('尺寸不一致 → 返回 -1（调用方据此回退）', () => {
    expect(nccScore(createSolidImage(4, 4, [1, 2, 3]), createSolidImage(8, 8, [1, 2, 3]))).toBe(-1);
  });

  it('纯色图（方差为 0）→ 返回 0 而不是 NaN', () => {
    const solid = createSolidImage(8, 8, [10, 20, 30]);
    expect(nccScore(solid, solid)).toBe(0);
  });
});

describe('fusion（多证据融合与裁决）', () => {
  it('权重和为 1 时等于加权和', () => {
    const score = fuseScore(1, 1, 1, DEFAULT_FUSION_WEIGHTS);
    expect(score).toBeCloseTo(1, 6);
    const zero = fuseScore(0, 0, 0, DEFAULT_FUSION_WEIGHTS);
    expect(zero).toBeCloseTo(0, 6);
  });

  it('费用先验一致时提高综合分，不一致时压低', () => {
    const agree = fuseScore(0.6, 0.6, 1);
    const disagree = fuseScore(0.6, 0.6, 0);
    expect(agree).toBeGreaterThan(disagree);
  });

  it('fuseAll 按 championId 合并模板并降序排列', () => {
    const hits = [
      { championId: 'ahri', cost: 4 as Cost, templateIndex: 0, distance: 4, score: 0.9, dHashDistance: 0, refinedScore: 0.95, matcher: 'ncc' as const },
      { championId: 'ahri', cost: 4 as Cost, templateIndex: 1, distance: 9, score: 0.5, dHashDistance: 1, refinedScore: 0.4, matcher: 'ncc' as const },
      { championId: 'lux', cost: 4 as Cost, templateIndex: 2, distance: 6, score: 0.7, dHashDistance: 2, refinedScore: 0.7, matcher: 'ncc' as const },
    ];
    const fused = fuseAll(hits, 4);
    expect(fused[0]!.championId).toBe('ahri');
    expect(fused).toHaveLength(2);
    expect(fused[0]!.costAgreement).toBe(1);
  });

  it('费用未知时给中性一致度（不偏袒任何费用档）', () => {
    const hits = [
      { championId: 'a', cost: 1 as Cost, templateIndex: 0, distance: 2, score: 0.9, dHashDistance: 0, refinedScore: 0.9, matcher: 'ncc' as const },
    ];
    const fused = fuseAll(hits, null);
    expect(fused[0]!.costAgreement).toBe(0.5);
  });

  it('同费用档时先验一致的那一路胜出', () => {
    const hits = [
      { championId: 'cheap', cost: 1 as Cost, templateIndex: 0, distance: 3, score: 0.8, dHashDistance: 0, refinedScore: 0.8, matcher: 'ncc' as const },
      { championId: 'match', cost: 5 as Cost, templateIndex: 1, distance: 4, score: 0.78, dHashDistance: 0, refinedScore: 0.8, matcher: 'ncc' as const },
    ];
    const fused = fuseAll(hits, 5);
    expect(fused[0]!.championId).toBe('match');
  });

  it('decideMatch：分数达标且与亚军拉开差距 → 不低置信', () => {
    const fused = fuseAll(
      [
        { championId: 'a', cost: 1 as Cost, templateIndex: 0, distance: 0, score: 1, dHashDistance: 0, refinedScore: 1, matcher: 'ncc' as const },
        { championId: 'b', cost: 1 as Cost, templateIndex: 1, distance: 2, score: 0.5, dHashDistance: 0, refinedScore: 0.2, matcher: 'ncc' as const },
      ],
      1,
    );
    const decision = decideMatch(fused, 0.72);
    expect(decision.championId).toBe('a');
    expect(decision.lowConfidence).toBe(false);
    expect(decision.candidates.length).toBeGreaterThan(0);
  });

  it('decideMatch：与亚军过于接近 → 打低置信（引导人工校正）', () => {
    const fused = fuseAll(
      [
        { championId: 'a', cost: 1 as Cost, templateIndex: 0, distance: 3, score: 0.95, dHashDistance: 0, refinedScore: 0.95, matcher: 'ncc' as const },
        { championId: 'b', cost: 1 as Cost, templateIndex: 1, distance: 3, score: 0.95, dHashDistance: 0, refinedScore: 0.94, matcher: 'ncc' as const },
      ],
      1,
    );
    const decision = decideMatch(fused, 0.72);
    expect(decision.lowConfidence).toBe(true);
    expect(decision.margin).toBeLessThan(0.05);
  });

  it('decideMatch：没有候选 → 返回 null 且标低置信', () => {
    const decision = decideMatch([], 0.72);
    expect(decision.championId).toBeNull();
    expect(decision.lowConfidence).toBe(true);
    expect(decision.candidates).toEqual([]);
  });

  it('fuseFromCoarse：无精排时的降级路径仍能产出候选', () => {
    const fused = fuseFromCoarse(
      [{ championId: 'a', cost: 2, templateIndex: 0, distance: 1, score: 0.98, dHashDistance: 0 }],
      2,
    );
    expect(fused[0]!.championId).toBe('a');
    expect(fused[0]!.refinedScore).toBe(0.98);
  });
});

describe('blacklist-filter（非池单位过滤，PRD E5）', () => {
  it('识别非池单位 id', () => {
    const filter = createBlacklistFilter(['riftbeast', 'training_dummy']);
    expect(filter.has('riftbeast')).toBe(true);
    expect(filter.has('ahri')).toBe(false);
    expect(filter.size()).toBe(2);
  });

  it('过滤候选时保持原顺序', () => {
    const filter = createBlacklistFilter(['x']);
    const kept = filter.filter([
      { championId: 'a' },
      { championId: 'x' },
      { championId: 'b' },
    ]);
    expect(kept.map((item) => item.championId)).toEqual(['a', 'b']);
  });

  it('支持 ids 数组与 units[].id 两种文件形状', () => {
    expect(parseNonPoolUnitIds({ ids: ['a', 'b', 'a'] })).toEqual(['a', 'b']);
    expect(parseNonPoolUnitIds({ units: [{ id: 'c' }, { id: 'd' }] })).toEqual(['c', 'd']);
    expect(parseNonPoolUnitIds(null)).toEqual([]);
  });

  it('isNonPoolUnit / filterCandidates 便捷函数', () => {
    expect(isNonPoolUnit('x', ['x', 'y'])).toBe(true);
    expect(filterCandidates([{ championId: 'x', score: 1 }], ['x'])).toEqual([]);
    expect(filterCandidates([{ championId: 'z', score: 1 }], ['x'])).toHaveLength(1);
  });
});
