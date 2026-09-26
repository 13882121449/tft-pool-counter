/**
 * QA2 独立审计 —— 2.5 IPC 契约三方一致（不 import electron，纯静态解析）。
 *
 * 三方来源：
 *   ① 定义 `src/shared/ipc/channels.ts`（唯一通道常量处）
 *   ② 暴露 `src/preload/index.ts`（`ipcRenderer.invoke/subscribe`）
 *   ③ 注册 `src/main/ipc/*.handlers.ts`（`ipcMain.handle`）
 *
 * 断言：
 *   a) 通道常量与 ALL_CHANNELS 数量一致、无重复；
 *   b) 通道命名规范 `domain:action`；
 *   c) preload 调用的每个通道都在 main 注册（无悬空 invoke）；
 *   d) main 注册的每个通道都在 channels.ts 声明（无未声明的裸字符串）；
 *   e) 不存在"声明了却未接线"的死通道（QA N2 整改后升级为硬不变量）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CHANNELS, IpcChannel } from '../../src/shared/ipc/channels';
import { PROJECT_ROOT } from '../helpers/goldens';

const CHANNELS_SRC = readFileSync(resolve(PROJECT_ROOT, 'src', 'shared', 'ipc', 'channels.ts'), 'utf8');
const PRELOAD_SRC = readFileSync(resolve(PROJECT_ROOT, 'src', 'preload', 'index.ts'), 'utf8');

const MAIN_IPC_DIR = resolve(PROJECT_ROOT, 'src', 'main', 'ipc');
const MAIN_SRC = readdirSync(MAIN_IPC_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(resolve(MAIN_IPC_DIR, f), 'utf8'))
  .join('\n');

/** 提取匹配的常量名集合。 */
function extract(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(re)) {
    out.add(m[1]!);
  }
  return out;
}

const declaredConstants = extract(CHANNELS_SRC, /^export const (CH_[A-Z_]+)\s*=/gm);
const preloadInvoked = extract(PRELOAD_SRC, /ipcRenderer\.invoke\((CH_[A-Z_]+)/g);
// 推送订阅：preload 通过 subscribe(CH_X, cb) 注册
const preloadSubscribed = extract(PRELOAD_SRC, /subscribe\((CH_[A-Z_]+)/g);
const mainHandled = extract(MAIN_SRC, /ipcMain\.handle\(\s*(CH_[A-Z_]+)/g);

describe('2.5 IPC 通道定义', () => {
  it('通道常量与 ALL_CHANNELS 数量一致且无重复', () => {
    expect(new Set(ALL_CHANNELS).size).toBe(ALL_CHANNELS.length);
    expect(declaredConstants.size).toBe(ALL_CHANNELS.length);
  });

  it('每个通道名符合 domain:action 规范', () => {
    for (const channel of ALL_CHANNELS) {
      expect(channel as IpcChannel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });

  it('ALL_CHANNELS 覆盖 channels.ts 中声明的全部常量', () => {
    // ALL_CHANNELS 的长度已等于声明数量；这里再验证每个声明名都出现在源码数组中
    for (const name of declaredConstants) {
      expect(CHANNELS_SRC).toContain(`  ${name},`);
    }
  });
});

describe('2.5 preload ↔ main 契约', () => {
  it('preload 调用的通道全部在 main 注册（无悬空 invoke）', () => {
    expect(preloadInvoked.size).toBeGreaterThan(20);
    const dangling: string[] = [];
    for (const name of preloadInvoked) {
      if (!mainHandled.has(name)) {
        dangling.push(name);
      }
    }
    expect(dangling).toEqual([]);
  });

  it('preload 订阅的推送通道均已在 channels.ts 声明', () => {
    expect(preloadSubscribed.size).toBeGreaterThanOrEqual(3);
    for (const name of preloadSubscribed) {
      expect(declaredConstants.has(name)).toBe(true);
    }
  });

  it('main 注册的通道均已在 channels.ts 声明（无裸字符串）', () => {
    expect(mainHandled.size).toBeGreaterThan(20);
    for (const name of mainHandled) {
      expect(declaredConstants.has(name)).toBe(true);
    }
  });
});

describe('2.5 死通道防护（QA N2 整改后：不允许存在未接线的通道）', () => {
  /**
   * 反查"已声明但三方都没用到"的通道。
   *
   * N2 整改前这里断言恰好是 `pool:get-rows` / `pool:coverage` 两个死通道
   * （只记录、不拦截）。整改后两条通道已合并为 `pool:get-snapshot` 并全链路接线，
   * 因此本用例升级为**硬不变量**：任何"声明了却没人用"的通道都会让测试失败，
   * 防止以后再次悄悄积累死契约。
   */
  function unusedChannels(): string[] {
    const used = new Set<string>([...preloadInvoked, ...preloadSubscribed, ...mainHandled]);
    return ALL_CHANNELS.filter((ch) => {
      const constName = [...declaredConstants].find((n) =>
        CHANNELS_SRC.includes(`export const ${n} = '${ch}'`),
      );
      return constName !== undefined && !used.has(constName);
    });
  }

  it('不存在"已声明但未注册也未暴露"的死通道', () => {
    expect(unusedChannels()).toEqual([]);
  });

  it('原死通道 pool:get-rows / pool:coverage 已不复存在', () => {
    expect(ALL_CHANNELS).not.toContain('pool:get-rows' as never);
    expect(ALL_CHANNELS).not.toContain('pool:coverage' as never);
  });

  it('牌库域同时具备推送通道与拉取通道', () => {
    // 推送：主 → 渲（变化才发）；拉取：渲 → 主（首帧补齐），两者缺一不可
    expect(preloadSubscribed.has('CH_POOL_SNAPSHOT')).toBe(true);
    expect(preloadInvoked.has('CH_POOL_GET_SNAPSHOT')).toBe(true);
    expect(mainHandled.has('CH_POOL_GET_SNAPSHOT')).toBe(true);
  });
});
