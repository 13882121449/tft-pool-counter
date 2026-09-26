/**
 * 颜色工具：RGB ↔ HSV 转换、颜色距离、主色提取。
 *
 * 用途：费用颜色先验分类（ADR-02 第 3 步，把 65 类问题降到 ≤14 类）
 * 与星标检测的亮度/饱和度统计。
 *
 * 纯 JS，零依赖，可在 vision worker 与单测中直接使用。
 */

/** RGB 颜色（各分量 0..255）。 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** HSV 颜色（h: 0..360，s/v: 0..1）。 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** HSV 容差区间，用于费用档判定。 */
export interface HsvRange {
  hMin: number;
  hMax: number;
  sMin: number;
  sMax: number;
  vMin: number;
  vMax: number;
}

/** 把 0..255 分量归一到 0..1。 */
function norm255(value: number): number {
  return value / 255;
}

/**
 * RGB → HSV。
 *
 * @param rgb RGB 颜色。
 */
export function rgbToHsv(rgb: Rgb): Hsv {
  const r = norm255(rgb.r);
  const g = norm255(rgb.g);
  const b = norm255(rgb.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

/**
 * HSV → RGB。
 *
 * @param hsv HSV 颜色。
 */
export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = hsv.s;
  const v = hsv.v;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

/**
 * 两个 RGB 颜色的欧氏距离（0..441.67）。
 *
 * @param a 颜色 A。
 * @param b 颜色 B。
 */
export function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 色相环形距离（0..180）。
 *
 * @param a 色相 A（0..360）。
 * @param b 色相 B（0..360）。
 */
export function hueDistance(a: number, b: number): number {
  const diff = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360));
  return diff > 180 ? 360 - diff : diff;
}

/**
 * 判断颜色是否落在 HSV 区间内（色相支持跨 0/360 的环形区间）。
 *
 * @param hsv 待判定颜色。
 * @param range 容差区间。
 */
export function isInHsvRange(hsv: Hsv, range: HsvRange): boolean {
  if (hsv.s < range.sMin || hsv.s > range.sMax) {
    return false;
  }
  if (hsv.v < range.vMin || hsv.v > range.vMax) {
    return false;
  }
  const h = ((hsv.h % 360) + 360) % 360;
  if (range.hMin <= range.hMax) {
    return h >= range.hMin && h <= range.hMax;
  }
  // 跨 0 度的区间，例如 [350, 10]
  return h >= range.hMin || h <= range.hMax;
}

/** 采样统计结果。 */
export interface DominantColorResult {
  /** 出现次数最多的量化颜色。 */
  dominant: Rgb;
  /** dominant 的 HSV 形式。 */
  dominantHsv: Hsv;
  /** 平均颜色。 */
  average: Rgb;
  /** 采样像素总数。 */
  sampleCount: number;
}

/**
 * 从像素采样中提取主色（量化到 4 bit/通道后取众数，抗噪声）。
 *
 * @param data 像素数据（RGBA 或 RGB）。
 * @param channels 每像素通道数。
 * @param step 采样步长（默认 1 = 全采）。
 */
export function extractDominantColor(
  data: Uint8Array | Uint8ClampedArray | number[],
  channels: 3 | 4 = 4,
  step = 1,
): DominantColorResult {
  const histogram = new Map<number, number>();
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let i = 0; i + channels - 1 < data.length; i += channels * step) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    sumR += r;
    sumG += g;
    sumB += b;
    count += 1;
    // 量化到 4 bit/通道
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }

  if (count === 0) {
    const empty: Rgb = { r: 0, g: 0, b: 0 };
    return {
      dominant: empty,
      dominantHsv: rgbToHsv(empty),
      average: empty,
      sampleCount: 0,
    };
  }

  let bestKey = 0;
  let bestCount = -1;
  for (const [key, hits] of histogram) {
    if (hits > bestCount) {
      bestCount = hits;
      bestKey = key;
    }
  }

  const dominant: Rgb = {
    r: ((bestKey >> 8) & 0x0f) * 17,
    g: ((bestKey >> 4) & 0x0f) * 17,
    b: (bestKey & 0x0f) * 17,
  };
  const average: Rgb = {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };

  return {
    dominant,
    dominantHsv: rgbToHsv(dominant),
    average,
    sampleCount: count,
  };
}

/**
 * 计算像素区域的平均亮度（0..1）。
 *
 * @param data 像素数据。
 * @param channels 每像素通道数。
 */
export function averageBrightness(
  data: Uint8Array | Uint8ClampedArray | number[],
  channels: 3 | 4 = 4,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
    count += 1;
  }
  return count === 0 ? 0 : sum / count / 255;
}

/**
 * 统计落在指定亮度阈值之上的像素比例（星标检测用）。
 *
 * @param data 像素数据。
 * @param threshold 亮度阈值（0..255）。
 * @param channels 每像素通道数。
 */
export function brightPixelRatio(
  data: Uint8Array | Uint8ClampedArray | number[],
  threshold: number,
  channels: 3 | 4 = 4,
): number {
  let bright = 0;
  let count = 0;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    count += 1;
    if (luma >= threshold) {
      bright += 1;
    }
  }
  return count === 0 ? 0 : bright / count;
}
