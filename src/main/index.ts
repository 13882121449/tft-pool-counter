/**
 * Electron 主进程入口（架构 §3.6 / §5.1）。
 *
 * 启动顺序（严格按依赖）：
 *   单实例锁 → app ready → 日志 → 配置 → 标定 → 窗口 → 台账宿主 → 快照推送
 *   → Vision worker 宿主 → 调度器 → IPC handlers → 热键/托盘/生命周期 → 开扫
 *
 * 合规（PRD 第 7 章 X1–X8）：本文件及整个 main 进程只做
 * 窗口管理 / 进程编排 / 配置持久化；**不读进程内存、不注入、不模拟输入、不上传**。
 * 所有屏幕像素处理都发生在独立的 vision utilityProcess 内。
 */

import { app } from 'electron';
import type { AppError } from '../shared/types/domain';
import { ConfigStore } from './store/config-store';
import { SessionStore } from './store/session-store';
import { CalibrationStore } from './store/calibration-store';
import { LedgerRuntime } from './ledger-runtime';
import { SnapshotPusher } from './snapshot-push';
import { VisionHost } from './vision-host';
import { ScanScheduler } from './scheduler/scan-scheduler';
import { WindowManager } from './windows/window-manager';
import { dataDir, userTemplatesDir, visionWorkerPath } from './store/paths';
import { devServerUrl } from './windows/renderer-url';
import { initLogger, logger } from './system/logger';
import { registerHandlers } from './ipc/register-handlers';
import type { AppServices } from './ipc/context';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { createTray, disposeTray } from './tray';
import { installLifecycle } from './lifecycle';

/** 开发态 dev server 地址（由 scripts/dev.mjs 注入）。 */
const DEV_SERVER_URL = devServerUrl();

/** 全局服务集合（bootstrap 后可用）。 */
let services: AppServices | null = null;

/** 生命周期卸载函数。 */
let detachLifecycle: (() => void) | null = null;

/** 是否正在退出（防止重复清理）。 */
let shuttingDown = false;

/** 上次生效的热键签名（用于热键变更时才重注册）。 */
let hotkeySignature = '';

// ---------------------------------------------------------------------------
// 单实例锁
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const hud = services?.windows.hud() ?? null;
    if (hud !== null) {
      if (hud.isMinimized()) {
        hud.restore();
      }
      hud.showInactive();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    const hud = services?.windows.hud() ?? null;
    if (hud === null) {
      services?.windows.createAll();
    }
  });

  app.on('will-quit', (event) => {
    if (shuttingDown) {
      return;
    }
    event.preventDefault();
    void shutdown().finally(() => {
      app.exit(0);
    });
  });

  void bootstrap();
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

/** 应用启动主流程。 */
async function bootstrap(): Promise<void> {
  await app.whenReady();

  initLogger('info');

  const config = new ConfigStore();
  const initialConfig = await config.load();
  initLogger(initialConfig.advanced.logLevel);

  const session = new SessionStore();
  session.setEnabled(initialConfig.advanced.saveSession);

  const calibration = new CalibrationStore();
  await calibration.load();

  const windows = new WindowManager(config, DEV_SERVER_URL);
  windows.createAll();

  const push = new SnapshotPusher(() => windows.allWindows());

  const runtime = new LedgerRuntime(config);

  const vision = new VisionHost({
    workerPath: visionWorkerPath(),
    dataDir: dataDir(),
    templateDir: userTemplatesDir(),
    recognition: {
      matchThreshold: initialConfig.recognition.matchThreshold,
      coarseTopN: initialConfig.recognition.coarseTopN,
      enableShopDetect: initialConfig.recognition.enableShopDetect,
    },
    onError: (error: AppError) => {
      push.pushError(error);
    },
    onCapabilities: (capabilities) => {
      logger.info('[vision] 能力上报', {
        backend: capabilities.backend,
        matcher: capabilities.matcherBackend,
        templates: capabilities.templateCount,
      });
    },
  });

  const scheduler = new ScanScheduler({
    runtime,
    vision,
    config,
    push,
    getCalibration: () => calibration.get(),
    onError: (error) => push.pushError(error),
  });

  services = {
    config,
    session,
    calibration,
    runtime,
    push,
    vision,
    scheduler,
    windows,
    devServerUrl: DEV_SERVER_URL,
  };

  registerHandlers(services);
  registerHotkeys(services);
  hotkeySignature = hotkeySignatureOf(initialConfig.hotkeys.toggleVisible, initialConfig.hotkeys.togglePause);
  createTray(services);
  detachLifecycle = installLifecycle({ scheduler });

  // 热键变更时才重新注册（避免拖窗等高频配置写入触发无谓的 unregisterAll）
  config.subscribe((next) => {
    const signature = hotkeySignatureOf(next.hotkeys.toggleVisible, next.hotkeys.togglePause);
    if (signature !== hotkeySignature) {
      hotkeySignature = signature;
      if (services !== null) {
        registerHotkeys(services);
      }
    }
  });

  // 加载卡池基线（失败不阻塞启动，HUD 会显示错误提示）
  const baselineResult = await runtime.loadBaseline();
  if (!baselineResult.ok) {
    for (const error of baselineResult.errors) {
      push.pushError(error);
    }
  }

  // 恢复上一局台账（仅在显式开启落盘时）
  if (initialConfig.advanced.saveSession) {
    const saved = await session.load();
    if (saved !== null) {
      runtime.restore(saved.ledgers);
      logger.info('[app] 已恢复上一局台账', { ledgers: saved.ledgers.length });
    }
  }

  // 标定就绪则下发给 worker，并启动扫描
  const readyCalibration = calibration.get();
  if (readyCalibration !== null) {
    vision.setCalibration(readyCalibration);
  }
  vision.start();

  // HUD 首次加载完成后再推一份初始快照（此时渲染层已订阅）
  // 注意用 ensureSnapshot 而不是 reset：上面可能刚 restore 过上一局台账，
  // reset 会顺手把它抹掉（只是想读一份快照，不该有副作用）。
  const hud = windows.hud();
  hud?.webContents.once('did-finish-load', () => {
    const initial = runtime.ensureSnapshot();
    if (initial !== null) {
      push.push(initial);
    }
  });

  scheduler.start();

  logger.info('[app] 启动完成', {
    dev: DEV_SERVER_URL.length > 0,
    setNumber: runtime.getBaselineInfo()?.setNumber ?? null,
    calibrationReady: readyCalibration !== null,
  });
}

/** 计算热键签名。 */
function hotkeySignatureOf(toggleVisible: string, togglePause: string): string {
  return `${toggleVisible}|${togglePause}`;
}

// ---------------------------------------------------------------------------
// 退出清理
// ---------------------------------------------------------------------------

/** 退出清理：停调度、落盘、释放 worker 与窗口。 */
async function shutdown(): Promise<void> {
  shuttingDown = true;
  const current = services;
  if (current === null) {
    return;
  }
  try {
    current.scheduler.stop();
    current.push.flush();
    if (current.session.isEnabled()) {
      current.session.save(current.runtime.ledgers(), current.runtime.sessionStartedAt);
    }
    await current.session.flush();
    await current.config.flush();
    unregisterHotkeys();
    disposeTray();
    detachLifecycle?.();
    detachLifecycle = null;
    current.vision.stop();
    current.windows.dispose();
    logger.info('[app] 退出清理完成');
  } catch (error) {
    logger.error('[app] 退出清理异常', error);
  }
}
