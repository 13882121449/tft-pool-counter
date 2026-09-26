/**
 * id 生成。
 *
 * 优先使用宿主提供的 `crypto.randomUUID`；在无 crypto 的环境（纯函数测试）
 * 退化为"前缀 + 单调递增 + 随机后缀"，保证既不依赖 node，也不会碰撞。
 */

let fallbackSeq = 0;

/** 检测宿主是否提供 crypto.randomUUID。 */
function hasRandomUuid(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID ===
      'function'
  );
}

/**
 * 生成一个全局唯一 id。
 *
 * @param prefix 可选前缀，便于日志排查（如 'inst'、'scan'）。
 */
export function newId(prefix = 'id'): string {
  fallbackSeq += 1;
  if (hasRandomUuid()) {
    return `${prefix}_${(globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID()}`;
  }
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${Date.now().toString(36)}_${fallbackSeq.toString(36)}_${random}`;
}

/**
 * 生成一个**确定性** id（同输入永远同输出）。
 *
 * 台账需要幂等：同一 (championId, seat, zone, slotIndex, firstSeenAt) 组合
 * 在重复 applyScan 时必须得到相同 instanceId。
 */
export function deterministicId(parts: ReadonlyArray<string | number>, prefix = 'u'): string {
  return `${prefix}_${parts.join('-')}`;
}
