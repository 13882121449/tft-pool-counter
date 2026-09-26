/**
 * 扫描分段耗时统计 + 超时保护（架构 §9 T03 要点）。
 *
 * 为什么必须有：
 * - 扫描预算 `SCAN_BUDGET_MS = 1500ms`、单次流水线超时 `SCAN_TIMEOUT_MS = 1200ms`
 *   是硬指标，没有分段耗时就无法定位是哪一步（截图/几何/匹配/星标/玩家）拖慢；
 * - 超时保护保证"某一步卡死"不会把调度器一起拖死（扫描绝不能卡主线程的延伸要求）。
 */

import { SCAN_TIMEOUT_MS } from '../shared/constants';

/** 一个分段标记。 */
export interface ProfilerMark {
  name: string;
  /** 相对 start 的时间偏移（ms）。 */
  at: number;
  /** 与上一个标记之间的耗时（ms）。 */
  deltaMs: number;
}

/** 一次剖面结果。 */
export interface ProfileResult {
  totalMs: number;
  marks: ProfilerMark[];
  /** 名称 → 耗时（ms）。 */
  segments: Record<string, number>;
}

/**
 * 扫描剖面器（可注入时钟，便于单测）。
 */
export class ScanProfiler {
  private readonly now: () => number;

  private startedAt = 0;

  private lastAt = 0;

  private marks: ProfilerMark[] = [];

  private running = false;

  /**
   * @param now 时钟注入点，默认 `Date.now`。
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** 开始一次剖面。 */
  start(): void {
    this.startedAt = this.now();
    this.lastAt = this.startedAt;
    this.marks = [];
    this.running = true;
  }

  /**
   * 打一个分段标记。
   *
   * @param name 分段名（如 'capture' / 'geometry' / 'match' / 'star' / 'player'）。
   * @returns 本段耗时（ms）。
   */
  mark(name: string): number {
    if (!this.running) {
      this.start();
    }
    const now = this.now();
    const deltaMs = Math.max(0, now - this.lastAt);
    this.marks.push({ name, at: now - this.startedAt, deltaMs });
    this.lastAt = now;
    return deltaMs;
  }

  /**
   * 结束并产出结果。
   *
   * @returns 剖面结果。
   */
  end(): ProfileResult {
    const totalMs = this.running ? Math.max(0, this.now() - this.startedAt) : 0;
    const segments: Record<string, number> = {};
    for (const mark of this.marks) {
      segments[mark.name] = (segments[mark.name] ?? 0) + mark.deltaMs;
    }
    this.running = false;
    return { totalMs, marks: [...this.marks], segments };
  }

  /** 取某个分段的累计耗时。 */
  segmentMs(name: string): number {
    return this.marks
      .filter((mark) => mark.name === name)
      .reduce((sum, mark) => sum + mark.deltaMs, 0);
  }
}

/**
 * 给 Promise 加超时保护。
 *
 * 注意：超时**不会中断**已开始的计算（JS 单线程无法抢占），但会让调用方
 * 立刻拿到兜底值继续走流程 —— 这对"调度器不能卡死"的目标已经足够。
 *
 * @param promise 被保护的异步任务。
 * @param ms 超时毫秒数，默认 `SCAN_TIMEOUT_MS`(1200)。
 * @param fallback 超时时的兜底值（惰性求值，避免无谓构造）。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = SCAN_TIMEOUT_MS,
  fallback: () => T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ value: fallback(), timedOut: true });
    }, Math.max(1, ms));

    promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      },
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ value: fallback(), timedOut: true });
      },
    );
  });
}

/**
 * 简单的耗时记录器（用于"最近 N 次扫描耗时"的滑动统计）。
 */
export class DurationTracker {
  private readonly samples: number[] = [];

  private readonly capacity: number;

  /**
   * @param capacity 保留样本数，默认 20。
   */
  constructor(capacity = 20) {
    this.capacity = Math.max(1, capacity);
  }

  /** 记录一次耗时。 */
  push(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /** 平均耗时（无样本返回 0）。 */
  average(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    return this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
  }

  /** 最大值。 */
  max(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples);
  }

  /** 样本数。 */
  count(): number {
    return this.samples.length;
  }

  /** 是否超出扫描预算（用于 UI 提示"识别耗时偏高"）。 */
  exceeding(budgetMs: number): boolean {
    return this.average() > budgetMs;
  }
}
