/**
 * modules/condition-evaluator.ts —— 模块 10：条件求值引擎
 *
 * 解析 [] 变量条件标签内的表达式，读取变量状态并求值返回布尔结果。
 * 纯逻辑模块，不关心标签来自哪类条目。
 *
 * 支撑功能：面向用户功能卡 十三·L-1 ~ L-14
 */

import { getValueByPath } from '../shared/path-utils.js';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 对条目文本中所有 [] 变量条件标签求值（多标签 AND）
 *
 * @param text 含标签的文本（如 `["HP" >= 60]["MP" > 0] 战斗设定`）
 * @param data 当前变量快照（最新一层 message.data）
 * @returns 所有标签均通过返回 true；无标签时返回 true（不过滤）
 */
export function evaluateAllConditions(text: string, data: Record<string, any>): boolean {
  const brackets = extractBrackets(text);
  if (brackets.length === 0) return true;

  for (const expr of brackets) {
    if (!evaluateCondition(expr, data)) return false;
  }
  return true;
}

/**
 * 对单个条件表达式求值
 *
 * @param expression 表达式文本（不含定界符 []），如 `"HP" >= 60`
 * @param data 当前变量快照
 * @returns 条件是否满足；解析失败或变量不存在时返回 false
 */
export function evaluateCondition(expression: string, data: Record<string, any>): boolean {
  if (!data) return false;

  const trimmed = expression.trim();
  if (trimmed === '') {
    warn(`空条件表达式`);
    return false;
  }

  // OR 分割：按顶层 | 分割
  const orBranches = splitOrBranches(trimmed);

  // OR 语义：任一分支为 true 即返回 true
  for (const branch of orBranches) {
    try {
      if (evaluateSingleBranch(branch.trim(), data)) return true;
    } catch {
      // 单个 OR 分支解析失败不影响其他分支
    }
  }
  return false;
}

// ═══════════════════════════════════════════
//  内部：单分支求值
// ═══════════════════════════════════════════

/**
 * 求值单个条件分支（不含 OR）
 */
function evaluateSingleBranch(expr: string, data: Record<string, any>): boolean {
  if (expr === '') {
    warn(`空条件分支`);
    return false;
  }

  // NOT 检测
  let negate = false;
  let body = expr;
  if (body.startsWith('!')) {
    negate = true;
    body = body.slice(1).trim();
  }

  const result = evaluateBody(body, data);
  return negate ? !result : result;
}

/**
 * 解析并求值表达式主体（去除 NOT 后的部分）
 */
function evaluateBody(body: string, data: Record<string, any>): boolean {
  // ── 左操作数：引号包裹的变量路径 ──
  const leftParse = parseQuotedString(body, 0);
  if (!leftParse) {
    warn(`无法解析左操作数: ${body}`);
    return false;
  }

  const varPath = leftParse.value;
  let rest = body.slice(leftParse.end).trim();

  // ── 存在性检查 ？ / !? ──
  if (rest === '?') {
    const val = getValueByPath(data, varPath);
    return val !== undefined && val !== null;
  }
  if (rest === '!?') {
    const val = getValueByPath(data, varPath);
    return val === undefined || val === null;
  }

  // ── 长度运算符 # ──
  if (rest.startsWith('#')) {
    rest = rest.slice(1).trim();
    const val = getValueByPath(data, varPath);
    const len = getCollectionLength(val);
    if (len === null) return false;
    return evaluateLengthComparison(len, rest);
  }

  // ── 普通运算符 ──
  const opParse = parseOperator(rest);
  if (!opParse) {
    warn(`无法解析运算符: ${body}`);
    return false;
  }

  const operator = opParse.op;
  rest = rest.slice(opParse.end).trim();

  // ── 右操作数 ──
  const rightValue = parseRightOperand(rest, data);
  if (rightValue === PARSE_FAILED) {
    warn(`无法解析右操作数: ${body}`);
    return false;
  }

  // ── 取左值 ──
  const leftValue = getValueByPath(data, varPath);

  // ── 执行比较 ──
  return compare(leftValue, operator, rightValue);
}

// ═══════════════════════════════════════════
//  内部：解析工具
// ═══════════════════════════════════════════

/** 解析失败哨兵值 */
const PARSE_FAILED = Symbol('PARSE_FAILED');

/**
 * 从指定位置解析引号包裹的字符串
 * 返回 { value, end }，end 是闭引号之后的位置
 */
function parseQuotedString(text: string, start: number): { value: string; end: number } | null {
  let i = start;
  // 跳过空白
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return null;

  const quote = text[i];
  if (quote !== '"' && quote !== "'") return null;

  i++; // 跳过开引号
  let value = '';
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return { value, end: i + 1 };
    }
    value += text[i];
    i++;
  }
  return null; // 未找到闭引号
}

/**
 * 解析运算符（从字符串开头）
 */
function parseOperator(text: string): { op: string; end: number } | null {
  // 按长度降序匹配，避免 === 被 == 先匹配
  const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<', '∋', '!∋', '⊇', '!⊇'];
  for (const op of operators) {
    if (text.startsWith(op)) {
      return { op, end: op.length };
    }
  }
  return null;
}

/**
 * 解析右操作数（字面量或变量引用）
 */
function parseRightOperand(text: string, data: Record<string, any>): any {
  const trimmed = text.trim();
  if (trimmed === '') return PARSE_FAILED;

  // 变量引用：$"变量名"
  if (trimmed.startsWith('$')) {
    const refParse = parseQuotedString(trimmed, 1);
    if (!refParse) return PARSE_FAILED;
    return getValueByPath(data, refParse.value);
  }

  // 布尔字面量
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // null
  if (trimmed === 'null') return null;

  // 字符串字面量（引号包裹）
  const strParse = parseQuotedString(trimmed, 0);
  if (strParse) return strParse.value;

  // 数字字面量
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  return PARSE_FAILED;
}

// ═══════════════════════════════════════════
//  内部：比较逻辑
// ═══════════════════════════════════════════

/**
 * 执行比较操作
 */
function compare(left: any, op: string, right: any): boolean {
  switch (op) {
    // ── 宽松相等 ──
    case '==':
      return looseEqual(left, right);
    case '!=':
      return !looseEqual(left, right);

    // ── 严格相等 ──
    case '===':
      return Object.is(left, right);
    case '!==':
      return !Object.is(left, right);

    // ── 数值比较 ──
    case '>':
    case '>=':
    case '<':
    case '<=':
      return numericCompare(left, op, right);

    // ── 数组含值 ──
    case '∋':
      return arrayContains(left, right);
    case '!∋':
      return !arrayContains(left, right);

    // ── 对象含键 ──
    case '⊇':
      return objectHasKey(left, right);
    case '!⊇':
      return !objectHasKey(left, right);

    default:
      return false;
  }
}

/**
 * 宽松相等：类型不同时尝试 Number/String 转换后比较
 * 字符串场景支持通配符
 */
function looseEqual(left: any, right: any): boolean {
  // 双方都是字符串（含通配符）
  if (typeof left === 'string' && typeof right === 'string') {
    if (hasWildcard(right)) return wildcardMatch(right, left);
    if (hasWildcard(left)) return wildcardMatch(left, right);
    return left === right;
  }
  // 类型相同 → 直接比较
  if (typeof left === typeof right) return left === right;
  // 类型不同 → 尝试数字转换
  const numL = Number(left);
  const numR = Number(right);
  if (!isNaN(numL) && !isNaN(numR)) return numL === numR;
  // 最终退化为字符串比较
  return String(left) === String(right);
}

/** 数值比较 */
function numericCompare(left: any, op: string, right: any): boolean {
  const l = Number(left);
  const r = Number(right);
  if (isNaN(l) || isNaN(r)) return false;
  switch (op) {
    case '==': return l === r;
    case '!=': return l !== r;
    case '>': return l > r;
    case '>=': return l >= r;
    case '<': return l < r;
    case '<=': return l <= r;
    default: return false;
  }
}

/** 数组含值检查（支持通配符） */
function arrayContains(arr: any, value: any): boolean {
  if (!Array.isArray(arr)) return false;
  const strVal = typeof value === 'string' ? value : null;
  for (const item of arr) {
    if (strVal !== null && typeof item === 'string') {
      if (hasWildcard(strVal) ? wildcardMatch(strVal, item) : item === strVal) return true;
    } else if (looseEqual(item, value)) {
      return true;
    }
  }
  return false;
}

/** 对象含键检查（支持通配符） */
function objectHasKey(obj: any, key: any): boolean {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const strKey = String(key);
  if (hasWildcard(strKey)) {
    return Object.keys(obj).some(k => wildcardMatch(strKey, k));
  }
  return strKey in obj;
}

/** 长度比较：# 运算符后的子表达式 */
function evaluateLengthComparison(len: number, rest: string): boolean {
  const opParse = parseOperator(rest);
  if (!opParse) {
    warn(`# 后缺少比较运算符: ${rest}`);
    return false;
  }
  const op = opParse.op;
  const numStr = rest.slice(opParse.end).trim();
  const num = Number(numStr);
  if (isNaN(num)) {
    warn(`# 比较的右操作数不是数字: ${numStr}`);
    return false;
  }
  return numericCompare(len, op, num);
}

/** 获取集合长度（数组或对象） */
function getCollectionLength(val: any): number | null {
  if (Array.isArray(val)) return val.length;
  if (val !== null && typeof val === 'object') return Object.keys(val).length;
  return null;
}

// ═══════════════════════════════════════════
//  内部：通配符匹配
// ═══════════════════════════════════════════

/** 检查字符串是否包含通配符 */
function hasWildcard(s: string): boolean {
  return s.includes('*');
}

/**
 * 通配符模式匹配
 *
 * 规则（与 Schema $enum 通配符一致）：
 * - 1~2 个 *：每个 * 匹配恰好 1 个字符
 * - 3 个及以上 *：连续 * 组匹配任意数量字符（0 到无穷）
 * - 大小写不敏感
 */
function wildcardMatch(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  const chars = Array.from(p);
  const starCount = chars.filter(c => c === '*').length;

  if (starCount === 0) return p === t;

  const regexStr = buildWildcardRegex(chars, starCount);
  try {
    return new RegExp('^' + regexStr + '$', 'su').test(t);
  } catch {
    return false;
  }
}

function buildWildcardRegex(chars: string[], starCount: number): string {
  const parts: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '*') {
      if (starCount <= 2) {
        parts.push('.');
        i++;
      } else {
        while (i < chars.length && chars[i] === '*') i++;
        parts.push('.*');
      }
    } else {
      parts.push(chars[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      i++;
    }
  }
  return parts.join('');
}

// ═══════════════════════════════════════════
//  内部：括号提取
// ═══════════════════════════════════════════

/**
 * 从文本中提取所有 [] 定界符内的内容
 *
 * 规则：
 * - 反斜杠转义 \[...\] 不被识别
 * - 反引号区域 `[...]` 不被识别
 * - 支持 Unicode
 */
function extractBrackets(text: string): string[] {
  if (!text) return [];

  const results: string[] = [];
  const chars = Array.from(text);
  const len = chars.length;
  let i = 0;
  let inBacktick = false;

  while (i < len) {
    const ch = chars[i];

    // 反引号区域
    if (ch === '`') {
      inBacktick = !inBacktick;
      i++;
      continue;
    }
    if (inBacktick) {
      i++;
      continue;
    }

    // 转义 \[
    if (ch === '\\' && i + 1 < len && chars[i + 1] === '[') {
      i += 2;
      continue;
    }

    // 方括号开始
    if (ch === '[') {
      let depth = 1;
      let j = i + 1;
      while (j < len && depth > 0) {
        if (chars[j] === '\\' && j + 1 < len && chars[j + 1] === ']') {
          j += 2;
          continue;
        }
        if (chars[j] === '[') depth++;
        else if (chars[j] === ']') depth--;
        j++;
      }
      if (depth === 0) {
        // 提取 [ 和 ] 之间的内容
        const content = chars.slice(i + 1, j - 1).join('');
        results.push(content);
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return results;
}

// ═══════════════════════════════════════════
//  内部：OR 分割
// ═══════════════════════════════════════════

/**
 * 按顶层 | 分割表达式为 OR 分支
 * 引号内的 | 不分割
 */
function splitOrBranches(expr: string): string[] {
  const branches: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    // 转义字符
    if (ch === '\\' && i + 1 < expr.length) {
      current += ch + expr[i + 1];
      i += 2;
      continue;
    }

    // 引号状态跟踪
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === inQuote) {
      inQuote = null;
      current += ch;
      i++;
      continue;
    }

    // 顶层 |
    if (ch === '|' && !inQuote) {
      branches.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  branches.push(current);
  return branches;
}

// ═══════════════════════════════════════════
//  内部：日志
// ═══════════════════════════════════════════

function warn(msg: string): void {
  try {
    console.warn(`[VarUpdate][cond] ${msg}`);
  } catch {
    // 静默
  }
}
