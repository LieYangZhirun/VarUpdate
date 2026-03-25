/**
 * modules/tag-extractor.ts
 *
 * 模块 5：消息标签提取器
 *
 * 从消息文本中识别并提取 <Var_Initial> / <Var_Update> 标签及其内容。
 * 采用分步检测策略：先确认开标签存在，再检查闭标签完整性。
 *
 * 标签名标准化规则：转小写 → 移除下划线 → 匹配
 * 支持宽松命名：VarUpdate / var_update / variable_update 等均等价
 */

import type { ExtractedTag, ExtractionResult } from '../types/index.js';

// ═══════════════════════════════════════════
//  标签名标准化
// ═══════════════════════════════════════════

/** 标准化标签名：转小写 + 移除下划线/连字符 */
function normalizeTagName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

/** 所有等价于 Var_Update 的标准化名称 */
const UPDATE_NAMES = new Set(['varupdate', 'variableupdate']);

/** 所有等价于 Var_Initial 的标准化名称 */
const INITIAL_NAMES = new Set(['varinitial', 'variableinitial']);

/**
 * 判断标准化后的标签名属于哪种类型
 */
function classifyTag(normalizedName: string): 'update' | 'initial' | null {
  if (UPDATE_NAMES.has(normalizedName)) return 'update';
  if (INITIAL_NAMES.has(normalizedName)) return 'initial';
  return null;
}

// ═══════════════════════════════════════════
//  标签扫描正则
// ═══════════════════════════════════════════

/**
 * 匹配开标签的正则（宽松）
 * 分组 1：标签名（不含 < > ）
 *
 * 排除：反斜杠转义 \<Tag>、行内代码块 `<Tag>`
 */
const OPEN_TAG_REGEX = /(?<!\\)(?<!`)<(\/?)(\w+)>(?!`)/g;

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/**
 * 从消息文本中提取所有变量标签
 *
 * @param messageText 完整的消息文本（始终从 chat[].mes 原始数据读取）
 * @returns 提取结果
 */
export function extractVarTags(messageText: string): ExtractionResult {
  const result: ExtractionResult = {
    tags: [],
    truncated: false,
  };

  if (!messageText) return result;

  // 收集所有标签位置
  interface TagPosition {
    type: 'update' | 'initial';
    isClose: boolean;
    name: string;
    index: number;
    fullMatch: string;
  }

  const positions: TagPosition[] = [];

  // 先排除代码块内的内容
  const codeBlockRanges = getCodeBlockRanges(messageText);

  let match: RegExpExecArray | null;
  const regex = new RegExp(OPEN_TAG_REGEX.source, 'g');

  while ((match = regex.exec(messageText)) !== null) {
    // 跳过代码块内的标签
    if (isInCodeBlock(match.index, codeBlockRanges)) continue;

    const isClose = match[1] === '/';
    const tagName = match[2];
    const normalized = normalizeTagName(tagName);
    const tagType = classifyTag(normalized);

    if (tagType) {
      positions.push({
        type: tagType,
        isClose,
        name: normalized,
        index: match.index,
        fullMatch: match[0],
      });
    }
  }

  // 匹配开闭标签对
  const openStack: TagPosition[] = [];

  for (const pos of positions) {
    if (!pos.isClose) {
      // 开标签 → 入栈
      openStack.push(pos);
    } else {
      // 闭标签 → 查找匹配的开标签
      // 从栈中查找同类型的最近开标签
      let foundIdx = -1;
      for (let i = openStack.length - 1; i >= 0; i--) {
        if (openStack[i].type === pos.type) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx !== -1) {
        const openTag = openStack[foundIdx];
        openStack.splice(foundIdx, 1);

        // 提取标签间的内容
        const contentStart = openTag.index + openTag.fullMatch.length;
        const contentEnd = pos.index;
        const content = messageText.substring(contentStart, contentEnd);

        result.tags.push({
          type: openTag.type,
          content,
          startIndex: openTag.index,
          endIndex: pos.index + pos.fullMatch.length,
        });
      }
    }
  }

  // 检查未闭合的开标签（截断检测）
  if (openStack.length > 0) {
    result.truncated = true;
    result.truncatedType = openStack[openStack.length - 1].type;
  }

  // 按出现顺序排序
  result.tags.sort((a, b) => a.startIndex - b.startIndex);

  return result;
}

// ═══════════════════════════════════════════
//  代码块检测
// ═══════════════════════════════════════════

/**
 * 获取文本中所有代码块的范围（行内 `...` 和围栏 ```...```）
 */
function getCodeBlockRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // 围栏代码块 ```...```
  const fenceRegex = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  // 行内代码 `...`（不与围栏重叠）
  const inlineRegex = /`[^`]+`/g;
  while ((m = inlineRegex.exec(text)) !== null) {
    if (!isInCodeBlock(m.index, ranges)) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  return ranges;
}

/**
 * 判断位置是否在代码块内
 */
function isInCodeBlock(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}
