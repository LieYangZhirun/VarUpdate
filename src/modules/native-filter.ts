/**
 * modules/native-filter.ts —— 模块 11：原生过滤 Hook
 *
 * 在酒馆生成请求前 Hook 世界书/预设/正则条目的激活流程，
 * 对携带变量条件标签的条目调用模块 10 求值过滤。
 *
 * 支撑功能：面向用户功能卡 十三·L-11 ~ L-12
 */

import { evaluateAllConditions } from './condition-evaluator.js';
import { readVariables } from './variable-store.js';
import * as eventBus from './event-bus.js';
import { EVENTS } from './event-bus.js';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 注册所有过滤 Hook
 * 在主控制器初始化时调用
 */
export function registerFilterHooks(): void {
  unregisterFilterHooks(); // 防止重复注册

  worldInfoStopper = eventBus.on(EVENTS.WORLDINFO_SCAN_DONE, filterWorldInfoEntries);
  sendingMessageStopper = eventBus.on(EVENTS.SENDING_MESSAGE, filterSendingMessages);

  log('过滤 Hook 已注册');
}

/**
 * 注销所有过滤 Hook
 * 在脚本卸载时调用
 */
export function unregisterFilterHooks(): void {
  if (worldInfoStopper) {
    worldInfoStopper.stop();
    worldInfoStopper = null;
  }
  if (sendingMessageStopper) {
    sendingMessageStopper.stop();
    sendingMessageStopper = null;
  }
}

// ═══════════════════════════════════════════
//  内部状态
// ═══════════════════════════════════════════

let worldInfoStopper: { stop: () => void } | null = null;
let sendingMessageStopper: { stop: () => void } | null = null;

// ═══════════════════════════════════════════
//  世界书条目过滤
// ═══════════════════════════════════════════

/**
 * WORLDINFO_SCAN_DONE 回调
 *
 * 酒馆在完成世界书关键词扫描后、实际注入提示词前触发。
 * 回调参数包含已激活的条目列表（可就地修改）。
 */
function filterWorldInfoEntries(data: any): void {
  if (!data?.entries || !Array.isArray(data.entries)) return;

  const varData = getLatestMessageData();

  // 从后向前遍历，移除不通过的条目
  for (let i = data.entries.length - 1; i >= 0; i--) {
    const entry = data.entries[i];
    const text = entry?.comment ?? '';
    if (!text) continue; // 无备注 → 不过滤

    if (!evaluateAllConditions(text, varData)) {
      data.entries.splice(i, 1);
    }
  }
}

// ═══════════════════════════════════════════
//  预设 & 正则脚本过滤
// ═══════════════════════════════════════════

/**
 * SENDING_MESSAGE 回调
 *
 * 酒馆在组装最终发送给 API 的消息列表时触发。
 * 过滤预设条目（按 name 字段）和正则脚本（按 scriptName 字段）。
 */
function filterSendingMessages(data: any): void {
  const varData = getLatestMessageData();

  // ── 预设条目过滤 ──
  if (data?.prompts && Array.isArray(data.prompts)) {
    for (let i = data.prompts.length - 1; i >= 0; i--) {
      const prompt = data.prompts[i];
      const name = prompt?.name ?? '';
      if (!name) continue;

      if (!evaluateAllConditions(name, varData)) {
        data.prompts.splice(i, 1);
      }
    }
  }

  // ── 正则脚本过滤 ──
  if (data?.regexScripts && Array.isArray(data.regexScripts)) {
    for (let i = data.regexScripts.length - 1; i >= 0; i--) {
      const script = data.regexScripts[i];
      const scriptName = script?.scriptName ?? '';
      if (!scriptName) continue;

      if (!evaluateAllConditions(scriptName, varData)) {
        data.regexScripts.splice(i, 1);
      }
    }
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

/**
 * 读取最新一层 message 的 data 字段
 */
function getLatestMessageData(): Record<string, any> {
  try {
    const messageVars = readVariables('message');
    return messageVars?.data ?? {};
  } catch {
    return {};
  }
}

function log(msg: string): void {
  try {
    console.log(`[VarUpdate][filter] ${msg}`);
  } catch { /* */ }
}
