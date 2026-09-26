/**
 * 非池单位黑名单过滤（PRD E5）。
 *
 * 棋盘上有些"看起来像弈子"但**不占用卡池**的东西：召唤物、训练假人、
 * 特殊机制单位等。它们的 id 集中在 `data/non-pool-units.json`，
 * 识别链路在产出 `ObservationRecord` 前必须过一遍黑名单，避免污染台账。
 *
 * 与卡池基数同一条规矩：**名单不硬编码**，从数据文件读入。
 */

import type { Candidate } from '../../shared/types/scan';

/** 黑名单过滤器。 */
export interface BlacklistFilter {
  /** 是否在黑名单中。 */
  has(id: string): boolean;
  /** 过滤候选列表。 */
  filter<T extends { championId: string }>(items: T[]): T[];
  /** 名单大小。 */
  size(): number;
  /** 全部 id（只读），便于设置页展示。 */
  ids(): string[];
}

/** 非池单位数据文件形状。 */
interface NonPoolUnitsFile {
  ids?: unknown;
  units?: unknown;
}

/**
 * 解析 `data/non-pool-units.json`（兼容 `ids` 数组与 `units[].id` 两种写法）。
 *
 * @param json 已解析 JSON。
 * @returns 去重后的 id 列表。
 */
export function parseNonPoolUnitIds(json: unknown): string[] {
  const root = (json ?? {}) as NonPoolUnitsFile & Record<string, unknown>;
  const collected: string[] = [];

  if (Array.isArray(root.ids)) {
    for (const item of root.ids) {
      if (typeof item === 'string' && item.length > 0) {
        collected.push(item);
      }
    }
  }

  if (Array.isArray(root.units)) {
    for (const item of root.units) {
      if (item === null || typeof item !== 'object') {
        continue;
      }
      const id = (item as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) {
        collected.push(id);
      }
    }
  }

  return [...new Set(collected)];
}

/**
 * 创建黑名单过滤器。
 *
 * @param ids 非池单位 id 列表。
 */
export function createBlacklistFilter(ids: readonly string[]): BlacklistFilter {
  const set = new Set(ids);
  return {
    has: (id: string) => set.has(id),
    filter: <T extends { championId: string }>(items: T[]): T[] =>
      items.filter((item) => !set.has(item.championId)),
    size: () => set.size,
    ids: () => [...set],
  };
}

/**
 * 判断单个 id 是否为非池单位。
 *
 * @param id 弈子 id。
 * @param ids 非池单位 id 列表。
 */
export function isNonPoolUnit(id: string, ids: readonly string[]): boolean {
  return ids.includes(id);
}

/**
 * 过滤候选列表（保留顺序）。
 *
 * @param candidates 候选。
 * @param ids 非池单位 id 列表。
 */
export function filterCandidates(candidates: Candidate[], ids: readonly string[]): Candidate[] {
  if (ids.length === 0) {
    return candidates;
  }
  const set = new Set(ids);
  return candidates.filter((candidate) => !set.has(candidate.championId));
}

/** 默认空黑名单（数据文件读不到时的兜底，不影响主流程）。 */
export const EMPTY_BLACKLIST: BlacklistFilter = createBlacklistFilter([]);
