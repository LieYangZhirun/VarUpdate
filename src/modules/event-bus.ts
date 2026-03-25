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
 * - agents:message_complete     Agents 消息完成
 * - varupdate:retry_requested   重试请求
 */

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
    console.error(`[VarUpdate] 事件广播失败: ${eventName}`, e);
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
    console.error(`[VarUpdate] 事件监听失败: ${eventName}`, e);
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
    console.error(`[VarUpdate] 一次性监听失败: ${eventName}`, e);
  }
  return { stop: () => {} };
}

/**
 * 注销所有由本脚本注册的事件监听器
 * 在脚本卸载时调用
 */
export function removeAll(): void {
  for (const listener of registeredListeners) {
    try {
      listener.stop();
    } catch {
      // 忽略清理错误
    }
  }
  registeredListeners.length = 0;

  // 额外调用酒馆助手的全局清理（如果可用）
  try {
    if (typeof eventClearAll === 'function') {
      eventClearAll();
    }
  } catch {
    // 静默
  }
}

// ═══════════════════════════════════════════
//  预定义事件名常量
// ═══════════════════════════════════════════

export const EVENTS = {
  // VarUpdate 广播
  INITIALIZED: 'varupdate:initialized',
  UPDATED: 'varupdate:updated',
  UPDATE_FAILED: 'varupdate:update_failed',
  SCHEMA_READY: 'varupdate:schema_ready',

  // VarUpdate 监听
  MESSAGE_COMPLETE: 'agents:message_complete',
  RETRY_REQUESTED: 'varupdate:retry_requested',

  // 酒馆原生事件
  CHAT_CHANGED: 'CHAT_CHANGED',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  MESSAGE_SWIPED: 'MESSAGE_SWIPED',
  MESSAGE_EDITED: 'MESSAGE_EDITED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
} as const;
