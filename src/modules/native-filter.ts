/**
 * modules/native-filter.ts —— 模块 11：原生过滤 Hook
 *
 * 在酒馆生成请求前 Hook 世界书条目的激活流程，
 * 对携带变量条件标签的条目调用模块 10 求值过滤。
 *
 * Hook 点：worldinfo_entries_loaded
 * 该事件在酒馆完成世界书条目加载、关键词扫描开始之前触发。
 * payload 为 { globalLore[], characterLore[], chatLore[], personaLore[] }，
 * 均为普通数组，直接 splice 即可移除条目。
 *
 * 支撑功能：面向用户功能卡 十三·L-11 ~ L-12
 */

import { evaluateAllConditions } from './condition-evaluator.js';
import { readVariables } from './variable-store.js';
import * as eventBus from './event-bus.js';
import * as notify from './notification.js';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 注册世界书过滤 Hook
 * 在主控制器初始化时调用
 */
export function registerFilterHooks(): void {
  unregisterFilterHooks(); // 防止重复注册

  worldInfoStopper = eventBus.on(eventBus.EVENTS.WORLDINFO_ENTRIES_LOADED, filterWorldInfoEntries);

  notify.debug('原生过滤', 'Hook 已注册', { category: 'evt' });
}

/**
 * 注销世界书过滤 Hook
 * 在脚本卸载时调用
 */
export function unregisterFilterHooks(): void {
  if (worldInfoStopper) {
    worldInfoStopper.stop();
    worldInfoStopper = null;
  }
}

// ═══════════════════════════════════════════
//  内部状态
// ═══════════════════════════════════════════

let worldInfoStopper: { stop: () => void } | null = null;

// ═══════════════════════════════════════════
//  世界书条目过滤
// ═══════════════════════════════════════════

/**
 * worldinfo_entries_loaded 回调
 *
 * 酒馆在关键词扫描开始前触发，提供分类的世界书条目数组。
 * 直接从数组中 splice 移除不通过条件的条目，使其不进入后续扫描。
 *
 * payload 结构（均为普通 Array，无跨 iframe 类型问题）：
 *   lores.globalLore:    全局世界书条目
 *   lores.characterLore: 角色世界书条目
 *   lores.chatLore:      聊天世界书条目
 *   lores.personaLore:   人设世界书条目
 */
function filterWorldInfoEntries(lores: any): void {
  const varData = getLatestMessageData();

  const categories = [
    lores?.globalLore,
    lores?.characterLore,
    lores?.chatLore,
    lores?.personaLore,
  ];

  for (const category of categories) {
    if (!Array.isArray(category)) continue;

    // 从后向前遍历，移除不通过的条目
    for (let i = category.length - 1; i >= 0; i--) {
      const entry = category[i];
      const text = entry?.comment ?? '';
      if (!text) continue; // 无备注 → 不过滤

      if (!evaluateAllConditions(text, varData)) {
        category.splice(i, 1);
      }
    }
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

/**
 * 读取最新一层 message 的 data 字段（仅普通对象；数组/原始值视为无变量表，避免条件求值异常）
 */
function getLatestMessageData(): Record<string, any> {
  try {
    const messageVars = readVariables('message');
    const d = messageVars?.data;
    if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
      return d as Record<string, any>;
    }
    return {};
  } catch {
    return {};
  }
}
