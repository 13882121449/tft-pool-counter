/**
 * QA2 独立审计 —— 2.2 降级路径。
 *
 * 验证 ADR-01 的"可选依赖缺失 / 后端失败 → 自动降级、绝不抛异常"承诺：
 *   a) `tryImport` 对不存在的模块返回 `{ok:false}` 而非抛出；
 *   b) 能力探测阶段：不支持的依赖被跳过，选第一个可用后端；
 *   c) 全后端不可用 → `capture()` 返回错误对象（不抛），degraded=true；
 *   d) 运行期连续失败达阈值 → 自动切下一个后端并重试一次；
 *   e) 默认管理器后端顺序 = node-screenshots → desktopCapturer。
 */

import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../src/shared/types/domain';
import { createSolidImage, type RawImage } from '../../src/vision/preprocess/raw-image';
import { tryImport } from '../../src/vision/native/optional-modules';
import {
  CaptureManager,
  createCaptureManager,
  DEGRADE_AFTER_FAILURES,
} from '../../src/vision/capture/capture-manager';
import type {
  CapabilityProbeResult,
  CaptureBackendId,
  Capturer,
} from '../../src/vision/capture/types';

const okProbe: CapabilityProbeResult = {
  ok: true,
  frames: 3,
  usableFrames: 3,
  avgVariance: 30,
  avgLuma: 120,
  elapsedMs: 1,
};

/** 可编程的假后端。 */
class FakeCapturer implements Capturer {
  readonly id: CaptureBackendId;

  constructor(
    id: CaptureBackendId,
    private readonly opts: {
      supported: boolean;
      probeOk?: boolean;
      captureWorks?: boolean;
    },
  ) {
    this.id = id;
  }

  captureCalls = 0;

  async isSupported(): Promise<boolean> {
    return this.opts.supported;
  }

  async probe(): Promise<CapabilityProbeResult> {
    return { ...okProbe, ok: this.opts.probeOk ?? true };
  }

  async capture(): Promise<{ image: RawImage | null; error: AppError | null }> {
    this.captureCalls += 1;
    if (this.opts.captureWorks ?? true) {
      return { image: createSolidImage(4, 4, [10, 20, 30]), error: null };
    }
    return {
      image: null,
      error: { code: 'CAP_TIMEOUT', message: 'timeout', at: 0, fatal: false },
    };
  }

  dispose(): void {
    /* no-op */
  }
}

describe('2.2 可选模块安全加载', () => {
  it('加载不存在的模块 → 返回 ok:false，绝不抛出', async () => {
    const result = await tryImport('__definitely_not_installed_module__');
    expect(result.ok).toBe(false);
    expect(result.module).toBeNull();
    expect(typeof result.reason).toBe('string');
  });

  it('加载存在的内建模块 → 返回 ok:true', async () => {
    const result = await tryImport<typeof import('node:path')>('node:path');
    expect(result.ok).toBe(true);
    expect(result.module).not.toBeNull();
  });
});

describe('2.2 捕获后端能力探测与降级', () => {
  it('首选后端不支持 → 自动选下一个可用后端，标记 degraded', async () => {
    const primary = new FakeCapturer('node-screenshots', { supported: false });
    const fallback = new FakeCapturer('desktopCapturer', { supported: true, probeOk: true });
    const manager = new CaptureManager([primary, fallback]);

    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
    expect(status.degraded).toBe(true);
    expect(status.backends[0]!.supported).toBe(false);
  });

  it('全后端不可用 → capture 返回错误对象而非抛异常', async () => {
    const manager = new CaptureManager([
      new FakeCapturer('node-screenshots', { supported: false }),
      new FakeCapturer('desktopCapturer', { supported: false }),
    ]);
    await manager.init();

    const outcome = await manager.capture();
    expect(outcome.image).toBeNull();
    expect(outcome.backend).toBeNull();
    expect(outcome.degraded).toBe(true);
    expect(outcome.errors.map((e) => e.code)).toContain('CAP_BACKEND_UNAVAILABLE');
  });

  it('运行期连续失败达阈值 → 自动切到回退后端并重试成功', async () => {
    const failing = new FakeCapturer('node-screenshots', { supported: true, captureWorks: false });
    const working = new FakeCapturer('desktopCapturer', { supported: true, captureWorks: true });
    const manager = new CaptureManager([failing, working], { degradeAfterFailures: 2 });
    await manager.init();
    expect(manager.getActiveBackend()).toBe('node-screenshots');

    // 第 1 次失败：未达阈值，不降级
    const first = await manager.capture();
    expect(first.image).toBeNull();
    expect(first.backend).toBe('node-screenshots');

    // 第 2 次失败：达阈值 → 降级 + 立即重试成功
    const second = await manager.capture();
    expect(second.image).not.toBeNull();
    expect(second.backend).toBe('desktopCapturer');
    expect(second.degraded).toBe(true);
  });

  it('降级阈值默认值被显式导出（可配置）', () => {
    expect(DEGRADE_AFTER_FAILURES).toBe(3);
  });

  it('createCaptureManager 默认后端顺序：node-screenshots → desktopCapturer', async () => {
    const manager = createCaptureManager({ runProbe: false, enableFallback: true });
    const status = await manager.init();
    // 探测顺序应保留候选顺序
    expect(status.backends.map((b) => b.id)).toEqual(['node-screenshots', 'desktopCapturer']);
  });

  it('probe 抛异常被吞掉视为不可用（safeIsSupported 兜底）', async () => {
    const evil = new FakeCapturer('node-screenshots', { supported: true });
    vi.spyOn(evil, 'isSupported').mockRejectedValue(new Error('boom'));
    const fallback = new FakeCapturer('desktopCapturer', { supported: true });
    const manager = new CaptureManager([evil, fallback], { runProbe: false });
    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
  });
});
