/**
 * modules/macro-engine.ts
 *
 * 模块 6：插值宏引擎
 *
 * 注册自定义宏，在消息发送前将 {{作用域/字段/路径}} 格式的宏
 * 替换为变量的实际值。复合类型使用 PromptalYAML 序列化。
 *
 * 宏格式：{{message|chat|global/data|log|schema/可选路径}}
 */

import { readVariables, getByPath } from './variable-store.js';
import * as notify from './notification.js';

// ═══════════════════════════════════════════
//  CDN 模块引用（PromptalYAML）
// ═══════════════════════════════════════════

let promptalYaml: {
  serializeToPromptalYAML: (value: any, indentLevel?: number) => string;
} | null = null;

async function ensurePromptalYaml() {
  if (!promptalYaml) {
    try {
      promptalYaml = await import(
        // @ts-ignore
        'https://testingcf.jsdelivr.net/gh/LieYangZhirun/Promptal-YAML/dist/index.js'
      );
    } catch {
      promptalYaml = null;
    }
  }
  return promptalYaml;
}

// ═══════════════════════════════════════════
//  宏注册状态
// ═══════════════════════════════════════════

let macroRegistered = false;
let originalMacroHandler: Function | null = null;

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 注册所有 VarUpdate 插值宏
 *
 * @returns 注销函数（脚本卸载时调用）
 */
export function registerMacros(): () => void {
  if (macroRegistered) {
    return () => unregisterMacros();
  }

  try {
    // 通过 TavernHelper 注册宏处理器
    const TH = (globalThis as any).TavernHelper;
    if (TH && TH._bind && TH._bind._registerMacro) {
      TH._bind._registerMacro.call(window, replaceMacros);
      macroRegistered = true;
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
  if (!macroRegistered) return;

  try {
    const TH = (globalThis as any).TavernHelper;
    if (TH && TH._bind && TH._bind._unregisterMacro) {
      TH._bind._unregisterMacro.call(window);
    }
  } catch {
    // 静默
  }

  macroRegistered = false;
}

// ═══════════════════════════════════════════
//  宏替换逻辑
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
 * 替换消息中的所有 VarUpdate 宏
 */
function replaceMacros(text: string): string {
  return text.replace(MACRO_REGEX, (fullMatch, scope, field, varPath, offset) => {
    try {
      // 获取值
      const value = resolveValue(scope, field, varPath || '');

      // 格式化输出
      const output = formatValue(value);

      // 缩进对齐
      const leadingSpaces = countLeadingSpaces(text, offset);
      return alignIndent(output, leadingSpaces);

    } catch (e) {
      notify.debug('宏替换失败', `${fullMatch}: ${(e as Error).message}`);
      return '';
    }
  });
}

/**
 * 解析宏引用的值
 */
function resolveValue(scope: string, field: string, varPath: string): any {
  const layer = scope as 'message' | 'chat' | 'global';

  // 读取整层数据
  const layerData = readVariables(layer);

  // 根据字段选择
  let fieldData: any;
  switch (field) {
    case 'data':
      fieldData = layerData;
      break;
    case 'log':
      fieldData = layerData._log || {};
      break;
    case 'schema':
      fieldData = layerData._schema || {};
      break;
    default:
      return undefined;
  }

  // 如果有路径，沿路径取值
  if (varPath) {
    return getByPath(layer, `${field === 'data' ? '' : `_${field}/`}${varPath}`);
  }

  return fieldData;
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

  // 复合类型 → PromptalYAML（同步回退到 JSON）
  if (promptalYaml) {
    return promptalYaml.serializeToPromptalYAML(value);
  }

  // 回退到 JSON
  return JSON.stringify(value, null, 2);
}

/**
 * 缩进对齐：检测宏所在行前方的空格数，将输出的每一行（除第一行）补齐
 */
function alignIndent(output: string, leadingSpaces: number): string {
  if (leadingSpaces === 0) return output;

  const lines = output.split('\n');
  return lines
    .map((line, i) => (i === 0 ? line : ' '.repeat(leadingSpaces) + line))
    .join('\n');
}

/**
 * 计算宏所在位置的行首空格数
 */
function countLeadingSpaces(text: string, offset: number): number {
  // 向前搜索到行首
  let i = offset - 1;
  let spaces = 0;
  while (i >= 0 && text[i] !== '\n') {
    if (text[i] === ' ') {
      spaces++;
    } else {
      spaces = 0; // 非空格 → 重置
    }
    i--;
  }
  return spaces;
}
