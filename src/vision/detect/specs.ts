/**
 * 识别参数规格（`data/cost-colors.json` + `data/star-markers.json`）的
 * 类型定义、解析与加载。
 *
 * 设计原则（与卡池基数同一条规矩）：**阈值绝不硬编码在代码里**，
 * 一律从 `data/*.json` 读入，方便用真实截图重新校准（PRD Q4 / 待确认项 2）。
 *
 * 解析函数是纯函数（输入已解析的 JSON），可直接单测；加载函数才碰 fs。
 */

import type { Cost, Star } from '../../shared/types/domain';
import type { HsvRange, Rgb } from '../../shared/math/color';

/** 费用颜色规格中的单项。 */
export interface CostClassSpec {
  cost: Cost;
  nameCn: string;
  hsvRanges: HsvRange[];
  referenceRgb: Rgb;
}

/** 费用颜色先验规格。 */
export interface CostColorSpec {
  /** 是否已经用真实样本校准过。 */
  confirmed: boolean;
  /** 采样区域（相对格子图的 0..1 比例）。 */
  sampleRegion: { anchor: string; heightRatio: number; widthRatio: number };
  costs: CostClassSpec[];
  /** 无法归类时的策略：'unknown-cost-scan-all' 表示不做先验剪枝。 */
  fallbackStrategy: string;
}

/** 星标规格中的单项。 */
export interface StarMarkerSpec {
  star: Star;
  templateFile: string;
  markerCountHint: number;
  hsvRanges: HsvRange[];
  /** 亮像素占比区间 [min, max]。 */
  brightPixelRatioRange: [number, number];
}

/** 星标检测规格。 */
export interface StarMarkerSpecFile {
  /** 不确定时的保守默认星数（1★ → 少算 → 高估剩余，误差方向更安全）。 */
  conservativeDefaultStar: Star;
  minConfidence: number;
  detectRegion: { anchor: string; widthRatio: number; heightRatio: number };
  starMarkers: StarMarkerSpec[];
}

/** 把 JSON 中的 0 基数组安全转成元组。 */
function toPair(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const first = Number(value[0]);
    const second = Number(value[1]);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      return [first, second];
    }
  }
  return fallback;
}

/** 解析单条 HSV 区间。 */
function parseHsvRange(raw: unknown): HsvRange | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const hMin = Number(record.hMin);
  const hMax = Number(record.hMax);
  const sMin = Number(record.sMin);
  const sMax = Number(record.sMax);
  const vMin = Number(record.vMin);
  const vMax = Number(record.vMax);
  if (![hMin, hMax, sMin, sMax, vMin, vMax].every((value) => Number.isFinite(value))) {
    return null;
  }
  return { hMin, hMax, sMin, sMax, vMin, vMax };
}

/** 解析 HSV 区间数组。 */
function parseHsvRanges(raw: unknown): HsvRange[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseHsvRange).filter((range): range is HsvRange => range !== null);
}

/** 解析 RGB。 */
function parseRgb(raw: unknown, fallback: Rgb): Rgb {
  if (raw === null || typeof raw !== 'object') {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const r = Number(record.r);
  const g = Number(record.g);
  const b = Number(record.b);
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return fallback;
  }
  return { r, g, b };
}

/** 判断是否为合法费用档。 */
function isCost(value: number): value is Cost {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/** 判断是否为合法星级。 */
function isStar(value: number): value is Star {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * 解析 `data/cost-colors.json`。
 *
 * @param json 已解析 JSON。
 * @returns 规格对象（结构异常时返回最小可用默认值，不抛异常）。
 */
export function parseCostColorSpec(json: unknown): CostColorSpec {
  const root = (json ?? {}) as Record<string, unknown>;
  const rawCosts = Array.isArray(root.costs) ? root.costs : [];
  const costs: CostClassSpec[] = [];

  for (const item of rawCosts) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const cost = Number(record.cost);
    if (!isCost(cost)) {
      continue;
    }
    costs.push({
      cost,
      nameCn: typeof record.nameCn === 'string' ? record.nameCn : `${cost} 费`,
      hsvRanges: parseHsvRanges(record.hsvRanges),
      referenceRgb: parseRgb(record.referenceRgb, { r: 128, g: 128, b: 128 }),
    });
  }

  const sample = (root.sampleRegion ?? {}) as Record<string, unknown>;
  const fallback = (root.fallback ?? {}) as Record<string, unknown>;

  return {
    confirmed: root.CONFIRMED === true,
    sampleRegion: {
      anchor: typeof sample.anchor === 'string' ? sample.anchor : 'bottom',
      heightRatio: Number.isFinite(Number(sample.heightRatio)) ? Number(sample.heightRatio) : 0.18,
      widthRatio: Number.isFinite(Number(sample.widthRatio)) ? Number(sample.widthRatio) : 0.9,
    },
    costs,
    fallbackStrategy:
      typeof fallback.strategy === 'string' ? fallback.strategy : 'unknown-cost-scan-all',
  };
}

/**
 * 解析 `data/star-markers.json`。
 *
 * @param json 已解析 JSON。
 * @returns 规格对象。
 */
export function parseStarMarkerSpec(json: unknown): StarMarkerSpecFile {
  const root = (json ?? {}) as Record<string, unknown>;
  const rawMarkers = Array.isArray(root.starMarkers) ? root.starMarkers : [];
  const starMarkers: StarMarkerSpec[] = [];

  for (const item of rawMarkers) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const star = Number(record.star);
    if (!isStar(star)) {
      continue;
    }
    starMarkers.push({
      star,
      templateFile: typeof record.templateFile === 'string' ? record.templateFile : `star-${star}.png`,
      markerCountHint: Number.isFinite(Number(record.markerCountHint))
        ? Number(record.markerCountHint)
        : star,
      hsvRanges: parseHsvRanges(record.hsvRanges),
      brightPixelRatioRange: toPair(record.brightPixelRatioRange, [0, 1]),
    });
  }

  const region = (root.detectRegion ?? {}) as Record<string, unknown>;
  const conservative = Number(root.conservativeDefaultStar);

  return {
    conservativeDefaultStar: isStar(conservative) ? conservative : 1,
    minConfidence: Number.isFinite(Number(root.minConfidence)) ? Number(root.minConfidence) : 0.55,
    detectRegion: {
      anchor: typeof region.anchor === 'string' ? region.anchor : 'bottom-center',
      widthRatio: Number.isFinite(Number(region.widthRatio)) ? Number(region.widthRatio) : 0.6,
      heightRatio: Number.isFinite(Number(region.heightRatio)) ? Number(region.heightRatio) : 0.28,
    },
    starMarkers: starMarkers.sort((a, b) => a.star - b.star),
  };
}

/** 内置兜底费用规格（`data/cost-colors.json` 读不到时使用，仍是数据驱动的最小集）。 */
export const FALLBACK_COST_COLOR_SPEC: CostColorSpec = {
  confirmed: false,
  sampleRegion: { anchor: 'bottom', heightRatio: 0.18, widthRatio: 0.9 },
  costs: [
    {
      cost: 1,
      nameCn: '1 费 · 灰白',
      hsvRanges: [{ hMin: 0, hMax: 360, sMin: 0, sMax: 0.18, vMin: 0.6, vMax: 1 }],
      referenceRgb: { r: 220, g: 224, b: 230 },
    },
    {
      cost: 2,
      nameCn: '2 费 · 绿',
      hsvRanges: [{ hMin: 90, hMax: 165, sMin: 0.35, sMax: 1, vMin: 0.4, vMax: 1 }],
      referenceRgb: { r: 60, g: 200, b: 120 },
    },
    {
      cost: 3,
      nameCn: '3 费 · 蓝',
      hsvRanges: [{ hMin: 190, hMax: 250, sMin: 0.35, sMax: 1, vMin: 0.4, vMax: 1 }],
      referenceRgb: { r: 70, g: 140, b: 240 },
    },
    {
      cost: 4,
      nameCn: '4 费 · 紫',
      hsvRanges: [{ hMin: 260, hMax: 310, sMin: 0.3, sMax: 1, vMin: 0.4, vMax: 1 }],
      referenceRgb: { r: 175, g: 95, b: 240 },
    },
    {
      cost: 5,
      nameCn: '5 费 · 金',
      hsvRanges: [{ hMin: 35, hMax: 60, sMin: 0.5, sMax: 1, vMin: 0.5, vMax: 1 }],
      referenceRgb: { r: 245, g: 200, b: 90 },
    },
  ],
  fallbackStrategy: 'unknown-cost-scan-all',
};

/** 内置兜底星标规格。 */
export const FALLBACK_STAR_MARKER_SPEC: StarMarkerSpecFile = {
  conservativeDefaultStar: 1,
  minConfidence: 0.55,
  detectRegion: { anchor: 'bottom-center', widthRatio: 0.6, heightRatio: 0.28 },
  starMarkers: [
    { star: 1, templateFile: 'star-1.png', markerCountHint: 1, hsvRanges: [], brightPixelRatioRange: [0, 0.06] },
    { star: 2, templateFile: 'star-2.png', markerCountHint: 2, hsvRanges: [], brightPixelRatioRange: [0.06, 0.14] },
    { star: 3, templateFile: 'star-3.png', markerCountHint: 3, hsvRanges: [], brightPixelRatioRange: [0.14, 0.24] },
    { star: 4, templateFile: 'star-4.png', markerCountHint: 4, hsvRanges: [], brightPixelRatioRange: [0.24, 1] },
  ],
};
