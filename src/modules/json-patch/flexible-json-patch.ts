/**
 * modules/json-patch/flexible-json-patch.ts
 *
 * 容错 JSON Patch 解析器 —— 最大限度容忍 AI 模型输出的格式偏差
 *
 * 四步预处理管道：
 * 1. 文本清洗：Markdown 围栏逐层剥除、去 BOM、截取数组/对象主体
 * 2. 引号修正：外向内对称解析，修复未转义双引号 + 单引号升级
 * 3. 宽松 JSON 解析：通过 json5 容忍尾逗号、无引号键名等
 * 4. 语义规范化：op 别名映射 + 结构校验
 *
 * @module flexible-json-patch
 */

import JSON5 from 'json5';
import { ScriptError } from '../../types/index.js';
import type { PatchInstruction } from '../../types/index.js';

export type { PatchInstruction };

/**
 * 解析结果
 */
export interface ParseResult {
  /** 成功解析的指令数组 */
  instructions: PatchInstruction[];
  /** 被丢弃的条目（含原因） */
  discarded: Array<{ entry: unknown; reason: string }>;
}

// ═══════════════════════════════════════════
//  op 别名映射
// ═══════════════════════════════════════════

const OP_ALIASES: Record<string, PatchInstruction['op']> = {
  // 标准名称
  replace: 'replace',
  insert: 'insert',
  delete: 'delete',
  // RFC 6902 标准术语
  add: 'insert',
  remove: 'delete',
  // 常见别名
  set: 'replace',
  update: 'replace',
  put: 'replace',
  del: 'delete',
  rm: 'delete',
  create: 'insert',
  new: 'insert',
};

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/**
 * 将 AI 原始输出文本解析为标准化的 Patch 指令数组
 *
 * 四步管道：文本清洗 → 引号修正 → 宽松 JSON 解析 → 语义规范化
 *
 * @param rawText 原始指令文本（来自 AI 模型输出）
 * @returns 解析结果（指令数组 + 丢弃记录）
 * @throws {PatchParseError} 当文本完全无法解析时
 */
export function parseInstructions(rawText: string): ParseResult {
  // 步骤 1：文本清洗
  let cleaned = cleanText(rawText);

  // 步骤 2：引号修正
  cleaned = fixQuotes(cleaned);

  // 步骤 3：宽松 JSON 解析
  let parsed: any;
  try {
    parsed = JSON5.parse(cleaned);
  } catch (e) {
    throw new PatchParseError(
      '无法解析 JSON 指令',
      { rawText, cleaned, parseError: (e as Error).message }
    );
  }

  // 确保结果是数组
  if (!Array.isArray(parsed)) {
    if (typeof parsed === 'object' && parsed !== null) {
      // 单个指令对象 → 包装为数组
      parsed = [parsed];
    } else {
      throw new PatchParseError(
        '解析结果不是指令数组或对象',
        { rawText, parsed }
      );
    }
  }

  // 步骤 2b：单引号升级（解析成功后、语义规范化前）
  // AI 为避免引号冲突可能将值内双引号降级为单引号，此处升级回双引号
  parsed = upgradeSingleQuotesInValues(parsed);

  // 步骤 4：语义规范化
  return normalizeInstructions(parsed);
}

// ═══════════════════════════════════════════
//  步骤 1：文本清洗
// ═══════════════════════════════════════════

/** 若整段符合多行或单行紧凑围栏形态，返回去掉一层围栏后的正文；否则返回 null。 */
function tryStripOneOuterFence(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('```')) return null;

  const lines = t.split(/\r?\n/);
  if (lines.length >= 2) {
    const first = lines[0].trim();
    const last = lines[lines.length - 1].trim();
    // 首行须为 ``` 或 ```lang，且该行不含其它反引号（与围栏语法一致）
    if (/^```[^\n`]*$/.test(first) && last === '```') {
      return lines.slice(1, -1).join('\n').trim();
    }
  }

  // 单段紧凑：` ```json[...]``` ` 或 ` ``` [...] ``` `
  const open = t.match(/^```[^\n`]*\s*/);
  if (!open) return null;
  const rest = t.slice(open[0].length);
  if (!rest.endsWith('```')) return null;
  return rest.slice(0, -3).trimEnd().trim();
}

/** 重复剥除外层围栏，至多 5 次 */
function stripOuterCodeFences(text: string): string {
  let result = text;
  for (let i = 0; i < 5; i++) {
    const next = tryStripOneOuterFence(result);
    if (next === null) break;
    result = next;
  }
  return result;
}

/**
 * 清洗 AI 输出的原始文本：去 BOM、剥 Markdown 围栏、截取 `[…]` 或 `{…}` 指令片段。
 */
function cleanText(text: string): string {
  let result = text.replace(/^\uFEFF/, '');

  result = stripOuterCodeFences(result);

  result = result.trim();

  // 提取 JSON 数组内容：查找第一个 [ 和最后一个 ]
  const firstBracket = result.indexOf('[');
  const lastBracket = result.lastIndexOf(']');

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    result = result.substring(firstBracket, lastBracket + 1);
  } else {
    // 尝试查找 { 和 }（单个指令对象的情况）
    const firstBrace = result.indexOf('{');
    const lastBrace = result.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      result = result.substring(firstBrace, lastBrace + 1);
    }
  }

  return result.trim();
}

// ═══════════════════════════════════════════
//  步骤 2：引号修正（外向内对称解析）
// ═══════════════════════════════════════════

/**
 * 修复 JSON 字符串值中未转义的双引号
 *
 * 核心策略：外向内对称解析
 * - 利用 JSON 结构符号（: , { } [ ]）定位字符串值的真正边界
 * - 在边界内的裸双引号自动补 \" 转义
 */
function fixQuotes(text: string): string {
  // 逐字符扫描，追踪 JSON 结构状态
  const result: string[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (ch === '"') {
      // 找到一个双引号，判断它是 JSON 语法的字符串开始
      // 从此开始寻找对应的字符串结束引号
      const strResult = extractJsonString(text, i);
      if (strResult) {
        result.push(strResult.fixed);
        i = strResult.endIndex;
      } else {
        result.push(ch);
        i++;
      }
    } else {
      result.push(ch);
      i++;
    }
  }

  return result.join('');
}

/**
 * 从指定位置提取一个 JSON 字符串值（含引号修正）
 *
 * 从 startQuote 位置的 " 开始，寻找对应的结束 "。
 * 结束引号的判定：下一个字符是 JSON 结构符号（, } ] : 或空白后跟这些）
 */
function extractJsonString(
  text: string,
  startQuote: number
): { fixed: string; endIndex: number } | null {
  const len = text.length;
  let i = startQuote + 1;
  const valueParts: string[] = ['"'];

  while (i < len) {
    const ch = text[i];

    // 已转义的引号 → 保留
    if (ch === '\\' && i + 1 < len && text[i + 1] === '"') {
      valueParts.push('\\"');
      i += 2;
      continue;
    }

    // 遇到双引号 → 检查它是否是字符串结束引号
    if (ch === '"') {
      // 向后查看：跳过空白后，下一个字符是否是 JSON 结构符号
      const afterQuote = lookAheadStructural(text, i + 1);
      if (afterQuote) {
        // 这是字符串结束引号
        valueParts.push('"');
        return { fixed: valueParts.join(''), endIndex: i + 1 };
      } else {
        // 这是值内容中的未转义引号 → 补转义
        valueParts.push('\\"');
        i++;
        continue;
      }
    }

    valueParts.push(ch);
    i++;
  }

  // 未找到结束引号（到达文本末尾）→ 补一个结束引号
  valueParts.push('"');
  return { fixed: valueParts.join(''), endIndex: len };
}

/**
 * 从指定位置向后跳过空白，判断下一个非空白字符是否为 JSON 结构符号
 */
function lookAheadStructural(text: string, pos: number): boolean {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  if (i >= text.length) return true; // 文本结束也视为结构边界
  return /[,}\]:]/.test(text[i]);
}

// ═══════════════════════════════════════════
//  步骤 4：语义规范化
// ═══════════════════════════════════════════

/**
 * 将解析后的 JSON 数组规范化为标准 PatchInstruction 数组
 *
 * - op 别名映射（add→insert, remove→delete, set→replace 等）
 * - 结构校验（必须有 op + path，replace/insert 必须有 value）
 * - 不合法条目丢弃（不阻断后续）
 */
function normalizeInstructions(entries: any[]): ParseResult {
  const instructions: PatchInstruction[] = [];
  const discarded: ParseResult['discarded'] = [];

  for (const entry of entries) {
    // 必须是对象
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      discarded.push({ entry, reason: '非对象条目' });
      continue;
    }

    // 提取 op（大小写不敏感）
    const rawOp = String(entry.op || entry.Op || entry.OP || '').toLowerCase().trim();
    const op = OP_ALIASES[rawOp];

    if (!op) {
      discarded.push({ entry, reason: rawOp ? `未知操作类型: ${rawOp}` : '缺少 op 字段' });
      continue;
    }

    // 提取 path
    const path = entry.path || entry.Path || entry.PATH;
    if (path === undefined || path === null || path === '') {
      discarded.push({ entry, reason: '缺少 path 字段' });
      continue;
    }

    // 规范化路径：确保以 / 分隔
    const normalizedPath = normalizePath(String(path));

    // replace 和 insert 必须有 value
    const value = entry.value !== undefined ? entry.value :
                  entry.Value !== undefined ? entry.Value :
                  entry.val !== undefined ? entry.val : undefined;

    if ((op === 'replace' || op === 'insert') && value === undefined) {
      discarded.push({ entry, reason: `${op} 操作缺少 value 字段` });
      continue;
    }

    const instruction: PatchInstruction = { op, path: normalizedPath };
    if (value !== undefined) {
      instruction.value = value;
    }

    instructions.push(instruction);
  }

  return { instructions, discarded };
}

/**
 * 规范化路径格式
 *
 * - 去除首尾空白
 * - 去除开头的 / （统一为无前导斜线格式）
 * - 多个连续 / 合并为一个
 */
function normalizePath(path: string): string {
  let result = path.trim();
  // 去除开头的 /
  result = result.replace(/^\/+/, '');
  // 合并多个连续 /
  result = result.replace(/\/+/g, '/');
  // 去除末尾的 /
  result = result.replace(/\/+$/, '');
  return result;
}

// ═══════════════════════════════════════════
//  步骤 2b：单引号升级
// ═══════════════════════════════════════════

/**
 * 遍历解析后的对象树，将字符串值中 '...' 包裹的内容升级为 "..."
 *
 * 典型场景：AI 将 `"进化日"` 降级输出为 `'进化日'` 以避免 JSON 引号冲突。
 * 解析成功后在此恢复原始标点。
 */
function upgradeSingleQuotesInValues(data: any): any {
  if (typeof data === 'string') {
    return data.replace(/'([^']+)'/g, '"$1"');
  }
  if (Array.isArray(data)) {
    return data.map(item => upgradeSingleQuotesInValues(item));
  }
  if (typeof data === 'object' && data !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = upgradeSingleQuotesInValues(value);
    }
    return result;
  }
  return data;
}

// ═══════════════════════════════════════════
//  错误类
// ═══════════════════════════════════════════

/**
 * Patch 解析失败错误
 */
export class PatchParseError extends ScriptError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, context);
    this.name = 'PatchParseError';
  }
}
