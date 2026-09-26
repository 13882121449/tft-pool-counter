/** 匹配层出口：模板库 → pHash 粗筛 → OpenCV/NCC 精排 → 多证据融合 → 黑名单。 */

export {
  TEMPLATE_SIZE,
  buildTemplate,
  createFileTemplateStore,
  createMemoryTemplateStore,
  parseTemplateFile,
  serializeTemplate,
  writeTemplateFile,
  type ChampionMeta,
  type ChampionTemplate,
  type TemplateStore,
  type TemplateStoreStats,
} from './template-store';
export {
  coarseRank,
  dedupeByChampion,
  filterTemplatesByCost,
  type CoarseHit,
  type CoarseRankOptions,
} from './phash-matcher';
export {
  currentMatcherBackend,
  loadOpencv,
  nccScore,
  refineCandidates,
  scoreAgainstTemplate,
  type RefinedHit,
} from './opencv-matcher';
export {
  DEFAULT_FUSION_WEIGHTS,
  NEUTRAL_COST_AGREEMENT,
  decideMatch,
  fuseAll,
  fuseFromCoarse,
  fuseScore,
  type FusedCandidate,
  type FusionWeights,
  type MatchDecision,
} from './fusion';
export {
  EMPTY_BLACKLIST,
  createBlacklistFilter,
  filterCandidates,
  isNonPoolUnit,
  parseNonPoolUnitIds,
  type BlacklistFilter,
} from './blacklist-filter';
export {
  applyMultiCellHints,
  type MultiCellMerge,
  type MultiCellOutcome,
} from './multi-cell';
