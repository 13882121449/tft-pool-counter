/**
 * `RawImage`：视觉层统一的图像抽象（架构 §3.5）。
 *
 * 设计要点：
 * - 统一为**未压缩的原始像素**（RGBA / BGRA / RGB），避免各模块各自理解 PNG/JPEG；
 * - 所有几何计算都在**物理像素坐标系**进行（ADR-01 已知坑 3：截图 Buffer
 *   的像素尺寸 = 逻辑像素 × scaleFactor）；
 * - 纯 JS 实现缩放/裁剪，保证在 `sharp` 不可用时流程仍然不崩（ADR-01 降级）。
 *
 * 合规：本文件只做内存中的像素运算，不涉及任何进程内存读写或网络传输。
 */

import { phash } from '../../shared/math/hash';

/** 像素排布格式。 */
export type PixelFormat = 'rgba' | 'bgra' | 'rgb';

/** 原始图像。 */
export interface RawImage {
  /** 宽度（物理像素）。 */
  width: number;
  /** 高度（物理像素）。 */
  height: number;
  /** 每像素通道数。 */
  channels: 3 | 4;
  /** 通道排布。 */
  format: PixelFormat;
  /** 像素数据，长度 = width * height * channels。 */
  data: Uint8Array;
  /** 捕获时的 DPI 缩放系数，默认 1。 */
  scaleFactor: number;
  /** 捕获时间戳（epoch ms）。 */
  capturedAt: number;
  /** 来源标识，便于日志排查（'node-screenshots' / 'desktopCapturer' / 'synthetic'）。 */
  source: string;
}

/** 创建 RawImage 的选项。 */
export interface CreateRawImageOptions {
  width: number;
  height: number;
  data: Uint8Array;
  channels?: 3 | 4;
  format?: PixelFormat;
  scaleFactor?: number;
  capturedAt?: number;
  source?: string;
}

/**
 * 构造 RawImage，并做一次长度自检（长度不足时用 0 补齐，绝不抛异常）。
 *
 * @param options 构造选项。
 * @returns 合法的 RawImage。
 */
export function createRawImage(options: CreateRawImageOptions): RawImage {
  const channels = options.channels ?? 4;
  const width = Math.max(0, Math.floor(options.width));
  const height = Math.max(0, Math.floor(options.height));
  const expected = width * height * channels;
  const data = options.data;

  if (data.length === expected) {
    return {
      width,
      height,
      channels,
      format: options.format ?? (channels === 4 ? 'rgba' : 'rgb'),
      data,
      scaleFactor: options.scaleFactor ?? 1,
      capturedAt: options.capturedAt ?? Date.now(),
      source: options.source ?? 'unknown',
    };
  }

  // 长度不匹配时补齐/截断：宁可得到一张错误的图，也不要让整个扫描链路崩溃
  const normalized = new Uint8Array(expected);
  normalized.set(data.subarray(0, Math.min(data.length, expected)));
  return {
    width,
    height,
    channels,
    format: options.format ?? (channels === 4 ? 'rgba' : 'rgb'),
    data: normalized,
    scaleFactor: options.scaleFactor ?? 1,
    capturedAt: options.capturedAt ?? Date.now(),
    source: options.source ?? 'unknown',
  };
}

/** 帧统计信息，用于黑帧/纯色帧判定。 */
export interface FrameStats {
  /** 平均亮度（0..255）。 */
  meanLuma: number;
  /** 亮度方差（越大表示画面越有内容）。 */
  variance: number;
  /** 最大亮度（0..255）。 */
  maxLuma: number;
  /** 亮度 >= blackLuma 的像素占比（0..1）。 */
  nonBlackRatio: number;
  /** 参与统计的像素数。 */
  sampled: number;
}

/**
 * 计算帧的亮度统计（带步长采样，避免 4K 帧的全量遍历开销）。
 *
 * @param image 输入图像。
 * @param step 采样步长，默认 4（每 4 个像素取 1 个）。
 * @param blackLuma 判定"非黑"的亮度阈值，默认 8。
 */
export function computeFrameStats(image: RawImage, step = 4, blackLuma = 8): FrameStats {
  const { width, height, channels, data } = image;
  const stride = Math.max(1, Math.floor(step));
  let sum = 0;
  let sumSq = 0;
  let maxLuma = 0;
  let nonBlack = 0;
  let sampled = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const base = (y * width + x) * channels;
      const r = data[base] ?? 0;
      const g = data[base + 1] ?? 0;
      const b = data[base + 2] ?? 0;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += luma;
      sumSq += luma * luma;
      if (luma > maxLuma) {
        maxLuma = luma;
      }
      if (luma >= blackLuma) {
        nonBlack += 1;
      }
      sampled += 1;
    }
  }

  if (sampled === 0) {
    return { meanLuma: 0, variance: 0, maxLuma: 0, nonBlackRatio: 0, sampled: 0 };
  }

  const mean = sum / sampled;
  const variance = Math.max(0, sumSq / sampled - mean * mean);
  return {
    meanLuma: mean,
    variance,
    maxLuma,
    nonBlackRatio: nonBlack / sampled,
    sampled,
  };
}

/**
 * 判定是否为黑帧（ADR-01 已知坑 2：独占全屏下 WGC 可能返回黑帧）。
 *
 * @param image 输入图像。
 * @param options 阈值。
 */
export function isBlackFrame(
  image: RawImage,
  options: { maxLuma?: number; minNonBlackRatio?: number; step?: number } = {},
): boolean {
  const maxLuma = options.maxLuma ?? 8;
  const minNonBlackRatio = options.minNonBlackRatio ?? 0.01;
  const stats = computeFrameStats(image, options.step ?? 4, maxLuma);
  return stats.maxLuma <= maxLuma || stats.nonBlackRatio < minNonBlackRatio;
}

/**
 * 判定是否为"有内容"的帧（非黑且方差足够）。
 *
 * 用于 CaptureManager 的能力探测：连续 N 帧通过才算后端可用。
 *
 * @param image 输入图像。
 * @param minVariance 最小亮度方差，默认 4。
 * @param maxLuma 黑帧亮度阈值，默认 8。
 */
export function isUsableFrame(image: RawImage, minVariance = 4, maxLuma = 8): boolean {
  if (isBlackFrame(image, { maxLuma })) {
    return false;
  }
  const stats = computeFrameStats(image, 4, maxLuma);
  return stats.variance >= minVariance;
}

/**
 * 把 BGRA 转成 RGBA（node-screenshots 在 Windows 上直出 BGRA）。
 *
 * @param image 输入图像（就地转换，返回同一对象以便链式调用）。
 */
export function bgraToRgbaInPlace(image: RawImage): RawImage {
  if (image.format !== 'bgra' || image.channels !== 4) {
    return image;
  }
  const { data } = image;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const b = data[i] ?? 0;
    const r = data[i + 2] ?? 0;
    data[i] = r;
    data[i + 2] = b;
  }
  image.format = 'rgba';
  return image;
}

/** 像素矩形（物理像素，左上原点）。 */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把矩形裁剪到图像范围内（越界返回零宽/零高矩形，不抛异常）。
 *
 * @param rect 待裁剪矩形。
 * @param width 图像宽度。
 * @param height 图像高度。
 */
export function clampRect(rect: PixelRect, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.min(width, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height, Math.round(rect.y)));
  const right = Math.max(0, Math.min(width, Math.round(rect.x + rect.w)));
  const bottom = Math.max(0, Math.min(height, Math.round(rect.y + rect.h)));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * 按矩形裁剪出子图（共享原 buffer 的拷贝，避免后续处理影响原帧）。
 *
 * @param image 源图像。
 * @param rect 裁剪矩形（自动 clamp 到图像内）。
 * @returns 新的 RawImage；矩形无效时返回 0×0 图像。
 */
export function cropImage(image: RawImage, rect: PixelRect): RawImage {
  const clamped = clampRect(rect, image.width, image.height);
  if (clamped.w === 0 || clamped.h === 0) {
    return createRawImage({
      width: 0,
      height: 0,
      data: new Uint8Array(0),
      channels: image.channels,
      format: image.format,
      source: image.source,
      capturedAt: image.capturedAt,
      scaleFactor: image.scaleFactor,
    });
  }

  const { channels } = image;
  const out = new Uint8Array(clamped.w * clamped.h * channels);
  for (let row = 0; row < clamped.h; row += 1) {
    const srcBase = ((clamped.y + row) * image.width + clamped.x) * channels;
    const dstBase = row * clamped.w * channels;
    out.set(image.data.subarray(srcBase, srcBase + clamped.w * channels), dstBase);
  }

  return createRawImage({
    width: clamped.w,
    height: clamped.h,
    data: out,
    channels,
    format: image.format,
    source: image.source,
    capturedAt: image.capturedAt,
    scaleFactor: image.scaleFactor,
  });
}

/**
 * 面积平均缩放（纯 JS，作为 `sharp` 不可用时的降级路径）。
 *
 * @param image 源图像。
 * @param targetW 目标宽度。
 * @param targetH 目标高度。
 * @returns 缩放后的新图像。
 */
export function resizeImage(image: RawImage, targetW: number, targetH: number): RawImage {
  const width = Math.max(0, Math.floor(targetW));
  const height = Math.max(0, Math.floor(targetH));
  if (width === 0 || height === 0 || image.width === 0 || image.height === 0) {
    return createRawImage({
      width,
      height,
      data: new Uint8Array(width * height * image.channels),
      channels: image.channels,
      format: image.format,
      source: image.source,
      capturedAt: image.capturedAt,
      scaleFactor: image.scaleFactor,
    });
  }

  const { channels, data } = image;
  const out = new Uint8Array(width * height * channels);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let ty = 0; ty < height; ty += 1) {
    const y0 = Math.floor(ty * yRatio);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((ty + 1) * yRatio)));
    for (let tx = 0; tx < width; tx += 1) {
      const x0 = Math.floor(tx * xRatio);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((tx + 1) * xRatio)));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const base = (sy * image.width + sx) * channels;
          sr += data[base] ?? 0;
          sg += data[base + 1] ?? 0;
          sb += data[base + 2] ?? 0;
          sa += channels === 4 ? data[base + 3] ?? 0 : 255;
          count += 1;
        }
      }
      const dst = (ty * width + tx) * channels;
      out[dst] = count > 0 ? Math.round(sr / count) : 0;
      out[dst + 1] = count > 0 ? Math.round(sg / count) : 0;
      out[dst + 2] = count > 0 ? Math.round(sb / count) : 0;
      if (channels === 4) {
        out[dst + 3] = count > 0 ? Math.round(sa / count) : 255;
      }
    }
  }

  return createRawImage({
    width,
    height,
    data: out,
    channels,
    format: image.format,
    source: image.source,
    capturedAt: image.capturedAt,
    scaleFactor: image.scaleFactor,
  });
}

/** 取矩形内的子区域（相对比例，0..1），用于费用条/星标等局部采样。 */
export interface RelativeRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把相对区域换算为图像内的绝对矩形。
 *
 * @param image 基准图像。
 * @param region 相对区域（0..1）。
 */
export function relativeToRect(image: RawImage, region: RelativeRegion): PixelRect {
  return {
    x: Math.round(region.x * image.width),
    y: Math.round(region.y * image.height),
    w: Math.max(0, Math.round(region.w * image.width)),
    h: Math.max(0, Math.round(region.h * image.height)),
  };
}

/**
 * 计算图像的 pHash 指纹（统一走 shared 的纯 JS 实现）。
 *
 * @param image 输入图像。
 * @returns 16 位十六进制指纹。
 */
export function fingerprint(image: RawImage): string {
  if (image.width === 0 || image.height === 0) {
    return '0'.repeat(16);
  }
  return phash(image.data, image.width, image.height, image.channels);
}

/**
 * 逐像素比较两张尺寸相同的图像，返回差异像素比例（用于帧间运动检测）。
 *
 * @param a 图 A。
 * @param b 图 B。
 * @param lumaDelta 判定"有变化"的亮度差阈值，默认 12。
 * @returns 变化像素占比（0..1）；尺寸不同时返回 1（视为剧烈变化）。
 */
export function diffRatio(a: RawImage, b: RawImage, lumaDelta = 12): number {
  if (a.width !== b.width || a.height !== b.height) {
    return 1;
  }
  const step = 4;
  let changed = 0;
  let total = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const base = (y * a.width + x) * a.channels;
      const la = 0.299 * (a.data[base] ?? 0) + 0.587 * (a.data[base + 1] ?? 0) + 0.114 * (a.data[base + 2] ?? 0);
      const lb = 0.299 * (b.data[base] ?? 0) + 0.587 * (b.data[base + 1] ?? 0) + 0.114 * (b.data[base + 2] ?? 0);
      total += 1;
      if (Math.abs(la - lb) >= lumaDelta) {
        changed += 1;
      }
    }
  }
  return total === 0 ? 0 : changed / total;
}

/**
 * 构造一张纯色测试图（合成图 / 单测用，便于在无真实截图时跑通链路）。
 *
 * @param width 宽度。
 * @param height 高度。
 * @param rgb 填充颜色。
 */
export function createSolidImage(width: number, height: number, rgb: [number, number, number]): RawImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return createRawImage({ width, height, data, channels: 4, format: 'rgba', source: 'synthetic' });
}
