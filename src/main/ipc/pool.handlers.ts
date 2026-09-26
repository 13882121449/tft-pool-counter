/**
 * 牌库域 IPC（架构 §8.3）。
 *
 * 通道：`pool:get-snapshot`
 *
 * 与 `pool:snapshot`（主 → 渲推送）互补：推送是"变化才发"，
 * 渲染进程挂载时可能已经错过启动阶段那一份，只靠推送会让 65 行列表
 * 在首次扫描之前一直是空的。这里提供幂等的一次性拉取：
 *
 *   - 已有快照 → 原样返回；
 *   - 尚无快照但基线已就绪 → 懒构建一份"全部 = 池总数、巡查 0/8"的初始快照
 *     （PRD §5.1 首屏要求），且**不清空台账**（走 `ensureSnapshot`）。
 *
 * 该通道只读、幂等：重复调用返回等价结果，且不会产生任何副作用
 * （不推快照、不落盘、不改台账）。
 */

import { ipcMain } from 'electron';
import type { PoolSnapshot } from '../../shared/types/domain';
import { CH_POOL_GET_SNAPSHOT } from '../../shared/ipc/channels';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 注册牌库域 handler。
 *
 * @param services 服务集合。
 */
export function registerPoolHandlers(services: AppServices): void {
  ipcMain.handle(CH_POOL_GET_SNAPSHOT, () =>
    wrap<PoolSnapshot | null>(() => services.runtime.ensureSnapshot()),
  );
}
