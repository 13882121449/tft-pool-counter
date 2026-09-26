/**
 * 模板采集向导（PRD Q6：**用户自建素材**，不内置任何图鉴站图片）。
 *
 * 工作流（全部本地、离线）：
 * 1. 用户停在游戏里的一局对局/训练模式画面上；
 * 2. 向导按当前标定切出棋盘 + 备战席的所有格子（`captureWizardSlots`）；
 * 3. UI 逐格展示缩略图，用户从 65 个弈子下拉里选 id（`WizardAssignments`）；
 * 4. `commitWizard` 把每格归一化成 64×64 模板并落盘到 `userData/assets/templates`；
 * 5. 之后所有识别都用这套模板（`TemplateStore`）。
 *
 * 版权合规：本文件**不包含任何图片素材**，只提供"把用户自己截的图切下来"的能力。
 */

import type { Cost } from '../../shared/types/domain';
import { extractSlotSamples, type SlotSample } from '../detect/slot-extractor';
import type { GridGeometry } from '../preprocess/geometry';
import type { RawImage } from '../preprocess/raw-image';
import {
  buildTemplate,
  writeTemplateFile,
  type ChampionTemplate,
  type TemplateStore,
} from '../match/template-store';

/** 向导中的一格草稿。 */
export interface WizardSlotDraft {
  zone: SlotSample['zone'];
  slotIndex: number;
  row: number;
  col: number;
  /** 空格跳过。 */
  blank: boolean;
  /** 归一化后的图（用于 UI 缩略图与生成模板）。 */
  image: RawImage;
  /** pHash 指纹（用于检测"同一格重复采集"）。 */
  fingerprint: string;
  /** 自动识别建议（可选，来自现有模板库自我匹配）。 */
  suggested?: string;
}

/** 用户的指派结果：格子 → 弈子 id。 */
export type WizardAssignments = Record<number, string>;

/** 备战席槽位键偏移：避免与棋盘槽位（0..27）冲突（同一数字键在多区域必须唯一）。 */
const WIZARD_SLOT_OFFSET_BENCH = 1_000;

/** 商店槽位键偏移：同上。 */
const WIZARD_SLOT_OFFSET_SHOP = 2_000;

/**
 * 把 `(zone, slotIndex)` 映射成**全局唯一**的数字键。
 *
 * 关键：`WizardAssignments` 是 `Record<number, string>`，而 board 与 bench 的
 * `slotIndex` 各自从 0 开始（board 0..27、bench 0..7），直接以 slotIndex 作键会互相覆盖。
 * 因此统一用本函数生成键。
 *
 * 渲染层必须使用**完全相同**的公式构造 key
 * （镜像实现见 `src/renderer/utils/wizard-slots.ts`），否则落盘时找不到对应草稿。
 *
 * @param zone 区域。
 * @param slotIndex 区域内的槽位索引。
 */
export function wizardSlotKey(zone: SlotSample['zone'], slotIndex: number): number {
  if (zone === 'bench') {
    return WIZARD_SLOT_OFFSET_BENCH + slotIndex;
  }
  if (zone === 'shop') {
    return WIZARD_SLOT_OFFSET_SHOP + slotIndex;
  }
  return slotIndex;
}

/** 采集结果。 */
export interface WizardCaptureResult {
  drafts: WizardSlotDraft[];
  /** 非空格数量。 */
  nonBlank: number;
  /** 归一化尺寸。 */
  size: number;
}

/**
 * 按当前标定切出所有格子作为向导素材。
 *
 * @param frame 整帧图像。
 * @param geometry 网格几何。
 * @param options 是否含商店格、归一化尺寸。
 */
export async function captureWizardSlots(
  frame: RawImage,
  geometry: GridGeometry,
  options: { includeShop?: boolean; size?: number } = {},
): Promise<WizardCaptureResult> {
  const size = options.size ?? geometry.normalizeTo;
  const samples = await extractSlotSamples(frame, geometry, {
    includeShop: options.includeShop ?? false,
    size,
  });

  const drafts: WizardSlotDraft[] = samples.map((sample) => ({
    zone: sample.zone,
    slotIndex: sample.slotIndex,
    row: sample.row,
    col: sample.col,
    blank: sample.blank,
    image: sample.image,
    fingerprint: sample.fingerprint,
  }));

  return {
    drafts,
    nonBlank: drafts.filter((draft) => !draft.blank).length,
    size,
  };
}

/** 指派校验结果。 */
export interface WizardValidation {
  ok: boolean;
  reasons: string[];
  /** 实际会被写入的格子数。 */
  actionable: number;
}

/**
 * 校验指派结果（在真正落盘前给 UI 反馈，避免采到一半才发现配置错）。
 *
 * @param assignments 指派结果。
 * @param drafts 草稿。
 * @param championIndex championId → cost 映射（来自卡池基线）。
 */
export function validateWizardAssignments(
  assignments: WizardAssignments,
  drafts: WizardSlotDraft[],
  championIndex: ReadonlyMap<string, Cost>,
): WizardValidation {
  const reasons: string[] = [];
  const bySlot = new Map<number, WizardSlotDraft>();
  for (const draft of drafts) {
    bySlot.set(draft.slotIndex, draft);
  }

  let actionable = 0;
  for (const [slotKey, championId] of Object.entries(assignments)) {
    const slotIndex = Number(slotKey);
    if (!Number.isInteger(slotIndex)) {
      reasons.push(`槽位键 ${slotKey} 不是整数`);
      continue;
    }
    const draft = bySlot.get(slotIndex);
    if (draft === undefined) {
      reasons.push(`槽位 ${slotIndex} 不在本次采集范围内`);
      continue;
    }
    if (draft.blank) {
      reasons.push(`槽位 ${slotIndex} 被判为空格，已跳过`);
      continue;
    }
    if (championId.length === 0) {
      continue;
    }
    if (!championIndex.has(championId)) {
      reasons.push(`槽位 ${slotIndex} 指定的弈子 ${championId} 不在卡池基线中`);
      continue;
    }
    actionable += 1;
  }

  if (actionable === 0) {
    reasons.push('没有任何有效指派，请至少为一个格子选择弈子');
  }

  return { ok: reasons.length === 0, reasons, actionable };
}

/**
 * 把指派结果落盘为模板。
 *
 * @param store 模板库（用于即时追加，避免重启才生效）。
 * @param assignments 指派结果。
 * @param drafts 草稿。
 * @param championIndex championId → cost。
 * @param dir 落盘目录。
 * @returns 写入统计。
 */
export async function commitWizard(
  store: TemplateStore,
  assignments: WizardAssignments,
  drafts: WizardSlotDraft[],
  championIndex: ReadonlyMap<string, Cost>,
  dir: string,
): Promise<{ added: number; files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];
  const counter = new Map<string, number>();
  const bySlot = new Map<number, WizardSlotDraft>();
  for (const draft of drafts) {
    bySlot.set(draft.slotIndex, draft);
  }

  for (const [slotKey, championId] of Object.entries(assignments)) {
    const draft = bySlot.get(Number(slotKey));
    if (draft === undefined || draft.blank || championId.length === 0) {
      continue;
    }
    const cost = championIndex.get(championId);
    if (cost === undefined) {
      errors.push(`槽位 ${slotKey} 的弈子 ${championId} 不在卡池基线中`);
      continue;
    }
    try {
      const template: ChampionTemplate = await buildTemplate(championId, cost, draft.image, 'user');
      const index = counter.get(championId) ?? 0;
      counter.set(championId, index + 1);
      const path = await writeTemplateFile(dir, template, index);
      store.append(template);
      files.push(path);
    } catch (error) {
      errors.push(
        `写入模板失败（${championId}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { added: files.length, files, errors };
}

/**
 * 由卡池基线构造 championId → cost 映射。
 *
 * @param champions 基线中的弈子列表。
 */
export function buildChampionIndex(
  champions: ReadonlyArray<{ id: string; cost: Cost }>,
): Map<string, Cost> {
  const map = new Map<string, Cost>();
  for (const champion of champions) {
    map.set(champion.id, champion.cost);
  }
  return map;
}
