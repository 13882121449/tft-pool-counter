/**
 * 错误码枚举 + 中文文案映射（架构 §4.4）。
 *
 * 命名：`域_描述`，域 ∈ {CAP, VIS, BASE, ENG, SYS}。
 * UI 优先取 `ERROR_TEXT_ZH[code]`，找不到则回退显示 `code + 英文 message`。
 */

import type { AppError, ErrorCode } from '../types/domain';

/** 全部错误码（按域分组，便于文档化与测试）。 */
export const ERROR_CODES = {
  // 捕获
  CAP_BACKEND_UNAVAILABLE: 'CAP_BACKEND_UNAVAILABLE',
  CAP_BLACK_FRAME: 'CAP_BLACK_FRAME',
  CAP_TIMEOUT: 'CAP_TIMEOUT',
  CAP_OS_UNSUPPORTED: 'CAP_OS_UNSUPPORTED',
  // 视觉
  VIS_NO_BOARD: 'VIS_NO_BOARD',
  VIS_CALIBRATION_MISSING: 'VIS_CALIBRATION_MISSING',
  VIS_TEMPLATE_EMPTY: 'VIS_TEMPLATE_EMPTY',
  VIS_LOW_CONFIDENCE: 'VIS_LOW_CONFIDENCE',
  VIS_SEAT_UNKNOWN: 'VIS_SEAT_UNKNOWN',
  // 基线
  BASE_INVALID_JSON: 'BASE_INVALID_JSON',
  BASE_SCHEMA_FAIL: 'BASE_SCHEMA_FAIL',
  BASE_SET_MISMATCH: 'BASE_SET_MISMATCH',
  BASE_UNCONFIRMED: 'BASE_UNCONFIRMED',
  // 引擎
  ENG_OVERFLOW: 'ENG_OVERFLOW',
  ENG_UNKNOWN_CHAMPION: 'ENG_UNKNOWN_CHAMPION',
  // 系统
  SYS_IPC_TIMEOUT: 'SYS_IPC_TIMEOUT',
  SYS_WORKER_CRASH: 'SYS_WORKER_CRASH',
  SYS_STORE_WRITE_FAIL: 'SYS_STORE_WRITE_FAIL',
} as const satisfies Record<ErrorCode, ErrorCode>;

/** 错误码中文文案（与 `data/ui-text.zh-CN.json` 的 errors 段保持一致）。 */
export const ERROR_TEXT_ZH: Record<ErrorCode, string> = {
  CAP_BACKEND_UNAVAILABLE: '屏幕捕获后端不可用，已尝试降级',
  CAP_BLACK_FRAME: '捕获到纯黑帧，请在游戏内切换为无边框/窗口化全屏',
  CAP_TIMEOUT: '屏幕捕获超时',
  CAP_OS_UNSUPPORTED: '当前系统版本不支持 Windows Graphics Capture',
  VIS_NO_BOARD: '未检测到棋盘，已休眠等待',
  VIS_CALIBRATION_MISSING: '尚未完成棋盘标定，请先运行标定向导',
  VIS_TEMPLATE_EMPTY: '识别模板为空，请先生成或导入模板集',
  VIS_LOW_CONFIDENCE: '识别置信度偏低，建议手动校正',
  VIS_SEAT_UNKNOWN: '未能判断当前是第几家，请手动指定',
  BASE_INVALID_JSON: '卡池基线文件不是合法 JSON',
  BASE_SCHEMA_FAIL: '卡池基线文件结构校验失败',
  BASE_SET_MISMATCH: '当前模式卡池基线未配置（仅支持 Set 18）',
  BASE_UNCONFIRMED: '卡池基线尚未实测确认，数值仅供参考',
  ENG_OVERFLOW: '已观测张数超过卡池总数，疑似使用了英雄复制器',
  ENG_UNKNOWN_CHAMPION: '观测到未知弈子 id，已忽略',
  SYS_IPC_TIMEOUT: '进程间通信超时',
  SYS_WORKER_CRASH: '识别进程崩溃，正在自动重启',
  SYS_STORE_WRITE_FAIL: '配置写入失败',
};

/** 构造一个 AppError（统一入口，避免各处手写字面量）。 */
export function makeError(
  code: ErrorCode,
  options: { message?: string; detail?: unknown; at?: number; fatal?: boolean } = {},
): AppError {
  return {
    code,
    message: options.message ?? ERROR_TEXT_ZH[code],
    detail: options.detail,
    at: options.at ?? Date.now(),
    fatal: options.fatal ?? false,
  };
}

/** 判断错误是否属于"必须中断当前流程"的严重错误。 */
export function isFatal(error: AppError): boolean {
  return error.fatal;
}
