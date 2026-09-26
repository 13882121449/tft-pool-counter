/**
 * QA 独立复核 —— M1 / M2 / M3 修复验证（严过关 / QA 一审）。
 *
 * 与 `qa2-m1m3-regression.test.ts`（QA 二审）相互独立：本文件以**一审原报缺陷的
 * 精确复现**为基准，并额外覆盖二审未涉及的角度：
 * - M1：竖向相邻、`geometry` 覆盖生效性、3 只巨龙不越界并合；
 * - M2：`applyMultiCellHints` 直接单测 + dedup「步骤 3b」旧实例清理 + 竖向合并；
 * - M3：`copiesToThreeStar` 读基线 + 签名变更后的调用安全性；
 * - M3b：**渲染层实际在用的** `distanceToThreeStar` 仍硬编码 9（发散记录）。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolBaseline, Star } from '../../src/shared/types/domain';
import { computeRemaining } from '../../src/core/pool-engine/compute-remaining';
import {
  colsForZone,
  DEFAULT_BENCH_COLS,
  DEFAULT_BOARD_COLS,
  DEFAULT_SHOP_COLS,
  isOrthogonallyAdjacent,
  toRowCol,
} from '../../src/core/pool-engine/slot-geometry';
import { copiesOf } from '../../src/core/pool-engine/star-copies';
import { applyScan, createLedgerState } from '../../src/core/ledger/ledger-store';
import { copiesToThreeStar } from '../../src/core/ledger/selectors';
import { loadBaseline } from '../../src/core/baseline/load-baseline';
import { applyMultiCellHints } from '../../src/vision/match/multi-cell';
import { distanceToThreeStar } from '../../src/renderer/utils/format';
import { loadTestBaseline, makeScan, PROJECT_ROOT } from '../helpers/goldens';
import { inst, ledgersOf, rowOf } from '../helpers/qa-builders';

let baseline: PoolBaseline;
let rawBaseline: Record<string, unknown>;
const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const COLS = 7;

beforeAll(() => {
  baseline = loadTestBaseline();
  rawBaseline = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'data', 'pool-baseline.json'), 'utf8'),
  ) as Record<string, unknown>;
});

/** 棋盘坐标 → 线性槽位索引（7 列）。 */
function slotAt(row: number, col: number, cols = COLS): number {
  return row * cols + col;
}

/** 构造 elderdragon 观测。 */
function dragonAt(seat: number, slotIndex: number, star: Star = 1, slotSpan?: number) {
  return inst({ championId: 'elderdragon', seat, star, slotIndex, slotSpan }, baseline);
}

/** 取某弈子的 observedCopies。 */
function observedOf(instances: ReturnType<typeof inst>[], championId: string): number {
  return rowOf(computeRemaining(ledgersOf(instances, { scannedSeats: ALL }), baseline), championId)
    .observedCopies;
}

// ============================================================================
// M1 —— 二维几何相邻
// ============================================================================

describe('M1 复核：slot-geometry 纯函数', () => {
  it('默认列数为 7 / 8 / 5，且可被覆盖', () => {
    expect(DEFAULT_BOARD_COLS).toBe(7);
    expect(DEFAULT_BENCH_COLS).toBe(8);
    expect(DEFAULT_SHOP_COLS).toBe(5);
    expect(colsForZone('board')).toBe(7);
    expect(colsForZone('bench')).toBe(8);
    expect(colsForZone('shop')).toBe(5);
    expect(colsForZone('board', { board: 6 })).toBe(6);
    // 非法值回退默认
    expect(colsForZone('board', { board: 0 })).toBe(7);
    expect(colsForZone('board', { board: -3 })).toBe(7);
    expect(colsForZone('board', { board: 2.5 })).toBe(7);
  });

  it('toRowCol 还原二维坐标（7 列）', () => {
    expect(toRowCol(0, 7)).toEqual({ row: 0, col: 0 });
    expect(toRowCol(6, 7)).toEqual({ row: 0, col: 6 });
    expect(toRowCol(7, 7)).toEqual({ row: 1, col: 0 });
    expect(toRowCol(13, 7)).toEqual({ row: 1, col: 6 });
    expect(toRowCol(14, 7)).toEqual({ row: 2, col: 0 });
    expect(toRowCol(27, 7)).toEqual({ row: 3, col: 6 });
  });

  it('isOrthogonallyAdjacent：水平/垂直为真，跨行边界与自身为假', () => {
    // 水平相邻
    expect(isOrthogonallyAdjacent(12, 13, 7)).toBe(true);
    expect(isOrthogonallyAdjacent(13, 12, 7)).toBe(true);
    // 垂直相邻（同一列、相邻行）
    expect(isOrthogonallyAdjacent(0, 7, 7)).toBe(true);
    expect(isOrthogonallyAdjacent(6, 13, 7)).toBe(true);
    // 跨行边界：线性差 1 但空间不相邻 —— M1 的核心
    expect(isOrthogonallyAdjacent(13, 14, 7)).toBe(false);
    expect(isOrthogonallyAdjacent(6, 7, 7)).toBe(false);
    expect(isOrthogonallyAdjacent(20, 21, 7)).toBe(false);
    // 同一格
    expect(isOrthogonallyAdjacent(5, 5, 7)).toBe(false);
    // 对角 / 远离
    expect(isOrthogonallyAdjacent(0, 8, 7)).toBe(false);
    expect(isOrthogonallyAdjacent(0, 14, 7)).toBe(false);
  });
});

describe('M1 复核：跨行边界不再误合并', () => {
  it('原报缺陷 13↔14（row1col6 / row2col0）→ 2 张（修复前为 1）', () => {
    const rows = computeRemaining(
      ledgersOf([dragonAt(0, slotAt(1, 6)), dragonAt(0, slotAt(2, 0))], { scannedSeats: ALL }),
      baseline,
    );
    const row = rowOf(rows, 'elderdragon');
    expect(row.observedCopies).toBe(2);
    expect(row.remaining).toBe(7);
  });

  it('同类跨行边界 6↔7 与 20↔21 → 各 2 张', () => {
    expect(observedOf([dragonAt(0, slotAt(0, 6)), dragonAt(0, slotAt(1, 0))], 'elderdragon')).toBe(2);
    expect(observedOf([dragonAt(0, slotAt(2, 6)), dragonAt(0, slotAt(3, 0))], 'elderdragon')).toBe(2);
  });

  it('水平相邻 12↔13 → 1 张', () => {
    expect(observedOf([dragonAt(0, slotAt(1, 5)), dragonAt(0, slotAt(1, 6))], 'elderdragon')).toBe(1);
  });

  it('竖向相邻 0↔7 / 6↔13 → 各 1 张（几何相邻含垂直，M1 新增能力）', () => {
    expect(observedOf([dragonAt(0, slotAt(0, 0)), dragonAt(0, slotAt(1, 0))], 'elderdragon')).toBe(1);
    expect(observedOf([dragonAt(0, slotAt(0, 6)), dragonAt(0, slotAt(1, 6))], 'elderdragon')).toBe(1);
  });

  it('3 只水平连续巨龙（0/1/2）→ 不越界并合，计 2 张', () => {
    // teamSlots=2 ⇒ 至多 2 格并成 1 只；第 3 格属于另一只
    expect(
      observedOf(
        [dragonAt(0, slotAt(0, 0)), dragonAt(0, slotAt(0, 1)), dragonAt(0, slotAt(0, 2))],
        'elderdragon',
      ),
    ).toBe(2);
  });

  it('4 只两两相邻（0,1 + 7,8）→ 2 张（每只各占 2 格）', () => {
    expect(
      observedOf(
        [
          dragonAt(0, slotAt(0, 0)),
          dragonAt(0, slotAt(0, 1)),
          dragonAt(0, slotAt(0, 2)),
          dragonAt(0, slotAt(0, 3)),
        ],
        'elderdragon',
      ),
    ).toBe(2);
  });

  it('备战席 0↔1 → 1 张（bench 单行 8 格）', () => {
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: 0, zone: 'bench' }, baseline),
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: 1, zone: 'bench' }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(1);
  });

  it('geometry 覆盖真实生效：6 列棋盘下 5↔6 变成跨行边界 → 2 张', () => {
    const instances = [dragonAt(0, 5), dragonAt(0, 6)];

    // 默认 7 列：5=row0col5, 6=row0col6 → 水平相邻 → 1 张
    const withDefault = computeRemaining(
      ledgersOf(instances, { scannedSeats: ALL }),
      baseline,
    );
    expect(rowOf(withDefault, 'elderdragon').observedCopies).toBe(1);

    // 覆盖为 6 列：5=row0col5, 6=row1col0 → 跨行 → 2 张
    const withSix = computeRemaining(ledgersOf(instances, { scannedSeats: ALL }), baseline, {}, {
      geometry: { board: 6 },
    });
    expect(rowOf(withSix, 'elderdragon').observedCopies).toBe(2);
  });

  it('不同星级 / 不同家 / 不同区域不合并', () => {
    expect(
      observedOf([dragonAt(0, slotAt(0, 0), 1), dragonAt(0, slotAt(0, 1), 2)], 'elderdragon'),
    ).toBe(1 + 3);
    const rows = computeRemaining(
      ledgersOf(
        [
          inst({ championId: 'elderdragon', seat: 0, star: 1, slotIndex: 0 }, baseline),
          inst({ championId: 'elderdragon', seat: 1, star: 1, slotIndex: 1 }, baseline),
        ],
        { scannedSeats: ALL },
      ),
      baseline,
    );
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(2);
  });

  it('普通弈子（teamSlots=1）永不因相邻而合并', () => {
    const normal = baseline.champions.find(
      (champion) => champion.cost === 1 && (champion.special?.teamSlots ?? 1) === 1,
    )!;
    expect(
      observedOf(
        [
          inst({ championId: normal.id, seat: 0, star: 1, slotIndex: slotAt(0, 0) }, baseline),
          inst({ championId: normal.id, seat: 0, star: 1, slotIndex: slotAt(0, 1) }, baseline),
          inst({ championId: normal.id, seat: 0, star: 1, slotIndex: slotAt(0, 2) }, baseline),
        ],
        normal.id,
      ),
    ).toBe(3);
  });
});

// ============================================================================
// M2 —— slotSpan 接线
// ============================================================================

describe('M2 复核：识别层 applyMultiCellHints', () => {
  it('水平相邻两只巨龙观测 → 合并为 1 条并写 slotSpan=2', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(0, 1), championId: 'elderdragon' },
    ]).observations;

    const outcome = applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(outcome.merged).toHaveLength(1);
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.observations[0]!.slotIndex).toBe(slotAt(0, 0));
    expect(outcome.observations[0]!.slotSpan).toBe(2);
  });

  it('竖向相邻同样合并（几何口径一致）', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(1, 0), championId: 'elderdragon' },
    ]).observations;
    const outcome = applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(outcome.observations).toHaveLength(1);
    expect(outcome.observations[0]!.slotSpan).toBe(2);
  });

  it('跨行边界 13↔14 不合并', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(2, 0), championId: 'elderdragon' },
    ]).observations;
    const outcome = applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
    expect(outcome.observations.every((o) => (o.slotSpan ?? 1) === 1)).toBe(true);
  });

  it('3 格连续观测：受 teamSlots=2 上限约束，产出 2 条（span 2 + span 1）', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(0, 1), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(0, 2), championId: 'elderdragon' },
    ]).observations;
    const outcome = applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(outcome.observations).toHaveLength(2);
    const spans = outcome.observations.map((o) => o.slotSpan ?? 1).sort();
    expect(spans).toEqual([1, 2]);
  });

  it('teamSlots 表不含该弈子时不合并（普通弈子不受影响）', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'ahri' },
      { zone: 'board', slotIndex: slotAt(0, 1), championId: 'ahri' },
    ]).observations;
    const outcome = applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(outcome.merged).toHaveLength(0);
    expect(outcome.observations).toHaveLength(2);
  });

  it('不修改入参观测对象', () => {
    const observations = makeScan(0, [
      { zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon' },
      { zone: 'board', slotIndex: slotAt(0, 1), championId: 'elderdragon' },
    ]).observations;
    const snapshot = JSON.stringify(observations);
    applyMultiCellHints(observations, {}, new Map([['elderdragon', 2]]));
    expect(JSON.stringify(observations)).toBe(snapshot);
  });
});

describe('M2 复核：引擎侧 slotSpan 全程贯通与步骤 3b 清理', () => {
  it('applyScan 写入 slotSpan=2 的实例，只计 1 张', () => {
    let state = createLedgerState(0);
    state = applyScan(
      state,
      makeScan(0, [{ zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon', slotSpan: 2 }]),
      baseline,
    );

    const instances = Object.values(state.ledgers.find((l) => l.seat === 0)!.slots);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.slotSpan).toBe(2);

    const rows = computeRemaining(state.ledgers, baseline);
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(1);
  });

  it('步骤 3b：span>1 观测会清掉被覆盖格上的旧单格实例（防重复计数）', () => {
    let state = createLedgerState(0);
    // 第一帧：只看到 slot 1（单格）
    state = applyScan(
      state,
      makeScan(0, [{ zone: 'board', slotIndex: slotAt(0, 1), championId: 'elderdragon' }], {
        scanId: 's1',
      }),
      baseline,
    );
    expect(Object.keys(state.ledgers.find((l) => l.seat === 0)!.slots)).toHaveLength(1);

    // 第二帧：识别层已判决这是占 0-1 两格的同一只巨龙（slotSpan=2）
    state = applyScan(
      state,
      makeScan(0, [{ zone: 'board', slotIndex: slotAt(0, 0), championId: 'elderdragon', slotSpan: 2 }], {
        scanId: 's2',
        at: 1000,
      }),
      baseline,
    );

    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    // 旧实例（slot 1）已被清理，只剩 slot 0 的 span 实例
    expect(Object.keys(slots)).toEqual(['0|board|0']);
    expect(Object.values(slots)[0]!.slotSpan).toBe(2);

    const rows = computeRemaining(state.ledgers, baseline);
    expect(rowOf(rows, 'elderdragon').observedCopies).toBe(1);
  });

  it('dedup 侧几何合并（第二道保险）：两格相邻观测 → 1 个实例', () => {
    let state = createLedgerState(0);
    state = applyScan(
      state,
      makeScan(0, [
        { zone: 'board', slotIndex: slotAt(1, 5), championId: 'elderdragon' },
        { zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon' },
      ]),
      baseline,
    );
    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(Object.keys(slots)).toHaveLength(1);
    expect(Object.values(slots)[0]!.slotSpan).toBe(2);
  });

  it('dedup 侧不误并跨行边界 13↔14', () => {
    let state = createLedgerState(0);
    state = applyScan(
      state,
      makeScan(0, [
        { zone: 'board', slotIndex: slotAt(1, 6), championId: 'elderdragon' },
        { zone: 'board', slotIndex: slotAt(2, 0), championId: 'elderdragon' },
      ]),
      baseline,
    );
    const slots = state.ledgers.find((l) => l.seat === 0)!.slots;
    expect(Object.keys(slots)).toHaveLength(2);
    expect(rowOf(computeRemaining(state.ledgers, baseline), 'elderdragon').observedCopies).toBe(2);
  });

  it('ApplyScanOptions.geometry 覆盖生效（4 列棋盘下 3↔4 变为跨行）', () => {
    const observations = [
      { zone: 'board' as const, slotIndex: 3, championId: 'elderdragon' },
      { zone: 'board' as const, slotIndex: 4, championId: 'elderdragon' },
    ];

    const withDefault = applyScan(createLedgerState(0), makeScan(0, observations), baseline);
    expect(
      Object.keys(withDefault.ledgers.find((l) => l.seat === 0)!.slots),
    ).toHaveLength(1);

    const withFour = applyScan(createLedgerState(0), makeScan(0, observations), baseline, {
      geometry: { board: 4 },
    });
    expect(Object.keys(withFour.ledgers.find((l) => l.seat === 0)!.slots)).toHaveLength(2);
  });
});

// ============================================================================
// M3 —— 去硬编码
// ============================================================================

describe('M3 复核：copiesToThreeStar 读基线', () => {
  it('默认基线：3★ 需要 9 张', () => {
    const rows = computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline);
    const row = rowOf(rows, 'ahri');
    expect(copiesToThreeStar(row, baseline)).toBe(9 - (row.bySeat[0] ?? 0));
  });

  it('自定义 starCopyCost[3]=27 时同步变化（证明读的是基线而非硬编码）', () => {
    const clone = JSON.parse(JSON.stringify(rawBaseline)) as { star_copy_cost: Record<string, number> };
    clone.star_copy_cost['3'] = 27;
    const tweaked = loadBaseline(clone).baseline!;
    expect(copiesOf(3, tweaked)).toBe(27);

    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), tweaked), 'ahri');
    expect(copiesToThreeStar(row, tweaked)).toBe(27);
  });

  it('基线缺省时回退兜底表（9），旧单参用法仍可用', () => {
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline), 'ahri');
    expect(copiesToThreeStar(row)).toBe(9);
    expect(copiesToThreeStar(row, undefined, 0)).toBe(9);
    expect(copiesOf(3, undefined)).toBe(9);
  });

  it('已持有 9 张（3★）时返回 0，不为负', () => {
    const rows = computeRemaining(
      ledgersOf([inst({ championId: 'ahri', seat: 0, star: 3, slotIndex: 0 }, baseline)], {
        scannedSeats: ALL,
      }),
      baseline,
    );
    expect(copiesToThreeStar(rowOf(rows, 'ahri'), baseline)).toBe(0);
  });

  it('⚠️ 签名变更提示：第 2 参已改为 baseline，旧「传座位号」用法会静默失效', () => {
    // 记录当前契约：第 2 个位置参数是 baseline，不是 mySeat。
    // 若误传数字（旧用法），copiesOf 会拿不到 starCopyCost 而回退 9 —— 静默错误。
    // 当前 src/ 无生产调用点（仅测试），故无实际影响，仅作契约留痕。
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline), 'ahri');
    expect(copiesToThreeStar(row, baseline, 0)).toBe(9);
    expect(typeof copiesToThreeStar(row, baseline)).toBe('number');
  });
});

describe('M3b 复核（第三轮）：重复定义已消除，残留仅"渲染层无法感知运行时基线覆盖"', () => {
  /**
   * 一审曾报 M3b：M3 修好的 `copiesToThreeStar` 无生产调用点，
   * HUD 实际用的 `src/renderer/utils/format.ts:distanceToThreeStar` 仍写死 9。
   *
   * 工程师已采纳"把换算表下沉到 @shared/constants 的 STAR_COPY_COST 作为唯一来源"，
   * 三处（shared / core / renderer）共用同一张表 —— **重复定义已消除**。
   *
   * 仍存在的**残留边界**：`distanceToThreeStar(row)` 无 baseline 入参，
   * 因此当运行时基线覆盖 star_copy_cost 时，HUD 仍按常量表显示（见下一条）。
   * 该边界已在 docs/QA-REVIEW-T02.md 如实记录，默认基线下无用户可见偏差。
   */
  it('重复定义已消除：core 与 HUD 默认基线下结果一致（均为 STAR_COPY_COST[3]）', () => {
    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), baseline), 'ahri');
    expect(copiesToThreeStar(row, baseline)).toBe(9);
    expect(distanceToThreeStar(row)).toBe(9);
  });

  it('残留边界：基线被覆盖时 core 跟随，而 HUD 无 baseline 入参故仍按常量', () => {
    const clone = JSON.parse(JSON.stringify(rawBaseline)) as { star_copy_cost: Record<string, number> };
    clone.star_copy_cost['3'] = 27;
    const tweaked = loadBaseline(clone).baseline!;

    const row = rowOf(computeRemaining(ledgersOf([], { scannedSeats: ALL }), tweaked), 'ahri');
    // core 正确跟随基线
    expect(copiesToThreeStar(row, tweaked)).toBe(27);
    // 渲染层仍按共享常量表（9）—— 已知残留，非重复定义问题
    expect(distanceToThreeStar(row)).toBe(9);
  });
});
