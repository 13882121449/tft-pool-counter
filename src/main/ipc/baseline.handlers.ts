/**
 * 基线域 IPC（架构 §8.3 / RQ-20）。
 *
 * 卡池基数**只**来自 `data/pool-baseline.json`（禁止硬编码）；
 * 设置页的「卡池自检 / 重载基线」都走这里。
 */

import { ipcMain } from 'electron';
import type { PoolBaseline } from '../../shared/types/domain';
import type { BaselineValidateResult } from '../../shared/types/ipc';
import {
  CH_BASELINE_GET,
  CH_BASELINE_RELOAD,
  CH_BASELINE_VALIDATE,
} from '../../shared/ipc/channels';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 注册基线域 handler。
 *
 * @param services 服务集合。
 */
export function registerBaselineHandlers(services: AppServices): void {
  ipcMain.handle(CH_BASELINE_GET, () =>
    wrap<PoolBaseline | null>(() => services.runtime.getBaseline()),
  );

  ipcMain.handle(CH_BASELINE_RELOAD, () =>
    wrap<BaselineValidateResult>(async () => {
      const result = await services.runtime.loadBaseline();
      const snapshot = services.runtime.getSnapshot();
      if (snapshot !== null) {
        services.push.push(snapshot);
      }
      return result;
    }),
  );

  ipcMain.handle(CH_BASELINE_VALIDATE, () =>
    wrap<BaselineValidateResult>(() => services.runtime.loadBaseline()),
  );
}
