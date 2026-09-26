/**
 * 实例变更历史（环形缓冲）与撤销栈（Ctrl+Z）。
 *
 * 撤销采用"保存受影响前的台账快照"策略：9 个台账 × 最多 36 槽，
 * 内存开销可以忽略，换来的是撤销语义 100% 正确，不用为每条指令写逆操作。
 */

import type { CorrectionCmd } from '../../shared/types/ipc';
import type { PlayerLedger, UnitInstance } from '../../shared/types/domain';
import { LEDGER_HISTORY_CAPACITY, UNDO_STACK_CAPACITY } from '../../shared/constants';

/** 实例变更历史（环形缓冲，满了丢弃最旧的）。 */
export class InstanceHistory {
  private readonly buffer: UnitInstance[] = [];
  private cursor = 0;

  /**
   * @param capacity 缓冲容量，默认 200。
   */
  constructor(private readonly capacity: number = LEDGER_HISTORY_CAPACITY) {}

  /**
   * 追加一批被替换/移除的实例。
   *
   * @param instances 实例列表。
   */
  push(instances: ReadonlyArray<UnitInstance>): void {
    for (const instance of instances) {
      if (this.buffer.length < this.capacity) {
        this.buffer.push(instance);
      } else {
        this.buffer[this.cursor] = instance;
        this.cursor = (this.cursor + 1) % this.capacity;
      }
    }
  }

  /** 全部历史（按写入顺序）。 */
  all(): UnitInstance[] {
    if (this.buffer.length < this.capacity) {
      return [...this.buffer];
    }
    return [...this.buffer.slice(this.cursor), ...this.buffer.slice(0, this.cursor)];
  }

  /** 清空。 */
  clear(): void {
    this.buffer.length = 0;
    this.cursor = 0;
  }

  /** 当前条目数。 */
  size(): number {
    return this.buffer.length;
  }
}

/** 撤销栈条目。 */
export interface UndoEntry<TSnapshot> {
  /** 触发这次变更的指令。 */
  cmd: CorrectionCmd;
  /** 变更前的快照。 */
  snapshot: TSnapshot;
  /** 变更时间（epoch ms）。 */
  at: number;
}

/**
 * 撤销栈。
 *
 * @typeParam TSnapshot 快照类型（本项目为 `PlayerLedger[]`）。
 */
export class HistoryStack<TSnapshot> {
  private readonly stack: Array<UndoEntry<TSnapshot>> = [];

  /**
   * @param capacity 栈容量，默认 50。
   */
  constructor(private readonly capacity: number = UNDO_STACK_CAPACITY) {}

  /**
   * 入栈。
   *
   * @param cmd 指令。
   * @param snapshot 变更前快照。
   * @param at 时间戳。
   */
  push(cmd: CorrectionCmd, snapshot: TSnapshot, at = 0): void {
    this.stack.push({ cmd, snapshot, at });
    if (this.stack.length > this.capacity) {
      this.stack.shift();
    }
  }

  /** 弹出最近一条，空栈返回 null。 */
  undo(): UndoEntry<TSnapshot> | null {
    return this.stack.pop() ?? null;
  }

  /** 是否可撤销。 */
  canUndo(): boolean {
    return this.stack.length > 0;
  }

  /** 当前栈深。 */
  size(): number {
    return this.stack.length;
  }

  /** 清空。 */
  clear(): void {
    this.stack.length = 0;
  }

  /** 只读视图（调试/测试用）。 */
  entries(): ReadonlyArray<UndoEntry<TSnapshot>> {
    return this.stack;
  }
}

/** 台账快照类型别名。 */
export type LedgerSnapshot = PlayerLedger[];
