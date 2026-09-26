#!/usr/bin/env node
/**
 * 校验 data/pool-baseline.json 是否结构完整、与业务口径一致。
 *
 * 用法：npm run verify:baseline
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = resolve(PROJECT_ROOT, 'data/pool-baseline.json');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'data/pool-baseline.schema.json');
const NON_POOL_PATH = resolve(PROJECT_ROOT, 'data/non-pool-units.json');

/** 读取并解析 JSON。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const baseline = readJson(BASELINE_PATH);
const schema = readJson(SCHEMA_PATH);
const nonPool = readJson(NON_POOL_PATH);

const problems = [];
const warnings = [];

// 1. 赛季号
if (baseline?.meta?.set_number !== 18) {
  problems.push(`当前仅支持 Set 18，文件为 Set ${baseline?.meta?.set_number}`);
}
if (baseline?.meta?.CONFIRMED !== true) {
  warnings.push('基线 CONFIRMED=false，所有数值均为"待实测估算"');
}

// 2. 池大小 vs 弈子数一致性
const countByCost = {};
for (const champion of baseline.champions) {
  countByCost[champion.cost] = (countByCost[champion.cost] ?? 0) + 1;
  const expected = baseline.pool_size_by_cost?.[String(champion.cost)]?.copies_per_champion;
  if (expected !== undefined && champion.pool_total !== expected) {
    problems.push(
      `${champion.id} 的 pool_total=${champion.pool_total} 与 pool_size_by_cost[${champion.cost}]=${expected} 不一致`,
    );
  }
}
for (const [cost, entry] of Object.entries(baseline.pool_size_by_cost ?? {})) {
  const actual = countByCost[cost] ?? 0;
  if (actual !== entry.distinct_champions) {
    warnings.push(
      `${cost} 费档：声明 ${entry.distinct_champions} 个弈子，实际 ${actual} 个`,
    );
  }
}

// 3. id 唯一
const seen = new Set();
for (const champion of baseline.champions) {
  if (seen.has(champion.id)) {
    problems.push(`champion id 重复：${champion.id}`);
  }
  seen.add(champion.id);
}

// 4. schema 存在性
if (!schema) {
  problems.push('缺少 pool-baseline.schema.json');
}

// 5. 非池黑名单
if (!Array.isArray(nonPool.units) || nonPool.units.length === 0) {
  warnings.push('non-pool-units.json 为空，E5 过滤将失效');
}

// 输出
console.log(`弈子总数：${baseline.champions.length}`);
console.log('各费用档数量：', JSON.stringify(countByCost));
console.log('池大小：', JSON.stringify(baseline.pool_size_by_cost));
console.log('星级换算：', JSON.stringify(baseline.star_copy_cost));
console.log(`非池黑名单：${nonPool.units?.length ?? 0} 条`);

if (warnings.length > 0) {
  console.log('\n警告：');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (problems.length > 0) {
  console.error('\n错误：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n✅ 基线校验通过');
