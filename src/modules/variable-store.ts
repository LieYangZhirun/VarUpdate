/**
 * modules/variable-store.ts —— 模块 4：变量存储适配层
 *
 * 封装酒馆助手 `getVariables` / `replaceVariables`（由助手在 iframe 上绑定的全局函数），
 * 对业务暴露统一的读、写、按路径读写接口。
 *
 * 层级约定：`global`（脚本设置，跨会话）、`chat`（Schema / Default，随当前聊天）、
 * `message`（单条消息的变量快照，含 swipe）。
 *
 * 读返回与写提交均经深拷贝，降低调用方意外改动持久化数据的风险。
 */

import { klona } from 'klona/full';
import { getValueByPath, setValueByPath } from '../shared/path-utils.js';
import type { StoreLayer, VariableOption } from '../types/index.js';

// ═══════════════════════════════════════════
//  深拷贝
// ═══════════════════════════════════════════

/**
 * 深拷贝（主包内置 klona；若宿主提供 lodash 仍可优先使用）
 */
export function deepClone<T>(obj: T): T {
  if (typeof _ !== 'undefined' && typeof _.cloneDeep === 'function') {
    return _.cloneDeep(obj);
  }
  return klona(obj);
}

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 读取指定层的变量
 */
export function readVariables(layer: StoreLayer, messageIndex?: number): Record<string, any> {
  try {
    const option = buildOption(layer, messageIndex);
    const data = getVariables(option);
    return deepClone(data || {});
  } catch {
    return {};
  }
}

/**
 * 写入指定层的变量（全量替换）
 */
export function writeVariables(layer: StoreLayer, data: Record<string, any>, messageIndex?: number): void {
  const option = buildOption(layer, messageIndex);
  replaceVariables(deepClone(data), option);
}

/**
 * 按路径读取单个变量值
 */
export function getByPath(layer: StoreLayer, path: string, messageIndex?: number): any {
  const data = readVariables(layer, messageIndex);
  return getValueByPath(data, path);
}

/**
 * 按路径写入单个变量值
 */
export function setByPath(layer: StoreLayer, path: string, value: any, messageIndex?: number): void {
  const data = readVariables(layer, messageIndex);
  setValueByPath(data, path, value);
  writeVariables(layer, data, messageIndex);
}

/**
 * 清除「严格大于 messageIndex」的每条消息的 message 层变量（仍存在的消息下标）
 * 用于 varupdate:retry_requested：保留 messageIndex 及之前，清空其后。
 */
export function clearMessageVariablesAfter(messageIndex: number): void {
  try {
    if (!Number.isFinite(messageIndex) || messageIndex < -1) return;

    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat) return;

    for (let i = messageIndex + 1; i < context.chat.length; i++) {
      writeVariables('message', {}, i);
    }
  } catch {
    // 静默失败——清理操作非关键
  }
}

/** 酒馆在 splice 后仍可能残留高下标槽位时的清扫宽度 */
const ORPHAN_MESSAGE_VAR_SWEEP = 2048;

/**
 * SillyTavern `message_deleted` 传入的是**删除后**的 `chat.length`（见 script.js emit），
 * 不是被删消息的下标。有效下标为 0..length-1，需清空 length 及以上可能残留的 message 变量槽位。
 *
 * 增量探测：连续遇到 EMPTY_STREAK_LIMIT 个已经为空的槽位后提前退出，避免无意义的大量写入。
 */
export function pruneOrphanMessageVariables(newChatLength: number): void {
  try {
    if (!Number.isFinite(newChatLength) || newChatLength < 0) return;

    const EMPTY_STREAK_LIMIT = 10;
    let emptyStreak = 0;

    const end = newChatLength + ORPHAN_MESSAGE_VAR_SWEEP;
    for (let i = newChatLength; i < end; i++) {
      const existing = readVariables('message', i);
      // 仅当槽位确实存有数据时才写空
      if (existing.data !== undefined || existing.log !== undefined || existing.isInitPoint) {
        writeVariables('message', {}, i);
        emptyStreak = 0;
      } else {
        emptyStreak++;
        if (emptyStreak >= EMPTY_STREAK_LIMIT) break;
      }
    }
  } catch {
    // 静默
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function buildOption(layer: StoreLayer, messageIndex?: number): VariableOption {
  if (layer === 'message') {
    return messageIndex !== undefined
      ? { type: 'message', message_id: messageIndex }
      : { type: 'message', message_id: 'latest' as const };
  }
  return { type: layer };
}
