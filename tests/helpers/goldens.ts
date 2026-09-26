/**
 * 测试辅助：加载真实卡池基线 + 构造 ScanResult / 台账。
 *
 * 测试运行在 node 环境，可以直接读 `data/*.json`；
 * 被测的 `src/core` 依然是零依赖纯函数。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  Cost,
  PoolBaseline,
  SeatOrUnknown,
  Star,
  Zone,
} from '../../src/shared/types/domain';
import type { Candidate, ObservationRecord, ScanResult } from '../../src/shared/types/scan';
import { loadBaseline } from '../../src/core/baseline/load-baseline';
import { createLedgerState, type LedgerState } from '../../src/core/ledger/ledger-store';

/** 项目根目录。 */
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** 真实基线文件路径。 */
export const BASELINE_PATH = resolve(PROJECT_ROOT, 'data', 'pool-baseline.json');

/** 加载真实基线（每个测试文件调用一次即可，开销很小）。 */
export function loadTestBaseline(): PoolBaseline {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  const result = loadBaseline(raw);
  if (!result.ok || !result.baseline) {
    throw new Error(`测试基线加载失败：${JSON.stringify(result.errors)}`);
  }
  return result.baseline;
}

/** 构造一个观测记录。 */
export interface ObsSpec {
  zone: Zone;
  slotIndex: number;
  championId: string | null;
  star?: Star;
  confidence?: number;
  fingerprint?: string;
  costGuess?: Cost | null;
  candidates?: Candidate[];
  isBlacklisted?: boolean;
  slotSpan?: number;
  mergedSlotIndices?: number[];
}

/** 把简写的观测规格补全为完整 ObservationRecord。 */
export function obs(spec: ObsSpec): ObservationRecord {
  const record: ObservationRecord = {
    zone: spec.zone,
    slotIndex: spec.slotIndex,
    championId: spec.championId,
    star: spec.star ?? 1,
    confidence: spec.confidence ?? 0.9,
    fingerprint: spec.fingerprint ?? '0'.repeat(16),
    costGuess: spec.costGuess ?? null,
    candidates: spec.candidates ?? [],
    isBlacklisted: spec.isBlacklisted ?? false,
    slotSpan: spec.slotSpan ?? 1,
  };
  if (spec.mergedSlotIndices !== undefined) {
    record.mergedSlotIndices = [...spec.mergedSlotIndices];
  }
  return record;
}

/** 构造一个 ScanResult。 */
export function makeScan(
  seat: SeatOrUnknown,
  observations: ReadonlyArray<ObsSpec>,
  options: { scanId?: string; at?: number; method?: ScanResult['seatGuess']['method'] } = {},
): ScanResult {
  const at = options.at ?? 1_700_000_000_000;
  return {
    scanId: options.scanId ?? `scan-${seat}-${at}`,
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    stage: 'prep',
    stageConfidence: 0.9,
    seatGuess: {
      seat,
      confidence: seat === 8 ? 0 : 0.9,
      method: options.method ?? (seat === 8 ? 'unknown' : 'scoreboard'),
    },
    observations: observations.map(obs),
    metrics: {
      captureMs: 0,
      geometryMs: 0,
      matchMs: 0,
      starMs: 0,
      playerMs: 0,
      backend: 'desktopCapturer',
    },
    errors: [],
  };
}

/** 空台账。 */
export function freshState(now = 0): LedgerState {
  return createLedgerState(now);
}

// ---------------- 算例 golden 文件 ----------------

/** golden 文件中的观测形状。 */
export interface GoldenObservation {
  zone: Zone;
  slotIndex: number;
  championId: string | null;
  star: Star;
  confidence: number;
  fingerprint: string;
  costGuess: Cost | null;
  candidates: Candidate[];
  isBlacklisted: boolean;
  slotSpan?: number;
}

/** golden 文件中的一次扫描。 */
export interface GoldenScan {
  seat: number;
  scanId: string;
  observations: GoldenObservation[];
}

/** golden 文件结构。 */
export interface GoldenCase {
  id: string;
  title: string;
  championId: string;
  baseTime: number;
  scans: GoldenScan[];
  expect: {
    championId: string;
    poolTotal: number;
    observedCopies: number;
    remaining: number;
    overflow: number;
    remainingOptimistic: number;
    remainingPessimistic: number;
    bySeat: number[];
    coverage: { scanned: number; total: number };
    flagsWith?: string[];
    flagsWithout?: string[];
  };
  rollback?: {
    seat: number;
    scanId: string;
    emptySlotIndex: number;
    emptyZone: Zone;
    advanceMs: number;
    expect: { observedCopies: number; remaining: number; bySeat: number[] };
  };
}

/** 读取一个算例 golden 文件。 */
export function loadGolden(name: string): GoldenCase {
  const path = resolve(PROJECT_ROOT, 'tests', 'goldens', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenCase;
}

/** 把 golden 中的一次扫描转成 ScanResult。 */
export function goldenToScan(scan: GoldenScan, baseTime: number): ScanResult {
  return makeScan(scan.seat as SeatOrUnknown, scan.observations as ObsSpec[], {
    scanId: scan.scanId,
    at: baseTime,
  });
}
