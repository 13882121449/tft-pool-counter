/**
 * 断言工具。
 *
 * `invariant` 用于在纯函数层做"不可能发生"的防御性检查，
 * 失败时抛出带上下文的错误，避免静默产生错误数据。
 */

/**
 * 条件为假时抛错。TypeScript 会据此做类型收窄。
 *
 * @param condition 必须为真的条件。
 * @param message 失败时的错误信息。
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[invariant] ${message}`);
  }
}

/**
 * 取值，为 null/undefined 时抛错。
 *
 * @param value 待取值。
 * @param message 失败时的错误信息。
 */
export function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(`[must] ${message}`);
  }
  return value;
}

/** 把数值限制在 [min, max] 区间内。 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

/** 把数值限制在 [0, 1]。 */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
