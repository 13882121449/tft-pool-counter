/**
 * 识别模板库（ADR-02 第 4 步的输入）。
 *
 * 素材来源的**版权决策（PRD Q6，用户已拍板）**：
 * > 不内置任何图鉴站素材，改为**用户自建采集向导**。
 * 因此本项目只提供：
 * - 采集向导（`src/vision/templates/capture-wizard.ts`）把用户截下的棋子截图切成 64×64；
 * - `scripts/make-templates.mjs` 生成**确定性占位模板**，让链路在用户采集前也能跑通；
 * - zip 导入 / 导出，方便用户迁移已采集的模板库。
 *
 * 模板落盘格式（自描述、无外部依赖）：
 * ```json
 * { "championId": "ahri", "size": 64, "channels": 4,
 *   "fingerprint": "…", "dHash": "…", "dataBase64": "…" }
 * ```
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dhash } from '../../shared/math/hash';
import type { Cost } from '../../shared/types/domain';
import { createRawImage, fingerprint, type RawImage } from '../preprocess/raw-image';
import { normalizeToSize } from '../preprocess/scale';

/** 模板归一化尺寸。 */
export const TEMPLATE_SIZE = 64;

/** 弈子元信息（模板库只需要 id + cost 就能支撑费用先验剪枝）。 */
export interface ChampionMeta {
  id: string;
  cost: Cost;
}

/** 单个模板。 */
export interface ChampionTemplate {
  championId: string;
  cost: Cost;
  size: number;
  channels: 4;
  /** pHash 指纹。 */
  fingerprint: string;
  /** dHash 指纹。 */
  dHash: string;
  /** RGBA 原始像素，长度 = size * size * 4。 */
  data: Uint8Array;
  source: 'user' | 'placeholder';
}

/** 模板库统计。 */
export interface TemplateStoreStats {
  total: number;
  championCount: number;
  byCost: Record<Cost, number>;
  dir: string;
  /** 是否处于"无用户模板，仅有占位模板"状态。 */
  placeholderOnly: boolean;
  errors: string[];
}

/** 模板库接口。 */
export interface TemplateStore {
  /** 加载（幂等）。 */
  init(): Promise<void>;
  /** 是否已加载。 */
  isLoaded(): boolean;
  /** 模板总数。 */
  size(): number;
  /** 全部模板。 */
  all(): ChampionTemplate[];
  /** 某弈子的全部模板。 */
  byChampion(championId: string): ChampionTemplate[];
  /** 某费用档的全部模板。 */
  byCost(cost: Cost): ChampionTemplate[];
  /** 追加一条模板（用户向导采集时用）。 */
  append(template: ChampionTemplate): void;
  /** 清空。 */
  clear(): void;
  /** 统计。 */
  stats(): TemplateStoreStats;
}

/** 落盘格式。 */
interface TemplateFile {
  championId: string;
  size: number;
  channels: number;
  fingerprint: string;
  dHash: string;
  dataBase64: string;
  source?: 'user' | 'placeholder';
}

/**
 * 由归一化图像构造模板。
 *
 * @param championId 弈子 id。
 * @param cost 费用档。
 * @param image 已归一化的图像（任意尺寸都会再归一化到 64）。
 * @param source 来源。
 */
export async function buildTemplate(
  championId: string,
  cost: Cost,
  image: RawImage,
  source: 'user' | 'placeholder' = 'user',
): Promise<ChampionTemplate> {
  const normalized =
    image.width === TEMPLATE_SIZE && image.height === TEMPLATE_SIZE && image.channels === 4
      ? image
      : await normalizeToSize(image, TEMPLATE_SIZE);

  return {
    championId,
    cost,
    size: TEMPLATE_SIZE,
    channels: 4,
    fingerprint: fingerprint(normalized),
    dHash: dhash(normalized.data, normalized.width, normalized.height, normalized.channels),
    data: normalized.data,
    source,
  };
}

/**
 * 解析模板 JSON。
 *
 * @param raw 已解析的 JSON。
 * @param costOf 由 championId 查费用档的函数。
 * @returns 模板或 null（结构非法）。
 */
export function parseTemplateFile(
  raw: unknown,
  costOf: (championId: string) => Cost | null,
): ChampionTemplate | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const championId = typeof record.championId === 'string' ? record.championId : null;
  const size = Number(record.size);
  const dataBase64 = typeof record.dataBase64 === 'string' ? record.dataBase64 : null;
  if (championId === null || !Number.isFinite(size) || size <= 0 || dataBase64 === null) {
    return null;
  }
  const cost = costOf(championId);
  if (cost === null) {
    return null;
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  const expected = size * size * 4;
  if (bytes.length !== expected) {
    return null;
  }
  const image = createRawImage({
    width: size,
    height: size,
    data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    channels: 4,
    format: 'rgba',
    source: 'template-file',
  });
  return {
    championId,
    cost,
    size,
    channels: 4,
    fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : fingerprint(image),
    dHash: typeof record.dHash === 'string' ? record.dHash : dhash(bytes, size, size, 4),
    data: image.data,
    source: record.source === 'placeholder' ? 'placeholder' : 'user',
  };
}

/**
 * 序列化模板为可落盘对象。
 *
 * @param template 模板。
 */
export function serializeTemplate(template: ChampionTemplate): TemplateFile {
  return {
    championId: template.championId,
    size: template.size,
    channels: template.channels,
    fingerprint: template.fingerprint,
    dHash: template.dHash,
    dataBase64: Buffer.from(
      template.data.buffer,
      template.data.byteOffset,
      template.data.byteLength,
    ).toString('base64'),
    source: template.source,
  };
}

/** 内存实现的模板库（用于单测与"未落盘"场景）。 */
class MemoryTemplateStore implements TemplateStore {
  private templates: ChampionTemplate[] = [];

  private loaded = false;

  private readonly errors: string[] = [];

  private readonly dir: string;

  constructor(dir = '') {
    this.dir = dir;
  }

  /** 直接注入模板（不做磁盘 IO）。 */
  seed(templates: ChampionTemplate[]): void {
    this.templates = [...templates];
    this.loaded = true;
  }

  async init(): Promise<void> {
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  size(): number {
    return this.templates.length;
  }

  all(): ChampionTemplate[] {
    return [...this.templates];
  }

  byChampion(championId: string): ChampionTemplate[] {
    return this.templates.filter((template) => template.championId === championId);
  }

  byCost(cost: Cost): ChampionTemplate[] {
    return this.templates.filter((template) => template.cost === cost);
  }

  append(template: ChampionTemplate): void {
    this.templates.push(template);
  }

  clear(): void {
    this.templates = [];
  }

  stats(): TemplateStoreStats {
    const byCost: Record<Cost, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const champions = new Set<string>();
    let placeholders = 0;
    for (const template of this.templates) {
      champions.add(template.championId);
      byCost[template.cost] += 1;
      if (template.source === 'placeholder') {
        placeholders += 1;
      }
    }
    return {
      total: this.templates.length,
      championCount: champions.size,
      byCost,
      dir: this.dir,
      placeholderOnly: this.templates.length > 0 && placeholders === this.templates.length,
      errors: [...this.errors],
    };
  }
}

/**
 * 创建内存模板库。
 *
 * @param templates 预置模板。
 */
export function createMemoryTemplateStore(templates: ChampionTemplate[] = []): MemoryTemplateStore {
  const store = new MemoryTemplateStore();
  store.seed(templates);
  return store;
}

/**
 * 从磁盘目录加载模板库。
 *
 * 目录约定：`<dir>/<cost>-<championId>-<n>.json` 或任意 `*.json`；
 * 文件内自带 championId，因此文件名不参与解析（更健壮）。
 *
 * @param dir 模板目录。
 * @param champions 弈子元信息（用于校验 id 与查费用档）。
 */
export async function createFileTemplateStore(
  dir: string,
  champions: ChampionMeta[],
): Promise<TemplateStore> {
  const store = new MemoryTemplateStore(resolve(dir));
  const costMap = new Map<string, Cost>();
  for (const champion of champions) {
    costMap.set(champion.id, champion.cost);
  }
  const costOf = (championId: string): Cost | null => costMap.get(championId) ?? null;

  await store.init();

  let entries: string[] = [];
  try {
    entries = await readdir(store.stats().dir);
  } catch {
    // 目录不存在 = 尚无模板，交由上层提示"请先采集模板"
    return store;
  }

  const parsed: ChampionTemplate[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) {
      continue;
    }
    try {
      const text = await readFile(join(store.stats().dir, entry), 'utf8');
      const template = parseTemplateFile(JSON.parse(text) as unknown, costOf);
      if (template !== null) {
        parsed.push(template);
      }
    } catch {
      // 单个文件损坏不影响整库加载
    }
  }

  parsed.sort((a, b) => a.championId.localeCompare(b.championId));
  store.seed(parsed);
  return store;
}

/**
 * 把一个模板写盘。
 *
 * @param dir 模板目录。
 * @param template 模板。
 * @param index 同弈子序号（用于文件名去重）。
 * @returns 写入的绝对路径。
 */
export async function writeTemplateFile(
  dir: string,
  template: ChampionTemplate,
  index: number,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${template.cost}-${template.championId}-${index}.json`);
  await writeFile(file, JSON.stringify(serializeTemplate(template)), 'utf8');
  return file;
}
