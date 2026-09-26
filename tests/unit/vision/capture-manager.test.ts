/**
 * T03 捕获策略层单测（ADR-01）：
 * **能力探测（连拍 3 帧非纯黑）→ 选定后端 → 失败自动降级**。
 *
 * 这是"依赖缺失/独占全屏拿黑帧"这两类现实故障的防线：
 * 全部后端都不可用时必须**返回错误对象而不是抛异常**，调度器才不会崩。
 */

import { describe, expect, it } from 'vitest';
import { makeError } from '../../../src/shared/ipc/error-codes';
import type { AppError } from '../../../src/shared/types/domain';
import {
  CaptureManager,
  type CaptureManagerOptions,
} from '../../../src/vision/capture/capture-manager';
import { NodeScreenshotsCapturer } from '../../../src/vision/capture/node-screenshots-capturer';
import {
  BLACK_FRAME_MAX_LUMA,
  type CapabilityProbeResult,
  type CaptureBackendId,
  type Capturer,
} from '../../../src/vision/capture/types';
import {
  computeFrameStats,
  createRawImage,
  createSolidImage,
  isUsableFrame,
  type RawImage,
} from '../../../src/vision/preprocess/raw-image';

/** 造一张有结构的确定性图（方差足够大 → 判定为"有内容"）。 */
function noisyImage(size = 64, seed = 7): RawImage {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const value = (x * 5 + y * 11 + seed * 17) % 256;
      data[idx] = value;
      data[idx + 1] = (value * 3) % 256;
      data[idx + 2] = (255 - value) % 256;
      data[idx + 3] = 255;
    }
  }
  return createRawImage({ width: size, height: size, data, channels: 4 });
}

/** 可控的假后端。 */
class FakeCapturer implements Capturer {
  readonly id: CaptureBackendId;

  private failures = 0;

  /** 是否已"上膛"（上膛后 capture 才开始按 failTimes 失败）。 */
  private armed = false;

  constructor(
    id: CaptureBackendId,
    private readonly options: {
      supported?: boolean;
      usable?: boolean;
      /** 上膛后前 N 次 capture 故意失败。 */
      failTimes?: number;
    } = {},
  ) {
    this.id = id;
  }

  /** 让失败计数从下一次 capture 开始生效（避免被 probe 消耗掉）。 */
  arm(): void {
    this.armed = true;
    this.failures = 0;
  }

  async isSupported(): Promise<boolean> {
    return this.options.supported !== false;
  }

  async probe(frames = 3): Promise<CapabilityProbeResult> {
    const result: CapabilityProbeResult = {
      ok: false,
      frames: 0,
      usableFrames: 0,
      avgVariance: 0,
      avgLuma: 0,
      elapsedMs: 0,
    };
    if (!(await this.isSupported())) {
      result.reason = '假的：不支持';
      return result;
    }
    let varianceSum = 0;
    let lumaSum = 0;
    for (let i = 0; i < frames; i += 1) {
      const { image, error } = await this.capture();
      result.frames += 1;
      if (image === null) {
        result.reason = error?.message ?? '假的：捕获失败';
        return result;
      }
      const stats = computeFrameStats(image, 4, BLACK_FRAME_MAX_LUMA);
      varianceSum += stats.variance;
      lumaSum += stats.meanLuma;
      if (isUsableFrame(image, 4, BLACK_FRAME_MAX_LUMA)) {
        result.usableFrames += 1;
      }
    }
    result.avgVariance = varianceSum / result.frames;
    result.avgLuma = lumaSum / result.frames;
    result.ok = result.usableFrames >= frames;
    if (!result.ok) {
      result.reason = '假的：连续捕获到纯黑帧（疑似独占全屏），请在游戏内改为「无边框全屏」';
    }
    return result;
  }

  async capture(): Promise<{ image: RawImage | null; error: AppError | null }> {
    if (
      this.armed &&
      this.options.failTimes !== undefined &&
      this.failures < this.options.failTimes
    ) {
      this.failures += 1;
      return { image: null, error: makeError('CAP_TIMEOUT', { message: '假的：超时' }) };
    }
    if (this.options.usable === false) {
      return { image: createSolidImage(64, 64, [0, 0, 0]), error: null };
    }
    return { image: noisyImage(), error: null };
  }

  dispose(): void {
    // 假的：无资源可释放
  }
}

/** 主选 + 回退 两个假后端。 */
function makeManager(
  mainOptions: ConstructorParameters<typeof FakeCapturer>[1] = {},
  fallbackOptions: ConstructorParameters<typeof FakeCapturer>[1] = {},
  managerOptions: Partial<CaptureManagerOptions> = {},
): { manager: CaptureManager; main: FakeCapturer; fallback: FakeCapturer } {
  const main = new FakeCapturer('node-screenshots', mainOptions);
  const fallback = new FakeCapturer('desktopCapturer', fallbackOptions);
  const manager = new CaptureManager([main, fallback], { runProbe: true, ...managerOptions });
  return { manager, main, fallback };
}

describe('CaptureManager 能力探测', () => {
  it('首选后端连拍 3 帧非纯黑 → 选它，且不是降级态', async () => {
    const { manager } = makeManager();
    const status = await manager.init();
    expect(status.activeBackend).toBe('node-screenshots');
    expect(status.degraded).toBe(false);
    expect(status.backends[0]).toMatchObject({
      id: 'node-screenshots',
      supported: true,
      probeOk: true,
    });
  });

  it('首选连拍全是纯黑帧 → 自动降级到回退后端，并带中文原因', async () => {
    const { manager } = makeManager({ usable: false });
    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
    expect(status.degraded).toBe(true);
    expect(status.backends[0]!.probeOk).toBe(false);
    expect(status.backends[0]!.reason).toContain('无边框全屏');
  });

  it('后端依赖缺失（isSupported=false）→ 直接跳过，不参与探测', async () => {
    const { manager } = makeManager({ supported: false });
    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
    expect(status.backends[0]).toMatchObject({ supported: false });
    expect(status.backends[0]!.avgVariance).toBe(0);
  });

  it('全部后端不可用 → activeBackend=null、degraded=true，capture 返回错误而不抛异常', async () => {
    const { manager } = makeManager({ supported: false }, { usable: false });
    const status = await manager.init();
    expect(status.activeBackend).toBeNull();
    expect(status.degraded).toBe(true);

    const outcome = await manager.capture();
    expect(outcome.image).toBeNull();
    expect(outcome.errors.map((error) => error.code)).toContain('CAP_BACKEND_UNAVAILABLE');
  });

  it('runProbe=false 时跳过探测，直接选第一个"声明支持"的后端', async () => {
    const { manager } = makeManager({}, {}, { runProbe: false });
    const status = await manager.init();
    expect(status.activeBackend).toBe('node-screenshots');
    expect(status.backends[0]!.probeOk).toBe(true);
  });

  it('preferred 指定回退后端时把它排到最前并优先生效', async () => {
    const { manager } = makeManager({}, {}, { preferred: 'desktopCapturer' });
    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
    expect(status.degraded).toBe(false);
  });

  it('preferred 指向不可用的后端时回落到下一个可用后端（降级态）', async () => {
    const { manager } = makeManager({ supported: false }, {}, { preferred: 'node-screenshots' });
    const status = await manager.init();
    expect(status.activeBackend).toBe('desktopCapturer');
    expect(status.degraded).toBe(true);
  });
});

describe('CaptureManager 运行期降级', () => {
  it('连续失败达到阈值后自动切换后端并立即重试成功', async () => {
    const { manager, main } = makeManager({ failTimes: 3 }, {}, { degradeAfterFailures: 3 });
    await manager.init();
    // 能力探测用的是成功的帧；从这里开始让主后端"坏掉"
    main.arm();

    const first = await manager.capture();
    expect(first.image).toBeNull();
    expect(first.backend).toBe('node-screenshots');
    expect(manager.getStatus().consecutiveFailures).toBe(1);

    const second = await manager.capture();
    expect(second.image).toBeNull();
    expect(manager.getStatus().consecutiveFailures).toBe(2);

    // 第三次达到阈值 → 切到回退后端并重试一次，直接拿到图
    const third = await manager.capture();
    expect(third.image).not.toBeNull();
    expect(third.backend).toBe('desktopCapturer');
    expect(third.degraded).toBe(true);
    expect(manager.getActiveBackend()).toBe('desktopCapturer');
  });

  it('成功后连续失败计数清零（不会因为历史失败误判降级）', async () => {
    const { manager, main } = makeManager({ failTimes: 2 }, {}, { degradeAfterFailures: 5 });
    await manager.init();
    main.arm();
    await manager.capture();
    await manager.capture();
    expect(manager.getStatus().consecutiveFailures).toBe(2);
    const ok = await manager.capture();
    expect(ok.image).not.toBeNull();
    expect(manager.getStatus().consecutiveFailures).toBe(0);
  });

  it('未 init 时 capture 会自动初始化（懒加载）', async () => {
    const { manager } = makeManager();
    const outcome = await manager.capture();
    expect(outcome.image).not.toBeNull();
    expect(manager.getActiveBackend()).toBe('node-screenshots');
  });
});

describe('NodeScreenshotsCapturer 契约', () => {
  it('isSupported() 永远返回布尔值而不是抛异常（依赖缺失时的降级契约）', async () => {
    const capturer = new NodeScreenshotsCapturer();
    await expect(capturer.isSupported()).resolves.toBeTypeOf('boolean');
    capturer.dispose();
  });

  it('不可用时 probe() 返回 ok=false 且带原因，不抛异常', async () => {
    const capturer = new NodeScreenshotsCapturer();
    const supported = await capturer.isSupported();
    if (!supported) {
      const probe = await capturer.probe(1);
      expect(probe.ok).toBe(false);
      expect(probe.reason).toBeTruthy();
    }
    capturer.dispose();
  });
});
