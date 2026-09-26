/**
 * 台账宿主（main 进程）单测 —— 聚焦 `ensureSnapshot()` 的**非破坏性**语义。
 *
 * 背景（本轮整改）：启动流程原本用 `runtime.getSnapshot() ?? runtime.reset()`
 * 来拿"首帧快照"，但 `reset()` 会把台账整个换新 —— 如果本次启动刚刚
 * `restore()` 过上一局的落盘台账，这一下就把它抹掉了（"恢复上一局"形同虚设）。
 * 修复方式是新增只读的 `ensureSnapshot()`。
 *
 * 为了让本用例保持"零 electron 依赖"（与仓库既有测试纪律一致），
 * 这里 mock 掉 ledger-runtime 间接依赖的两个本仓模块，而不是 mock electron 包。
 */

import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/store/paths', () => ({
  dataDir: () => process.cwd(),
}));

const logged: string[] = [];
vi.mock('../../../src/main/system/logger', () => ({
  logger: {
    info: (message: string) => logged.push(message),
    warn: (message: string) => logged.push(message),
    error: (message: string) => logged.push(message),
    debug: (message: string) => logged.push(message),
  },
  initLogger: () => undefined,
}));
import { LedgerRuntime } from '../../../src/main/ledger-runtime';
import type { ConfigStore } from '../../../src/main/store/config-store';
import { DEFAULT_ESTIMATE_CONFIG } from '../../../src/shared/constants';
import type { PlayerLedger } from '../../../src/shared/types/domain';
import { BASELINE_PATH, makeScan } from '../../helpers/goldens';

/** 真实基线路径（转正斜杠，命中 baselinePath() 的绝对路径分支）。 */
const ABSOLUTE_BASELINE = BASELINE_PATH.replace(/\\/g, '/');

/**
 * 构造一个只实现 LedgerRuntime 实际用到的那部分接口的假 ConfigStore。
 *
 * ledger-runtime 只用 `config.get().data.baselinePath` 与 `config.get().estimate`。
 *
 * @param baselinePath 基线路径。
 */
function fakeConfig(baselinePath = ABSOLUTE_BASELINE): ConfigStore {
  return {
    get: () => ({
      data: { baselinePath, templateDir: '' },
      estimate: DEFAULT_ESTIMATE_CONFIG,
    }),
  } as unknown as ConfigStore;
}

describe('ensureSnapshot —— 只读，不清空台账', () => {
  it('基线未就绪时返回 null（不抛异常）', () => {
    const runtime = new LedgerRuntime(fakeConfig(), 1_700_000_000_000);
    expect(runtime.getSnapshot()).toBeNull();
    expect(runtime.ensureSnapshot()).toBeNull();
  });

  it('首次调用构建"全部 = 池总数、巡查 0/8"的初始快照', async () => {
    const runtime = new LedgerRuntime(fakeConfig(), 1_700_000_000_000);
    const loaded = await runtime.loadBaseline();
    expect(loaded.ok).toBe(true);

    const snapshot = runtime.ensureSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.rows).toHaveLength(65);
    expect(snapshot!.coverage.scanned).toBe(0);
    expect(snapshot!.coverage.total).toBe(8);
    // 一局未开始：每一行的已观测消耗为 0，剩余 = 池总数
    for (const row of snapshot!.rows) {
      expect(row.observedCopies).toBe(0);
      expect(row.remaining).toBe(row.poolTotal);
    }
  });

  it('幂等：第二次调用返回同一份快照，不会重复构建', async () => {
    const runtime = new LedgerRuntime(fakeConfig(), 1_700_000_000_000);
    await runtime.loadBaseline();

    const first = runtime.ensureSnapshot();
    const second = runtime.ensureSnapshot();
    expect(second).toBe(first);
  });

  it('**不清空台账**：restore 之后 ensureSnapshot 仍保留恢复的数据', async () => {
    const now = 1_700_000_000_000;
    const runtime = new LedgerRuntime(fakeConfig(), now);
    await runtime.loadBaseline();

    // 模拟"有内容的一局"：自家棋盘 slot 0 上有 1 张 1★ 维迦（消耗 1 张）
    const populated = new LedgerRuntime(fakeConfig(), now);
    await populated.loadBaseline();
    populated.applyScanResult(makeScan(0, [{ zone: 'board', slotIndex: 0, championId: 'veigar' }]));
    const saved: PlayerLedger[] = JSON.parse(JSON.stringify(populated.ledgers())) as PlayerLedger[];

    // 启动流程：恢复上一局 → 然后需要一份首帧快照
    runtime.restore(saved);
    const before = runtime.ledgers().reduce((sum, ledger) => sum + Object.keys(ledger.slots).length, 0);
    expect(before).toBe(1);

    const snapshot = runtime.ensureSnapshot();
    expect(snapshot).not.toBeNull();

    // 台账必须原封不动（修复前这里会被 reset() 清成 0 个 slot）
    const after = runtime.ledgers().reduce((sum, ledger) => sum + Object.keys(ledger.slots).length, 0);
    expect(after).toBe(1);

    // 快照也必须反映恢复的数据，而不是"全新一局"
    const veigar = snapshot!.rows.find((row) => row.championId === 'veigar');
    expect(veigar).toBeDefined();
    expect(veigar!.observedCopies).toBe(1);
    expect(veigar!.remaining).toBe(veigar!.poolTotal - 1);
  });

  it('reset() 仍然保留原有"清空整局"语义（两者不可混用）', async () => {
    const now = 1_700_000_000_000;
    const runtime = new LedgerRuntime(fakeConfig(), now);
    await runtime.loadBaseline();

    runtime.applyScanResult(makeScan(0, [{ zone: 'board', slotIndex: 0, championId: 'veigar' }]));
    expect(
      runtime.ledgers().reduce((sum, ledger) => sum + Object.keys(ledger.slots).length, 0),
    ).toBe(1);

    runtime.reset();
    expect(
      runtime.ledgers().reduce((sum, ledger) => sum + Object.keys(ledger.slots).length, 0),
    ).toBe(0);
  });

  it('基线路径不存在时不抛异常，只返回校验失败', async () => {
    const runtime = new LedgerRuntime(fakeConfig(resolve(process.cwd(), 'no-such-baseline.json')));
    const loaded = await runtime.loadBaseline();
    expect(loaded.ok).toBe(false);
    expect(runtime.ensureSnapshot()).toBeNull();
  });
});
