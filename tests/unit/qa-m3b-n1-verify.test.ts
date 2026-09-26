/**
 * QA 第三轮独立复核 —— M3b（单一事实来源）与 N1（步骤 3b 几何口径）。
 *
 * 背景：一审提出 M3b（渲染层 `distanceToThreeStar` 硬编码 9、core 修的函数无调用点）
 * 与 N1（步骤 3b 线性外推）。工程师采纳方案：
 * - M3b：`STAR_COPY_COST` 下沉到 `@shared/constants` 作为唯一来源，core 与 renderer 共用；
 * - N1：步骤 3b 改为「精确格位（`mergedSlotIndices`）优先 + 几何 fallback」双路径。
 *
 * 本文件独立验证其**结构与行为**，并明确记录 fallback 路径的**已知残留**边界。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PoolBaseline, Star } from '../../src/shared/types/domain';
import { STAR_COPY_COST } from '../../src/shared/constants';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import { copiesOf } from '../../src/core/pool-engine/star-copies';
import { applyScan, createLedgerState } from '../../src/core/ledger/ledger-store';
import { copiesToThreeStar } from '../../src/core/ledger/selectors';
import { loadBaseline } from '../../src/core/baseline/load-baseline';
import { applyMultiCellHints } from '../../src/vision/match/multi-cell';
import { distanceToThreeStar } from '../../src/renderer/utils/format';
import { loadTestBaseline, makeScan, PROJECT_ROOT } from '../helpers/goldens';
import { ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
let rawBaseline: Record<string, unknown>;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const COLS = 7;
const SRC = resolve(PROJECT_ROOT, 'src');

beforeAll(() => {
  baseline = loadTestBaseline();
  rawBaseline = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'data', 'pool-baseline.json'), 'utf8'),
  ) as Record<string, unknown>;
});

/** 棋盘坐标 → 线性槽位索引（7 列）。 */
function slotAt(row: number, col: number): number {
  return row * COLS + col;
}

/** 递归收集目录下所有 .ts/.tsx 源文件。 */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** 用给定基数重建基线。 */
function withStarCost(cost3: number): PoolBaseline {
  const clone = JSON.parse(JSON.stringify(rawBaseline)) as { star_copy_cost: Record<string, number> };
  clone.star_copy_cost['3'] = cost3;
  const result = loadBaseline(clone);
  if (!result.ok || !result.baseline) {
    throw new Error('重建基线失败');
  }
  return result.baseline;
}

/** 构造一个已应用过一次扫描的台账状态。 */
function stateAfter(observations: Parameters<typeof makeScan>[1]) {
  return applyScan(createLedgerState(0), makeScan(0, observations), baseline, { now: 0 });
}

// ============================================================================
// M3b —— 单一事实来源
// ============================================================================

describe('M3b 复核：STAR_COPY_COST 单一事实来源', () => {
  it('shared/constants 导出的表为 {1:1, 2:3, 3:9, 4:9}', () => {
    expect(STAR_COPY_COST).toEqual({ 1: 1, 2: 3, 3: 9, 4: 9 });
  });

  it('core 的 copiesOf 在基线缺失时回退到该表（逐档一致）', () => {
    for (const star of [1, 2, 3, 4] as Star[]) {
      expect(copiesOf(star, undefined)).toBe(STAR_COPY_COST[star]);
    }
  });

  it('core 的 loadBaseline 对缺失/非法档位回退到该表', () => {
    // 注意：schema 要求 star_copy_cost 必含 "1"/"2"/"3"，整体删除会触发 BASE_SCHEMA_FAIL，
    // 故这里用「缺失可选的 4 档」+「非法的 0 值」来触发归一化的回退分支。
    const clone = JSON.parse(JSON.stringify(rawBaseline)) as {
      star_copy_cost: Record<string, number>;
    };
    delete clone.star_copy_cost['4'];
    clone.star_copy_cost['3'] = 0;

    const result = loadBaseline(clone);
    expect(result.ok).toBe(true);
    expect(result.baseline!.starCopyCost[4]).toBe(STAR_COPY_COST[4]);
    expect(result.baseline!.starCopyCost[3]).toBe(STAR_COPY_COST[3]);
    expect(result.baseline!.starCopyCost[1]).toBe(1);
    expect(result.baseline!.starCopyCost[2]).toBe(3);
  });

  it('运行时基线仍优先于常量（未被"单一来源"反向遮蔽）', () => {
    const tweaked = withStarCost(27);
    expect(tweaked.starCopyCost[3]).toBe(27);
    expect(copiesOf(3, tweaked)).toBe(27);
    // 其余档位仍回落常量
    expect(copiesOf(1, tweaked)).toBe(STAR_COPY_COST[1]);
  });

  it('HUD 与 core 在默认基线下结果一致', () => {
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline), 'ahri');
    expect(copiesToThreeStar(row, baseline)).toBe(distanceToThreeStar(row));
    expect(distanceToThreeStar(row)).toBe(STAR_COPY_COST[3]);
  });

  it('渲染层 distanceToThreeStar 已引用常量，不再出现 9 的字面量运算', () => {
    const formatSource = readFileSync(resolve(SRC, 'renderer', 'utils', 'format.ts'), 'utf8');
    expect(formatSource).toContain('STAR_COPY_COST');
    expect(formatSource).toContain('STAR_COPY_COST[3]');
    // 不得再出现 `9 - mine` 这类硬编码运算
    expect(/\b9\s*-\s*mine\b/.test(formatSource)).toBe(false);
    expect(/Math\.max\(0,\s*9\b/.test(formatSource)).toBe(false);
  });

  it('全 src 已无 FALLBACK_STAR_COPY_COST 重复定义', () => {
    const offenders = collectSources(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('FALLBACK_STAR_COPY_COST'),
    );
    expect(offenders).toEqual([]);
  });

  it('引用 STAR_COPY_COST 的文件覆盖 core + renderer + shared 三处', () => {
    const refs = collectSources(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('STAR_COPY_COST'),
    );
    const names = refs.map((file) => file.replace(SRC, '').replace(/\\/g, '/'));
    expect(names).toContain('/shared/constants.ts');
    expect(names).toContain('/core/pool-engine/star-copies.ts');
    expect(names).toContain('/core/baseline/load-baseline.ts');
    expect(names).toContain('/renderer/utils/format.ts');
  });
});

describe('M3b 残留边界（已在报告中如实记录）', () => {
  it('渲染层无法感知"运行时基线覆盖"：改基线 3★ 后 core 跟随、HUD 仍按常量', () => {
    const tweaked = withStarCost(27);
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), tweaked), 'ahri');

    expect(copiesToThreeStar(row, tweaked)).toBe(27); // core 跟随基线
    expect(distanceToThreeStar(row)).toBe(9); // HUD 无基线入参 → 仍 9
  });

  it('默认基线下两者一致，故当前无用户可见偏差', () => {
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline), 'ahri');
    expect(copiesToThreeStar(row, baseline)).toBe(distanceToThreeStar(row));
  });
});

// ============================================================================
// N1 —— 步骤 3b 几何口径
// ============================================================================

describe('N1 复核：步骤 3b 精确路径（mergedSlotIndices）', () => {
  it('水平：精确格位 [11] 的旧单格实例被清理，只留 1 个 span=2 实例', () => {
    let state = stateAfter([{ zone: 'board', slotIndex: 10, championId: 'elderdragon' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 10, championId: 'elderdragon', slotSpan: 2, mergedSlotIndices: [11] }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(Object.keys(slots)).toEqual(['0|board|10']);
    expect(Object.values(slots)[0]!.slotSpan).toBe(2);
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(1);
  });

  it('竖向：精确格位 [13]（竖排格）被清理，且 slot 1 未被误动', () => {
    let state = stateAfter([
      { zone: 'board', slotIndex: slotAt(0, 6), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: 1, championId: 'ahri' },
    ]);

    state = applyScan(
      state,
      makeScan(
        0,
        [
          {
            zone: 'board',
            slotIndex: slotAt(0, 6),
            championId: 'elderdragon',
            slotSpan: 2,
            mergedSlotIndices: [slotAt(1, 0)],
          },
        ],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    // 竖向被并入格 13 已清理
    expect(slots['0|board|13']).toBeUndefined();
    expect(slots['0|board|6']).toBeDefined();
    // 邻近的无关格 slot 1 未被误删
    expect(slots['0|board|1']).toBeDefined();
  });
});

describe('N1 复核：步骤 3b fallback 路径（仅 slotSpan）', () => {
  it('水平：slotSpan=2 于 slot 0 → 覆盖格按几何推为 [1]，旧实例被清理', () => {
    let state = stateAfter([{ zone: 'board', slotIndex: 1, championId: 'elderdragon' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 0, championId: 'elderdragon', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(Object.keys(slots)).toEqual(['0|board|0']);
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(1);
  });

  it('行末转竖向：slotSpan=2 于 slot 6（row0col6）→ 覆盖格为 [13]，旧实例被清理', () => {
    let state = stateAfter([{ zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: slotAt(0, 6), championId: 'elderdragon', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(slots['0|board|13']).toBeUndefined();
    expect(slots['0|board|6']).toBeDefined();
  });

  it('守卫：覆盖格上是**其他弈子**的单格实例 → 不清理（不误删）', () => {
    let state = stateAfter([{ zone: 'board', slotIndex: 1, championId: 'ahri' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 0, championId: 'elderdragon', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(slots['0|board|1']).toBeDefined();
    expect(slots['0|board|1']!.championId).toBe('ahri');
  });

  it('守卫：覆盖格上是**同弈子但已是多格**的实例 → 不清理（那是另一只巨龙）', () => {
    // 先在 slot 1 造一个 span=2 的巨龙实例
    let state = applyScan(
      createLedgerState(0),
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 1, championId: 'elderdragon', slotSpan: 2, mergedSlotIndices: [2] }],
        { scanId: 's1', at: 0 },
      ),
      baseline,
      { now: 0 },
    );
    expect(Object.values(state.ledgers.find((l) => l.seat === 0)!.slots)[0]!.slotSpan).toBe(2);

    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 0, championId: 'elderdragon', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(slots['0|board|1']).toBeDefined();
    expect(slots['0|board|1']!.slotSpan).toBe(2);
  });

  it('提示：fallback 是"横向优先"启发式 —— 竖向巨龙若缺精确格位会漏清（已知残留，管线不可达）', () => {
    // slot 0 与 slot 7 是竖向相邻；若只是一只竖排巨龙且视觉层未给精确格位，
    // fallback 会推为横向 [1]，导致 slot 7 的残留未被清理 → 多计 1 张。
    let state = stateAfter([{ zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(slots['0|board|7']).toBeDefined(); // 残留仍在（记录该边界）
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(2);
  });

  it('该残留不可达：视觉层对合并的多格实例总会写入 mergedSlotIndices（含竖向）', () => {
    const vertical = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' },
    ]).observations;

    const outcome = applyMultiCellHints(vertical, {}, new Map([['elderdragon', 2]]));
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.observations[0]!.slotSpan).toBe(2);
    expect(outcome.observations[0]!.mergedSlotIndices).toEqual([slotAt(1, 0)]);
    // 有精确格位 → 走步骤 3b 的 (a) 路径，fallback 不会参与
  });

  it('普通弈子（teamSlots=1）不参与步骤 3b 清理', () => {
    let state = stateAfter([{ zone: 'board', slotIndex: 1, championId: 'ahri' }]);
    state = applyScan(
      state,
      makeScan(
        0,
        [{ zone: 'board', slotIndex: 0, championId: 'ahri', slotSpan: 2 }],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );
    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(slots['0|board|1']).toBeDefined();
  });
});

describe('N1 澄清：引擎侧 mergeAdjacentSlots 路径由「步骤 3 droppedSlotIndex」精确清理', () => {
  /**
   * 工程师指出：引擎侧 `mergeAdjacentSlots`（视觉层漏并时的保险）只写 `slotSpan`、
   * **不写 `mergedSlotIndices`**，因此其 kept 观测会走步骤 3b 的 fallback。
   * 本组用例澄清：被并入格的清理实际由**步骤 3**（按 `droppedSlotIndex` 精确删除）
   * 完成，不依赖 fallback，故**不会重复计数**（横向/竖向均成立）。
   */
  it('同帧竖向两格（0 与 7）被引擎合并为一只 → observedCopies = 1（不重复计数）', () => {
    const state = applyScan(
      createLedgerState(0),
      makeScan(0, [
        { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
        { zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' },
      ]),
      baseline,
      { now: 0 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(Object.keys(slots)).toEqual(['0|board|0']);
    expect(Object.values(slots)[0]!.slotSpan).toBe(2);
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(1);
  });

  it('被并入格上的旧实例由「步骤 3」精确删除（竖向 7 格），与 fallback 无关', () => {
    // 上一帧已有 slot 7 的单格实例；本帧视觉层漏并、由引擎合并 0 与 7
    let state = stateAfter([{ zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' }]);
    expect(state.ledgers.find((l) => l.seat === 0)!.slots['0|board|7']).toBeDefined();

    state = applyScan(
      state,
      makeScan(
        0,
        [
          { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
          { zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' },
        ],
        { scanId: 's2', at: 1000 },
      ),
      baseline,
      { now: 1000 },
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    // 竖排被并入格（7）被精确清除 → 不重复计数
    expect(slots['0|board|7']).toBeUndefined();
    expect(slots['0|board|0']).toBeDefined();
    expect(Object.values(slots)[0]!.slotSpan).toBe(2);
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(1);
  });

  it('同帧横向两格（12/13）同样精确清理 → 1 张', () => {
    const state = applyScan(
      createLedgerState(0),
      makeScan(0, [
        { zone: 'board', slotIndex: slotAt(1, 5), championId: 'elderdragon' },
        { zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon' },
      ]),
      baseline,
      { now: 0 },
    );
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(1);
  });

  it('跨行边界 13/14 不被引擎合并 → 2 张（回归 M1）', () => {
    const state = applyScan(
      createLedgerState(0),
      makeScan(0, [
        { zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon' },
        { zone: 'board', slotIndex: slotAt(2, 0), championId: 'elderdragon' },
      ]),
      baseline,
      { now: 0 },
    );
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(2);
  });
});
