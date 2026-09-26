/**
 * `scripts/make-templates.mjs` 的 TS 实现（由 esbuild 打包后执行）。
 *
 * 两种模式：
 *
 * 1. **占位模式（默认）**：`--out data/templates`
 *    读取 `data/pool-baseline.json`，为 65 个弈子各生成 1 张确定性占位模板，
 *    让识别链路在用户采集真实素材之前就能跑通。
 *
 * 2. **真实素材模式**：`--from <图片路径> --champion <id> [--cost <1-5>]`
 *    把用户自己截的一张图居中裁成正方形并归一化为 64×64 模板。
 *    这是"用户自建素材、不内置图鉴站图片"的合规落地方式之一
 *    （另一种是 UI 里的采集向导）。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { dhash } from '../../shared/math/hash';
import type { Cost } from '../../shared/types/domain';
import { cropImage, fingerprint } from '../preprocess/raw-image';
import { decodeCompressedImage, normalizeToSize } from '../preprocess/scale';
import {
  TEMPLATE_SIZE,
  writeTemplateFile,
  type ChampionMeta,
  type ChampionTemplate,
} from '../match/template-store';
import {
  generatePlaceholderTemplates,
  writePlaceholderTemplates,
  type PlaceholderOptions,
} from './placeholder-generator';

/** CLI 参数。 */
export interface GenerateCliArgs {
  mode: 'placeholder' | 'from-image';
  out: string;
  baselinePath: string;
  variants: number;
  /** 是否先清空目录中的 `*.json`。 */
  clean: boolean;
  from?: string;
  champion?: string;
  cost?: Cost;
  quiet: boolean;
}

/** 解析结果。 */
export interface ParseResult {
  ok: boolean;
  args: GenerateCliArgs;
  errors: string[];
}

/**
 * 解析命令行参数。
 *
 * @param argv 去掉 node/script 后的参数数组。
 */
export function parseArgs(argv: readonly string[]): ParseResult {
  const args: GenerateCliArgs = {
    mode: 'placeholder',
    out: resolve('data/templates'),
    baselinePath: resolve('data/pool-baseline.json'),
    variants: 1,
    clean: false,
    quiet: false,
  };
  const errors: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--out':
        args.out = resolve(argv[i + 1] ?? args.out);
        i += 1;
        break;
      case '--baseline':
        args.baselinePath = resolve(argv[i + 1] ?? args.baselinePath);
        i += 1;
        break;
      case '--variants': {
        const value = Number(argv[i + 1]);
        if (!Number.isInteger(value) || value < 1) {
          errors.push('--variants 需要 >= 1 的整数');
        } else {
          args.variants = value;
        }
        i += 1;
        break;
      }
      case '--from':
        args.from = resolve(argv[i + 1] ?? '');
        args.mode = 'from-image';
        i += 1;
        break;
      case '--champion':
        args.champion = argv[i + 1] ?? '';
        i += 1;
        break;
      case '--cost': {
        const value = Number(argv[i + 1]);
        if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) {
          errors.push('--cost 需要 1..5');
        } else {
          args.cost = value as Cost;
        }
        i += 1;
        break;
      }
      case '--clean':
        args.clean = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        errors.push('HELP');
        break;
      default:
        if (token !== undefined && token.startsWith('--')) {
          errors.push(`未知参数：${token}`);
        }
        break;
    }
  }

  if (args.mode === 'from-image') {
    if (!args.from) {
      errors.push('--from 需要图片路径');
    }
    if (!args.champion) {
      errors.push('--from 模式必须提供 --champion');
    }
  }

  return { ok: errors.length === 0, args, errors };
}

/** 帮助文本。 */
export const HELP_TEXT = [
  '用法：node scripts/make-templates.mjs [选项]',
  '',
  '占位模式（默认）：',
  '  --out <dir>        输出目录（默认 data/templates）',
  '  --baseline <file>  卡池基线（默认 data/pool-baseline.json）',
  '  --variants <n>     每个弈子生成几张（默认 1）',
  '  --clean            先清空输出目录内的 *.json',
  '',
  '真实素材模式：',
  '  --from <image>     用户自己截的图片（PNG/JPG）',
  '  --champion <id>    该图对应的弈子 id（如 ahri）',
  '  --cost <1-5>       费用档（缺省则查基线）',
  '',
  '通用：',
  '  --quiet            只输出结果摘要',
].join('\n');

/** 读取基线里的弈子元信息。 */
async function readChampions(baselinePath: string): Promise<ChampionMeta[]> {
  const text = await readFile(baselinePath, 'utf8');
  const json = JSON.parse(text) as { champions?: Array<{ id?: unknown; cost?: unknown }> };
  const champions: ChampionMeta[] = [];
  for (const item of json.champions ?? []) {
    const id = typeof item.id === 'string' ? item.id : null;
    const cost = Number(item.cost);
    if (id !== null && cost >= 1 && cost <= 5) {
      champions.push({ id, cost: cost as Cost });
    }
  }
  return champions;
}

/** 清空目录中的模板 json（保留其他文件）。 */
async function cleanDir(dir: string): Promise<number> {
  let removed = 0;
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith('.json')) {
        await unlink(resolve(dir, entry));
        removed += 1;
      }
    }
  } catch {
    // 目录不存在 = 无需清理
  }
  return removed;
}

/**
 * 由一张用户截图生成模板（居中裁方形 → 64×64）。
 *
 * @param imagePath 图片路径。
 * @param championId 弈子 id。
 * @param cost 费用档。
 */
export async function templateFromImage(
  imagePath: string,
  championId: string,
  cost: Cost,
): Promise<ChampionTemplate | null> {
  const bytes = await readFile(imagePath);
  const decoded = await decodeCompressedImage(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    `file:${basename(imagePath)}`,
  );
  if (decoded === null) {
    return null;
  }
  const side = Math.min(decoded.width, decoded.height);
  const square = cropImage(decoded, {
    x: Math.round((decoded.width - side) / 2),
    y: Math.round((decoded.height - side) / 2),
    w: side,
    h: side,
  });
  const normalized = await normalizeToSize(square, TEMPLATE_SIZE);
  return {
    championId,
    cost,
    size: TEMPLATE_SIZE,
    channels: 4,
    fingerprint: fingerprint(normalized),
    dHash: dhash(normalized.data, normalized.width, normalized.height, normalized.channels),
    data: normalized.data,
    source: 'user',
  };
}

/** 主流程。 */
export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    if (parsed.errors.includes('HELP')) {
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }
    for (const error of parsed.errors) {
      process.stderr.write(`[make-templates] ${error}\n`);
    }
    process.stderr.write(`${HELP_TEXT}\n`);
    return 2;
  }

  const args = parsed.args;
  await mkdir(args.out, { recursive: true });

  if (args.clean) {
    const removed = await cleanDir(args.out);
    if (!args.quiet) {
      process.stdout.write(`[make-templates] 清理旧模板 ${removed} 个\n`);
    }
  }

  if (args.mode === 'from-image') {
    if (!args.from || !args.champion) {
      process.stderr.write('[make-templates] --from 与 --champion 必填\n');
      return 2;
    }
    let cost = args.cost;
    if (cost === undefined) {
      const champions = await readChampions(args.baselinePath);
      cost = champions.find((item) => item.id === args.champion)?.cost;
    }
    if (cost === undefined) {
      process.stderr.write(
        `[make-templates] 无法确定 ${args.champion} 的费用档，请显式传 --cost\n`,
      );
      return 3;
    }
    const template = await templateFromImage(args.from, args.champion, cost);
    if (template === null) {
      process.stderr.write('[make-templates] 图片解码失败（需要 sharp 支持该格式）\n');
      return 4;
    }
    const path = await writeTemplateFile(args.out, template, 0);
    process.stdout.write(`[make-templates] 已写入 1 个模板：${path}\n`);
    return 0;
  }

  const champions = await readChampions(args.baselinePath);
  if (champions.length === 0) {
    process.stderr.write(`[make-templates] 基线中未读到弈子：${args.baselinePath}\n`);
    return 5;
  }

  const options: PlaceholderOptions = { variantsPerChampion: args.variants };
  const templates = generatePlaceholderTemplates(champions, options);
  const files = await writePlaceholderTemplates(args.out, templates);

  // 同时写一份指纹清单，便于"模板库是否与基线一致"的快速自检
  const index = templates.map((template) => ({
    championId: template.championId,
    cost: template.cost,
    fingerprint: template.fingerprint,
    dHash: template.dHash,
    source: template.source,
  }));
  const indexContent = JSON.stringify(
    {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      generator: 'scripts/make-templates.mjs',
      deterministicSeed: createHash('sha1').update(JSON.stringify(index)).digest('hex').slice(0, 12),
      count: templates.length,
      items: index,
    },
    null,
    2,
  );
  await writeFile(resolve(args.out, 'index.json'), indexContent, 'utf8');

  process.stdout.write(
    `[make-templates] 生成占位模板 ${templates.length} 个（${champions.length} 弈子 × ${args.variants} 变体）→ ${args.out}\n`,
  );
  if (!args.quiet) {
    process.stdout.write(`[make-templates] 示例文件：${files.slice(0, 3).join(', ')}\n`);
    process.stdout.write(
      '[make-templates] 提示：这是占位素材，真实识别请在应用内「模板管理 → 采集向导」自建。\n',
    );
  }
  return 0;
}
