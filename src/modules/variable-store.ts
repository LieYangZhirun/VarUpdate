/**
 * modules/variable-store.ts
 *
 * 模块 4：变量存储适配层
 *
 * 对酒馆助手多层变量系统的封装，提供统一的变量 CRUD 接口。
 * 使用 iframe 全局函数 getVariables / replaceVariables（由 predefine.js 从
 * TavernHelper._bind 解构并绑定到 iframe window）。
 *
 * 三个存储层级：
 * - global：全局设置（通知等级、容错阈值等），跨角色卡跨聊天
 * - chat：当前聊天会话（Schema、Default 等），切换聊天时随之切换
 * - message：消息粒度（变量快照），每条消息独立
 *
 * 所有读写操作自动深拷贝，避免外部意外修改持久化数据。
 */

import { getValueByPath, setValueByPath } from '../shared/path-utils.js';
import type { StoreLayer } from '../types/index.js';

// ═══════════════════════════════════════════
//  深拷贝
// ═══════════════════════════════════════════

/**
 * 深拷贝（优先使用 lodash _.cloneDeep，回退到 JSON）
 */
function deepClone<T>(obj: T): T {
  if (typeof _ !== 'undefined' && typeof _.cloneDeep === 'function') {
    return _.cloneDeep(obj);
  }
  return JSON.parse(JSON.stringify(obj));
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
const ORPHAN_MESSAGE_VAR_SWEEP = 256;

/**
 * SillyTavern `message_deleted` 传入的是**删除后**的 `chat.length`（见 script.js emit），
 * 不是被删消息的下标。有效下标为 0..length-1，需清空 length 及以上可能残留的 message 变量槽位。
 */
export function pruneOrphanMessageVariables(newChatLength: number): void {
  try {
    const end = newChatLength + ORPHAN_MESSAGE_VAR_SWEEP;
    for (let i = newChatLength; i < end; i++) {
      writeVariables('message', {}, i);
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
