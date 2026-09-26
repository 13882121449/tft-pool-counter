/**
 * 模板库的 zip 导入 / 导出（便于用户备份与迁移自己采集的素材）。
 *
 * 包结构（自描述）：
 * ```
 * tft-templates.zip
 * ├── manifest.json          { schemaVersion, setNumber, patch, exportedAt, count }
 * └── templates/
 *     └── <cost>-<championId>-<n>.json
 * ```
 *
 * 注意：导出的是**用户自己采集的** 64×64 像素，不含任何第三方素材。
 */

import JSZip from 'jszip';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Cost } from '../../shared/types/domain';
import {
  parseTemplateFile,
  serializeTemplate,
  type ChampionTemplate,
  type TemplateStore,
} from '../match/template-store';

/** 清单结构。 */
export interface TemplateManifest {
  schemaVersion: string;
  setNumber: number;
  patch: string;
  exportedAt: string;
  count: number;
  /** 采集来源说明（合规留痕）。 */
  source: string;
}

/** 导出结果。 */
export interface ExportResult {
  path: string;
  count: number;
  bytes: number;
}

/** 导入结果。 */
export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  dir: string;
  manifest?: TemplateManifest;
}

/**
 * 导出模板库为 zip。
 *
 * @param store 模板库。
 * @param outPath 输出 zip 路径。
 * @param meta 附加元信息。
 */
export async function exportTemplateSet(
  store: TemplateStore,
  outPath: string,
  meta: { setNumber: number; patch: string; source?: string } = { setNumber: 18, patch: 'unknown' },
): Promise<ExportResult> {
  const zip = new JSZip();
  const templates = store.all();
  const counter = new Map<string, number>();

  for (const template of templates) {
    const index = counter.get(template.championId) ?? 0;
    counter.set(template.championId, index + 1);
    const name = `templates/${template.cost}-${template.championId}-${index}.json`;
    zip.file(name, JSON.stringify(serializeTemplate(template)));
  }

  const manifest: TemplateManifest = {
    schemaVersion: '1.0',
    setNumber: meta.setNumber,
    patch: meta.patch,
    exportedAt: new Date().toISOString(),
    count: templates.length,
    source: meta.source ?? 'user-captured (local only)',
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return { path: target, count: templates.length, bytes: buffer.byteLength };
}

/**
 * 读取 zip 中的清单。
 *
 * @param zipPath zip 路径。
 */
export async function readTemplateManifest(zipPath: string): Promise<TemplateManifest | null> {
  try {
    const bytes = await readFile(resolve(zipPath));
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file('manifest.json');
    if (entry === null) {
      return null;
    }
    const text = await entry.async('string');
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      schemaVersion: typeof record.schemaVersion === 'string' ? record.schemaVersion : '1.0',
      setNumber: Number(record.setNumber) || 0,
      patch: typeof record.patch === 'string' ? record.patch : 'unknown',
      exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : '',
      count: Number(record.count) || 0,
      source: typeof record.source === 'string' ? record.source : '',
    };
  } catch {
    return null;
  }
}

/**
 * 从 zip 导入模板到目录。
 *
 * @param zipPath zip 路径。
 * @param targetDir 目标目录。
 * @param champions 弈子元信息（id → cost 校验）。
 * @param store 可选：同时追加到内存库，导入后立即生效。
 */
export async function importTemplateSet(
  zipPath: string,
  targetDir: string,
  champions: ReadonlyArray<{ id: string; cost: Cost }>,
  store?: TemplateStore,
): Promise<ImportResult> {
  const dir = resolve(targetDir);
  const errors: string[] = [];
  const costMap = new Map<string, Cost>();
  for (const champion of champions) {
    costMap.set(champion.id, champion.cost);
  }

  let imported = 0;
  let skipped = 0;
  let manifest: TemplateManifest | undefined;

  try {
    const bytes = await readFile(resolve(zipPath));
    const zip = await JSZip.loadAsync(bytes);

    const manifestEntry = zip.file('manifest.json');
    if (manifestEntry !== null) {
      const parsed = (await readTemplateManifest(zipPath)) ?? undefined;
      manifest = parsed;
    }

    await mkdir(dir, { recursive: true });

    const entries = Object.keys(zip.files).filter(
      (name) => !zip.files[name]?.dir && name.endsWith('.json') && name !== 'manifest.json',
    );

    for (const name of entries) {
      const entry = zip.file(name);
      if (entry === null) {
        continue;
      }
      try {
        const text = await entry.async('string');
        const template = parseTemplateFile(
          JSON.parse(text) as unknown,
          (championId: string) => costMap.get(championId) ?? null,
        );
        if (template === null) {
          skipped += 1;
          errors.push(`${basename(name)} 结构非法或弈子不在卡池基线中，已跳过`);
          continue;
        }
        await writeFile(join(dir, basename(name)), JSON.stringify(serializeTemplate(template)), 'utf8');
        store?.append(template);
        imported += 1;
      } catch (error) {
        skipped += 1;
        errors.push(
          `${basename(name)} 解析失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    errors.push(`zip 打开失败：${error instanceof Error ? error.message : String(error)}`);
  }

  return { imported, skipped, errors, dir, ...(manifest !== undefined ? { manifest } : {}) };
}

/**
 * 校验一个模板集合的完整性（每个弈子是否至少有一张模板）。
 *
 * @param templates 模板集合。
 * @param expectedChampionIds 期望覆盖的弈子 id。
 */
export function auditTemplateCoverage(
  templates: ChampionTemplate[],
  expectedChampionIds: readonly string[],
): { covered: string[]; missing: string[]; coverageRatio: number } {
  const has = new Set(templates.map((template) => template.championId));
  const covered = expectedChampionIds.filter((id) => has.has(id));
  const missing = expectedChampionIds.filter((id) => !has.has(id));
  return {
    covered,
    missing,
    coverageRatio: expectedChampionIds.length === 0 ? 1 : covered.length / expectedChampionIds.length,
  };
}
