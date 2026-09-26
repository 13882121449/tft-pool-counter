/**
 * 快照节流广播（架构 §3.6 / §5.2）。
 *
 * HUD 每 1.5s 会拿到一份全新的 65 行快照（约 30KB）。如果每一份都立刻
 * 广播到所有窗口，拖窗 / 批量校正时会出现"渲染进程被消息淹没"的卡顿。
 * 因此这里做 **100ms 合并节流**：同一窗口内只推最后一份快照。
 *
 * 状态推送（scan:status）与错误（system:error）体量小、时效性强，直通不节流。
 */

import type { BrowserWindow } from 'electron';
import type { AppError, PoolSnapshot } from '../shared/types/domain';
import type { ScanStatusPush } from '../shared/types/ipc';
import { CH_POOL_SNAPSHOT, CH_SCAN_STATUS, CH_SYSTEM_ERROR } from '../shared/ipc/channels';
import { SNAPSHOT_THROTTLE_MS } from '../shared/constants';

/** 窗口提供者（每次广播时动态取，天然适配窗口重建）。 */
export type WindowProvider = () => readonly BrowserWindow[];

/** 节流推送器。 */
export class SnapshotPusher {
  private timer: NodeJS.Timeout | null = null;

  private pending: PoolSnapshot | null = null;

  private readonly throttleMs: number;

  /**
   * @param getWindows 取当前所有需要接收推送的窗口。
   * @param throttleMs 合并窗口（默认 100ms）。
   */
  constructor(
    private readonly getWindows: WindowProvider,
    throttleMs = SNAPSHOT_THROTTLE_MS,
  ) {
    this.throttleMs = Math.max(0, throttleMs);
  }

  /**
   * 安排一次快照广播（合并窗口内的多次调用）。
   *
   * @param snapshot 最新快照。
   */
  push(snapshot: PoolSnapshot): void {
    this.pending = snapshot;
    if (this.timer !== null) {
      return;
    }
    if (this.throttleMs === 0) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.throttleMs);
  }

  /**
   * 立即广播待发送的快照（退出前调用）。
   */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = this.pending;
    this.pending = null;
    if (snapshot !== null) {
      this.broadcast(CH_POOL_SNAPSHOT, snapshot);
    }
  }

  /**
   * 推送扫描状态（不节流）。
   *
   * @param status 状态载荷。
   */
  pushStatus(status: ScanStatusPush): void {
    this.broadcast(CH_SCAN_STATUS, status);
  }

  /**
   * 推送系统错误（不节流）。
   *
   * @param error 错误。
   */
  pushError(error: AppError): void {
    this.broadcast(CH_SYSTEM_ERROR, error);
  }

  /** 释放定时器。 */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  /** 广播到所有窗口（销毁的窗口自动跳过）。 */
  private broadcast(channel: string, payload: unknown): void {
    for (const window of this.getWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      try {
        window.webContents.send(channel, payload);
      } catch {
        // 窗口恰好处于销毁中：忽略这一帧
      }
    }
  }
}
