/** 识别层出口：规格解析 / 棋盘门禁 / 抽格 / 费用先验 / 星标 / 阶段 / 玩家 / 商店。 */

export {
  FALLBACK_COST_COLOR_SPEC,
  FALLBACK_STAR_MARKER_SPEC,
  parseCostColorSpec,
  parseStarMarkerSpec,
  type CostClassSpec,
  type CostColorSpec,
  type StarMarkerSpec,
  type StarMarkerSpecFile,
} from './specs';
export { loadCostColorSpec, loadStarMarkerSpec, type SpecLoadResult } from './spec-loader';
export {
  BOARD_MIN_LUMA,
  BOARD_MIN_VARIANCE,
  BENCH_MIN_VARIANCE,
  detectBoard,
  isCalibrationPlausible,
  type BoardDetectionResult,
} from './board-detector';
export {
  BLANK_SLOT_LUMA,
  BLANK_SLOT_VARIANCE,
  extractBoardRow,
  extractSlotSample,
  extractSlotSamples,
  pickBoardRow,
  type SlotSample,
} from './slot-extractor';
export {
  allowedCostsFor,
  classifyCost,
  isCostAllowed,
  type CostClassifyResult,
} from './cost-classifier';
export {
  STAR_BRIGHT_LUMA,
  detectStar,
  isLowConfidenceStar,
  type StarDetectResult,
} from './star-detector';
export {
  CAROUSEL_BOARD_MAX_VARIANCE,
  COMBAT_MOTION_RATIO,
  SHOP_MIN_VARIANCE,
  detectStage,
  intervalForStage,
  type PrevFrame,
  type StageDetectResult,
} from './stage-detector';
export {
  detectByBoardFingerprint,
  detectByScoreboardHighlight,
  detectPlayer,
  rememberBoardFingerprint,
  type FingerprintMatchResult,
  type KnownBoardFingerprint,
  type PlayerDetectInput,
  type ScoreboardHighlightResult,
} from './player-detector';
export {
  shopHasContent,
  toShopSlots,
  validateShopGeometry,
  type ShopSlotMatch,
} from './shop-detector';
