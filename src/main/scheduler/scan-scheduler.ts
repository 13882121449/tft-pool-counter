/**
 * 扫描调度器（架构 §3.6 / §5.4）。
 *
 * 职责：
 * 1. 自调度定时器（每次跑完按**当前阶段**重算下一次间隔）；
 * 2. 前台探测：以"是否检测到棋盘"作为游戏是否在前台的判据
 *    —— **不枚举进程、不读窗口标题**（合规 X1–X3）；
 * 3. 失败退避与连续失败告警（连续 failStreakToAlarm 次红灯）；
 * 4. 扫描全程异步，绝不阻塞主进程事件循环。
 */

import type { AppError, Stage } from '../../shared/types/domain';
import type { ScanStatusPush } from '../../shared/types/ipc';
import type { Calibration } from '../../shared/types/scan';
import { makeError } from '../../shared/ipc/error-codes';
import type { ConfigStore } from '../store/config-store';
import type { LedgerRuntime } from '../ledger-runtime';
import type { SnapshotPusher } from '../snapshot-push';
import type { VisionHost } from '../vision-host';
import { logger } from '../system/logger';
import { intervalForStage } from './stage-policy';

/** 调度器依赖。 */
export interface ScanSchedulerDeps {
  runtime: LedgerRuntime;
  vision: VisionHost;
  config: ConfigStore;
  push: SnapshotPusher;
  /** 取当前标定（未标定时返回 null，调度器只回报状态不扫描）。 */
  getCalibration: () => Calibration | null;
  /** 错误回调（写入日志/状态条）。 */
  onError?: (error: AppError) => void;
}

/** 触发来源。 */
export type ScanTrigger = 'scheduled' | 'manual' | 'probe';

/**
 * 定时扫描调度器。
 */
export class ScanScheduler {
  private timer: NodeJS.Timeout | null = null;

  private disposed = false;

  private userPaused = false;

  private running = false;

  private failStreak = 0;

  private alarmed = false;

  private lastScanAt = 0;

  private durationMs = 0;

  private stage: Stage = 'unknown';

  private backend = 'unknown';

  private boardMissStreak = 0;

  constructor(private readonly deps: ScanSchedulerDeps) {}

  /** 启动调度（幂等）。 */
  start(): void {
    if (this.disposed) {
      return;
    }
    this.schedule(0);
  }

  /** 停止调度并释放定时器。 */
  stop(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 用户暂停（热键 / UI）。 */
  pause(): void {
    this.userPaused = true;
    this.emitStatus();
  }

  /** 用户恢复。 */
  resume(): void {
    this.userPaused = false;
    this.schedule(0);
    this.emitStatus();
  }

  /** 是否被用户暂停。 */
  isPaused(): boolean {
    return this.userPaused;
  }

  /** 当前状态（供 IPC 查询与 UI 状态条）。 */
  getStatus(): ScanStatusPush {
    return {
      scanning: this.running,
      lastScanAt: this.lastScanAt,
      durationMs: this.durationMs,
      stage: this.stage,
      failStreak: this.failStreak,
      backend: this.backend,
    };
  }

  /**
   * 立即触发一次扫描（手动）。
   *
   * @returns 触发后的状态。
   */
  async triggerManual(): Promise<ScanStatusPush> {
    await this.tick('manual');
    return this.getStatus();
  }

  /** 安排下一次执行。 */
  private schedule(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(
      () => {
        void this.runOnce();
      },
      Math.max(0, delayMs),
    );
  }

  /** 跑一轮然后自调度。 */
  private async runOnce(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.tick('scheduled');
    if (this.disposed) {
      return;
    }
    this.schedule(this.nextDelay());
  }

  /** 计算下一次间隔。 */
  private nextDelay(): number {
    const scan = this.deps.config.get().scan;
    if (this.userPaused || !this.deps.vision.isReady()) {
      return scan.probeIntervalMs;
    }
    return intervalForStage(this.stage, scan).intervalMs;
  }

  /**
   * 执行一次扫描。
   *
   * @param trigger 触发来源。
   */
  private async tick(trigger: ScanTrigger): Promise<void> {
    if (this.running) {
      return;
    }

    if (this.userPaused && trigger !== 'manual') {
      this.emitStatus();
      return;
    }

    const config = this.deps.config.get();
    // 阶段策略：战斗/选秀阶段对 scheduled 触发做暂停（手动始终允许）
    if (trigger === 'scheduled') {
      const policy = intervalForStage(this.stage, config.scan);
      if (policy.paused) {
        this.emitStatus();
        return;
      }
    }

    const calibration = this.deps.getCalibration();
    if (calibration === null) {
      this.emitStatus();
      return;
    }

    this.running = true;
    this.emitStatus();

    try {
      this.deps.vision.setCalibration(calibration);
      const scanId = `${trigger}-${Date.now()}`;
      const scan = await this.deps.vision.scan(
        {
          detectPlayer: true,
          detectStage: true,
          detectShop: config.recognition.enableShopDetect,
        },
        scanId,
      );

      this.backend = scan.metrics.backend;
      this.durationMs = scan.durationMs;
      if (scan.stage !== 'unknown') {
        this.stage = scan.stage;
      }

      const captureFailure = scan.errors.find(
        (error) =>
          error.code === 'CAP_TIMEOUT' ||
          error.code === 'CAP_BLACK_FRAME' ||
          error.code === 'CAP_BACKEND_UNAVAILABLE',
      );

      if (captureFailure !== undefined) {
        this.failStreak += 1;
        this.deps.onError?.(captureFailure);
        this.deps.push.pushError(captureFailure);
        if (this.failStreak >= config.scan.failStreakToAlarm && !this.alarmed) {
          this.alarmed = true;
          const alarm = makeError('CAP_BACKEND_UNAVAILABLE', {
            message: `连续 ${this.failStreak} 次捕获失败，请检查是否处于独占全屏`,
          });
          this.deps.push.pushError(alarm);
          logger.warn('[scheduler] 触发捕获告警', alarm);
        }
      } else {
        this.failStreak = 0;
        this.alarmed = false;
      }

      // 前台探测：无任何观测 ≈ 棋盘不存在（游戏未在前台或界面切换中）
      if (scan.observations.length > 0) {
        this.boardMissStreak = 0;
        this.lastScanAt = scan.finishedAt;
        const snapshot = this.deps.runtime.applyScanResult(scan, {
          board: calibration.boardCols,
          bench: calibration.benchSlots,
          shop: calibration.shopSlots,
        });
        if (snapshot !== null) {
          this.deps.push.push(snapshot);
        }
      } else {
        this.boardMissStreak += 1;
        if (this.boardMissStreak === 1 || this.boardMissStreak % 10 === 0) {
          logger.info('[scheduler] 未检测到棋盘，转入探测模式', {
            missStreak: this.boardMissStreak,
          });
        }
        const noBoard =
          scan.errors.find((error) => error.code === 'VIS_NO_BOARD') ??
          makeError('VIS_NO_BOARD', { message: '未检测到棋盘，已休眠等待' });
        if (this.boardMissStreak === 1) {
          this.deps.push.pushError(noBoard);
        }
      }
    } catch (error) {
      const appError = makeError('SYS_IPC_TIMEOUT', {
        message: `扫描异常：${error instanceof Error ? error.message : String(error)}`,
      });
      this.deps.onError?.(appError);
      logger.error('[scheduler] 扫描异常', appError);
    } finally {
      this.running = false;
      this.emitStatus();
    }
  }

  /** 回报状态。 */
  private emitStatus(): void {
    this.deps.push.pushStatus(this.getStatus());
  }
}
