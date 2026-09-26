/**
 * 对局台账落盘（默认关闭）。
 *
 * 为什么默认关闭（PRD 隐私取向）：
 * - 台账本身只是"我看到了哪些棋子"的结构化数据，不含任何像素/进程信息；
 * - 但它毕竟是用户的对局记录，**必须由用户显式开启**（`advanced.saveSession`）。
 *
 * 落盘内容刻意最小化：只存 `PlayerLedger[]` 与必要的元信息，
 * 绝不存截图、绝不存窗口标题、绝不含任何可识别用户身份的信息。
 */

import type { PlayerLedger } from '../../shared/types/domain';
import { sessionFilePath } from './paths';
import { DebouncedJsonWriter, readJsonFile } from './json-file';

/** 落盘结构。 */
export interface SessionFile {
  schemaVersion: string;
  savedAt: string;
  /** 仅用于排查：本局开始时间。 */
  startedAt: number;
  ledgers: PlayerLedger[];
}

/** 会话存储。 */
export class SessionStore {
  private readonly writer = new DebouncedJsonWriter(sessionFilePath(), 800);

  private enabled = false;

  /** 开启/关闭落盘。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 当前是否开启。 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 保存台账（未开启时为空操作）。
   *
   * @param ledgers 全部台账。
   * @param startedAt 本局开始时间。
   */
  save(ledgers: readonly PlayerLedger[], startedAt: number): void {
    if (!this.enabled) {
      return;
    }
    const payload: SessionFile = {
      schemaVersion: '1.0',
      savedAt: new Date().toISOString(),
      startedAt,
      ledgers: ledgers as PlayerLedger[],
    };
    this.writer.schedule(payload);
  }

  /**
   * 读取上次的台账（用于"恢复上一局"）。
   *
   * @returns 台账数组；无记录返回 null。
   */
  async load(): Promise<SessionFile | null> {
    const result = await readJsonFile<SessionFile | null>(sessionFilePath(), () => null);
    if (result.fallback || result.value === null) {
      return null;
    }
    const value = result.value;
    if (!Array.isArray(value.ledgers)) {
      return null;
    }
    return value;
  }

  /** 立即落盘。 */
  async flush(): Promise<void> {
    await this.writer.flush();
  }
}
