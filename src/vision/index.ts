/**
 * 视觉层出口（T03）。
 *
 * 分层：
 * - `capture/`  —— 唯一允许出现截屏 API 的目录（合规红线，ESLint 强制）
 * - `preprocess/` —— 原始图像、几何、裁剪、缩放（纯 JS，含 sharp 降级）
 * - `detect/`   —— 棋盘门禁 / 抽格 / 费用先验 / 星标 / 阶段 / 玩家 / 商店
 * - `match/`    —— 模板库 / pHash 粗筛 / OpenCV-NCC 精排 / 融合 / 黑名单
 * - `templates/` —— 用户自建模板采集向导 + zip 导入导出
 * - `pipeline.ts` —— 编排 + 超时保护
 * - `worker-entry.ts` —— Utility Process 入口（宿主通过 IPC 驱动）
 */

export * from './capture';
export * from './preprocess/raw-image';
export * from './preprocess/geometry';
export * from './preprocess/crop';
export * from './preprocess/scale';
export * from './detect';
export * from './match';
export * from './templates/capture-wizard';
export * from './templates/exporter';
export * from './profiler';
export * from './pipeline';
export * from './native/optional-modules';
export type {
  VisionWorkerConfig,
  WizardDraftPayload,
  VisionCapabilities,
} from './worker-entry';
export { VisionWorkerRuntime, encodeDraft, toBytes } from './worker-entry';
