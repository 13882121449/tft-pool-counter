/**
 * 阵容推荐领域类型（新增模块）。
 *
 * ## 定位
 * 本模块回答的是「现在这套阵容**能不能凑出来**」，而不是「哪套阵容最强」。
 *
 * 强度榜单会随版本过时、且必须依赖外部数据源（图鉴站/统计站），而「可成型度」
 * 只有拿到了**全场牌库剩余数**才算得准 —— 这正是本工具独有的数据优势。
 * 因此推荐逻辑严格只吃两份输入：**我已有的**（`bySeat[mySeat]`）与
 * **牌库剩的**（`remaining` / `remainingPessimistic`）。
 *
 * ## 误差声明
 * 推荐结果继承牌库快照本身的误差（未侦察到的玩家、两次扫描之间的买入卖出）。
 * UI 必须与牌库列表一样显示覆盖率与「估算」字样，不得呈现为确定性结论。
 */

import type { Cost, Star } from './domain';

/** 成员在牌库中的可得性状态。 */
export type MemberStatus =
  /** 剩余足够买到目标星级。 */
  | 'ready'
  /** 剩余紧张，可能买不齐。 */
  | 'contested'
  /** 牌库已被抢空，买不到。 */
  | 'blocked';

/** 阵容整体成型难度。 */
export type Feasibility =
  /** 牌库充足，成型轻松。 */
  | 'easy'
  /** 正常难度。 */
  | 'normal'
  /** 牌库紧张，需要抢。 */
  | 'hard'
  /** 核心成员牌库已空，基本成型无望。 */
  | 'blocked';

/** 推荐阵容里的一名成员。 */
export interface LineupMember {
  championId: string;
  nameCn: string;
  cost: Cost;
  /** 我当前持有张数（`bySeat[mySeat]`）。 */
  owned: number;
  /** 建议目标星级。 */
  targetStar: Star;
  /** 距目标星级还需购买的张数（已达标为 0）。 */
  needed: number;
  /** 全场剩余（乐观口径）。 */
  poolRemaining: number;
  /** 全场剩余（悲观口径，已扣未侦察玩家的估计持有）。 */
  poolPessimistic: number;
  status: MemberStatus;
  /** 是否为核心成员（决定此羁绊的骨干，UI 优先展示）。 */
  core: boolean;
}

/** 阵容激活的羁绊。 */
export interface LineupTrait {
  /** 英文 key，与基线 traits 一致。 */
  trait: string;
  /** 国服译名；基线未确认时为「未译」占位。 */
  nameCn: string;
  /** 本阵容中带此羁绊的成员数。 */
  count: number;
  /** 该羁绊在整池中总共可用的成员数（表示「还能换谁」）。 */
  poolCount: number;
}

/** 一条阵容推荐。 */
export interface LineupRecommendation {
  /** 稳定 id，由成员集合派生，便于 UI 做 diff/动画。 */
  id: string;
  /** 核心羁绊，按成员数降序。 */
  traits: LineupTrait[];
  members: LineupMember[];
  /** 0..100 综合评分，仅用于同快照内排序，不是绝对强度。 */
  score: number;
  feasibility: Feasibility;
  /** 还需购买的总张数（不含已拥有）。 */
  missingCopies: number;
  /** 一句话结论，直接展示给玩家。 */
  summary: string;
}

/** 追星建议的结论。 */
export type ChaseVerdict =
  /** 牌库充足，继续追。 */
  | 'keep-chasing'
  /** 剩余紧张，观望。 */
  | 'hold'
  /** 牌库已空或几乎无望，止损。 */
  | 'stop';

/** 单个已持有弈子的追星建议。 */
export interface ChaseAdvice {
  championId: string;
  nameCn: string;
  cost: Cost;
  owned: number;
  /** 当前星级（由持有张数推断）。 */
  star: Star;
  verdict: ChaseVerdict;
  /** 距离下一星级还需几张。 */
  neededToNextStar: number;
  poolRemaining: number;
  poolPessimistic: number;
  /** 判定理由，直接展示。 */
  reason: string;
}

/** 推荐计算的参数快照。 */
export interface RecommendationParams {
  /** 上阵人口（通常等于等级）。 */
  population: number;
  /** 我的座位。 */
  mySeat: number;
  /** 返回的阵容条数。 */
  topN: number;
}

/** 推荐模块的完整输出。 */
export interface RecommendationResult {
  lineups: LineupRecommendation[];
  chase: ChaseAdvice[];
  generatedAt: number;
  params: RecommendationParams;
  /** 数据可信度提示，UI 需原样显示。 */
  disclaimer: string;
}
