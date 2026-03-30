/**
 * shared/wildcard.ts
 *
 * 全局通配符匹配引擎
 * 用于条件表达式右侧匹配、Schema 规则判断，以及变量寻址路径中的分叉收集。
 */

/** 检查字符串是否包含通配符 */
export function hasWildcard(s: string): boolean {
  return typeof s === 'string' && s.includes('*');
}

/**
 * 通配符模式匹配
 *
 * 规则（全系统通用）：
 * - 1~2 个 *：每个 * 匹配恰好 1 个字符
 * - 3 个及以上 *：连续 * 组匹配任意数量字符（0 到无穷）
 * - 大小写不敏感
 */
export function wildcardMatch(pattern: string, text: string): boolean {
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
      // 转义其他正则元字符
      parts.push(chars[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      i++;
    }
  }
  return parts.join('');
}
