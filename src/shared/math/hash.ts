/**
 * 感知哈希（pHash / dHash）与汉明距离 —— 纯 JS 实现，零依赖。
 *
 * 用途：
 * - 同槽位指纹判重（ADR-04 去重核心）
 * - 模板粗筛（pHash 汉明距离 Top-N，ADR-02 第 4 步）
 * - 整块棋盘指纹（ADR-05 L2 玩家识别）
 *
 * 输出统一为 **16 位十六进制字符串**（64 bit），便于跨进程传输与比较。
 */

/** pHash / dHash 的下采样尺寸。 */
const PHASH_SIZE = 32;
const PHASH_BITS = 8;
const DHASH_W = 9;
const DHASH_H = 8;

/** 灰度矩阵类型。 */
export type GrayMatrix = Float64Array;

/**
 * 把 RGBA/RGB 像素数据转成灰度矩阵。
 *
 * @param data 像素数据，长度 >= width * height * channels。
 * @param width 图像宽度（像素）。
 * @param height 图像高度（像素）。
 * @param channels 每像素通道数（3 = RGB，4 = RGBA）。
 * @returns 长度 width*height 的灰度数组，取值 0..255。
 */
export function toGrayscale(
  data: Uint8Array | Uint8ClampedArray | number[],
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): GrayMatrix {
  const out = new Float64Array(width * height);
  const total = width * height;
  for (let i = 0; i < total; i += 1) {
    const base = i * channels;
    const r = data[base] ?? 0;
    const g = data[base + 1] ?? 0;
    const b = data[base + 2] ?? 0;
    // ITU-R BT.601 亮度权重
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

/**
 * 用面积平均法把灰度图缩放到 targetW × targetH。
 *
 * 相比最近邻，面积平均对缩放噪声更稳健，有利于指纹稳定。
 */
export function resizeGray(
  gray: GrayMatrix,
  width: number,
  height: number,
  targetW: number,
  targetH: number,
): GrayMatrix {
  const out = new Float64Array(targetW * targetH);
  const xRatio = width / targetW;
  const yRatio = height / targetH;
  for (let ty = 0; ty < targetH; ty += 1) {
    const y0 = Math.floor(ty * yRatio);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((ty + 1) * yRatio)));
    for (let tx = 0; tx < targetW; tx += 1) {
      const x0 = Math.floor(tx * xRatio);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((tx + 1) * xRatio)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += gray[y * width + x] ?? 0;
          count += 1;
        }
      }
      out[ty * targetW + tx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/**
 * 一维 DCT-II（直接实现，N=32 时开销可忽略）。
 *
 * @param input 长度 n 的输入向量。
 * @returns 长度 n 的 DCT 系数。
 */
function dct1d(input: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const scale = Math.PI / n;
  for (let k = 0; k < n; k += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += (input[i] ?? 0) * Math.cos(scale * (i + 0.5) * k);
    }
    const alpha = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
    out[k] = alpha * sum;
  }
  return out;
}

/**
 * 可分离二维 DCT-II。
 *
 * @param matrix 长度 n*n 的输入矩阵（行主序）。
 * @param n 方阵边长。
 * @returns 长度 n*n 的 DCT 系数矩阵。
 */
export function dct2(matrix: Float64Array, n: number): Float64Array {
  const tmp = new Float64Array(n * n);
  const row = new Float64Array(n);
  // 先对每一行做一维 DCT
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      row[x] = matrix[y * n + x] ?? 0;
    }
    const transformed = dct1d(row, n);
    for (let x = 0; x < n; x += 1) {
      tmp[y * n + x] = transformed[x] ?? 0;
    }
  }
  // 再对每一列做一维 DCT
  const out = new Float64Array(n * n);
  const col = new Float64Array(n);
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      col[y] = tmp[y * n + x] ?? 0;
    }
    const transformed = dct1d(col, n);
    for (let y = 0; y < n; y += 1) {
      out[y * n + x] = transformed[y] ?? 0;
    }
  }
  return out;
}

/** 计算 64 位整数数组的中位数（不修改入参）。 */
function median(values: Float64Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const len = sorted.length;
  if (len === 0) {
    return 0;
  }
  const mid = len >> 1;
  if (len % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** 把 64 个 bit 打包成 16 位十六进制字符串。 */
function packBits(bits: ReadonlyArray<number>): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble =
      ((bits[i] ?? 0) << 3) |
      ((bits[i + 1] ?? 0) << 2) |
      ((bits[i + 2] ?? 0) << 1) |
      (bits[i + 3] ?? 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * 计算 pHash。
 *
 * 流程：灰度 → 32×32 面积平均缩放 → 2D DCT-II → 取左上 8×8 低频 →
 * 以（去掉直流分量后的）中位数为阈值二值化 → 64 bit。
 *
 * @param data 像素数据（RGBA 或 RGB）。
 * @param width 图像宽度。
 * @param height 图像高度。
 * @param channels 通道数，默认 4（RGBA）。
 * @returns 16 位十六进制指纹。
 */
export function phash(
  data: Uint8Array | Uint8ClampedArray | number[],
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): string {
  if (width <= 0 || height <= 0) {
    return '0'.repeat(16);
  }
  const gray = toGrayscale(data, width, height, channels);
  const small = resizeGray(gray, width, height, PHASH_SIZE, PHASH_SIZE);
  const coeffs = dct2(small, PHASH_SIZE);

  // 取左上 8×8 低频系数（含直流）
  const lowFreq: number[] = [];
  for (let y = 0; y < PHASH_BITS; y += 1) {
    for (let x = 0; x < PHASH_BITS; x += 1) {
      lowFreq.push(coeffs[y * PHASH_SIZE + x] ?? 0);
    }
  }
  // 直流分量量级远大于交流分量，计算中位数时排除它，避免阈值被拉偏
  const acValues = new Float64Array(lowFreq.slice(1));
  const threshold = median(acValues);

  const bits = lowFreq.map((value) => (value > threshold ? 1 : 0));
  return packBits(bits);
}

/**
 * 计算 dHash（相邻像素差值哈希）。
 *
 * 比 pHash 更快，对渐变更敏感；用于粗筛阶段的补充特征。
 *
 * @returns 16 位十六进制指纹。
 */
export function dhash(
  data: Uint8Array | Uint8ClampedArray | number[],
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): string {
  if (width <= 0 || height <= 0) {
    return '0'.repeat(16);
  }
  const gray = toGrayscale(data, width, height, channels);
  const small = resizeGray(gray, width, height, DHASH_W, DHASH_H);
  const bits: number[] = [];
  for (let y = 0; y < DHASH_H; y += 1) {
    for (let x = 0; x < DHASH_W - 1; x += 1) {
      const left = small[y * DHASH_W + x] ?? 0;
      const right = small[y * DHASH_W + x + 1] ?? 0;
      bits.push(left > right ? 1 : 0);
    }
  }
  return packBits(bits);
}

/** 单个十六进制字符的二进制权重（popcount）。 */
const NIBBLE_POPCOUNT: ReadonlyArray<number> = [
  0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4,
];

/** 解析一个十六进制字符，非法字符按 0 处理。 */
function parseNibble(char: string | undefined): number {
  if (!char) {
    return 0;
  }
  const value = Number.parseInt(char, 16);
  return Number.isNaN(value) ? 0 : value;
}

/**
 * 计算两个十六进制指纹的汉明距离。
 *
 * 长度不等时右侧补 0 对齐（防御性：理论上所有指纹都是 16 位）。
 *
 * @param a 指纹 A。
 * @param b 指纹 B。
 */
export function hammingDistance(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i += 1) {
    const xor = parseNibble(a[i]) ^ parseNibble(b[i]);
    distance += NIBBLE_POPCOUNT[xor] ?? 0;
  }
  return distance;
}

/**
 * 判断两个指纹是否"足够相似"。
 *
 * @param a 指纹 A。
 * @param b 指纹 B。
 * @param threshold 汉明距离阈值，≤ 此值判定相似（默认 6）。
 */
export function isSimilarFingerprint(a: string, b: string, threshold = 6): boolean {
  if (!a || !b) {
    return false;
  }
  return hammingDistance(a, b) <= threshold;
}

/** 归一化指纹：空值统一为 16 个 0，避免 undefined 参与比较。 */
export function normalizeFingerprint(value: string | undefined | null): string {
  if (!value) {
    return '0'.repeat(16);
  }
  return value.length >= 16 ? value.slice(0, 16) : value.padEnd(16, '0');
}
