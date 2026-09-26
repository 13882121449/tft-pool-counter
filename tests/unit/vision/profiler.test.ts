/**
 * T03 性能保障单测：分段耗时统计 + 超时保护。
 *
 * 硬指标：单次流水线超时 1200ms（`SCAN_TIMEOUT_MS`）、扫描预算 1500ms。
 * 超时保护的价值不是"算得更快"，而是"卡死也不拖垮调度器"。
 */

import { describe, expect, it, vi } from 'vitest';
import { DurationTracker, ScanProfiler, withTimeout } from '../../../src/vision/profiler';

/** 可控时钟。 */
function fakeClock(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

describe('ScanProfiler', () => {
  it('按标记切分段落并累计同名分段耗时', () => {
    // start=0, capture=100, geometry=150, match=400, match=500
    const profiler = new ScanProfiler(fakeClock([0, 100, 150, 400, 500]));
    profiler.start();
    expect(profiler.mark('capture')).toBe(100);
    expect(profiler.mark('geometry')).toBe(50);
    expect(profiler.mark('match')).toBe(250);
    expect(profiler.mark('match')).toBe(100);

    expect(profiler.segmentMs('match')).toBe(350);
    const result = profiler.end();
    expect(result.totalMs).toBe(500);
    expect(result.segments.capture).toBe(100);
    expect(result.segments.geometry).toBe(50);
    expect(result.segments.match).toBe(350);
    expect(result.marks).toHaveLength(4);
  });

  it('未 start 就 mark 会自动开始（容错）', () => {
    const profiler = new ScanProfiler(fakeClock([1000, 1100]));
    const delta = profiler.mark('capture');
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(profiler.end().marks).toHaveLength(1);
  });

  it('end 之后 totalMs 归零（避免重复 end 累加）', () => {
    const profiler = new ScanProfiler(fakeClock([0, 10]));
    profiler.start();
    profiler.mark('a');
    expect(profiler.end().totalMs).toBe(10);
    expect(profiler.end().totalMs).toBe(0);
  });
});

describe('withTimeout', () => {
  it('任务按时完成时返回真实值且 timedOut=false', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 100, () => 'fallback');
    expect(result).toEqual({ value: 'ok', timedOut: false });
  });

  it('任务超时返回兜底值且 timedOut=true（不抛异常）', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);
    const promise = withTimeout(never, 50, () => 'fallback');
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;
    vi.useRealTimers();
    expect(result).toEqual({ value: 'fallback', timedOut: true });
  });

  it('任务 reject 时也返回兜底值（绝不把异常抛给调度器）', async () => {
    const result = await withTimeout(Promise.reject(new Error('boom')), 100, () => 'safe');
    expect(result).toEqual({ value: 'safe', timedOut: true });
  });
});

describe('DurationTracker', () => {
  it('统计平均值与最大值，并限制样本容量', () => {
    const tracker = new DurationTracker(3);
    tracker.push(100);
    tracker.push(200);
    tracker.push(300);
    tracker.push(400);
    expect(tracker.count()).toBe(3);
    expect(tracker.average()).toBeCloseTo(300, 6);
    expect(tracker.max()).toBe(400);
  });

  it('无样本时返回 0', () => {
    const tracker = new DurationTracker();
    expect(tracker.average()).toBe(0);
    expect(tracker.max()).toBe(0);
    expect(tracker.exceeding(1500)).toBe(false);
  });

  it('平均耗时超预算时判为超预算（UI 据此提示识别耗时偏高）', () => {
    const tracker = new DurationTracker();
    tracker.push(2000);
    expect(tracker.exceeding(1500)).toBe(true);
  });
});
