/**
 * 极简 `Result<T, E>` 实现（跨进程可结构化克隆的纯对象）。
 *
 * 用它替代异常抛出，保证所有 IPC handler 都有可序列化的返回值。
 */

export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** 构造成功结果。 */
export function Ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** 构造失败结果。 */
export function Err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** 判定是否为成功结果。 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** 判定是否为失败结果。 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** 成功取值，失败返回默认值。 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** 成功则映射，失败原样透传。 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? Ok(fn(result.value)) : result;
}

/** 把可能抛异常的函数包成 Result（不吞掉堆栈，塞进 error 里）。 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn());
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}

/** 组合多个 Result：全部成功才成功。 */
export function combineResults<T, E>(
  results: ReadonlyArray<Result<T, E>>,
): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return Ok(values);
}
