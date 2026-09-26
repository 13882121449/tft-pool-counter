/* eslint-env node */
/**
 * ESLint 配置。
 *
 * 两块核心职责：
 * 1. 常规 TS/React 代码质量与共享层隔离（`src/shared` 禁止 import electron / node:*）。
 * 2. **合规红线静态检查**：任何出现进程内存读写 / DLL 注入 / 输入模拟 / 内存扫描
 *    相关字样或模块导入的代码一律 error（对应 PRD 第 7 章 X1–X3）。
 */

/** 合规禁用 API 关键字（PRD X1 进程内存读写 / X2 注入 / X3 输入模拟）。 */
const FORBIDDEN_API_PATTERN = [
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
  'WriteProcessMemory',
].join('|');

/** 合规禁用模块（PRD X3 输入模拟 / X1 内存读写 / 进程枚举）。 */
const FORBIDDEN_MODULES = [
  'robotjs',
  'nut-js',
  'node-key-sender',
  'ffi-napi',
  'ffi',
  'ref-napi',
  'koffi',
  'memoryjs',
  'process-list',
  'node-window-manager',
];

const COMPLIANCE_MESSAGE =
  '合规红线：本工具只允许读取屏幕像素，禁止读写游戏进程内存、DLL 注入、模拟鼠标键盘输入。' +
  '详见 docs/COMPLIANCE-CHECKLIST.md 与 src/shared/forbidden-apis.md。';

module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['tsconfig.base.json'],
        alwaysTryTypes: true,
      },
      node: {
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      },
    },
  },
  rules: {
    // ---------- 通用质量 ----------
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // ---------- 合规红线：标识符 / 字符串字面量 ----------
    'no-restricted-syntax': [
      'error',
      {
        selector: `Identifier[name=/^(?:${FORBIDDEN_API_PATTERN})$/]`,
        message: COMPLIANCE_MESSAGE,
      },
      {
        selector: `Literal[value=/(?:${FORBIDDEN_API_PATTERN})/]`,
        message: COMPLIANCE_MESSAGE,
      },
      {
        selector: `Literal[value=/^(?:${FORBIDDEN_MODULES.join('|')})$/]`,
        message: COMPLIANCE_MESSAGE,
      },
    ],

    // ---------- 合规红线：模块导入 ----------
    'no-restricted-imports': [
      'error',
      {
        paths: FORBIDDEN_MODULES.map((name) => ({
          name,
          message: COMPLIANCE_MESSAGE,
        })),
        patterns: [
          {
            group: ['node:child_process', 'child_process'],
            message: '禁止派生子进程操作游戏；如需启动进程请走 src/main/vision-host.ts。',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // 截屏能力只允许出现在视觉层的 capture 目录，且必须走 CaptureManager 策略层（ADR-01）
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: ['src/vision/capture/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: `Identifier[name=/^(?:${FORBIDDEN_API_PATTERN})$/]`,
            message: COMPLIANCE_MESSAGE,
          },
          {
            selector: `Literal[value=/(?:${FORBIDDEN_API_PATTERN})/]`,
            message: COMPLIANCE_MESSAGE,
          },
          {
            selector: `Literal[value=/^(?:${FORBIDDEN_MODULES.join('|')})$/]`,
            message: COMPLIANCE_MESSAGE,
          },
          {
            selector: 'ImportDeclaration[source.value=/(?:node-screenshots|desktopCapturer)/]',
            message:
              '截屏只能在 src/vision/capture/** 中使用，且必须走 CaptureManager 策略层（ADR-01）。',
          },
        ],
      },
    },
    {
      // 共享层被 main / renderer / vision 三方共享，禁止依赖运行时宿主
      files: ['src/shared/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'electron', message: 'src/shared 禁止依赖 electron（架构 §3.3）。' },
              ...FORBIDDEN_MODULES.map((name) => ({ name, message: COMPLIANCE_MESSAGE })),
            ],
            patterns: [
              {
                group: ['node:*', 'fs', 'path', 'os'],
                message: 'src/shared 禁止依赖 node 内置模块（架构 §3.3）。',
              },
              {
                group: ['@main/*', '@renderer/*', '@vision/*'],
                message: 'src/shared 禁止反向依赖上层模块。',
              },
            ],
          },
        ],
      },
    },
    {
      // 纯函数核心层：零 electron / node 依赖，必须可脱离 UI 单测
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'electron', message: 'src/core 必须零 electron 依赖（ADR-03）。' },
              ...FORBIDDEN_MODULES.map((name) => ({ name, message: COMPLIANCE_MESSAGE })),
            ],
            patterns: [
              {
                group: ['node:*', 'fs', 'path', 'os', 'crypto'],
                message: 'src/core 必须零 node 依赖（ADR-03）。',
              },
              {
                group: ['@main/*', '@renderer/*', '@vision/*'],
                message: 'src/core 禁止依赖上层模块。',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'release', 'node_modules', 'coverage', '**/*.d.ts'],
};
