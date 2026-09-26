/**
 * 台账宿主（架构 §3.6 / ADR-06）。
 *
 * 把「T02 的纯函数引擎」与「T03 的扫描结果」在**主进程内存里**缝合成一条闭环：
 *
 *   扫描结果 → applyScan（幂等槽位覆盖） → computeRemaining（65 行） → PoolSnapshot
 *                                                   ↑
 *   人工校正 → applyCorrection / undo（一等公民，优先于自动值）
 *
 * 卡池基线的文件读取也放在这里（core 保持零 I/O 可单测）。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AppError,
  Coverage,
  PlayerLedger,
  PoolBaseline,
  PoolSnapshot,
  RemainingResult,
  SeatOrUnknown,
  Stage,
} from '../shared/types/domain';
import type { Candidate, ScanResult } from '../shared/types/scan';
import type {
  BaselineInfo,
  BaselineValidateResult,
  CorrectionCmd,
  CorrectionPayload,
} from '../shared/types/ipc';
import { loadBaseline } from '../core/baseline/load-baseline';
import { computeCoverage } from '../core/pool-engine/coverage';
import { computeRemaining } from '../core/pool-engine/compute-remaining';
import type { ZoneCols } from '../core/pool-engine/slot-geometry';
import {
  applyCorrection,
  applyScan,
  canUndo,
  createLedgerState,
  resetLedger,
  undoCorrection,
  type LedgerState,
} from '../core/ledger/ledger-store';
import type { ConfigStore } from './store/config-store';
import { dataDir } from './store/paths';
import { logger } from './system/logger';

/** 台账宿主运行期状态。 */
export class LedgerRuntime {
  private state: LedgerState;

  private baseline: PoolBaseline | null = null;

  private info: BaselineInfo | null = null;

  private prevRows: RemainingResult[] = [];

  private lastSnapshot: PoolSnapshot | null = null;

  private lastScan: ScanResult | null = null;

  private lastStage: Stage = 'unknown';

  private lastDurationMs = 0;

  /** 最近一次标定的几何列数（供引擎做二维相邻判定，QA M1）。 */
  private zoneCols: ZoneCols | undefined;

  private readonly startedAt: number;

  /**
   * @param config 配置存储（读取 `estimate` 参数与基线路径）。
   * @param now 初始时间。
   */
  constructor(
    private readonly config: ConfigStore,
    now = Date.now(),
  ) {
    this.state = createLedgerState(now);
    this.startedAt = now;
  }

  /** 本局开始时间（会话落盘用）。 */
  get sessionStartedAt(): number {
    return this.startedAt;
  }

  /** 当前全部台账（含 UNKNOWN 暂存区）。 */
  ledgers(): PlayerLedger[] {
    return this.state.ledgers;
  }

  /** 当前基线（可能为 null，表示尚未加载/加载失败）。 */
  getBaseline(): PoolBaseline | null {
    return this.baseline;
  }

  /** 基线元信息（设置页展示）。 */
  getBaselineInfo(): BaselineInfo | null {
    return this.info;
  }

  /** 最近一次快照（可能为 null）。 */
  getSnapshot(): PoolSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * **非破坏性**地取"当前快照"：没有历史快照时，按当前台账就地构建一份。
   *
   * 与 `reset()` 的关键区别：本方法**不清空台账**。首帧渲染需要一份
   * "全部 = 池总数、巡查 0/8" 的快照（PRD §5.1），但此时可能已经
   * `restore()` 过上一局台账 —— 用 `reset()` 去拿这份快照会顺手把恢复的
   * 数据抹掉（main 启动流程曾经如此）。凡"只是想读一份快照"的场景一律用本方法。
   *
   * @returns 当前（或新构建的）快照；基线未就绪时返回 null。
   */
  ensureSnapshot(): PoolSnapshot | null {
    if (this.lastSnapshot !== null) {
      return this.lastSnapshot;
    }
    return this.buildSnapshot(this.tempScanId('initial'), this.lastStage, [], 0);
  }

  /** 是否可撤销。 */
  get canUndo(): boolean {
    return canUndo(this.state);
  }

  /** 解析基线文件绝对路径。 */
  baselinePath(): string {
    const configured = this.config.get().data.baselinePath;
    const normalized = configured.replace(/\\/g, '/');
    if (normalized.length > 0 && /^[A-Za-z]:\//.test(normalized)) {
      // 绝对路径（用户自定义）
      return normalized;
    }
    if (normalized.startsWith('/')) {
      return normalized;
    }
    // 相对路径一律以 data 目录为基准（打包后 dataDir 指向 resources/data）
    const relative = normalized.length > 0 ? normalized.replace(/^data\//, '') : 'pool-baseline.json';
    return join(dataDir(), relative);
  }

  /**
   * 加载并校验卡池基线。
   *
   * @returns 校验结果（含 info；失败时 errors 非空）。
   */
  async loadBaseline(): Promise<BaselineValidateResult> {
    const path = this.baselinePath();
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      const message = `读取卡池基线失败：${error instanceof Error ? error.message : String(error)}`;
      logger.error('[ledger] 基线读取失败', { path, message });
      return {
        ok: false,
        errors: [
          {
            code: 'BASE_INVALID_JSON',
            message,
            detail: { path },
            at: Date.now(),
            fatal: true,
          },
        ],
        warnings: [],
      };
    }

    const result = loadBaseline(text);
    if (!result.ok || result.baseline === null) {
      this.baseline = null;
      this.info = null;
      logger.error('[ledger] 基线校验失败', result.errors);
      return { ok: false, errors: result.errors, warnings: result.warnings };
    }

    this.baseline = result.baseline;
    this.info = {
      setNumber: result.baseline.meta.setNumber,
      setNameCn: result.baseline.meta.setNameCn,
      patch: result.baseline.meta.patch,
      confirmed: result.baseline.meta.confirmed,
      championCount: result.baseline.champions.length,
      path,
      loadedAt: Date.now(),
    };
    logger.info('[ledger] 基线已加载', {
      champions: this.info.championCount,
      confirmed: this.info.confirmed,
      path,
    });
    return { ok: true, errors: result.errors, warnings: result.warnings, info: this.info };
  }

  /**
   * 应用一次自动扫描结果并生成新快照。
   *
   * @param scan 扫描结果。
   * @param geometry 棋盘/备战席列数（缺省沿用上一次；再缺省按游戏常量）。
   * @returns 新快照；基线未就绪时返回 null。
   */
  applyScanResult(scan: ScanResult, geometry?: ZoneCols): PoolSnapshot | null {
    if (this.baseline === null) {
      return null;
    }
    if (geometry !== undefined) {
      this.zoneCols = geometry;
    }
    this.state = applyScan(this.state, scan, this.baseline, {
      now: scan.finishedAt,
      geometry: this.zoneCols,
    });
    this.lastScan = scan;
    this.lastDurationMs = scan.durationMs;
    this.lastStage = scan.stage;
    return this.buildSnapshot(scan.scanId, scan.stage, scan.errors, scan.durationMs);
  }

  /**
   * 应用一条人工校正指令。
   *
   * @param cmd 校正指令。
   * @returns 新快照；基线未就绪时返回 null。
   */
  correct(cmd: CorrectionCmd): PoolSnapshot | null {
    if (this.baseline === null) {
      return null;
    }
    this.state = applyCorrection(this.state, cmd, this.baseline);
    return this.buildSnapshot(this.tempScanId('correction'), this.lastStage, [], this.lastDurationMs);
  }

  /**
   * 撤销最近一次人工校正。
   *
   * @returns 新快照。
   */
  undo(): PoolSnapshot | null {
    if (this.baseline === null) {
      return null;
    }
    this.state = undoCorrection(this.state);
    return this.buildSnapshot(this.tempScanId('undo'), this.lastStage, [], this.lastDurationMs);
  }

  /**
   * 清空整局台账（新的一局）。
   */
  reset(): PoolSnapshot | null {
    if (this.baseline === null) {
      return null;
    }
    this.state = resetLedger(this.state, Date.now());
    this.prevRows = [];
    return this.buildSnapshot(this.tempScanId('reset'), 'unknown', [], 0);
  }

  /**
   * 用会话文件恢复台账（「恢复上一局」）。
   *
   * @param ledgers 台账数组。
   */
  restore(ledgers: PlayerLedger[]): void {
    this.state = {
      ledgers,
      history: this.state.history,
      undo: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * 构造校正面板所需的载荷（PRD 5.2）。
   *
   * @param championId 弈子 id。
   * @param seat 座位。
   * @returns 校正载荷；快照尚未生成时返回 null。
   */
  correctionPayload(championId: string, seat: SeatOrUnknown): CorrectionPayload | null {
    const snapshot = this.lastSnapshot;
    if (snapshot === null) {
      return null;
    }
    const row = snapshot.rows.find((item) => item.championId === championId);
    if (row === undefined) {
      return null;
    }
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const observation of this.lastScan?.observations ?? []) {
      if (observation.championId !== championId) {
        continue;
      }
      for (const candidate of observation.candidates) {
        if (!seen.has(candidate.championId)) {
          seen.add(candidate.championId);
          candidates.push(candidate);
        }
      }
    }
    const ledger = this.state.ledgers.find((item) => item.seat === seat);
    const locked =
      ledger !== undefined &&
      Object.values(ledger.slots).some(
        (instance) => Boolean(instance) && instance.championId === championId && instance.locked,
      );
    return {
      championId,
      bySeat: [...row.bySeat],
      observedCopies: row.observedCopies,
      remaining: row.remaining,
      poolTotal: row.poolTotal,
      locked,
      candidates,
    };
  }

  /** 生成带前缀的临时 scanId。 */
  private tempScanId(prefix: string): string {
    return `${prefix}-${Date.now()}`;
  }

  /**
   * 由当前台账生成快照。
   *
   * @param scanId 扫描/操作 id。
   * @param stage 当前阶段。
   * @param errors 错误列表。
   * @param durationMs 本轮耗时。
   */
  private buildSnapshot(
    scanId: string,
    stage: Stage,
    errors: AppError[],
    durationMs: number,
  ): PoolSnapshot | null {
    const baseline = this.baseline;
    if (baseline === null) {
      return null;
    }
    const now = Date.now();
    const rows = computeRemaining(this.state.ledgers, baseline, this.config.get().estimate, {
      now,
      prevRows: this.prevRows,
      geometry: this.zoneCols,
    });
    const coverage: Coverage = computeCoverage(this.state.ledgers);
    const snapshot: PoolSnapshot = {
      scanId,
      generatedAt: now,
      stage,
      coverage,
      rows,
      meta: {
        setNumber: baseline.meta.setNumber,
        patch: baseline.meta.patch,
        baselineConfirmed: baseline.meta.confirmed,
        avgConfidence: averageConfidence(rows),
        lastScanDurationMs: durationMs,
      },
      errors,
    };
    this.prevRows = rows;
    this.lastSnapshot = snapshot;
    return snapshot;
  }
}

/**
 * 平均置信度（0..1）。
 *
 * @param rows 结果行。
 */
export function averageConfidence(rows: ReadonlyArray<RemainingResult>): number {
  if (rows.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const row of rows) {
    sum += row.confidence;
  }
  return sum / rows.length;
}
