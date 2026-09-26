/**
 * 玩家身份判定（ADR-05）。
 *
 * 合规禁止模拟输入 → 工具不能自动切换视角，只能**被动识别**当前画面属于谁。
 * 判定链由视觉层给出 L1/L2/L3 结果，这里只负责"落到哪个台账"：
 * - 命中真实座位 → 写入该 seat；
 * - 都不命中 → 写入 UNKNOWN(8) 暂存区，**绝不猜测**；
 * - 用户指定后 → 一次性把暂存区搬移到目标 seat。
 */

import type { PlayerLedger, Seat, SeatOrUnknown, UnitInstance } from '../../shared/types/domain';
import { makeSlotKey, type SeatGuess } from '../../shared/types/scan';
import { UNKNOWN_SEAT } from '../../shared/types/domain';
import type { LedgerState } from './ledger-store';

/** 判定阈值：低于此置信度一律进 UNKNOWN 暂存区。 */
export const SEAT_CONFIDENCE_FLOOR = 0.3;

/**
 * 把 SeatGuess 解析成具体台账座位。
 *
 * @param guess 视觉层给出的座位判定。
 * @param ledgers 当前台账（用于校验座位合法性）。
 */
export function resolveSeat(
  guess: SeatGuess,
  ledgers: ReadonlyArray<PlayerLedger> = [],
): SeatOrUnknown {
  if (!guess || typeof guess.seat !== 'number') {
    return UNKNOWN_SEAT;
  }
  if (guess.method === 'unknown') {
    return UNKNOWN_SEAT;
  }
  if (guess.seat === UNKNOWN_SEAT) {
    return UNKNOWN_SEAT;
  }
  if (guess.seat < 0 || guess.seat > 7) {
    return UNKNOWN_SEAT;
  }
  if (guess.confidence < SEAT_CONFIDENCE_FLOOR) {
    return UNKNOWN_SEAT;
  }
  if (ledgers.length > 0 && !ledgers.some((ledger) => ledger.seat === guess.seat)) {
    return UNKNOWN_SEAT;
  }
  return guess.seat as Seat;
}

/**
 * 在台账中查找某个实例。
 *
 * @param state 台账状态。
 * @param instanceId 实例 id。
 */
export function findInstance(
  state: LedgerState,
  instanceId: string,
): { ledger: PlayerLedger; key: string; instance: UnitInstance } | null {
  for (const ledger of state.ledgers) {
    for (const [key, instance] of Object.entries(ledger.slots ?? {})) {
      if (instance && instance.instanceId === instanceId) {
        return { ledger, key, instance };
      }
    }
  }
  return null;
}

/**
 * 在指定座位找下一个空闲的槽位索引（搬移实例时用）。
 *
 * @param ledger 目标台账。
 * @param zone 区域。
 * @param startFrom 起始索引。
 */
export function findFreeSlotIndex(
  ledger: PlayerLedger,
  zone: UnitInstance['zone'],
  startFrom = 0,
): number {
  const used = new Set<number>();
  for (const [key, instance] of Object.entries(ledger.slots ?? {})) {
    if (!instance) {
      continue;
    }
    const parts = key.split('|');
    if (parts.length === 3 && parts[1] === zone) {
      used.add(Number(parts[2]));
    }
  }
  let index = startFrom;
  while (used.has(index)) {
    index += 1;
  }
  return index;
}

/**
 * 把 UNKNOWN 暂存区里的某个实例搬移到目标座位。
 *
 * @param state 台账状态。
 * @param instanceId 实例 id。
 * @param toSeat 目标座位。
 * @param now 当前时间。
 */
export function moveFromUnknown(
  state: LedgerState,
  instanceId: string,
  toSeat: SeatOrUnknown,
  now = 0,
): LedgerState {
  const found = findInstance(state, instanceId);
  if (!found) {
    return state;
  }
  if (found.ledger.seat === toSeat) {
    return state;
  }

  const ledgers = state.ledgers.map((ledger) => ({ ...ledger, slots: { ...ledger.slots } }));
  const source = ledgers.find((ledger) => ledger.seat === found.ledger.seat);
  const target = ledgers.find((ledger) => ledger.seat === toSeat);
  if (!source || !target) {
    return state;
  }

  delete source.slots[found.key];
  const freeIndex = findFreeSlotIndex(target, found.instance.zone);
  const moved: UnitInstance = {
    ...found.instance,
    seat: toSeat,
    slotIndex: freeIndex,
    lastSeenAt: now,
    source: 'manual',
  };
  target.slots[makeSlotKey(toSeat, moved.zone, freeIndex)] = moved;

  return { ...state, ledgers, updatedAt: now };
}

/**
 * 统计 UNKNOWN 暂存区里滞留的实例（UI 用它提示"请指定归属"）。
 *
 * @param state 台账状态。
 */
export function listUnknownInstances(state: LedgerState): UnitInstance[] {
  const unknown = state.ledgers.find((ledger) => ledger.seat === UNKNOWN_SEAT);
  if (!unknown) {
    return [];
  }
  return Object.values(unknown.slots ?? {}).filter((instance): instance is UnitInstance =>
    Boolean(instance),
  );
}
