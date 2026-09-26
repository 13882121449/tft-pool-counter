/**
 * T03 模板链单测：占位生成器 → 费用先验自洽 → 序列化往返 → 文件库加载 → 采集向导校验。
 *
 * 其中"占位模板能被费用分类器认对费用档"是一条**交叉验证**：
 * 它同时证明了 ① 占位图的底部色带位置与 cost-colors.json 的采样区一致，
 * ② 费用分类器的 HSV 阈值与参考色自洽。任何一边写错都会让这条断言失败。
 */

import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Cost } from '../../../src/shared/types/domain';
import { parseCostColorSpec, FALLBACK_COST_COLOR_SPEC } from '../../../src/vision/detect/specs';
import { parseStarMarkerSpec, FALLBACK_STAR_MARKER_SPEC } from '../../../src/vision/detect/specs';
import { classifyCost } from '../../../src/vision/detect/cost-classifier';
import { parseNonPoolUnitIds } from '../../../src/vision/match/blacklist-filter';
import {
  createFileTemplateStore,
  createMemoryTemplateStore,
  parseTemplateFile,
  serializeTemplate,
} from '../../../src/vision/match/template-store';
import {
  fnv1a,
  generatePlaceholderImage,
  generatePlaceholderTemplates,
  makeRandom,
  writePlaceholderTemplates,
} from '../../../src/vision/templates/placeholder-generator';
import {
  buildChampionIndex,
  validateWizardAssignments,
  type WizardSlotDraft,
} from '../../../src/vision/templates/capture-wizard';
import {
  auditTemplateCoverage,
  exportTemplateSet,
  importTemplateSet,
  readTemplateManifest,
} from '../../../src/vision/templates/exporter';
import costColorsJson from '../../../data/cost-colors.json';
import starMarkersJson from '../../../data/star-markers.json';
import nonPoolJson from '../../../data/non-pool-units.json';
import baselineJson from '../../../data/pool-baseline.json';

/** 基线里的 (id, cost) 列表（供测试构造模板用）。 */
const CHAMPIONS: Array<{ id: string; cost: Cost }> = (
  baselineJson as { champions: Array<{ id: string; cost: number }> }
).champions.map((champion) => ({ id: champion.id, cost: champion.cost as Cost }));

describe('占位模板生成器', () => {
  it('同一弈子多次生成结果完全一致（可复现）', () => {
    const a = generatePlaceholderImage('ahri', 4, 32, 0);
    const b = generatePlaceholderImage('ahri', 4, 32, 0);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('不同变体生成不同图案（可扩充模板库）', () => {
    const a = generatePlaceholderImage('ahri', 4, 32, 0);
    const b = generatePlaceholderImage('ahri', 4, 32, 1);
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it('65 个弈子的模板指纹两两不同（pHash 具备区分力）', () => {
    const templates = generatePlaceholderTemplates(CHAMPIONS, { size: 32 });
    const fingerprints = new Set(templates.map((template) => template.fingerprint));
    expect(templates).toHaveLength(CHAMPIONS.length);
    expect(fingerprints.size).toBe(CHAMPIONS.length);
  });

  it('fnv1a / makeRandom 是确定性的（哈希与伪随机不引入随机性）', () => {
    expect(fnv1a('ahri')).toBe(fnv1a('ahri'));
    expect(fnv1a('ahri')).not.toBe(fnv1a('lux'));
    const r1 = makeRandom(123);
    const r2 = makeRandom(123);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it('占位图底部色带 = 该费用档参考色（费用先验因此可用）', () => {
    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      const image = generatePlaceholderImage('sample', cost, 64, 0);
      const result = classifyCost(image, FALLBACK_COST_COLOR_SPEC);
      expect(result.cost).toBe(cost);
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });

  it('用真实 cost-colors.json 时同样认对费用档（数据文件与分类器自洽）', () => {
    const spec = parseCostColorSpec(costColorsJson);
    for (const cost of [1, 2, 3, 4, 5] as Cost[]) {
      const image = generatePlaceholderImage('sample', cost, 64, 0);
      expect(classifyCost(image, spec).cost).toBe(cost);
    }
  });
});

describe('模板序列化与文件库', () => {
  it('serialize → parse 往返后指纹与像素一致', async () => {
    const [template] = generatePlaceholderTemplates([{ id: 'ahri', cost: 4 }], { size: 32 });
    expect(template).toBeDefined();
    const json = JSON.parse(JSON.stringify(serializeTemplate(template!))) as unknown;
    const parsed = parseTemplateFile(json, (id) => (id === 'ahri' ? 4 : null));
    expect(parsed).not.toBeNull();
    expect(parsed!.fingerprint).toBe(template!.fingerprint);
    expect(parsed!.dHash).toBe(template!.dHash);
    expect(Array.from(parsed!.data)).toEqual(Array.from(template!.data));
    expect(parsed!.source).toBe('placeholder');
  });

  it('结构非法 / 弈子不在基线中 → 返回 null（不抛异常）', () => {
    expect(parseTemplateFile(null, () => 1)).toBeNull();
    expect(parseTemplateFile({ championId: 'ahri' }, () => 1)).toBeNull();
    const broken = { championId: 'ghost', size: 1, dataBase64: 'AA==' };
    expect(parseTemplateFile(broken, () => null)).toBeNull();
  });

  it('长度不匹配的 dataBase64 → 拒绝', () => {
    const bad = { championId: 'ahri', size: 8, dataBase64: Buffer.from([1, 2, 3]).toString('base64') };
    expect(parseTemplateFile(bad, () => 4)).toBeNull();
  });

  it('内存库按费用档 / 弈子查询与统计', () => {
    const store = createMemoryTemplateStore(
      generatePlaceholderTemplates(
        [
          { id: 'a', cost: 1 },
          { id: 'b', cost: 5 },
        ],
        { size: 32 },
      ),
    );
    expect(store.size()).toBe(2);
    expect(store.byCost(5).map((item) => item.championId)).toEqual(['b']);
    expect(store.byChampion('a')).toHaveLength(1);
    const stats = store.stats();
    expect(stats.championCount).toBe(2);
    expect(stats.byCost[1]).toBe(1);
    expect(stats.placeholderOnly).toBe(true);
  });

  it('从磁盘目录加载模板库（真实写盘 → 读回）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tft-tpl-'));
    try {
      const templates = generatePlaceholderTemplates(
        [
          { id: 'ahri', cost: 4 },
          { id: 'lux', cost: 4 },
        ],
        { size: 32 },
      );
      const files = await writePlaceholderTemplates(dir, templates);
      expect(files).toHaveLength(2);

      const store = await createFileTemplateStore(dir, [
        { id: 'ahri', cost: 4 },
        { id: 'lux', cost: 4 },
      ]);
      expect(store.size()).toBe(2);
      expect(store.byCost(4)).toHaveLength(2);
      expect(store.stats().placeholderOnly).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('目录不存在时返回空库而不是抛异常（首次使用场景）', async () => {
    const store = await createFileTemplateStore(join(tmpdir(), 'tft-not-exist-dir-xyz'), []);
    expect(store.size()).toBe(0);
    expect(store.stats().errors).toEqual([]);
  });

  it('真实数据目录 data/templates 可被加载（65 张占位模板）', async () => {
    const store = await createFileTemplateStore(join(process.cwd(), 'data', 'templates'), CHAMPIONS);
    expect(store.size()).toBeGreaterThanOrEqual(CHAMPIONS.length);
    const coverage = auditTemplateCoverage(store.all(), CHAMPIONS.map((champion) => champion.id));
    expect(coverage.missing).toEqual([]);
    expect(coverage.coverageRatio).toBe(1);
    expect(await readdir(join(process.cwd(), 'data', 'templates'))).toContain('index.json');
  });
});

describe('采集向导校验', () => {
  /** 构造两格草稿（一格非空、一格空）。 */
  function drafts(): WizardSlotDraft[] {
    return [
      {
        zone: 'board',
        slotIndex: 0,
        row: 0,
        col: 0,
        blank: false,
        image: generatePlaceholderImage('a', 1, 32),
        fingerprint: 'f',
      },
      {
        zone: 'board',
        slotIndex: 1,
        row: 0,
        col: 1,
        blank: true,
        image: generatePlaceholderImage('a', 1, 32),
        fingerprint: '0',
      },
    ];
  }

  it('合法指派通过，并统计可落盘格数', () => {
    const index = buildChampionIndex([
      { id: 'ahri', cost: 4 },
      { id: 'lux', cost: 4 },
    ]);
    const result = validateWizardAssignments({ 0: 'ahri' }, drafts(), index);
    expect(result.ok).toBe(true);
    expect(result.actionable).toBe(1);
  });

  it('指派不存在的弈子 / 空格 / 越界槽位都被拒绝并给出中文原因', () => {
    const index = buildChampionIndex([{ id: 'ahri', cost: 4 }]);
    const bad = validateWizardAssignments(
      { 0: 'ghost', 1: 'ahri', 99: 'ahri' },
      drafts(),
      index,
    );
    expect(bad.ok).toBe(false);
    expect(bad.reasons.some((reason) => reason.includes('不在卡池基线中'))).toBe(true);
    expect(bad.reasons.some((reason) => reason.includes('空格'))).toBe(true);
    expect(bad.reasons.some((reason) => reason.includes('不在本次采集范围内'))).toBe(true);
  });

  it('没有任何有效指派时明确报错', () => {
    const result = validateWizardAssignments({}, drafts(), buildChampionIndex([]));
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('没有任何有效指派'))).toBe(true);
  });
});

describe('规格解析（数据驱动，无硬编码）', () => {
  it('解析 cost-colors.json：5 档费用、采样区与参考色齐全', () => {
    const spec = parseCostColorSpec(costColorsJson);
    expect(spec.costs).toHaveLength(5);
    expect(spec.sampleRegion.heightRatio).toBeCloseTo(0.18, 6);
    expect(spec.costs.map((item) => item.cost)).toEqual([1, 2, 3, 4, 5]);
    expect(spec.fallbackStrategy).toBe('unknown-cost-scan-all');
  });

  it('解析 star-markers.json：保守默认 1★ + 4 档星标区间', () => {
    const spec = parseStarMarkerSpec(starMarkersJson);
    expect(spec.conservativeDefaultStar).toBe(1);
    expect(spec.starMarkers.map((item) => item.star)).toEqual([1, 2, 3, 4]);
    expect(spec.detectRegion.widthRatio).toBeGreaterThan(0);
  });

  it('解析损坏 JSON → 返回可用兜底而不是抛异常', () => {
    const spec = parseCostColorSpec({ costs: [{ cost: 99 }] });
    expect(spec.costs).toHaveLength(0);
    expect(spec.fallbackStrategy).toBe('unknown-cost-scan-all');
    // 空输入解析出空列表（不抛异常），真正的兜底由 spec-loader 提供
    expect(parseStarMarkerSpec(null).starMarkers).toHaveLength(0);
    expect(parseStarMarkerSpec(null).conservativeDefaultStar).toBe(1);
    // 内置兜底规格本身必须完整（4 档星标全部存在）
    expect(FALLBACK_STAR_MARKER_SPEC.starMarkers.map((item) => item.star)).toEqual([1, 2, 3, 4]);
    expect(FALLBACK_COST_COLOR_SPEC.costs).toHaveLength(5);
  });

  it('解析非池单位名单', () => {
    const ids = parseNonPoolUnitIds(nonPoolJson);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('模板覆盖审计', () => {
  it('缺模板的弈子被列在 missing 中，覆盖率相应下降', () => {
    const templates = generatePlaceholderTemplates([{ id: 'a', cost: 1 }], { size: 16 });
    const audit = auditTemplateCoverage(templates, ['a', 'b']);
    expect(audit.missing).toEqual(['b']);
    expect(audit.coverageRatio).toBe(0.5);
  });

  it('期望集合为空时覆盖率为 1（避免 0/0 产生 NaN）', () => {
    expect(auditTemplateCoverage([], []).coverageRatio).toBe(1);
  });
});

describe('zip 导出 / 导入', () => {
  it('导出后清单可读，并能导入到新目录（用户备份迁移路径）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tft-zip-'));
    try {
      const store = createMemoryTemplateStore(
        generatePlaceholderTemplates(
          [
            { id: 'ahri', cost: 4 },
            { id: 'lux', cost: 4 },
          ],
          { size: 32 },
        ),
      );
      const zipPath = join(dir, 'set18.zip');
      const exported = await exportTemplateSet(store, zipPath, { setNumber: 18, patch: 'test' });
      expect(exported.count).toBe(2);
      expect(exported.bytes).toBeGreaterThan(0);

      const manifest = await readTemplateManifest(zipPath);
      expect(manifest?.setNumber).toBe(18);
      expect(manifest?.count).toBe(2);

      const targetDir = join(dir, 'imported');
      const importedStore = createMemoryTemplateStore([]);
      const imported = await importTemplateSet(
        zipPath,
        targetDir,
        [
          { id: 'ahri', cost: 4 },
          { id: 'lux', cost: 4 },
        ],
        importedStore,
      );
      expect(imported.imported).toBe(2);
      expect(imported.skipped).toBe(0);
      expect(importedStore.size()).toBe(2);
      expect((await readdir(targetDir)).length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('zip 中弈子不在基线里 → 计入 skipped 并给出原因，不整体失败', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tft-zip2-'));
    try {
      const store = createMemoryTemplateStore(
        generatePlaceholderTemplates([{ id: 'ghost', cost: 5 }], { size: 16 }),
      );
      const zipPath = join(dir, 'ghost.zip');
      await exportTemplateSet(store, zipPath, { setNumber: 18, patch: 'test' });

      const imported = await importTemplateSet(zipPath, join(dir, 'out'), []);
      expect(imported.imported).toBe(0);
      expect(imported.skipped).toBe(1);
      expect(imported.errors.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('不存在的 zip → 返回错误信息而不抛异常', async () => {
    const imported = await importTemplateSet(
      join(tmpdir(), 'tft-missing-zip-xyz.zip'),
      join(tmpdir(), 'tft-out-xyz'),
      [],
    );
    expect(imported.imported).toBe(0);
    expect(imported.errors.length).toBe(1);
    expect(await readTemplateManifest(join(tmpdir(), 'tft-missing-zip-xyz.zip'))).toBeNull();
  });
});
