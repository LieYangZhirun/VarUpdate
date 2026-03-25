/**
 * modules/variable-store.ts
 *
 * 模块 4：变量存储适配层
 *
 * 对酒馆助手多层变量系统的封装，提供统一的变量 CRUD 接口。
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
//  TavernHelper API 声明
// ═══════════════════════════════════════════

declare const TavernHelper: {
  getVariables(opts: { type: string; message_id?: number }): Record<string, any>;
  replaceVariables(data: Record<string, any>, opts: { type: string; message_id?: number }): void;
  [key: string]: any;
};

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
    const opts = buildOpts(layer, messageIndex);
    const data = TavernHelper.getVariables(opts);
    return deepClone(data || {});
  } catch {
    return {};
  }
}

/**
 * 写入指定层的变量（全量替换）
 */
export function writeVariables(layer: StoreLayer, data: Record<string, any>, messageIndex?: number): void {
  const opts = buildOpts(layer, messageIndex);
  TavernHelper.replaceVariables(deepClone(data), opts);
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
 * 清除指定消息索引之后的所有 message 层变量
 * 用于检查点切换或消息删除时的旧数据清理
 */
export function clearMessageVariablesAfter(messageIndex: number): void {
  try {
    // 获取当前聊天的消息数量（通过 SillyTavern.getContext 或直接操作 chat[]）
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat) return;

    for (let i = messageIndex + 1; i < context.chat.length; i++) {
      writeVariables('message', {}, i);
    }
  } catch {
    // 静默失败——清理操作非关键
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function buildOpts(layer: StoreLayer, messageIndex?: number) {
  const opts: { type: string; message_id?: number } = { type: layer };
  if (layer === 'message' && messageIndex !== undefined) {
    opts.message_id = messageIndex;
  }
  return opts;
}
