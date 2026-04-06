/**
 * modules/event-bus.ts
 *
 * 模块 7：事件总线
 *
 * 封装酒馆助手事件 API，定义 VarUpdate 与外部脚本的通信协议。
 * 使用 varupdate: 前缀命名空间。
 *
 * 广播事件：
 * - varupdate:initialized       变量初始化完成
 * - varupdate:updated           变量更新成功
 * - varupdate:update_failed     变量更新失败
 * - varupdate:schema_ready      Schema 编译完成
 *
 * 监听事件：
 * - agents:message_complete     Agents 消息完成（payload 宜含 messageIndex，见 types/MessageCompletePayload）
 * - varupdate:retry_requested   重试请求
 */

import * as notify from './notification.js';

// ═══════════════════════════════════════════
//  监听器追踪（用于 removeAll）
// ═══════════════════════════════════════════

const registeredListeners: Array<{ stop: () => void }> = [];

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 广播事件
 */
export async function emit(eventName: string, payload: any): Promise<void> {
  try {
    if (typeof eventEmit === 'function') {
      await eventEmit(eventName, payload);
    }
  } catch (e) {
    notify.bridgeError(`事件广播失败 · ${eventName}`, e);
  }
}

/**
 * 监听事件
 */
export function on(eventName: string, handler: (payload: any) => void): { stop: () => void } {
  try {
    if (typeof eventOn === 'function') {
      const listener = eventOn(eventName, handler);
      registeredListeners.push(listener);
      return listener;
    }
  } catch (e) {
    notify.bridgeError(`事件监听失败 · ${eventName}`, e);
  }
  return { stop: () => {} };
}

/**
 * 一次性监听
 */
export function once(eventName: string, handler: (payload: any) => void): { stop: () => void } {
  try {
    if (typeof eventOnce === 'function') {
      const listener = eventOnce(eventName, handler);
      registeredListeners.push(listener);
      return listener;
    }
  } catch (e) {
    notify.bridgeError(`一次性监听失败 · ${eventName}`, e);
  }
  return { stop: () => {} };
}

/**
 * 注销本脚本注册的全部事件监听。
 *
 * 先尝试宿主 `eventClearAll()`；再对本地记录的 listener 逐个 `stop()`（宿主未提供 ClearAll 或未能覆盖本脚本监听时仍可释放）。
 */
export function removeAll(): void {
  try {
    if (typeof eventClearAll === 'function') {
      eventClearAll();
    }
  } catch {
    // 静默
  }
  for (const { stop } of registeredListeners) {
    try {
      stop();
    } catch {
      // 静默
    }
  }
  registeredListeners.length = 0;
}

// ═══════════════════════════════════════════
//  预定义事件名常量
// ═══════════════════════════════════════════

export const EVENTS = {
  // VarUpdate 广播
  VAR_INITIALIZED: 'varupdate:initialized',
  VAR_UPDATED: 'varupdate:updated',
  VAR_UPDATE_FAILED: 'varupdate:update_failed',
  VAR_SCHEMA_READY: 'varupdate:schema_ready',

  // VarUpdate 监听（来自 Agents）
  MESSAGE_COMPLETE: 'agents:message_complete',
  RETRY_REQUESTED: 'varupdate:retry_requested',
  PIPELINE_STARTED: 'agents:pipeline_started',
  PIPELINE_ENDED: 'agents:pipeline_ended',

  // 酒馆原生事件（值必须与 tavern_events 定义一致）
  CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
  MESSAGE_SENT: 'message_sent',
} as const;
