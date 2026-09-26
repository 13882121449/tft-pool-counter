/**
 * 图像缩放 / 归一化（ADR-02 第 2 步：每格裁剪后归一化到 64×64）。
 *
 * **双后端**：优先 `sharp`（SIMD 加速、质量更好），不可用时自动降级到
 * `raw-image.ts` 的纯 JS 面积平均缩放。两条路径产出完全相同的尺寸契约，
 * 上层无感知 —— 这是 ADR-01"能力探测 + 自动降级"在预处理层的具体落法。
 */

import { tryImport, pickCallable } from '../native/optional-modules';
import { createRawImage, resizeImage, type RawImage } from './raw-image';

/** sharp 实例的极小接口（只声明本项目用到的方法）。 */
interface SharpInstance {
  resize(width: number, height: number, options?: unknown): SharpInstance;
  ensureAlpha(alpha?: number): SharpInstance;
  raw(): SharpInstance;
  removeAlpha(): SharpInstance;
  png(options?: unknown): SharpInstance;
  jpeg(options?: unknown): SharpInstance;
  toBuffer(options?: unknown): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number; channels?: number }>;
}

/** sharp 模块的可调用形态。 */
type SharpFactory = (
  input: Buffer | Uint8Array,
  options?: unknown,
) => SharpInstance;

/** sharp 加载状态缓存（一个进程内只探测一次）。 */
let sharpCache: { loaded: boolean; factory: SharpFactory | null; reason?: string } | null = null;

/**
 * 探测并加载 sharp。
 *
 * @returns 可用的 sharp 工厂，不可用返回 null。
 */
export async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpCache !== null) {
    return sharpCache.factory;
  }
  const result = await tryImport<unknown>('sharp');
  const factory = result.ok ? pickCallable<SharpFactory>(result.module) : null;
  sharpCache = {
    loaded: factory !== null,
    factory,
    reason: factory === null ? result.reason ?? 'sharp 未安装' : undefined,
  };
  return factory;
}

/**
 * 当前缩放后端（供 UI 展示与日志）。
 *
 * @returns 'sharp' | 'js'。
 */
export async function currentScaleBackend(): Promise<'sharp' | 'js'> {
  const factory = await loadSharp();
  return factory === null ? 'js' : 'sharp';
}

/** 暴露 sharp 不可用的原因，便于设置页提示用户。 */
export function sharpUnavailableReason(): string | undefined {
  return sharpCache?.reason;
}

/**
 * 把任意尺寸图像归一化到 size × size。
 *
 * @param image 源图像。
 * @param size 目标边长，默认 64。
 * @returns 归一化后的 RGBA 图像。
 */
export async function normalizeToSize(image: RawImage, size = 64): Promise<RawImage> {
  if (image.width === size && image.height === size && image.channels === 4) {
    return image;
  }
  const factory = await loadSharp();
  if (factory === null) {
    return resizeImage(image, size, size);
  }

  try {
    const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const pipeline = factory(bytes, {
      raw: {
        width: image.width,
        height: image.height,
        channels: image.channels,
      },
    });
    const buffer = await pipeline
      .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
      .ensureAlpha(255)
      .raw()
      .toBuffer({ resolveWithObject: false });
    return createRawImage({
      width: size,
      height: size,
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      channels: 4,
      format: 'rgba',
      source: image.source,
      capturedAt: image.capturedAt,
      scaleFactor: image.scaleFactor,
    });
  } catch {
    // sharp 运行期失败（不支持的像素格式等）→ 静默降级到纯 JS
    return resizeImage(image, size, size);
  }
}

/**
 * 解码 PNG/JPEG Buffer 为 RawImage（desktopCapturer 回退链路用：
 * 主进程只传压缩帧，解码留在 Vision Worker，避免主进程做重像素运算）。
 *
 * @param bytes 压缩图像字节。
 * @param source 来源标识。
 * @returns 解码后的图像；失败返回 null。
 */
export async function decodeCompressedImage(
  bytes: Uint8Array,
  source: string,
): Promise<RawImage | null> {
  const factory = await loadSharp();
  if (factory === null) {
    return null;
  }
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pipeline = factory(buffer);
    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) {
      return null;
    }
    const raw = await pipeline.ensureAlpha(255).raw().toBuffer({ resolveWithObject: false });
    return createRawImage({
      width,
      height,
      data: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      channels: 4,
      format: 'rgba',
      source,
    });
  } catch {
    return null;
  }
}

/**
 * 把 RawImage 编码成 PNG（模板采集向导把缩略图传给渲染层用）。
 *
 * 渲染进程只需要"能显示"，因此用无损 PNG；sharp 不可用时返回 null，
 * 由调用方回退为传输原始 RGBA。
 *
 * @param image 输入图像。
 * @returns PNG 字节；sharp 不可用或编码失败返回 null。
 */
export async function encodePng(image: RawImage): Promise<Uint8Array | null> {
  const factory = await loadSharp();
  if (factory === null || image.width === 0 || image.height === 0) {
    return null;
  }
  try {
    const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const pipeline = factory(bytes, {
      raw: { width: image.width, height: image.height, channels: image.channels },
    });
    const png = await pipeline.ensureAlpha(255).png({ compressionLevel: 6 }).toBuffer();
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  } catch {
    return null;
  }
}
