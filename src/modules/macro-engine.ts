/**
 * modules/macro-engine.ts
 *
 * 模块 6：插值宏引擎
 *
 * 通过酒馆助手的 registerMacroLike API 注册自定义宏。
 * 在消息发送前将 {{作用域/字段/路径}} 格式的宏替换为变量的实际值。
 * 复合类型使用 PromptalYAML 序列化。
 *
 * 宏格式：{{message|chat|global/data|log|schema/可选路径}}
 */

import { serializeToPromptalYAML } from '@vendor/promptal-yaml';
import { readVariables } from './variable-store.js';
import { getValueByPath } from '../shared/path-utils.js';
import * as notify from './notification.js';
import type { MacroLikeContext } from '../types/index.js';

/** 与 ui-panel 一致：脚本设置占用此键；{{global/data}} 仅用于读取同层其它自定义键（若有） */
const VARUPDATE_CONFIG_KEY = 'VarUpdate_config';

// ═══════════════════════════════════════════
//  宏注册状态
// ═══════════════════════════════════════════

let macroUnregister: (() => void) | null = null;

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 宏替换正则
 *
 * 匹配：{{作用域/字段/可选路径}}
 *   - 作用域：message | chat | global
 *   - 字段：data | log | schema
 *   - 路径：/ 分隔的任意深度路径，可省略
 */
const MACRO_REGEX = /\{\{(message|chat|global)\/(data|log|schema)(?:\/([^}]*))?\}\}/g;

/**
 * 注册所有 VarUpdate 插值宏
 *
 * 使用酒馆助手的 registerMacroLike 全局函数注册。
 * iframe pagehide 时酒馆助手会自动注销，但也提供手动注销函数。
 *
 * @returns 注销函数（脚本卸载时调用）
 */
export function registerMacros(): () => void {
  if (macroUnregister) {
    return () => unregisterMacros();
  }

  try {
    if (typeof registerMacroLike === 'function') {
      const result = registerMacroLike(MACRO_REGEX, macroReplacer);
      macroUnregister = result.unregister;
    }
  } catch (e) {
    notify.warning('宏注册', `注册宏失败: ${(e as Error).message}`);
  }

  return () => unregisterMacros();
}

/**
 * 注销宏
 */
function unregisterMacros(): void {
  if (macroUnregister) {
    try {
      macroUnregister();
    } catch {
      // 静默
    }
    macroUnregister = null;
  }
}

// ═══════════════════════════════════════════
//  宏替换逻辑
// ═══════════════════════════════════════════

/**
 * registerMacroLike 回调：替换单个宏匹配
 *
 * @param context 酒馆助手提供的上下文（含 message_id）
 * @param substring 正则匹配到的完整字符串
 * @param scope 作用域（message | chat | global）
 * @param field 字段（data | log | schema）
 * @param varPath 可选的变量路径
 */
function macroReplacer(
  context: MacroLikeContext,
  substring: string,
  scope: string,
  field: string,
  varPath: string | undefined,
  offset: number,
  fullText: string,
): string {
  try {
    const value = resolveValue(scope, field, varPath || '', context.message_id);
    if (value === undefined || value === null) {
      notify.notify(
        'notice',
        '宏引用为空',
        `${scope}/${field}${varPath ? `/${varPath}` : ''}`,
      );
    }
    const output = formatValue(value);
    const leadingSpaces = countLeadingSpaces(fullText, offset);
    return alignIndent(output, leadingSpaces);
  } catch (e) {
    notify.debug('宏替换失败', `${substring}: ${(e as Error).message}`);
    return '';
  }
}

/**
 * 解析宏引用的值
 *
 * field 直接对应变量存储中的顶层键名：
 * - {{message/data/角色/HP}} → messageVars.data.角色.HP
 * - {{message/log/角色/HP}}  → messageVars.log["角色/HP"]
 * - {{chat/schema/...}}      → chatVars.schema[...]
 * - {{chat/data/...}}        → chatVars.default[...]（面向用户 K-2：chat 层 Default 存储键为 default）
 */
function resolveValue(scope: string, field: string, varPath: string, messageId?: number): any {
  const layer = scope as 'message' | 'chat' | 'global';

  const layerData = layer === 'message'
    ? readVariables('message', messageId)
    : readVariables(layer);

  // field → 存储键名映射
  let fieldData: any;
  if (layer === 'chat' && field === 'data') {
    fieldData = layerData.default;
  } else if (layer === 'global' && field === 'data') {
    // global 层仅有 VarUpdate_config 等脚本约定键，无独立 data 键；宏里 data 表示「除脚本配置外的其余全局键」
    const g = layerData as Record<string, any>;
    const { [VARUPDATE_CONFIG_KEY]: _cfg, ...rest } = g;
    fieldData = Object.keys(rest).length ? rest : undefined;
  } else {
    fieldData = layerData[field];
  }

  if (fieldData === undefined) return undefined;

  if (!varPath) return fieldData;

  // 沿路径取值
  return getValueByPath(fieldData, varPath);
}

/**
 * 格式化值为字符串
 *
 * - undefined/null → 空字符串
 * - 基础类型（number/string/boolean） → 直接转字符串
 * - 复合类型（object/array）→ PromptalYAML 序列化
 */
function formatValue(value: any): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  return serializeToPromptalYAML(value);
}

/**
 * 缩进对齐（面向用户 K-4）
 *
 * 将输出的每一行（除第一行）左侧补齐 N 个空格，
 * 使多行输出与宏所在行的缩进对齐。
 */
function alignIndent(output: string, leadingSpaces: number): string {
  if (leadingSpaces === 0 || !output.includes('\n')) return output;
  const lines = output.split('\n');
  return lines
    .map((line, i) => (i === 0 ? line : ' '.repeat(leadingSpaces) + line))
    .join('\n');
}

/**
 * 计算宏所在位置的行首连续空格数
 */
function countLeadingSpaces(text: string, offset: number): number {
  let i = offset - 1;
  let spaces = 0;
  while (i >= 0 && text[i] !== '\n') {
    if (text[i] === ' ') {
      spaces++;
    } else {
      spaces = 0;
    }
    i--;
  }
  return spaces;
}
