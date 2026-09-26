/**
 * 识别参数规格的文件加载器（唯一碰 fs 的地方，解析逻辑在 `specs.ts`）。
 *
 * 读不到文件或 JSON 损坏时**回退到内置兜底规格并给出警告**，绝不让扫描链路崩溃。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FALLBACK_COST_COLOR_SPEC,
  FALLBACK_STAR_MARKER_SPEC,
  parseCostColorSpec,
  parseStarMarkerSpec,
  type CostColorSpec,
  type StarMarkerSpecFile,
} from './specs';

/** 加载结果（带降级标记）。 */
export interface SpecLoadResult<T> {
  spec: T;
  /** 是否用了内置兜底（true = 文件读取/解析失败）。 */
  fallback: boolean;
  /** 失败原因（中文）。 */
  reason?: string;
  /** 实际读取的路径。 */
  path: string;
}

/**
 * 读取并解析一个 JSON 规格文件。
 *
 * @param path 文件绝对路径或相对项目根目录的路径。
 * @param baseDir 相对路径的基准目录。
 */
async function readJson(path: string, baseDir: string): Promise<{ json: unknown; full: string }> {
  const full = resolve(baseDir, path);
  const text = await readFile(full, 'utf8');
  return { json: JSON.parse(text) as unknown, full };
}

/**
 * 加载费用颜色规格。
 *
 * @param path JSON 路径。
 * @param baseDir 基准目录（默认进程工作目录）。
 */
export async function loadCostColorSpec(
  path = 'data/cost-colors.json',
  baseDir = process.cwd(),
): Promise<SpecLoadResult<CostColorSpec>> {
  try {
    const { json, full } = await readJson(path, baseDir);
    return { spec: parseCostColorSpec(json), fallback: false, path: full };
  } catch (error) {
    return {
      spec: FALLBACK_COST_COLOR_SPEC,
      fallback: true,
      reason: `费用颜色规格加载失败，已用内置兜底：${
        error instanceof Error ? error.message : String(error)
      }`,
      path: resolve(baseDir, path),
    };
  }
}

/**
 * 加载星标规格。
 *
 * @param path JSON 路径。
 * @param baseDir 基准目录。
 */
export async function loadStarMarkerSpec(
  path = 'data/star-markers.json',
  baseDir = process.cwd(),
): Promise<SpecLoadResult<StarMarkerSpecFile>> {
  try {
    const { json, full } = await readJson(path, baseDir);
    return { spec: parseStarMarkerSpec(json), fallback: false, path: full };
  } catch (error) {
    return {
      spec: FALLBACK_STAR_MARKER_SPEC,
      fallback: true,
      reason: `星标规格加载失败，已用内置兜底：${
        error instanceof Error ? error.message : String(error)
      }`,
      path: resolve(baseDir, path),
    };
  }
}
