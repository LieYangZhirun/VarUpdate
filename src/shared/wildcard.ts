/**
 * shared/wildcard.ts
 * 
 * 字符串通配符匹配工具库
 * 规则（与 Schema $enum 通配符一致）：
 * - 1~2 个 *：每个 * 匹配恰好 1 个字符
 * - 3 个及以上 *：连续 * 组匹配任意数量字符（0 到无穷）
 * - 大小写不敏感
 */

/** 检查字符串是否包含通配符 */
export function hasWildcard(s: string): boolean {
  return s.includes('*');
}

/**
 * 通配符模式匹配
 *
 * 根据自定义星号长度生成正则表达式并测试。
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

/** 组装通配符的底层正则表达式字符串 */
export function buildWildcardRegex(chars: string[], starCount: number): string {
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
