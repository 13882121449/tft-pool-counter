/**
 * **占位模板生成器**（`scripts/make-templates.mjs` 的核心实现）。
 *
 * 为什么需要它：
 * - 用户真正可用的模板必须靠采集向导自建（版权合规，不内置图鉴站素材）；
 * - 但在用户采集之前，识别链路必须能跑通、能被单测、能被 UI 演示。
 *   所以用**确定性合成图**生成一套 65 个占位模板：
 *   同一弈子 id 永远生成同一张图（可复现），不同弈子生成可区分的 pHash。
 *
 * 合成的关键设计：**底色取该费用档的参考色** —— 这样费用颜色先验
 * （cost-classifier）在占位阶段也能被真实验证，而不是"先验永远失效"。
 *
 * 生成物一律标记 `source: 'placeholder'`，UI 会提示用户"请采集真实模板"。
 */

import { dhash } from '../../shared/math/hash';
import type { Cost } from '../../shared/types/domain';
import { createRawImage, fingerprint, type RawImage } from '../preprocess/raw-image';
import { DEBUG_COST_REFERENCE_RGB } from './placeholder-palette';
import {
  TEMPLATE_SIZE,
  writeTemplateFile,
  type ChampionMeta,
  type ChampionTemplate,
} from '../match/template-store';

/** 生成参数。 */
export interface PlaceholderOptions {
  size?: number;
  /** 每个弈子生成几张（默认 1）。 */
  variantsPerChampion?: number;
  /** 全局种子偏移（换一批风格时用）。 */
  seed?: number;
}

/** FNV-1a 字符串哈希（用于把 championId 映射成确定性种子）。 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 由种子构造 xorshift32 伪随机数发生器（确定性，跨平台一致）。 */
export function makeRandom(seed: number): () => number {
  let state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * 生成某个弈子的确定性占位图。
 *
 * @param championId 弈子 id。
 * @param cost 费用档（决定底色）。
 * @param size 边长，默认 64。
 * @param variant 变体序号。
 */
export function generatePlaceholderImage(
  championId: string,
  cost: Cost,
  size: number = TEMPLATE_SIZE,
  variant = 0,
): RawImage {
  const base = DEBUG_COST_REFERENCE_RGB[cost];
  const random = makeRandom(fnv1a(`${championId}#${variant}`));
  const data = new Uint8Array(size * size * 4);

  // 1) 底色 = 费用参考色（让费用先验在占位阶段也可验证）
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = base.r;
    data[i * 4 + 1] = base.g;
    data[i * 4 + 2] = base.b;
    data[i * 4 + 3] = 255;
  }

  // 2) 叠加 6 个确定性色块（制造"人像轮廓"般的结构，让 pHash 可区分）
  const blocks = 6;
  for (let b = 0; b < blocks; b += 1) {
    const w = 8 + Math.floor(random() * (size / 3));
    const h = 8 + Math.floor(random() * (size / 3));
    const x0 = Math.floor(random() * Math.max(1, size - w));
    const y0 = Math.floor(random() * Math.max(1, size - h));
    const shade = 40 + Math.floor(random() * 200);
    const tint = Math.floor(random() * 80);
    for (let y = y0; y < Math.min(size, y0 + h); y += 1) {
      for (let x = x0; x < Math.min(size, x0 + w); x += 1) {
        const idx = (y * size + x) * 4;
        data[idx] = clamp8(shade + tint);
        data[idx + 1] = clamp8(shade);
        data[idx + 2] = clamp8(shade - tint);
        data[idx + 3] = 255;
      }
    }
  }

  // 3) 底部 18% 强制为费用参考色（对应真实卡面的费用色带位置）
  const bandStart = Math.floor(size * 0.82);
  for (let y = bandStart; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      data[idx] = base.r;
      data[idx + 1] = base.g;
      data[idx + 2] = base.b;
      data[idx + 3] = 255;
    }
  }

  return createRawImage({
    width: size,
    height: size,
    data,
    channels: 4,
    format: 'rgba',
    source: 'placeholder',
  });
}

/** 把 0..255 之外的值夹回范围内。 */
function clamp8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * 为一个弈子生成占位模板。
 *
 * @param championId 弈子 id。
 * @param cost 费用档。
 * @param options 参数。
 */
export function generatePlaceholderTemplate(
  championId: string,
  cost: Cost,
  options: PlaceholderOptions = {},
  variant = 0,
): ChampionTemplate {
  const size = options.size ?? TEMPLATE_SIZE;
  const image = generatePlaceholderImage(championId, cost, size, variant);
  return {
    championId,
    cost,
    size,
    channels: 4,
    fingerprint: fingerprint(image),
    dHash: dhash(image.data, image.width, image.height, image.channels),
    data: image.data,
    source: 'placeholder',
  };
}

/**
 * 为一批弈子生成占位模板集合。
 *
 * @param champions 弈子元信息。
 * @param options 参数。
 */
export function generatePlaceholderTemplates(
  champions: readonly ChampionMeta[],
  options: PlaceholderOptions = {},
): ChampionTemplate[] {
  const variants = Math.max(1, options.variantsPerChampion ?? 1);
  const seedOffset = options.seed ?? 0;
  const templates: ChampionTemplate[] = [];
  for (const champion of champions) {
    for (let variant = 0; variant < variants; variant += 1) {
      templates.push(
        generatePlaceholderTemplate(
          champion.id,
          champion.cost,
          { ...options, seed: seedOffset + variant },
          variant,
        ),
      );
    }
  }
  return templates;
}

/**
 * 把占位模板写盘。
 *
 * @param dir 目标目录。
 * @param templates 模板集合。
 * @returns 写入的文件路径列表。
 */
export async function writePlaceholderTemplates(
  dir: string,
  templates: readonly ChampionTemplate[],
): Promise<string[]> {
  const counter = new Map<string, number>();
  const files: string[] = [];
  for (const template of templates) {
    const index = counter.get(template.championId) ?? 0;
    counter.set(template.championId, index + 1);
    files.push(await writeTemplateFile(dir, template, index));
  }
  return files;
}
