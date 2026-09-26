/**
 * 识别流水线编排（架构 §1.2 + §9 T03）：
 *
 * ```
 * capture → geometry → board-detect → slot-extract
 *        → cost-classifier(先验剪枝) → phash 粗筛 → opencv 精排 → fusion → 裁决
 *        → star-detect → blacklist-filter → 玩家/阶段识别 → ScanResult
 * ```
 *
 * 三条硬性保证：
 * 1. **超时保护**：整条链包在 `withTimeout` 里（默认 1200ms），超时返回
 *    带 `CAP_TIMEOUT` 的降级结果，调度器不会被拖死；
 * 2. **零异常溢出**：任何一个槽位识别失败都只是该槽位置信度低，
 *    绝不会让整次扫描抛异常（`ScanResult.errors` 承载问题）；
 * 3. **零像素外流**：返回的 `ScanResult` 只含结构化观测，不含任何像素数据
 *    （合规 X8：结构上杜绝"截图被上传"）。
 */

import { makeError } from '../shared/ipc/error-codes';
import { SCAN_TIMEOUT_MS } from '../shared/constants';
import type { AppError, SeatOrUnknown, Star } from '../shared/types/domain';
import { UNKNOWN_SEAT } from '../shared/types/domain';
import type { ObservationRecord, ScanResult, SeatGuess, ShopSlot } from '../shared/types/scan';
import { createEmptyScanResult } from '../shared/types/scan';
import type { CaptureManager } from './capture/capture-manager';
import { detectBoard } from './detect/board-detector';
import type { CostColorSpec, StarMarkerSpecFile } from './detect/specs';
import { detectPlayer, type KnownBoardFingerprint } from './detect/player-detector';
import { toShopSlots, type ShopSlotMatch } from './detect/shop-detector';
import { extractSlotSamples, type SlotSample } from './detect/slot-extractor';
import { detectStage, type PrevFrame } from './detect/stage-detector';
import { classifyCost } from './detect/cost-classifier';
import { detectStar, isLowConfidenceStar } from './detect/star-detector';
import type { BlacklistFilter } from './match/blacklist-filter';
import { decideMatch, fuseAll, type FusedCandidate } from './match/fusion';
import { applyMultiCellHints } from './match/multi-cell';
import { refineCandidates } from './match/opencv-matcher';
import { coarseRank, filterTemplatesByCost } from './match/phash-matcher';
import type { TemplateStore } from './match/template-store';
import { buildGeometry, type GridGeometry } from './preprocess/geometry';
import { fingerprint, type RawImage } from './preprocess/raw-image';
import { ScanProfiler, withTimeout } from './profiler';

/** 识别配置（取自 `AppConfig.recognition`）。 */
export interface PipelineRecognitionConfig {
  matchThreshold: number;
  coarseTopN: number;
  enableShopDetect: boolean;
}

/** 流水线依赖（全部注入，便于单测与替换）。 */
export interface PipelineDeps {
  capture: CaptureManager;
  templates: TemplateStore;
  costSpec: CostColorSpec;
  starSpec: StarMarkerSpecFile;
  blacklist: BlacklistFilter;
  recognition: PipelineRecognitionConfig;
  /** 超时毫秒数，默认 1200。 */
  timeoutMs?: number;
  /** 时钟注入。 */
  now?: () => number;
  /** 能拿到"上一帧"时传入（阶段识别的运动判据）。 */
  prevFrame?: () => PrevFrame;
  /**
   * 本帧捕获完成后的回调（宿主用它把帧存为"上一帧"，避免重复截图）。
   * 对架构 §9 的最小扩展，不改变任何对外契约。
   */
  onFrame?: (frame: RawImage) => void;
  /** 已知座位↔棋盘指纹记录。 */
  knownFingerprints?: readonly KnownBoardFingerprint[];
  /** 用户手动指定的座位。 */
  seatHint?: SeatOrUnknown | null;
  /**
   * championId → 占用格数（`teamSlots`）。
   *
   * 提供后，识别层会在裁决完成后把同一只多格单位（远古巨龙）占据的相邻格
   * 合并为一条观测并写 `slotSpan`（QA M2）。缺省时不合并（引擎侧仍有兜底）。
   */
  teamSlots?: ReadonlyMap<string, number>;
}

/** 一次扫描请求。 */
export interface PipelineRequest {
  scanId: string;
  trigger: 'scheduled' | 'manual' | 'probe';
  calibration: import('../shared/types/scan').Calibration;
  options: { detectPlayer: boolean; detectStage: boolean; detectShop: boolean };
}

/** 单格识别的中间产物，便于调试与"剪枝率"统计。 */
export interface SlotRecognition {
  zone: SlotSample['zone'];
  slotIndex: number;
  blank: boolean;
  costGuess: number | null;
  /** 候选池大小（费用剪枝后）。 */
  candidatePoolSize: number;
  /** 融合后的候选（已降序）。 */
  fused: FusedCandidate[];
  /** 裁决结果（含 championId / confidence / lowConfidence / candidates）。 */
  decision: ReturnType<typeof decideMatch>;
}

/**
 * 识别单个非空格子。
 *
 * @param sample 格子样本。
 * @param deps 依赖。
 * @returns 中间产物。
 */
async function recognizeSlot(sample: SlotSample, deps: PipelineDeps): Promise<SlotRecognition> {
  const allTemplates = deps.templates.all();

  // 步骤 3：费用颜色先验 → 剪枝（65 类 → ≤14 类）
  const costResult = classifyCost(sample.image, deps.costSpec);
  const allowed = filterTemplatesByCost(
    allTemplates,
    costResult.cost === null ? [] : [costResult.cost],
  );

  // 步骤 4：pHash 粗筛 Top-N
  const coarse = coarseRank(sample.fingerprint, sample.dHash, allowed, {
    topN: deps.recognition.coarseTopN,
  });

  // 步骤 5：精排
  const refined = await refineCandidates(sample.image, allowed, coarse);

  // 步骤 6：多证据融合 + 裁决
  const fused = fuseAll(refined, costResult.cost);
  const decision = decideMatch(fused, deps.recognition.matchThreshold, deps.recognition.coarseTopN);

  return {
    zone: sample.zone,
    slotIndex: sample.slotIndex,
    blank: false,
    costGuess: costResult.cost,
    candidatePoolSize: allowed.length,
    fused,
    decision,
  };
}

/**
 * 由中间产物构造 `ObservationRecord`。
 *
 * @param sample 格子样本。
 * @param recognition 识别中间产物。
 * @param starSpec 星标规格。
 * @param blacklist 黑名单。
 */
async function buildObservation(
  sample: SlotSample,
  recognition: SlotRecognition,
  starSpec: StarMarkerSpecFile,
  blacklist: BlacklistFilter,
): Promise<ObservationRecord> {
  const starResult = detectStar(sample.image, starSpec);
  const decision = recognition.decision;

  const championId = decision.championId;
  const isBlacklisted = championId !== null && blacklist.has(championId);

  // 置信度取"识别置信度"与"星级置信度"的较小者（任一不确定就算不确定）
  const confidence = Math.max(
    0,
    Math.min(1, Math.min(decision.confidence, Math.max(0.5, starResult.confidence))),
  );

  return {
    zone: sample.zone,
    slotIndex: sample.slotIndex,
    championId: isBlacklisted ? null : championId,
    star: starResult.star,
    confidence,
    fingerprint: sample.fingerprint,
    costGuess: (recognition.costGuess as ObservationRecord['costGuess']) ?? null,
    candidates: decision.candidates,
    isBlacklisted,
  };
}

/**
 * 构造空格观测（卖回池判据的上游来源）。
 *
 * @param sample 格子样本。
 */
function buildEmptyObservation(sample: SlotSample): ObservationRecord {
  return {
    zone: sample.zone,
    slotIndex: sample.slotIndex,
    championId: null,
    star: 1,
    // 空格判定很可靠（亮度方差极低），给高置信
    confidence: 0.9,
    fingerprint: sample.fingerprint,
    costGuess: null,
    candidates: [],
    isBlacklisted: false,
  };
}

/**
 * 计算整块棋盘的 pHash（L2 玩家识别用）。
 *
 * @param frame 整帧。
 * @param geometry 网格几何。
 */
function boardFingerprint(frame: RawImage, geometry: GridGeometry): string {
  const board = frame;
  // 用棋盘标定矩形的派生裁片做指纹：直接对整帧做 pHash 会受 HUD/UI 干扰
  const rect = geometry.boardRect;
  const data = new Uint8Array(Math.max(0, rect.w) * Math.max(0, rect.h) * frame.channels);
  for (let row = 0; row < rect.h; row += 1) {
    const srcBase = ((rect.y + row) * frame.width + rect.x) * frame.channels;
    const dstBase = row * rect.w * frame.channels;
    data.set(
      frame.data.subarray(srcBase, srcBase + rect.w * frame.channels),
      dstBase,
    );
  }
  if (data.length === 0) {
    return '0'.repeat(16);
  }
  return fingerprint({
    ...board,
    width: rect.w,
    height: rect.h,
    data,
  });
}

/**
 * 执行一次完整扫描。
 *
 * @param deps 依赖。
 * @param request 请求。
 * @returns `ScanResult`（永不抛异常）。
 */
export async function runScanPipeline(
  deps: PipelineDeps,
  request: PipelineRequest,
): Promise<ScanResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const errors: AppError[] = [];
  const profiler = new ScanProfiler(now);
  profiler.start();

  const timed = await withTimeout(
    runPipelineCore(deps, request, profiler, errors, startedAt, now),
    deps.timeoutMs ?? SCAN_TIMEOUT_MS,
    () => {
      const snapshot = profiler.end();
      return {
        ...createEmptyScanResult(request.scanId, now(), [
          ...errors,
          makeError('CAP_TIMEOUT', {
            message: `识别流水线超过 ${deps.timeoutMs ?? SCAN_TIMEOUT_MS}ms 未完成`,
            detail: snapshot.segments,
          }),
        ]),
        startedAt,
        finishedAt: now(),
      };
    },
  );

  if (timed.timedOut) {
    return timed.value;
  }
  return timed.value;
}

/**
 * 流水线主体（被超时包装）。
 */
async function runPipelineCore(
  deps: PipelineDeps,
  request: PipelineRequest,
  profiler: ScanProfiler,
  errors: AppError[],
  startedAt: number,
  now: () => number,
): Promise<ScanResult> {
  // ---- 1. 捕获 ----
  const captureOutcome = await deps.capture.capture();
  const captureMs = profiler.mark('capture');
  errors.push(...captureOutcome.errors);

  if (captureOutcome.image === null) {
    return {
      ...createEmptyScanResult(request.scanId, now(), errors),
      startedAt,
      finishedAt: now(),
      metrics: {
        captureMs,
        geometryMs: 0,
        matchMs: 0,
        starMs: 0,
        playerMs: 0,
        backend: captureOutcome.backend ?? 'desktopCapturer',
      },
    };
  }
  const frame = captureOutcome.image;
  deps.onFrame?.(frame);

  // ---- 2. 几何（用**实际帧尺寸**，天然对齐物理像素与 DPI 缩放）----
  const geometry = buildGeometry(request.calibration, {
    width: frame.width,
    height: frame.height,
    scaleFactor: frame.scaleFactor,
  });
  const geometryMs = profiler.mark('geometry');

  // ---- 3. 棋盘门禁 ----
  const boardResult = detectBoard(frame, geometry);
  if (!boardResult.present) {
    errors.push(makeError('VIS_NO_BOARD', { message: boardResult.reason }));
    return {
      ...createEmptyScanResult(request.scanId, now(), errors),
      startedAt,
      finishedAt: now(),
      stage: 'unknown',
      metrics: {
        captureMs,
        geometryMs,
        matchMs: 0,
        starMs: 0,
        playerMs: 0,
        backend: captureOutcome.backend ?? 'desktopCapturer',
      },
    };
  }

  // ---- 4. 抽格 ----
  const samples = await extractSlotSamples(frame, geometry, {
    includeShop: request.options.detectShop,
  });

  // ---- 5~6. 逐格识别 ----
  const observations: ObservationRecord[] = [];
  const shopMatches: ShopSlotMatch[] = [];
  for (const sample of samples) {
    if (sample.blank) {
      if (sample.zone !== 'shop') {
        observations.push(buildEmptyObservation(sample));
      } else {
        shopMatches.push({ slotIndex: sample.slotIndex, championId: null, confidence: 0.9, cost: null });
      }
      continue;
    }

    try {
      const recognition = await recognizeSlot(sample, deps);
      profiler.mark('match');

      if (sample.zone === 'shop') {
        const top = recognition.fused[0];
        shopMatches.push({
          slotIndex: sample.slotIndex,
          championId: top?.championId ?? null,
          confidence: top?.score ?? 0,
          cost: top?.cost ?? null,
        });
        profiler.mark('star');
        continue;
      }

      observations.push(await buildObservation(sample, recognition, deps.starSpec, deps.blacklist));
      profiler.mark('star');
    } catch (error) {
      // 单格失败不致命：记录错误并跳过该格
      errors.push(
        makeError('VIS_LOW_CONFIDENCE', {
          message: `槽位识别失败（zone=${sample.zone}, slot=${sample.slotIndex}）`,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  // ---- 6.5 多格实例（远古巨龙）合并 + slotSpan 标注（QA M2）----
  const finalObservations =
    deps.teamSlots !== undefined && deps.teamSlots.size > 0
      ? applyMultiCellHints(
          observations,
          {
            board: request.calibration.boardCols,
            bench: request.calibration.benchSlots,
            shop: request.calibration.shopSlots,
          },
          deps.teamSlots,
        ).observations
      : observations;
  const matchMs = profiler.segmentMs('match');

  // ---- 7. 玩家识别（L1/L2/L3）----
  const boardFp = boardFingerprint(frame, geometry);
  let seatGuess: SeatGuess = { seat: UNKNOWN_SEAT, confidence: 0, method: 'unknown' };
  if (request.options.detectPlayer) {
    const scoreboardCrop =
      geometry.scoreboardRect && geometry.scoreboardRect.w > 0
        ? cropForPlayer(frame, geometry)
        : null;
    seatGuess = detectPlayer({
      scoreboard: scoreboardCrop,
      boardFingerprint: boardFp,
      known: deps.knownFingerprints ?? [],
      hint: deps.seatHint ?? null,
    });
    if (seatGuess.method === 'unknown') {
      errors.push(makeError('VIS_SEAT_UNKNOWN'));
    }
  }
  const playerMs = profiler.mark('player');

  // ---- 8. 阶段识别 ----
  let stage: ScanResult['stage'] = 'unknown';
  let stageConfidence = 0;
  if (request.options.detectStage) {
    const prev = deps.prevFrame?.() ?? null;
    const stageResult = detectStage(frame, geometry, prev);
    stage = stageResult.stage;
    stageConfidence = stageResult.confidence;
  }
  profiler.mark('stage');

  const profile = profiler.end();
  const finishedAt = now();

  const shop: ShopSlot[] | undefined = request.options.detectShop
    ? toShopSlots(
        shopMatches,
        // 小精灵格位来自几何配置；缺省排除最后一格
        Math.max(0, geometry.shop.length - 1),
      )
    : undefined;

  return {
    scanId: request.scanId,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    stage,
    stageConfidence,
    seatGuess,
    observations: finalObservations,
    shop,
    metrics: {
      captureMs,
      geometryMs,
      matchMs,
      starMs: profile.segments.star ?? 0,
      playerMs,
      backend: captureOutcome.backend ?? 'desktopCapturer',
    },
    errors,
  };
}

/**
 * 裁出计分板区域（L1 玩家识别用）。
 *
 * @param frame 整帧。
 * @param geometry 网格几何。
 */
function cropForPlayer(frame: RawImage, geometry: GridGeometry): RawImage | null {
  const rect = geometry.scoreboardRect;
  if (!rect || rect.w <= 0 || rect.h <= 0) {
    return null;
  }
  const data = new Uint8Array(rect.w * rect.h * frame.channels);
  for (let row = 0; row < rect.h; row += 1) {
    const srcBase = ((rect.y + row) * frame.width + rect.x) * frame.channels;
    data.set(frame.data.subarray(srcBase, srcBase + rect.w * frame.channels), row * rect.w * frame.channels);
  }
  return { ...frame, width: rect.w, height: rect.h, data };
}

/**
 * 把识别结果里的低置信槽位摘出来（HUD 高亮 + 一键校正入口）。
 *
 * @param observations 观测列表。
 * @param threshold 低置信号阈值，默认 0.6。
 */
export function listLowConfidenceSlots(
  observations: ObservationRecord[],
  threshold = 0.6,
): ObservationRecord[] {
  return observations.filter(
    (observation) =>
      observation.championId !== null && observation.confidence < threshold,
  );
}

/**
 * 星级保守性校验：把"不确定的星级"降级为保守默认值（下游写入前的最后一道保险）。
 *
 * 这是"宁可低估已消耗、不可高估已消耗"取值方向的最终落点。
 *
 * @param result 星级识别结果。
 * @param spec 星标规格。
 * @returns 用于记账的星级。
 */
export function conservativeStar(result: ReturnType<typeof detectStar>, spec: StarMarkerSpecFile): Star {
  return isLowConfidenceStar(result, spec) ? spec.conservativeDefaultStar : result.star;
}
