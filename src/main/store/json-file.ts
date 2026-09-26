/**
 * 极小的 JSON 文件持久化底座（原子写 + 防抖 + 损坏自愈）。
 *
 * **为什么不用 `electron-store`**：
 * 主进程产物是 esbuild 的 **CJS** bundle（ADR-08），而 `electron-store@10`
 * 是 **pure ESM**；在 Electron 自带的 Node（20.x，未开启 `require(esm)`）下
 * `require()` 会直接抛 `ERR_REQUIRE_ESM`。为避免把启动流程押在一个
 * 模块格式赌注上，这里用 100 行透明实现替代，换来三件确定的好处：
 * 1. 原子写（先写 `.tmp` 再 rename），断电不会写出半个文件；
 * 2. 写入防抖合并（HUD 拖窗会高频改配置）；
 * 3. 解析失败自动备份坏文件并回落默认值（用户不会因为手改坏 JSON 而打不开应用）。
 */

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 读取结果。 */
export interface ReadResult<T> {
  value: T;
  /** 是否用了兜底值（文件不存在或解析失败）。 */
  fallback: boolean;
  /** 失败原因（中文）。 */
  reason?: string;
}

/**
 * 读取 JSON 文件；不存在或损坏时返回兜底值。
 *
 * @param path 文件路径。
 * @param fallback 兜底值工厂（每次调用都新建，避免共享引用）。
 * @param onCorrupt 损坏文件备份回调（可选）。
 */
export async function readJsonFile<T>(
  path: string,
  fallback: () => T,
  onCorrupt?: (backupPath: string, reason: string) => void,
): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { value: fallback(), fallback: true, reason: '文件不存在' };
  }

  try {
    const parsed = JSON.parse(text) as T;
    if (parsed === null || parsed === undefined) {
      throw new Error('内容为空');
    }
    return { value: parsed, fallback: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const backupPath = `${path}.corrupt-${Date.now()}.bak`;
    try {
      await copyFile(path, backupPath);
      onCorrupt?.(backupPath, reason);
    } catch {
      // 备份失败不影响主流程
    }
    return { value: fallback(), fallback: true, reason: `解析失败：${reason}` };
  }
}

/**
 * 原子写入 JSON 文件（先写临时文件再 rename）。
 *
 * @param path 目标路径。
 * @param value 要序列化的值。
 */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

/** 防抖写入器。 */
export class DebouncedJsonWriter {
  private timer: NodeJS.Timeout | null = null;

  private pending: unknown = undefined;

  private hasPending = false;

  private writing: Promise<void> = Promise.resolve();

  /**
   * @param path 目标路径。
   * @param delayMs 防抖延迟，默认 300ms。
   */
  constructor(
    private readonly path: string,
    private readonly delayMs = 300,
  ) {}

  /** 安排一次写入（合并同窗口内的多次调用）。 */
  schedule(value: unknown): void {
    this.pending = value;
    this.hasPending = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
  }

  /** 立即落盘（退出前必须调用）。 */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.hasPending) {
      await this.writing;
      return;
    }
    const value = this.pending;
    this.hasPending = false;
    this.pending = undefined;
    this.writing = this.writing.then(() => writeJsonFile(this.path, value)).catch(() => undefined);
    await this.writing;
  }

  /** 是否有未落盘的改动。 */
  get dirty(): boolean {
    return this.hasPending || this.timer !== null;
  }
}
