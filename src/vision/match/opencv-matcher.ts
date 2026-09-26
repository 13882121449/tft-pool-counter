/**
 * OpenCV(WASM) 精排（ADR-02 第 5 步）+ **纯 JS NCC 降级**。
 *
 * 双路径设计（ADR-01 降级原则）：
 * 1. `@techstark/opencv-js` 可用 → 用 `matchTemplate(TM_CCOEFF_NORMED)` 精排；
 * 2. 不可用 / 初始化失败 → 用本文件内实现的**归一化互相关（NCC）**纯 JS 版，
 *    在 64×64 的小图上误差可忽略（一次全图匹配仅 4096 次乘加）。
 *
 * 因此"精排"这一步**永远不会因为依赖缺失而失效**，只是精度/速度略有差异。
 */

import { tryImport, pickExport } from '../native/optional-modules';
import { toGrayscale } from '../../shared/math/hash';
import type { RawImage } from '../preprocess/raw-image';
import type { ChampionTemplate } from './template-store';
import type { CoarseHit } from './phash-matcher';

/** OpenCV Mat 的极小接口。 */
interface CvMatLike {
  rows: number;
  cols: number;
  data: Uint8Array | Int32Array | Float32Array;
  delete(): void;
}

/** OpenCV 模块的极小接口。 */
interface CvModuleLike {
  Mat: new (...args: unknown[]) => CvMatLike;
  matFromImageData(imageData: { data: Uint8ClampedArray; width: number; height: number }): CvMatLike;
  cvtColor(src: CvMatLike, dst: CvMatLike, code: number): void;
  matchTemplate(src: CvMatLike, templ: CvMatLike, dst: CvMatLike, method: number): void;
  minMaxLoc(
    src: CvMatLike,
    minVal: unknown,
    maxVal: unknown,
    minLoc: unknown,
    maxLoc: unknown,
  ): void;
  CV_8UC1: number;
  CV_8UC4: number;
  CV_32FC1: number;
  COLOR_RGBA2GRAY: number;
  TM_CCOEFF_NORMED: number;
}

/** 精排命中项。 */
export interface RefinedHit extends CoarseHit {
  /** 精排相似度 0..1（越高越像）。 */
  refinedScore: number;
  /** 使用的精排后端。 */
  matcher: 'opencv' | 'ncc';
}

/** OpenCV 加载状态缓存。 */
let cvCache: { resolved: boolean; cv: CvModuleLike | null; reason?: string } | null = null;

/**
 * 加载 OpenCV WASM 模块（只探测一次，失败后不再重试）。
 *
 * @returns 可用的 cv 模块或 null。
 */
export async function loadOpencv(): Promise<CvModuleLike | null> {
  if (cvCache !== null) {
    return cvCache.cv;
  }
  const result = await tryImport<unknown>('@techstark/opencv-js');
  if (!result.ok || result.module === null) {
    cvCache = { resolved: true, cv: null, reason: result.reason ?? '未安装 @techstark/opencv-js' };
    return null;
  }

  const candidate =
    pickExport<CvModuleLike>(result.module, 'cv') ??
    (typeof (result.module as { default?: unknown }).default === 'object'
      ? ((result.module as { default: CvModuleLike }).default as CvModuleLike)
      : null);

  if (candidate === null || typeof candidate.Mat !== 'function') {
    cvCache = { resolved: true, cv: null, reason: 'OpenCV 导出结构不符合预期' };
    return null;
  }

  // WASM 需要等待 runtime 初始化；@techstark/opencv-js 在部分版本里导出 Promise
  const maybeThenable = candidate as unknown as { then?: (cb: (value: unknown) => void) => void };
  if (typeof maybeThenable.then === 'function') {
    const resolvedCv = await new Promise<CvModuleLike | null>((resolveCv) => {
      const timer = setTimeout(() => resolveCv(null), 5_000);
      try {
        maybeThenable.then?.(() => {
          clearTimeout(timer);
          resolveCv(candidate);
        });
      } catch {
        clearTimeout(timer);
        resolveCv(candidate);
      }
    });
    cvCache =
      resolvedCv === null
        ? { resolved: true, cv: null, reason: 'OpenCV WASM 初始化超时' }
        : { resolved: true, cv: resolvedCv };
    return cvCache.cv;
  }

  cvCache = { resolved: true, cv: candidate };
  return candidate;
}

/** 当前精排后端（设置页展示用）。 */
export async function currentMatcherBackend(): Promise<'opencv' | 'ncc'> {
  const cv = await loadOpencv();
  return cv === null ? 'ncc' : 'opencv';
}

/**
 * 纯 JS 归一化互相关（NCC），尺寸必须一致。
 *
 * @param a 图 A（任意通道数）。
 * @param b 图 B（尺寸需与 A 相同）。
 * @returns -1..1 的相关系数；尺寸不符返回 -1。
 */
export function nccScore(a: RawImage, b: RawImage): number {
  if (a.width !== b.width || a.height !== b.height || a.width === 0 || a.height === 0) {
    return -1;
  }
  const ga = toGrayscale(a.data, a.width, a.height, a.channels);
  const gb = toGrayscale(b.data, b.width, b.height, b.channels);
  const n = ga.length;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += ga[i] ?? 0;
    meanB += gb[i] ?? 0;
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (ga[i] ?? 0) - meanA;
    const db = (gb[i] ?? 0) - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) {
    return 0;
  }
  return num / den;
}

/** 把模板转成 RawImage（缓存，避免每次转灰度重复申请内存）。 */
const templateImageCache = new WeakMap<ChampionTemplate, RawImage>();

/**
 * 模板 → RawImage（带 WeakMap 缓存）。
 *
 * @param template 模板。
 */
function templateToImage(template: ChampionTemplate): RawImage {
  const cached = templateImageCache.get(template);
  if (cached !== undefined) {
    return cached;
  }
  const image: RawImage = {
    width: template.size,
    height: template.size,
    channels: 4,
    format: 'rgba',
    data: template.data,
    scaleFactor: 1,
    capturedAt: 0,
    source: 'template',
  };
  templateImageCache.set(template, image);
  return image;
}

/** 把 RawImage 丢给 OpenCV 做灰度匹配。 */
function opencvScore(cv: CvModuleLike, crop: RawImage, templateImage: RawImage): number | null {
  let src: CvMatLike | null = null;
  let templ: CvMatLike | null = null;
  let graySrc: CvMatLike | null = null;
  let grayTempl: CvMatLike | null = null;
  let result: CvMatLike | null = null;
  try {
    const toImageData = (image: RawImage): ImageDataLike => ({
      data: new Uint8ClampedArray(
        image.data.buffer,
        image.data.byteOffset,
        image.data.byteLength,
      ) as unknown as Uint8ClampedArray,
      width: image.width,
      height: image.height,
    });

    src = cv.matFromImageData(toImageData(crop));
    templ = cv.matFromImageData(toImageData(templateImage));
    graySrc = new cv.Mat(crop.height, crop.width, cv.CV_8UC1);
    grayTempl = new cv.Mat(templateImage.height, templateImage.width, cv.CV_8UC1);
    cv.cvtColor(src, graySrc, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(templ, grayTempl, cv.COLOR_RGBA2GRAY);

    // 同尺寸模板匹配结果矩阵为 1×1
    result = new cv.Mat(graySrc.rows - grayTempl.rows + 1, graySrc.cols - grayTempl.cols + 1, cv.CV_32FC1);
    cv.matchTemplate(graySrc, grayTempl, result, cv.TM_CCOEFF_NORMED);

    // 直接读结果矩阵（1×1 时无需 minMaxLoc）
    const data = result.data;
    if (typeof data === 'object' && data !== null && 'length' in data) {
      const value = Number((data as Float32Array)[0] ?? 0);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    for (const mat of [result, graySrc, grayTempl, src, templ]) {
      try {
        mat?.delete();
      } catch {
        // 释放失败不影响后续
      }
    }
  }
}

/** ImageData 的最小形态（避免依赖 DOM lib）。 */
interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 对粗筛命中的模板做精排。
 *
 * @param crop 观测格的归一化图。
 * @param templates 模板集合（下标需与 CoarseHit.templateIndex 对齐）。
 * @param hits 粗筛命中。
 * @returns 精排后的命中列表（按 refinedScore 降序）。
 */
export async function refineCandidates(
  crop: RawImage,
  templates: ChampionTemplate[],
  hits: CoarseHit[],
): Promise<RefinedHit[]> {
  const cv = await loadOpencv();
  const backend: 'opencv' | 'ncc' = cv === null ? 'ncc' : 'opencv';

  const refined: RefinedHit[] = [];
  for (const hit of hits) {
    const template = templates[hit.templateIndex];
    if (template === undefined) {
      continue;
    }
    const templateImage = templateToImage(template);

    let score: number | null = null;
    if (cv !== null) {
      score = opencvScore(cv, crop, templateImage);
    }
    if (score === null) {
      const ncc = nccScore(crop, templateImage);
      // NCC ∈ [-1, 1] → [0, 1]
      score = Number.isFinite(ncc) ? Math.max(0, Math.min(1, (ncc + 1) / 2)) : 0;
    }

    refined.push({ ...hit, refinedScore: score, matcher: backend });
  }

  refined.sort((a, b) => b.refinedScore - a.refinedScore || a.championId.localeCompare(b.championId));
  return refined;
}

/**
 * 单张模板的精排分数（供采集向导做"自我校验"）。
 *
 * @param crop 观测图。
 * @param template 模板。
 */
export async function scoreAgainstTemplate(
  crop: RawImage,
  template: ChampionTemplate,
): Promise<number> {
  const refined = await refineCandidates(
    crop,
    [template],
    [
      {
        championId: template.championId,
        cost: template.cost,
        templateIndex: 0,
        distance: 0,
        score: 1,
        dHashDistance: 0,
      },
    ],
  );
  return refined[0]?.refinedScore ?? 0;
}
