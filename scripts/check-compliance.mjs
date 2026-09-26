#!/usr/bin/env node
/**
 * 合规红线自查脚本：全仓 grep 禁用 API 关键字。
 *
 * 这是继 ESLint 静态规则之后的第二道防线：连注释里误写、数据文件里误配
 * 也能扫出来。命中清单中的文件（本脚本自身、ESLint 配置、禁用 API 清单、
 * PRD/架构文档）属于白名单。
 *
 * 用法：npm run lint:compliance
 * 退出码：0 = 无命中；1 = 有命中。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

/** 禁用关键字（与 .eslintrc.cjs 保持一致）。 */
const FORBIDDEN_KEYWORDS = [
  'ReadProcessMemory',
  'WriteProcessMemory',
  'OpenProcess',
  'VirtualAllocEx',
  'VirtualProtectEx',
  'CreateRemoteThread',
  'NtReadVirtualMemory',
  'NtWriteVirtualMemory',
  'ZwReadVirtualMemory',
  'ZwWriteVirtualMemory',
  'SetWindowsHookEx',
  'SendInput',
  'mouse_event',
  'keybd_event',
  'robotjs',
  'nut-js',
  'node-key-sender',
  'ffi-napi',
  'koffi',
  'memoryjs',
  'process-list',
];

/** 白名单：为了"禁止"而提到这些字样的文件。 */
const WHITELIST = new Set([
  'scripts/check-compliance.mjs',
  '.eslintrc.cjs',
  'src/shared/forbidden-apis.md',
  'docs/PRD.md',
  'docs/ARCHITECTURE.md',
  'docs/COMPLIANCE-CHECKLIST.md',
  'docs/HANDOVER.md',
  // QA 审计报告为"证明不存在而逐项引用禁用字样"，属白名单（否则审计文档本身会把
  // 合规门禁打红 —— 这正是 T05 期间 QA-REVIEW-T02.md 引入的回归）。
  'docs/QA-REVIEW-T02.md',
  'docs/QA-REVIEW-FINAL.md',
]);

/** 需要跳过的目录。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'release',
  'coverage',
  '.vscode',
  '.idea',
]);

/** 需要检查的文件扩展名。 */
const CHECKED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.md']);

/**
 * 递归收集待检查文件。
 * @param {string} dir 目录。
 * @param {string[]} acc 累积结果。
 * @returns {string[]}
 */
function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    // 跳过依赖目录与所有隐藏目录（.git / .cache / 备份目录等）
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, acc);
    } else if (CHECKED_EXT.has(full.slice(full.lastIndexOf('.')))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectFiles(PROJECT_ROOT);
const hits = [];

for (const file of files) {
  const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/');
  if (WHITELIST.has(rel)) continue;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (line.includes(keyword)) {
        hits.push({ file: rel, line: index + 1, keyword, text: line.trim().slice(0, 160) });
      }
    }
  });
}

if (hits.length === 0) {
  console.log(`[compliance] ✅ 通过：扫描 ${files.length} 个文件，无禁用 API 命中。`);
  process.exit(0);
}

console.error(`[compliance] ❌ 发现 ${hits.length} 处禁用 API 命中：`);
for (const hit of hits) {
  console.error(`  ${hit.file}:${hit.line}  [${hit.keyword}]  ${hit.text}`);
}
process.exit(1);
