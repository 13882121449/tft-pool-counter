/**
 * 星级识别（ADR-02 第 6 步）。
 *
 * 判据：棋子底部的**星标角标**区域（`bottom-center`）内的亮像素占比 +
 * 该区域主色的 HSV 命中情况；参数全部来自 `data/star-markers.json`。
 *
 * **保守原则**（数据文件里写死的产品决策）：
 * > 不确定时保守默认 1★ 并标低置信。
 * > 低星 = 少算已消耗 = 高估剩余，误差方向对用户更安全。
 *
 * 这是本项目"宁可低估消耗，不可高估消耗"的取值方向在视觉层的落地。
 */

import { brightPixelRatio, extractDominantColor, isInHsvRange } from '../../shared/math/color';
import type { Star } from '../../shared/types/domain';
import { cropRelative } from '../preprocess/crop';
import type { RawImage } from '../preprocess/raw-image';
import type { StarMarkerSpec, StarMarkerSpecFile } from './specs';

/** 判定"亮像素"的亮度阈值（0..255）。 */
export const STAR_BRIGHT_LUMA = 205;

/** 星级识别结果。 */
export interface StarDetectResult {
  star: Star;
  /** 0..1；低于 spec.minConfidence 时 UI 应打 LOW_CONFIDENCE 标记。 */
  confidence: number;
  /** 判定依据：'ratio' = 亮像素占比命中；'hsv' = 主色命中；'default' = 保守兜底。 */
  method: 'ratio' | 'hsv' | 'default';
  /** 实测亮像素占比，便于调试与阈值校准。 */
  brightRatio: number;
  /** 命中的规格项（如有）。 */
  matched: Star | null;
}

/** 判断比例是否落在区间内。 */
function inRange(value: number, range: [number, number]): boolean {
  return value >= range[0] && value <= range[1];
}

/**
 * 识别单格星级。
 *
 * @param cell 归一化后的格子图（建议 64×64 RGBA）。
 * @param spec 星标规格。
 */
export function detectStar(cell: RawImage, spec: StarMarkerSpecFile): StarDetectResult {
  const fallback: StarDetectResult = {
    star: spec.conservativeDefaultStar,
    confidence: 0,
    method: 'default',
    brightRatio: 0,
    matched: null,
  };

  if (cell.width === 0 || cell.height === 0 || spec.starMarkers.length === 0) {
    return fallback;
  }

  const region = {
    x: (1 - spec.detectRegion.widthRatio) / 2,
    y: 1 - spec.detectRegion.heightRatio,
    w: spec.detectRegion.widthRatio,
    h: spec.detectRegion.heightRatio,
  };
  const strip = cropRelative(cell, region);
  const ratio = brightPixelRatio(strip.data, STAR_BRIGHT_LUMA, strip.channels);
  const dominant = extractDominantColor(strip.data, strip.channels, 2);

  // 1) 亮像素占比命中（主判据）
  const ratioHits: StarMarkerSpec[] = spec.starMarkers.filter((marker) =>
    inRange(ratio, marker.brightPixelRatioRange),
  );
  if (ratioHits.length > 0) {
    // 多个区间重叠时取"区间更窄"的那个（判别力更强）
    const best = ratioHits.reduce((acc, item) => {
      const accWidth = acc.brightPixelRatioRange[1] - acc.brightPixelRatioRange[0];
      const itemWidth = item.brightPixelRatioRange[1] - item.brightPixelRatioRange[0];
      return itemWidth < accWidth ? item : acc;
    });
    // 命中区间的宽度越窄、越靠近区间中心 → 置信度越高
    const [low, high] = best.brightPixelRatioRange;
    const width = Math.max(1e-6, high - low);
    const center = (low + high) / 2;
    const centered = 1 - Math.min(1, Math.abs(ratio - center) / (width / 2 + 1e-6));
    const sharpness = 1 / (1 + width * 4);
    const confidence = Math.max(0, Math.min(1, 0.5 + centered * 0.3 + sharpness * 0.2));
    return {
      star: best.star,
      confidence: ratioHits.length === 1 ? confidence : confidence * 0.85,
      method: 'ratio',
      brightRatio: ratio,
      matched: best.star,
    };
  }

  // 2) 主色 HSV 命中（辅助判据）
  for (const marker of spec.starMarkers) {
    if (marker.hsvRanges.length === 0) {
      continue;
    }
    if (marker.hsvRanges.some((range) => isInHsvRange(dominant.dominantHsv, range))) {
      const confidence = Math.max(0, Math.min(1, spec.minConfidence + 0.1));
      return {
        star: marker.star,
        confidence,
        method: 'hsv',
        brightRatio: ratio,
        matched: marker.star,
      };
    }
  }

  // 3) 兜底：保守默认 1★ + 低置信（绝不猜高星）
  return {
    ...fallback,
    brightRatio: ratio,
    confidence: Math.max(0, Math.min(spec.minConfidence - 0.05, spec.minConfidence * 0.5)),
  };
}

/**
 * 判断星级识别结果是否需要"低置信"提示。
 *
 * @param result 识别结果。
 * @param spec 星标规格。
 */
export function isLowConfidenceStar(result: StarDetectResult, spec: StarMarkerSpecFile): boolean {
  return result.confidence < spec.minConfidence;
}
