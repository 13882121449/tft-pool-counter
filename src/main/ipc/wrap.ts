/**
 * IPC handler 包装器。
 *
 * 统一约定（架构 §8.3）：所有 handler 返回 `Result<T, AppError>`，
 * 因此任何抛出的异常都在这里被转成 `Err(makeError(code))`，
 * 渲染进程永远拿到"可判别、可结构化克隆"的返回值，不会看到裸异常。
 */

import type { ErrorCode } from '../../shared/types/domain';
import type { IpcResponse } from '../../shared/types/ipc';
import { Err, Ok } from '../../shared/utils/result';
import { makeError } from '../../shared/ipc/error-codes';

/**
 * 包裹一个可能同步/异步抛错的 handler。
 *
 * @param fn 实际逻辑。
 * @param code 失败时使用的错误码（默认 SYS_IPC_TIMEOUT）。
 */
export async function wrap<T>(
  fn: () => Promise<T> | T,
  code: ErrorCode = 'SYS_IPC_TIMEOUT',
): Promise<IpcResponse<T>> {
  try {
    return Ok(await fn());
  } catch (error) {
    return Err(
      makeError(code, {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
