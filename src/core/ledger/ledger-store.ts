/**
 * 台账 reducer（架构 ADR-04 / ADR-06）。
 *
 * 权威状态 = 9 个 `PlayerLedger`（8 家 + 1 个 UNKNOWN 暂存区），
 * 更新语义是**槽位覆盖**而非事件累加，因此天然幂等。
 *
 * 幂等性保证：
 * - 实例 id 由 (seat, zone, slotIndex, firstSeenAt) 确定性生成；
 * - 同一 scanId 重复 applyScan 不增加 scanCount（用于账等幂自检）;
 * - lastScanAt 取 max，重复应用不变。
 */

import type {
  PlayerLedger,
  PoolBaseline,
  SeatOrUnknown,
  SlotKey,
  Star,
  UnitInstance,
} from '../../shared/types/domain';
import type { ScanResult } from '../../shared/types/scan';
import type { CorrectionCmd } from '../../shared/types/ipc';
import { UNKNOWN_SEAT } from '../../shared/types/domain';
import {
  LEDGER_HISTORY_CAPACITY,
  MANUAL_SLOT_BASE,
  UNDO_STACK_CAPACITY,
} from '../../shared/constants';
import { indexChampions } from '../baseline/load-baseline';
import {
  DEFAULT_DEDUP_CONFIG,
  mergeObservations,
  makeInstanceId,
  type DedupConfig,
  type DedupDeps,
} from '../pool-engine/dedup';
import { copiesOf, starFromCopies } from '../pool-engine/star-copies';
import type { ZoneCols } from '../pool-engine/slot-geometry';
import { resolveSeat, moveFromUnknown, findInstance } from './player-identity';
import { InstanceHistory, type LedgerSnapshot } from './history';

/** 台账状态。 */
export interface LedgerState {
  /** 9 个台账，索引即 seat（8 = UNKNOWN 暂存区）。 */
  ledgers: PlayerLedger[];
  /** 被替换/移除的实例历史（环形缓冲）。 */
  history: UnitInstance[];
  /** 撤销栈。 */
  undo: Array<{ cmd: CorrectionCmd; snapshot: LedgerSnapshot; at: number }>;
  updatedAt: number;
}

/** applyScan 选项。 */
export interface ApplyScanOptions {
  /** 覆盖当前时间（默认取 scanResult.finishedAt）。 */
  now?: number;
  /** 去重配置覆盖。 */
  dedup?: Partial<DedupConfig>;
  /** 各区域列数（供同帧相邻槽位合并做二维几何判定，QA M1）。 */
  geometry?: ZoneCols;
}

/** applyCorrection 选项。 */
export interface ApplyCorrectionOptions {
  /** 覆盖当前时间。 */
  now?: number;
  /** false = 不入撤销栈（用于撤销自身与程序化迁移）。 */
  trackUndo?: boolean;
}

/**
 * 创建空台账。
 *
 * @param now 初始时间。
 */
export function createLedgerState(now = 0): LedgerState {
  const ledgers: PlayerLedger[] = [];
  for (let seat = 0; seat <= UNKNOWN_SEAT; seat += 1) {
    ledgers.push({
      seat: seat as SeatOrUnknown,
      isSelf: seat === 0,
      status: 'unscanned',
      slots: {},
      lastScanAt: 0,
      scanCount: 0,
    });
  }
  return { ledgers, history: [], undo: [], updatedAt: now };
}

/** 深拷贝台账数组（保持可结构化克隆：只用普通对象/数组）。 */
function cloneLedgers(ledgers: ReadonlyArray<PlayerLedger>): PlayerLedger[] {
  return ledgers.map((ledger) => ({
    ...ledger,
    slots: { ...ledger.slots },
  }));
}

/** 取指定座位的台账副本。 */
function findLedger(ledgers: ReadonlyArray<PlayerLedger>, seat: SeatOrUnknown): PlayerLedger | undefined {
  return ledgers.find((ledger) => ledger.seat === seat);
}

/**
 * 应用一次扫描结果。
 *
 * @param state 当前状态（不修改）。
 * @param scanResult 扫描结果。
 * @param baseline 卡池基线（提供星级换算、特殊机制、黑名单）。
 * @param options 选项。
 */
export function applyScan(
  state: LedgerState,
  scanResult: ScanResult,
  baseline: PoolBaseline,
  options: ApplyScanOptions = {},
): LedgerState {
  const now = options.now ?? scanResult.finishedAt;
  const dedupConfig: DedupConfig = { ...DEFAULT_DEDUP_CONFIG, ...(options.dedup ?? {}) };
  const championIndex = indexChampions(baseline);
  const deps: DedupDeps = {
    championIndex,
    nonPoolUnitIds: new Set(baseline.nonPoolUnitIds ?? []),
    copiesOfStar: (star: Star) => copiesOf(star, baseline),
    boardCols: options.geometry?.board,
    benchCols: options.geometry?.bench,
    shopCols: options.geometry?.shop,
  };

  const seat = resolveSeat(scanResult.seatGuess, state.ledgers);
  const ledgers = cloneLedgers(state.ledgers);
  const target = findLedger(ledgers, seat);
  if (!target) {
    return state;
  }

  // 人工校正优先：某家某弈子一旦被人工设定并锁定，
  // 该家该弈子的自动观测一律丢弃，避免"人工值 + 自动值"双计把数字顶穿。
  const manualLocked = new Set<string>();
  for (const instance of Object.values(target.slots ?? {})) {
    if (instance && instance.source === 'manual' && instance.locked) {
      manualLocked.add(instance.championId);
    }
  }
  const observations =
    manualLocked.size === 0
      ? scanResult.observations
      : scanResult.observations.filter(
          (observation) =>
            observation.championId === null || !manualLocked.has(observation.championId),
        );

  const outcome = mergeObservations(target, observations, now, dedupConfig, deps);

  // 幂等：同一 scanId 不重复计数
  const isSameScan = target.lastScanId === scanResult.scanId;
  const merged: PlayerLedger = {
    ...outcome.ledger,
    status: 'scanned',
    lastScanAt: Math.max(target.lastScanAt, scanResult.finishedAt),
    scanCount: isSameScan ? target.scanCount : target.scanCount + 1,
    lastScanId: scanResult.scanId,
  };

  const nextLedgers = ledgers.map((ledger) => (ledger.seat === seat ? merged : ledger));
  const history = new InstanceHistory(LEDGER_HISTORY_CAPACITY);
  history.push(state.history);
  history.push(outcome.displaced);

  return {
    ledgers: nextLedgers,
    history: history.all(),
    undo: state.undo,
    updatedAt: now,
  };
}

/**
 * 应用一条人工校正指令。
 *
 * @param state 当前状态（不修改）。
 * @param cmd 校正指令。
 * @param baseline 卡池基线。
 * @param options 选项。
 */
export function applyCorrection(
  state: LedgerState,
  cmd: CorrectionCmd,
  baseline: PoolBaseline,
  options: ApplyCorrectionOptions = {},
): LedgerState {
  const now = options.now ?? state.updatedAt;
  const trackUndo = options.trackUndo ?? true;
  let next = state;

  switch (cmd.kind) {
    case 'set-copies': {
      next = setCopies(next, cmd.championId, cmd.seat, cmd.value, baseline, now, cmd.lock ?? true);
      break;
    }
    case 'adjust-copies': {
      const current = countCopiesOf(next, cmd.championId, cmd.seat);
      next = setCopies(
        next,
        cmd.championId,
        cmd.seat,
        Math.max(0, current + cmd.delta),
        baseline,
        now,
        true,
      );
      break;
    }
    case 'move-instance': {
      next = moveFromUnknown(next, cmd.instanceId, cmd.toSeat, now);
      break;
    }
    case 'set-lock': {
      next = setLock(next, cmd.championId, cmd.seat, cmd.locked);
      break;
    }
    case 'clear-seat': {
      next = clearSeat(next, cmd.seat, now);
      break;
    }
    case 'mark-eliminated': {
      next = markEliminated(next, cmd.seat, now);
      break;
    }
    default:
      return state;
  }

  if (!trackUndo) {
    return { ...next, updatedAt: now };
  }

  // 撤销策略：保存"变更前"的台账快照，撤销即整体回滚，语义 100% 正确
  const undo = [
    ...state.undo,
    { cmd, snapshot: cloneLedgers(state.ledgers), at: now },
  ].slice(-UNDO_STACK_CAPACITY);

  return { ...next, undo, updatedAt: now };
}

/**
 * 统计某家某弈子的当前持有张数。
 *
 * @param state 台账状态。
 * @param championId 弈子 id。
 * @param seat 座位。
 */
export function countCopiesOf(state: LedgerState, championId: string, seat: SeatOrUnknown): number {
  const ledger = findLedger(state.ledgers, seat);
  if (!ledger) {
    return 0;
  }
  let total = 0;
  for (const instance of Object.values(ledger.slots ?? {})) {
    if (instance && instance.championId === championId) {
      total += instance.copies;
    }
  }
  return total;
}

/**
 * 把某家某弈子的持有量设为指定值（人工校正落点）。
 *
 * 实现方式：清空该家该弈子的全部实例，再写入**一个**人工实例承载张数。
 * 该实例位于保留槽位（MANUAL_SLOT_BASE 起），不会与真实棋盘/备战席槽位冲突，
 * 因此自动扫描不会覆盖它；引擎侧会因它存在而对这家启用"人工覆盖"口径。
 *
 * @param state 台账状态。
 * @param championId 弈子 id。
 * @param seat 座位。
 * @param value 目标张数。
 * @param baseline 卡池基线。
 * @param now 当前时间。
 * @param lock 是否锁定。
 */
export function setCopies(
  state: LedgerState,
  championId: string,
  seat: SeatOrUnknown,
  value: number,
  baseline: PoolBaseline,
  now = 0,
  lock = true,
): LedgerState {
  const ledgers = cloneLedgers(state.ledgers);
  const ledger = findLedger(ledgers, seat);
  if (!ledger) {
    return state;
  }

  const removedInstances: UnitInstance[] = [];
  for (const [key, instance] of Object.entries(ledger.slots)) {
    if (instance && instance.championId === championId) {
      removedInstances.push(instance);
      delete ledger.slots[key];
    }
  }

  const safeValue = Math.max(0, Math.floor(value));
  if (safeValue > 0) {
    const manualCount = Object.values(ledger.slots).filter(
      (instance) => instance && instance.source === 'manual',
    ).length;
    const slotIndex = MANUAL_SLOT_BASE + manualCount;
    const star = starFromCopies(safeValue, baseline);
    const manual: UnitInstance = {
      instanceId: makeInstanceId(seat, 'bench', slotIndex, now),
      championId,
      star,
      copies: safeValue,
      seat,
      zone: 'bench',
      slotIndex,
      slotSpan: 1,
      confidence: 1,
      fingerprint: '0'.repeat(16),
      firstSeenAt: now,
      lastSeenAt: now,
      source: 'manual',
      locked: lock,
    };
    const key: SlotKey = `${seat}|bench|${slotIndex}`;
    ledger.slots[key] = manual;
  }

  ledger.status = ledger.status === 'eliminated' ? 'eliminated' : 'scanned';
  ledger.lastScanAt = Math.max(ledger.lastScanAt, now);

  const history = new InstanceHistory();
  history.push(state.history);
  history.push(removedInstances);

  return { ...state, ledgers, history: history.all(), updatedAt: now };
}

/**
 * 锁定/解锁某家某弈子（锁定后自动扫描不写入）。
 *
 * @param state 台账状态。
 * @param championId 弈子 id。
 * @param seat 座位。
 * @param locked 是否锁定。
 */
export function setLock(
  state: LedgerState,
  championId: string,
  seat: SeatOrUnknown,
  locked: boolean,
): LedgerState {
  const ledgers = cloneLedgers(state.ledgers);
  const ledger = findLedger(ledgers, seat);
  if (!ledger) {
    return state;
  }
  for (const [key, instance] of Object.entries(ledger.slots)) {
    if (instance && instance.championId === championId) {
      ledger.slots[key] = { ...instance, locked };
    }
  }
  return { ...state, ledgers, updatedAt: state.updatedAt };
}

/**
 * 清空某家台账（一键重扫）。
 *
 * @param state 台账状态。
 * @param seat 座位。
 * @param now 当前时间。
 */
export function clearSeat(state: LedgerState, seat: SeatOrUnknown, now = 0): LedgerState {
  const ledgers = cloneLedgers(state.ledgers);
  const ledger = findLedger(ledgers, seat);
  if (!ledger) {
    return state;
  }
  ledger.slots = {};
  ledger.status = 'unscanned';
  ledger.scanCount = 0;
  ledger.lastScanAt = now;
  ledger.lastScanId = undefined;
  return { ...state, ledgers, updatedAt: now };
}

/**
 * 标记某家被淘汰：棋盘 + 备战席全部回池。
 *
 * @param state 台账状态。
 * @param seat 座位。
 * @param now 当前时间。
 */
export function markEliminated(state: LedgerState, seat: SeatOrUnknown, now = 0): LedgerState {
  const ledgers = cloneLedgers(state.ledgers);
  const ledger = findLedger(ledgers, seat);
  if (!ledger) {
    return state;
  }
  ledger.slots = {};
  ledger.status = 'eliminated';
  ledger.lastScanAt = now;
  return { ...state, ledgers, updatedAt: now };
}

/**
 * 重置整局台账。
 *
 * @param state 台账状态。
 * @param now 当前时间。
 */
export function resetLedger(state: LedgerState, now = 0): LedgerState {
  // state 不参与重置结果，保留参数是为了与其它 reducer 保持同一签名
  void state;
  const fresh = createLedgerState(now);
  return {
    ledgers: fresh.ledgers,
    history: [],
    undo: [],
    updatedAt: now,
  };
}

/**
 * 撤销最近一次人工校正。
 *
 * @param state 台账状态。
 * @returns 撤销后的状态；无可撤销内容时原样返回。
 */
export function undoCorrection(state: LedgerState): LedgerState {
  const last = state.undo[state.undo.length - 1];
  if (!last) {
    return state;
  }
  return {
    ...state,
    ledgers: cloneLedgers(last.snapshot),
    undo: state.undo.slice(0, -1),
    updatedAt: last.at,
  };
}

/** 是否可撤销。 */
export function canUndo(state: LedgerState): boolean {
  return state.undo.length > 0;
}

/**
 * 供校正面板使用：查某家某弈子的实例列表。
 *
 * @param state 台账状态。
 * @param championId 弈子 id。
 * @param seat 座位。
 */
export function instancesOf(
  state: LedgerState,
  championId: string,
  seat: SeatOrUnknown,
): UnitInstance[] {
  const ledger = findLedger(state.ledgers, seat);
  if (!ledger) {
    return [];
  }
  return Object.values(ledger.slots ?? {}).filter(
    (instance): instance is UnitInstance => Boolean(instance) && instance.championId === championId,
  );
}

/**
 * 全局查找实例（跨所有家）。
 *
 * @param state 台账状态。
 * @param instanceId 实例 id。
 */
export function locate(state: LedgerState, instanceId: string) {
  return findInstance(state, instanceId);
}
