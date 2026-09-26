/**
 * IPC 层共享上下文（依赖注入容器）。
 *
 * 所有 handler 只依赖这个"服务集合"，不各自去 `import` 具体实现，
 * 好处：
 * - 单测可以直接构造一个假 services；
 * - 避免 handler ↔ 实现之间的循环 import；
 * - 需要新增服务时只改一处。
 */

import type { CalibrationStore } from '../store/calibration-store';
import type { ConfigStore } from '../store/config-store';
import type { SessionStore } from '../store/session-store';
import type { LedgerRuntime } from '../ledger-runtime';
import type { SnapshotPusher } from '../snapshot-push';
import type { ScanScheduler } from '../scheduler/scan-scheduler';
import type { VisionHost } from '../vision-host';
import type { WindowManager } from '../windows/window-manager';

/** 全局服务集合。 */
export interface AppServices {
  config: ConfigStore;
  session: SessionStore;
  calibration: CalibrationStore;
  runtime: LedgerRuntime;
  push: SnapshotPusher;
  vision: VisionHost;
  scheduler: ScanScheduler;
  windows: WindowManager;
  /** Vite dev server 地址（开发态）。 */
  devServerUrl: string;
}
