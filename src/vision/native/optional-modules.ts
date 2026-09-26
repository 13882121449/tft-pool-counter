/**
 * 可选原生模块的安全加载器（ADR-01 降级策略的基础设施）。
 *
 * 背景：`sharp` 与 `node-screenshots` 都是**带预编译二进制**的可选依赖，
 * 在部分机器上可能装不上（网络 / 平台 / ABI）。架构要求：
 * > 不可用的后端做成"能力探测返回 false 自动跳过"，保证代码在无该依赖时
 * > 仍能 `tsc` 通过、流程不崩。
 *
 * 因此这里**不用静态 import**（静态 import 缺失模块会直接让整个进程起不来），
 * 而是用运行时动态导入 + 失败返回 null。
 */

/** 模块加载结果。 */
export interface OptionalModule<T> {
  ok: boolean;
  module: T | null;
  /** 失败原因（仅用于日志，不向用户暴露路径细节）。 */
  reason?: string;
}

/**
 * 动态导入一个模块；失败返回 `{ ok: false }` 而不是抛出。
 *
 * 说明：使用变量 specifier 是为了避免 TypeScript 在编译期解析模块类型
 * （这些包可能没有安装，静态 import 会直接编译失败）。
 *
 * @param spec 模块名，如 'sharp'。
 */
export async function tryImport<T = unknown>(spec: string): Promise<OptionalModule<T>> {
  try {
    const loaded: unknown = await import(spec);
    if (loaded === null || loaded === undefined) {
      return { ok: false, module: null, reason: `${spec} 加载结果为空` };
    }
    return { ok: true, module: loaded as T };
  } catch (error) {
    return {
      ok: false,
      module: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 从 ESM/CJS 混合导出中取出命名导出（兼容 `export =` 与 `export default`）。 */
export function pickExport<T = unknown>(mod: unknown, name: string): T | null {
  if (mod === null || typeof mod !== 'object') {
    return null;
  }
  const record = mod as Record<string, unknown>;
  const direct = record[name];
  if (direct !== undefined) {
    return direct as T;
  }
  const defaultExport = record.default;
  if (defaultExport !== null && typeof defaultExport === 'object') {
    const nested = (defaultExport as Record<string, unknown>)[name];
    if (nested !== undefined) {
      return nested as T;
    }
  }
  return null;
}

/** 从 ESM/CJS 混合导出中取出"模块本身就是函数"的默认导出（如 sharp）。 */
export function pickCallable<T = unknown>(mod: unknown, name?: string): T | null {
  if (mod !== null && typeof mod === 'function') {
    return mod as unknown as T;
  }
  if (name !== undefined) {
    const named = pickExport<T>(mod, name);
    if (named !== null && typeof named === 'function') {
      return named;
    }
  }
  if (mod !== null && typeof mod === 'object') {
    const defaultExport = (mod as Record<string, unknown>).default;
    if (typeof defaultExport === 'function') {
      return defaultExport as unknown as T;
    }
  }
  return null;
}
