/**
 * 配置存储（`<userData>/config.json`）。
 *
 * 三类职责：
 * 1. **迁移**：读到的 `version` 与当前 `CONFIG_VERSION` 不一致时逐级升级；
 * 2. **深合并**：旧配置缺字段时用默认值补齐（用户升级后不会缺 key）；
 * 3. **防抖落盘**：拖窗 / 改筛选条件的写入会被合并。
 *
 * ⚠️ 卡池基数**不在**这里 —— 它在 `data/pool-baseline.json`（唯一数据源）。
 * 本存储只保存"用户可改的偏好与估算参数"。
 */

import { DEFAULT_APP_CONFIG, CONFIG_VERSION } from '../../shared/constants';
import type { AppConfig } from '../../shared/types/config';
import { configFilePath } from './paths';
import { DebouncedJsonWriter, readJsonFile } from './json-file';

/** 配置变更监听器。 */
export type ConfigListener = (config: AppConfig) => void;

/** 深合并工具：只对"普通对象"递归，数组整体替换。 */
function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) {
    return base;
  }
  if (Array.isArray(base) || typeof base !== 'object') {
    return patch as T;
  }
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    return patch as T;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = result[key];
    if (
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      result[key] = mergeDeep(current, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * 把任意版本配置迁移到当前版本。
 *
 * 目前只有 v1；后续加字段时在这里补 case，保证老用户配置不丢。
 *
 * @param raw 读到的原始配置。
 */
export function migrateConfig(raw: unknown): AppConfig {
  const merged = mergeDeep(DEFAULT_APP_CONFIG, raw) as AppConfig;
  if (merged.version !== CONFIG_VERSION) {
    merged.version = CONFIG_VERSION;
  }
  return merged;
}

/**
 * 校验并纠正越界值（防止手改 JSON 后出现 0 宽窗口或 0ms 扫描间隔）。
 *
 * @param config 待校验配置。
 */
export function sanitizeConfig(config: AppConfig): AppConfig {
  const next = mergeDeep(DEFAULT_APP_CONFIG, config);
  next.window.width = clamp(next.window.width, 180, 2000, DEFAULT_APP_CONFIG.window.width);
  next.window.height = clamp(next.window.height, 200, 2000, DEFAULT_APP_CONFIG.window.height);
  next.window.scale = clamp(next.window.scale, 0.8, 1.5, 1);
  next.window.opacity = clamp(next.window.opacity, 0.4, 1, DEFAULT_APP_CONFIG.window.opacity);
  next.scan.intervalPrepMs = clamp(next.scan.intervalPrepMs, 500, 30_000, 1_500);
  next.scan.intervalCombatMs = clamp(next.scan.intervalCombatMs, 0, 60_000, 5_000);
  next.scan.probeIntervalMs = clamp(next.scan.probeIntervalMs, 1_000, 120_000, 5_000);
  next.scan.failStreakToAlarm = clamp(next.scan.failStreakToAlarm, 1, 50, 3);
  next.recognition.matchThreshold = clamp(next.recognition.matchThreshold, 0.3, 0.99, 0.72);
  next.recognition.coarseTopN = clamp(next.recognition.coarseTopN, 1, 20, 5);
  next.recognition.fingerprintSameThreshold = clamp(
    next.recognition.fingerprintSameThreshold,
    0,
    32,
    6,
  );
  next.estimate.lowCoverageThreshold = clamp(next.estimate.lowCoverageThreshold, 0, 8, 5);
  if (next.estimate.lowConfidenceThreshold !== undefined) {
    next.estimate.lowConfidenceThreshold = clamp(next.estimate.lowConfidenceThreshold, 0.1, 1, 0.6);
  }
  if (next.estimate.staleTtlMs !== undefined) {
    next.estimate.staleTtlMs = clamp(next.estimate.staleTtlMs, 500, 120_000, 8_000);
  }
  return next;
}

/** 数值夹取。 */
function clamp(value: number, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

/** 配置存储。 */
export class ConfigStore {
  private config: AppConfig = { ...DEFAULT_APP_CONFIG };

  private readonly writer = new DebouncedJsonWriter(configFilePath());

  private readonly listeners = new Set<ConfigListener>();

  private loaded = false;

  /** 加载（幂等）。 */
  async load(): Promise<AppConfig> {
    if (this.loaded) {
      return this.config;
    }
    this.loaded = true;
    const result = await readJsonFile(configFilePath(), () => ({ ...DEFAULT_APP_CONFIG }));
    this.config = sanitizeConfig(result.fallback ? { ...DEFAULT_APP_CONFIG } : migrateConfig(result.value));
    return this.config;
  }

  /** 当前配置（只读快照）。 */
  get(): AppConfig {
    return structuredCloneSafe(this.config);
  }

  /**
   * 局部更新配置。
   *
   * @param patch 局部配置。
   * @returns 更新后的完整配置。
   */
  set(patch: Partial<AppConfig>): AppConfig {
    this.config = sanitizeConfig(mergeDeep(this.config, patch));
    this.writer.schedule(this.config);
    const snapshot = this.get();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  /** 恢复默认（保留 compliance.acknowledged）。 */
  reset(): AppConfig {
    const acknowledged = this.config.compliance.acknowledged;
    this.config = sanitizeConfig({
      ...DEFAULT_APP_CONFIG,
      compliance: { ...DEFAULT_APP_CONFIG.compliance, acknowledged },
    });
    this.writer.schedule(this.config);
    const snapshot = this.get();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  /** 订阅变更。 */
  subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 立即落盘（退出前调用）。 */
  async flush(): Promise<void> {
    await this.writer.flush();
  }
}

/** 结构化克隆的安全实现（配置是纯数据，用 JSON 往返即可）。 */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
