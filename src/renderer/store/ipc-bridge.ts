/**
 * IPC 桥（架构 §3.7）：把主进程推送"翻译"进 store。
 *
 * 唯一允许调用 `window.api.onXxx` 的地方，好处：
 * - 订阅生命周期集中管理（卸载时一次性取消，不泄漏）；
 * - store 与 IPC 解耦，便于将来换成 mock。
 */

import { useConfigStore } from './use-config-store';
import { usePoolStore } from './use-pool-store';

/**
 * 建立所有订阅。
 *
 * @returns 取消订阅函数。
 */
export function initIpcBridge(): () => void {
  const offSnapshot = window.api.onPoolSnapshot((snapshot) => {
    usePoolStore.getState().setSnapshot(snapshot);
  });
  const offStatus = window.api.onScanStatus((status) => {
    usePoolStore.getState().setStatus(status);
  });
  const offError = window.api.onSystemError((error) => {
    usePoolStore.getState().pushError(error);
  });

  // 首帧：主动拉一次配置、状态与快照
  // （推送是"变化才发"，首启可能没有变化；快照推送还与 did-finish-load 有竞态）
  void useConfigStore.getState().load();
  void usePoolStore.getState().refreshStatus();
  void usePoolStore.getState().refreshSnapshot();

  return () => {
    offSnapshot();
    offStatus();
    offError();
  };
}
