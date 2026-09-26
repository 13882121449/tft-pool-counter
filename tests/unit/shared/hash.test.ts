/**
 * pHash / dHash / 汉明距离单测。
 */

import { describe, expect, it } from 'vitest';
import {
  dhash,
  hammingDistance,
  isSimilarFingerprint,
  normalizeFingerprint,
  phash,
  toGrayscale,
  resizeGray,
} from '../../../src/shared/math/hash';
import {
  averageBrightness,
  brightPixelRatio,
  extractDominantColor,
  hsvToRgb,
  hueDistance,
  isInHsvRange,
  rgbDistance,
  rgbToHsv,
} from '../../../src/shared/math/color';

/**
 * 生成一张合成 RGBA 图。
 *
 * @param width 宽。
 * @param height 高。
 * @param fn 像素生成函数。
 */
function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fn(x, y);
      const base = (y * width + x) * 4;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = 255;
    }
  }
  return data;
}

/** 纯色图。 */
function solid(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  return makeImage(width, height, () => [r, g, b]);
}

/** 棋盘格图。 */
function checker(width: number, height: number, size = 8): Uint8Array {
  return makeImage(width, height, (x, y) =>
    (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? [255, 255, 255] : [0, 0, 0],
  );
}

/** 水平渐变图。 */
function gradient(width: number, height: number): Uint8Array {
  return makeImage(width, height, (x) => {
    const v = Math.round((x / Math.max(1, width - 1)) * 255);
    return [v, v, v];
  });
}

describe('pHash / dHash', () => {
  it('同一张图必须得到相同指纹（确定性）', () => {
    const image = gradient(64, 64);
    expect(phash(image, 64, 64)).toBe(phash(image, 64, 64));
    expect(dhash(image, 64, 64)).toBe(dhash(image, 64, 64));
  });

  it('指纹固定为 16 位十六进制（64 bit）', () => {
    const image = checker(64, 64);
    expect(phash(image, 64, 64)).toMatch(/^[0-9a-f]{16}$/);
    expect(dhash(image, 64, 64)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('差异极大的图，汉明距离应显著大于 0', () => {
    const a = phash(solid(64, 64, 0, 0, 0), 64, 64);
    const b = phash(checker(64, 64), 64, 64);
    expect(hammingDistance(a, b)).toBeGreaterThan(0);
  });

  it('相同内容、不同分辨率的图，指纹应接近（缩放鲁棒性）', () => {
    const small = phash(gradient(32, 32), 32, 32);
    const large = phash(gradient(128, 128), 128, 128);
    // 远小于随机差异（期望 ~32），说明下采样后的频域特征稳定
    expect(hammingDistance(small, large)).toBeLessThanOrEqual(24);
  });

  it('宽高为 0 时安全返回全零指纹', () => {
    expect(phash(new Uint8Array(0), 0, 0)).toBe('0'.repeat(16));
    expect(dhash(new Uint8Array(0), 0, 0)).toBe('0'.repeat(16));
  });
});

describe('汉明距离与相似度判定', () => {
  it('相同指纹距离为 0', () => {
    expect(hammingDistance('a1b2c3d4e5f60718', 'a1b2c3d4e5f60718')).toBe(0);
  });

  it('逐位差异正确计数', () => {
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('长度不等时右侧补零对齐', () => {
    expect(hammingDistance('f', 'f000000000000000')).toBe(0);
  });

  it('isSimilarFingerprint 按阈值判定', () => {
    expect(isSimilarFingerprint('0000000000000000', '0000000000000001', 6)).toBe(true);
    expect(isSimilarFingerprint('0000000000000000', 'ffffffffffffffff', 6)).toBe(false);
    // 空指纹不参与判定
    expect(isSimilarFingerprint('', '0000000000000000', 6)).toBe(false);
  });

  it('normalizeFingerprint 补齐到 16 位', () => {
    expect(normalizeFingerprint('abc')).toBe('abc0000000000000');
    expect(normalizeFingerprint(undefined)).toBe('0'.repeat(16));
  });
});

describe('灰度与缩放', () => {
  it('toGrayscale 使用 BT.601 亮度权重', () => {
    const data = new Uint8Array([255, 0, 0, 255]);
    const gray = toGrayscale(data, 1, 1, 4);
    expect(Math.round(gray[0] ?? -1)).toBe(76); // 0.299 * 255
  });

  it('resizeGray 输出目标尺寸', () => {
    const gray = toGrayscale(solid(64, 64, 100, 100, 100), 64, 64, 4);
    const small = resizeGray(gray, 64, 64, 32, 32);
    expect(small.length).toBe(32 * 32);
    expect(small.every((value) => Math.abs(value - 100) < 1)).toBe(true);
  });
});

describe('颜色工具', () => {
  it('RGB → HSV 往返一致', () => {
    const hsv = rgbToHsv({ r: 255, g: 0, b: 0 });
    expect(hsv.h).toBeCloseTo(0, 5);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
    const back = hsvToRgb(hsv);
    expect(back.r).toBe(255);
    expect(back.g).toBe(0);
    expect(back.b).toBe(0);
  });

  it('灰度色的饱和度为 0', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });

  it('色相距离是环形距离', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });

  it('RGB 欧氏距离', () => {
    expect(rgbDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 })).toBe(5);
  });

  it('isInHsvRange 支持跨 0 度的区间', () => {
    const range = { hMin: 350, hMax: 10, sMin: 0, sMax: 1, vMin: 0, vMax: 1 };
    expect(isInHsvRange({ h: 355, s: 1, v: 1 }, range)).toBe(true);
    expect(isInHsvRange({ h: 5, s: 1, v: 1 }, range)).toBe(true);
    expect(isInHsvRange({ h: 180, s: 1, v: 1 }, range)).toBe(false);
  });

  it('extractDominantColor 取众数颜色', () => {
    const data = new Uint8Array(4 * 10);
    for (let i = 0; i < 9; i += 1) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 10;
      data[i * 4 + 2] = 10;
      data[i * 4 + 3] = 255;
    }
    data[36] = 0;
    data[37] = 0;
    data[38] = 255;
    data[39] = 255;
    const result = extractDominantColor(data, 4);
    expect(result.sampleCount).toBe(10);
    expect(result.dominant.r).toBeGreaterThan(150);
    expect(result.dominant.g).toBeLessThan(60);
  });

  it('averageBrightness 与 brightPixelRatio', () => {
    const white = solid(8, 8, 255, 255, 255);
    const black = solid(8, 8, 0, 0, 0);
    expect(averageBrightness(white)).toBeCloseTo(1, 5);
    expect(averageBrightness(black)).toBeCloseTo(0, 5);
    expect(brightPixelRatio(white, 200)).toBe(1);
    expect(brightPixelRatio(black, 200)).toBe(0);
  });

  it('空数据不崩溃', () => {
    expect(averageBrightness(new Uint8Array(0))).toBe(0);
    expect(brightPixelRatio(new Uint8Array(0), 100)).toBe(0);
    expect(extractDominantColor(new Uint8Array(0)).sampleCount).toBe(0);
  });
});
