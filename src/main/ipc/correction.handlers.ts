/**
 * 校正域 IPC（架构 §8.3 / PRD 5.2）。
 *
 * **人工校正是一等公民**：所有校正都走 T02 的 reducer，天然带幂等与撤销栈。
 * `correction:open` 返回校正面板需要的一切（各家持有、候选、锁定态），
 * 避免渲染层自己拼数据造成口径不一致。
 */

import { ipcMain } from 'electron';
import type { PoolSnapshot, SeatOrUnknown } from '../../shared/types/domain';
import type { CorrectionCmd, CorrectionPayload } from '../../shared/types/ipc';
import {
  CH_CORRECTION_APPLY,
  CH_CORRECTION_MOVE,
  CH_CORRECTION_OPEN,
  CH_CORRECTION_UNDO,
} from '../../shared/ipc/channels';
import type { AppServices } from './context';
import { wrap } from './wrap';

/**
 * 校正后统一出口：推送快照 + 落盘会话。
 *
 * @param services 服务集合。
 * @param snapshot 新快照。
 */
function emit(services: AppServices, snapshot: PoolSnapshot | null): PoolSnapshot | null {
  if (snapshot !== null) {
    services.push.push(snapshot);
    services.session.save(services.runtime.ledgers(), services.runtime.sessionStartedAt);
  }
  return snapshot;
}

/**
 * 注册校正域 handler。
 *
 * @param services 服务集合。
 */
export function registerCorrectionHandlers(services: AppServices): void {
  ipcMain.handle(CH_CORRECTION_APPLY, (_event, cmd: CorrectionCmd) =>
    wrap<PoolSnapshot | null>(() => emit(services, services.runtime.correct(cmd))),
  );

  ipcMain.handle(
    CH_CORRECTION_MOVE,
    (_event, payload: { instanceId: string; toSeat: SeatOrUnknown }) =>
      wrap<PoolSnapshot | null>(() =>
        emit(
          services,
          services.runtime.correct({
            kind: 'move-instance',
            instanceId: payload.instanceId,
            toSeat: payload.toSeat,
          }),
        ),
      ),
  );

  ipcMain.handle(CH_CORRECTION_UNDO, () =>
    wrap<PoolSnapshot | null>(() => emit(services, services.runtime.undo())),
  );

  ipcMain.handle(
    CH_CORRECTION_OPEN,
    (_event, payload: { championId: string; seat: SeatOrUnknown }) =>
      wrap<CorrectionPayload | null>(() =>
        services.runtime.correctionPayload(payload.championId, payload.seat),
      ),
  );
}
