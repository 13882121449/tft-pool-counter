/**
 * 日志（electron-log 包装）。
 *
 * 设计要点：
 * - 主进程、Vision worker 的错误都汇聚到同一份 `main.log`，便于用户一键导出；
 * - **合规**：日志里**绝不**写像素数据、截图路径或任何游戏进程信息；
 *   只写结构化事件（扫描耗时、后端名、识别数量、错误码）。
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import log from 'electron-log/main';
import type { AdvancedConfig } from '../../shared/types/config';
import { logFilePath } from '../store/paths';

/** 日志级别。 */
export type LogLevel = AdvancedConfig['logLevel'];

/** 内存中的环形缓冲（UI 的「日志」页直接读它，避免频繁读盘）。 */
const RING_CAPACITY = 500;
const ring: string[] = [];

/** 当前级别（用于过滤与文件 transport 配置）。 */
let currentLevel: LogLevel = 'info';

/** 是否已调用过 `log.initialize()`。 */
let initialized = false;

/** 级别权重，用于过滤。 */
const LEVEL_WEIGHT: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * 初始化日志系统。**幂等**。
 *
 * `electron-log` 的 `initialize()` 内部会注册 `app.on('ready')` 回调，
 * **重复调用会抛错** `log.initialize({ preload }) already called` ——
 * 而启动流程恰好会调两次（先按 info 初始化拿到早期日志、再按用户配置的级别
 * 重新初始化），必然踩中，输出里会出现一段误导性的异常堆栈。
 * 因此这里只在首次真正 initialize，之后仅更新级别与 transport 配置。
 *
 * @param level 日志级别。
 */
export function initLogger(level: LogLevel = 'info'): void {
  const first = !initialized;
  currentLevel = level;
  if (first) {
    initialized = true;
    log.initialize();
  }
  log.transports.file.level = level;
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.console.level = level === 'debug' ? 'debug' : 'info';
  if (first) {
    log.info('[log] 初始化完成', { level, file: logFilePath() });
  } else {
    log.debug('[log] 日志级别已更新', { level });
  }
}

/**
 * 设置日志级别（设置页改动后调用）。
 *
 * @param level 新级别。
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  log.transports.file.level = level;
}

/** 当前日志级别。 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** 是否需要记录该级别。 */
function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[currentLevel];
}

/** 把消息同时写进环形缓冲。 */
function pushRing(level: LogLevel, message: string, detail?: unknown): void {
  const stamp = new Date().toISOString();
  const suffix = detail === undefined ? '' : ` ${safeStringify(detail)}`;
  ring.push(`${stamp} [${level.toUpperCase()}] ${message}${suffix}`);
  if (ring.length > RING_CAPACITY) {
    ring.shift();
  }
}

/** 安全序列化（循环引用 / 大对象都不会炸）。 */
function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) {
      return JSON.stringify({ name: value.name, message: value.message });
    }
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.slice(0, 2000);
  } catch {
    return '[unserializable]';
  }
}

/** 结构化日志接口（业务代码只依赖它，不直接依赖 electron-log）。 */
export const logger = {
  error: (message: string, detail?: unknown): void => {
    pushRing('error', message, detail);
    log.error(message, detail ?? '');
  },
  warn: (message: string, detail?: unknown): void => {
    pushRing('warn', message, detail);
    log.warn(message, detail ?? '');
  },
  info: (message: string, detail?: unknown): void => {
    if (shouldLog('info')) {
      pushRing('info', message, detail);
      log.info(message, detail ?? '');
    }
  },
  debug: (message: string, detail?: unknown): void => {
    if (shouldLog('debug')) {
      pushRing('debug', message, detail);
      log.debug(message, detail ?? '');
    }
  },
};

/**
 * 读取最近 N 行日志（优先内存环形缓冲，不足时回退读盘）。
 *
 * @param lines 行数，默认 200。
 */
export async function tailLog(lines = 200): Promise<string[]> {
  const count = Math.max(1, Math.floor(lines));
  if (ring.length >= count) {
    return ring.slice(-count);
  }
  try {
    const text = await readFile(logFilePath(), 'utf8');
    const fileLines = text.split(/\r?\n/).filter((line) => line.length > 0);
    return fileLines.slice(-count);
  } catch {
    return [...ring];
  }
}

/**
 * 导出日志到指定路径（UI「导出日志」按钮）。
 *
 * @param targetPath 目标文件路径。
 * @returns 写入的绝对路径。
 */
export async function exportLog(targetPath: string): Promise<string> {
  const content = (await tailLog(RING_CAPACITY)).join('\n');
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${content}\n`, 'utf8');
  return targetPath;
}

/**
 * 追加一条原始日志（Vision worker 转发过来的）。
 *
 * @param line 日志行。
 */
export async function appendRawLog(line: string): Promise<void> {
  const stamp = new Date().toISOString();
  const formatted = `${stamp} [WORKER] ${line}`;
  pushRing('info', `[WORKER] ${line}`);
  try {
    await mkdir(dirname(logFilePath()), { recursive: true });
    await appendFile(logFilePath(), `${formatted}\n`, 'utf8');
  } catch {
    // 落盘失败不影响运行
  }
}
