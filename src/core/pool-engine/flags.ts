/**
 * PoolFlag 判定。
 *
 * 标记决定了 UI 的高亮与告警方式，是"手动校正是一等公民"的数据基础。
 */

import type { Coverage, PoolFlag } from '../../shared/types/domain';
import type { EstimateConfig } from '../../shared/types/config';
import { LOW_CONFIDENCE_THRESHOLD, STALE_TTL_MS } from '../../shared/constants';
import type { ChampionAggregate } from './rules/types';

/** flag 判定入参。 */
export interface FlagInputs {
  aggregate: ChampionAggregate;
  coverage: Coverage;
  config: EstimateConfig;
  now: number;
}

/**
 * 判定一行结果应带哪些标记。
 *
 * @param inputs 判定入参。
 */
export function resolveFlags(inputs: FlagInputs): PoolFlag[] {
  const { aggregate, coverage, config, now } = inputs;
  const flags = new Set<PoolFlag>(aggregate.flags);

  if (aggregate.overflow > 0) {
    flags.add('OVERFLOW_DUPLICATOR');
  }
  if (coverage.scanned < config.lowCoverageThreshold) {
    flags.add('LOW_COVERAGE');
  }
  const lowConfidenceThreshold = config.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  if (aggregate.confidence < lowConfidenceThreshold) {
    flags.add('LOW_CONFIDENCE');
  }
  if (aggregate.locked) {
    flags.add('LOCKED');
  }
  if (aggregate.manualOverride) {
    flags.add('MANUAL_OVERRIDE');
  }
  const staleTtl = config.staleTtlMs ?? STALE_TTL_MS;
  if (aggregate.latestSeenAt > 0 && now - aggregate.latestSeenAt > staleTtl) {
    flags.add('STALE');
  }
  if (aggregate.instances.some((instance) => instance.seat === 8)) {
    flags.add('SEAT_UNKNOWN');
  }

  return Array.from(flags);
}
