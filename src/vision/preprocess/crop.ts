/**
 * 裁剪 + 归一化：把整帧按网格切成一个个 64×64 的候选格（ADR-02 第 2 步）。
 *
 * 约定：
 * - 先按**标定矩形**切出格位矩形，再取**中心 sampleRatio** 区域（避开相邻格与边框）；
 * - 归一化到统一尺寸后再计算 pHash，保证指纹可比；
 * - sharp 不可用时走纯 JS 缩放（见 `scale.ts`），过程不抛异常。
 */

import { cropImage, type PixelRect, type RawImage } from './raw-image';
import { normalizeToSize } from './scale';

/** 归一化尺寸常量（与 `geometry.DEFAULT_NORMALIZE_TO` 对齐）。 */
export const CROP_NORMALIZE_SIZE = 64;

/**
 * 裁剪并归一化到指定尺寸。
 *
 * @param image 源图像。
 * @param rect 裁剪矩形（物理像素，会自动 clamp）。
 * @param size 目标边长，默认 64。
 * @returns 归一化后的 RGBA 图像。
 */
export async function cropAndNormalize(
  image: RawImage,
  rect: PixelRect,
  size: number = CROP_NORMALIZE_SIZE,
): Promise<RawImage> {
  const cropped = cropImage(image, rect);
  if (cropped.width === 0 || cropped.height === 0) {
    return cropped;
  }
  return normalizeToSize(cropped, size);
}

/**
 * 同步裁剪（不做缩放），用于费用条 / 星标等局部小区域采样。
 *
 * @param image 源图像。
 * @param rect 裁剪矩形。
 */
export function cropSync(image: RawImage, rect: PixelRect): RawImage {
  return cropImage(image, rect);
}

/**
 * 把"底部费用条"区域抠出来（费用颜色先验的采样区）。
 *
 * 区域参数来自 `data/cost-colors.json` 的 `sampleRegion`，默认取底部 18%、宽 90%。
 *
 * @param crop 已归一化的格子图（通常 64×64）。
 * @param region 相对区域。
 */
export function cropRelative(crop: RawImage, region: { x: number; y: number; w: number; h: number }): RawImage {
  const rect: PixelRect = {
    x: Math.round(region.x * crop.width),
    y: Math.round(region.y * crop.height),
    w: Math.max(1, Math.round(region.w * crop.width)),
    h: Math.max(1, Math.round(region.h * crop.height)),
  };
  return cropImage(crop, rect);
}
