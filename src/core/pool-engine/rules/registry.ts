/**
 * 规则插件注册表：按 order 升序执行，新增机制只加文件 + 注册，不改主流程。
 */

import type { PoolRulePlugin, RuleContext } from './types';

/** 注册表实现（不抛异常，重复注册按 id 覆盖）。 */
export class RuleRegistry {
  private readonly plugins = new Map<string, PoolRulePlugin>();

  /**
   * 注册一个插件。
   *
   * @param plugin 插件实例。
   */
  register(plugin: PoolRulePlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * 批量注册。
   *
   * @param plugins 插件列表。
   */
  registerAll(plugins: ReadonlyArray<PoolRulePlugin>): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * 移除插件。
   *
   * @param id 插件 id。
   */
  unregister(id: string): void {
    this.plugins.delete(id);
  }

  /** 当前已注册插件（按 order 升序）。 */
  list(): PoolRulePlugin[] {
    return Array.from(this.plugins.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * 按 order 依次执行全部插件。
   *
   * 单个插件抛异常不会中断整条链：转成 `SYS_WORKER_CRASH` 之外的
   * `ENG_UNKNOWN_CHAMPION` 风格错误不合适，这里统一记为一条 error 并继续。
   *
   * @param ctx 执行上下文。
   */
  runAll(ctx: RuleContext): void {
    for (const plugin of this.list()) {
      try {
        plugin.apply(ctx);
      } catch (error) {
        ctx.errors.push({
          code: 'ENG_UNKNOWN_CHAMPION',
          message: `规则插件 ${plugin.id} 执行失败：${error instanceof Error ? error.message : String(error)}`,
          detail: { pluginId: plugin.id },
          at: ctx.now,
          fatal: false,
        });
      }
    }
  }
}

/** 默认注册表实例（含 5 个内置插件，由 pool-engine/index.ts 装配）。 */
export const defaultRegistry = new RuleRegistry();
